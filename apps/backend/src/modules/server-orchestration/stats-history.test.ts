/**
 * Verlauf der Messwerte – Bausteine (Arbeitspaket P5).
 *
 * Geprüft werden die beiden Teile, die ohne Datenbank und ohne Agent auskommen:
 * die Umwandlung in das DTO, das das Diagramm liest, und der Zwischenspeicher
 * der Server-Abfrage – vor allem, dass er veraltete Werte **nicht**
 * fortschreibt.
 */

import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_LOG_INTERVAL_MS,
  CLOCK_SKEW_TOLERANCE_MS,
  ClockSkewMonitor,
  LatestQueryCache,
  type StatsSample,
  toLiveStats,
  toStatsHistoryDto,
} from './stats-history.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';

function probe(overrides: Partial<StatsSample> = {}): StatsSample {
  return {
    serverId: SERVER_ID,
    recordedAt: new Date('2026-09-01T10:00:00.000Z'),
    cpuPercent: 42.5,
    ramUsedMb: 1024,
    diskUsedMb: null,
    pingMs: 12,
    playersOnline: 3,
    playersMax: 20,
    networkRxBytes: 5_000,
    networkTxBytes: 6_000,
    ...overrides,
  };
}

describe('Umwandlung in das Diagramm-Format', () => {
  it('liefert genau die Felder von ServerLiveStats', () => {
    expect(toLiveStats(probe())).toEqual({
      cpuPercent: 42.5,
      ramUsedMb: 1024,
      diskUsedMb: null,
      pingMs: 12,
      playersOnline: 3,
      playersMax: 20,
      networkRxBytes: 5_000,
      networkTxBytes: 6_000,
      updatedAt: '2026-09-01T10:00:00.000Z',
    });
  });

  it('behält die Reihenfolge der Stichproben bei', () => {
    const dto = toStatsHistoryDto(SERVER_ID, 60, 60, [
      probe({ recordedAt: new Date('2026-09-01T10:00:00.000Z'), cpuPercent: 1 }),
      probe({ recordedAt: new Date('2026-09-01T10:01:00.000Z'), cpuPercent: 2 }),
    ]);

    expect(dto).toMatchObject({ serverId: SERVER_ID, windowMinutes: 60, intervalSeconds: 60 });
    expect(dto.samples.map((sample) => sample.cpuPercent)).toEqual([1, 2]);
  });

  it('liefert eine leere Reihe, wenn nichts gemessen wurde', () => {
    expect(toStatsHistoryDto(SERVER_ID, 60, 60, []).samples).toEqual([]);
  });
});

describe('Zwischenspeicher der Server-Abfrage', () => {
  const JETZT = new Date('2026-09-01T10:00:00.000Z');

  it('gibt die zuletzt gemeldeten Werte zurück', () => {
    const cache = new LatestQueryCache(5 * 60 * 1000);
    cache.remember(SERVER_ID, { playersOnline: 4, playersMax: 20, pingMs: 9 }, JETZT);

    expect(cache.read(SERVER_ID, JETZT)).toEqual({
      playersOnline: 4,
      playersMax: 20,
      pingMs: 9,
      // Ohne gemeldete Namen bleibt die Liste leer (Gefundener Punkt 51).
      players: [],
    });
  });

  it('merkt sich die gemeldeten Spielernamen (Gefundener Punkt 51)', () => {
    const cache = new LatestQueryCache(60_000);
    cache.remember(
      SERVER_ID,
      { playersOnline: 2, playersMax: 20, pingMs: 9, players: [{ name: 'Ana' }, { name: 'Bo' }] },
      JETZT,
    );

    expect(cache.read(SERVER_ID, JETZT).players).toEqual([{ name: 'Ana' }, { name: 'Bo' }]);
  });

  it('schreibt veraltete Werte nicht fort', () => {
    const cache = new LatestQueryCache(60_000);
    cache.remember(SERVER_ID, { playersOnline: 4, playersMax: 20, pingMs: 9 }, JETZT);

    expect(cache.read(SERVER_ID, new Date(JETZT.getTime() + 61_000))).toEqual({
      playersOnline: null,
      playersMax: null,
      pingMs: null,
      // Auch die Namensliste altert mit.
      players: [],
    });
  });

  it('kennt einen Server ohne Meldung nicht', () => {
    expect(new LatestQueryCache(60_000).read(SERVER_ID, JETZT)).toEqual({
      playersOnline: null,
      playersMax: null,
      pingMs: null,
      players: [],
    });
  });

  it('vergisst einen Server auf Anforderung', () => {
    const cache = new LatestQueryCache(60_000);
    cache.remember(SERVER_ID, { playersOnline: 4, playersMax: 20, pingMs: 9 }, JETZT);
    cache.forget(SERVER_ID);

    expect(cache.read(SERVER_ID, JETZT).playersOnline).toBeNull();
  });

  it('duldet einen Eintrag knapp aus der Zukunft (W2-14)', () => {
    // Innerhalb des Toleranzfensters bleibt der Wert gültig: Ein Sprung der
    // Backend-Uhr um Sekunden darf keine Messung kosten.
    const cache = new LatestQueryCache(60_000);
    cache.remember(
      SERVER_ID,
      { playersOnline: 4, playersMax: 20, pingMs: 9 },
      new Date(JETZT.getTime() + 30_000),
    );

    expect(cache.read(SERVER_ID, JETZT).playersOnline).toBe(4);
  });

  it('lässt einen Eintrag weit aus der Zukunft verfallen (W2-14)', () => {
    /*
     * Sonst altert er nie: `jetzt − at` bliebe negativ, der Wert damit für
     * immer „frisch" – eine Spielerzahl von vor Stunden stünde dauerhaft als
     * aktuelle Anzeige (orchestration-features-03, umgekehrter Skew).
     */
    const cache = new LatestQueryCache(60_000);
    cache.remember(
      SERVER_ID,
      { playersOnline: 4, playersMax: 20, pingMs: 9 },
      new Date(JETZT.getTime() + 2 * 60 * 60 * 1000),
    );

    expect(cache.read(SERVER_ID, JETZT)).toEqual({
      playersOnline: null,
      playersMax: null,
      pingMs: null,
      players: [],
    });
  });
});

/**
 * Uhrenabgleich Agent ↔ Backend (Audit W2-14, orchestration-features-03).
 *
 * Kern der Maßnahme: Der Messwert trägt **immer** die Empfangszeit des
 * Backends. Die gemeldete Zeit des Agents entscheidet nichts mehr – sie wird
 * nur noch als Abweichung protokolliert, und das gedrosselt.
 */
describe('Uhrenabgleich mit dem Agent', () => {
  const EMPFANGEN = new Date('2026-09-01T10:00:00.000Z');
  const versetzt = (ms: number): string => new Date(EMPFANGEN.getTime() + ms).toISOString();

  it('nimmt die Empfangszeit als Messzeit, auch wenn die Agent-Uhr 90 s vorgeht', () => {
    const monitor = new ClockSkewMonitor();

    const ergebnis = monitor.check(SERVER_ID, versetzt(90_000), EMPFANGEN);

    expect(ergebnis.recordedAt).toEqual(EMPFANGEN);
    expect(ergebnis.skewMs).toBe(90_000);
    expect(ergebnis.outsideTolerance).toBe(true);
    expect(ergebnis.shouldLog).toBe(true);
  });

  it('nimmt die Empfangszeit auch, wenn die Agent-Uhr 90 s nachgeht', () => {
    const monitor = new ClockSkewMonitor();

    const ergebnis = monitor.check(SERVER_ID, versetzt(-90_000), EMPFANGEN);

    expect(ergebnis.recordedAt).toEqual(EMPFANGEN);
    expect(ergebnis.skewMs).toBe(-90_000);
    expect(ergebnis.outsideTolerance).toBe(true);
  });

  it('schweigt innerhalb des Toleranzfensters', () => {
    const monitor = new ClockSkewMonitor();

    const ergebnis = monitor.check(SERVER_ID, versetzt(CLOCK_SKEW_TOLERANCE_MS - 1), EMPFANGEN);

    expect(ergebnis.outsideTolerance).toBe(false);
    expect(ergebnis.shouldLog).toBe(false);
    expect(ergebnis.recordedAt).toEqual(EMPFANGEN);
  });

  it('meldet dieselbe Abweichung nur einmal je Sperrfrist, nicht je Meldung', () => {
    const monitor = new ClockSkewMonitor();
    const gemeldet: boolean[] = [];

    // Drei Frames dicht hintereinander – im Betrieb kommen sie im Sekundentakt.
    for (const versatzMs of [0, 1_000, 2_000]) {
      const jetzt = new Date(EMPFANGEN.getTime() + versatzMs);
      gemeldet.push(monitor.check(SERVER_ID, versetzt(3 * 60 * 60 * 1000), jetzt).shouldLog);
    }

    expect(gemeldet).toEqual([true, false, false]);

    // Nach Ablauf der Sperrfrist wieder – der Zustand soll ja auffallen,
    // solange er anhält.
    const spaeter = new Date(EMPFANGEN.getTime() + CLOCK_SKEW_LOG_INTERVAL_MS);

    expect(monitor.check(SERVER_ID, versetzt(3 * 60 * 60 * 1000), spaeter).shouldLog).toBe(true);
  });

  it('drosselt je Server getrennt', () => {
    const monitor = new ClockSkewMonitor();
    const zweiter = '22222222-2222-4222-8222-222222222222';

    expect(monitor.check(SERVER_ID, versetzt(90_000), EMPFANGEN).shouldLog).toBe(true);
    expect(monitor.check(zweiter, versetzt(90_000), EMPFANGEN).shouldLog).toBe(true);
  });

  it('meldet erneut, sobald die Uhr wieder stimmt und danach wegläuft', () => {
    const monitor = new ClockSkewMonitor();

    expect(monitor.check(SERVER_ID, versetzt(90_000), EMPFANGEN).shouldLog).toBe(true);
    // Uhr wieder im Rahmen: Die Drosselung wird zurückgesetzt.
    expect(monitor.check(SERVER_ID, versetzt(0), EMPFANGEN).shouldLog).toBe(false);
    expect(monitor.check(SERVER_ID, versetzt(90_000), EMPFANGEN).shouldLog).toBe(true);
  });

  it('kommt ohne lesbaren Zeitstempel aus, statt zu raten', () => {
    const monitor = new ClockSkewMonitor();

    for (const gemeldet of [undefined, 'irgendwann']) {
      const ergebnis = monitor.check(SERVER_ID, gemeldet, EMPFANGEN);

      expect(ergebnis.recordedAt).toEqual(EMPFANGEN);
      expect(ergebnis.skewMs).toBeNull();
      expect(ergebnis.outsideTolerance).toBe(false);
      expect(ergebnis.shouldLog).toBe(false);
    }
  });

  it('vergisst eine Quelle auf Anforderung', () => {
    const monitor = new ClockSkewMonitor();
    monitor.check(SERVER_ID, versetzt(90_000), EMPFANGEN);
    monitor.forget(SERVER_ID);

    expect(monitor.check(SERVER_ID, versetzt(90_000), EMPFANGEN).shouldLog).toBe(true);
  });
});
