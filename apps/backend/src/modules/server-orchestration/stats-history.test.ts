/**
 * Verlauf der Messwerte – Bausteine (Arbeitspaket P5).
 *
 * Geprüft werden die beiden Teile, die ohne Datenbank und ohne Agent auskommen:
 * die Umwandlung in das DTO, das das Diagramm liest, und der Zwischenspeicher
 * der Server-Abfrage – vor allem, dass er veraltete Werte **nicht**
 * fortschreibt.
 */

import { describe, expect, it } from 'vitest';
import { type ServerLoadSnapshot } from '../resources/index.js';
import {
  CLOCK_SKEW_LOG_INTERVAL_MS,
  CLOCK_SKEW_TOLERANCE_MS,
  ClockSkewMonitor,
  LIVE_ENGINE_STATS_MAX_AGE_MS,
  LatestDiskUsageCache,
  LatestEngineStatsCache,
  LatestQueryCache,
  ServerLoadRegistry,
  type StatsSample,
  cpuCoresFromPercent,
  toLiveStats,
  toStatsHistoryDto,
} from './stats-history.js';
import { EMPTY_ENGINE_STATS } from './live-events.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';

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

/**
 * Zwischenspeicher des Plattenplatzes (Fundpunkt 175).
 *
 * Er ist die Brücke zwischen Abtastung und Live-Kanal: Der Wert kommt nur auf
 * `GET_STATS` an, gebraucht wird er aber bei jedem `STATS_UPDATE`.
 */
describe('Zwischenspeicher des Plattenplatzes', () => {
  const JETZT = new Date('2026-09-01T10:00:00.000Z');

  it('gibt den zuletzt gemessenen Wert zurück', () => {
    const cache = new LatestDiskUsageCache(5 * 60 * 1000);
    cache.remember(SERVER_ID, 3_072, JETZT);

    expect(cache.read(SERVER_ID, JETZT)).toBe(3_072);
  });

  it('kennt einen Server ohne Messung nicht', () => {
    expect(new LatestDiskUsageCache(60_000).read(SERVER_ID, JETZT)).toBeNull();
  });

  it('lässt eine ausgebliebene Messung den bekannten Wert nicht löschen', () => {
    /*
     * `null` heißt „nicht gemessen": Der Agent kennt das Feld nicht, hat den
     * Ordner noch nicht durchlaufen oder konnte ihn nicht lesen. Verdrängte das
     * den bekannten Wert, spränge die Anzeige bei jedem misslungenen Durchlauf
     * auf „—" – und eine 0 daraus zu machen wäre noch schlimmer: Die
     * Schwellwert-Prüfung rechnete „0 % belegt" und schwiege auch bei voller
     * Platte.
     */
    const cache = new LatestDiskUsageCache(60_000);
    cache.remember(SERVER_ID, 3_072, JETZT);
    cache.remember(SERVER_ID, null, JETZT);

    expect(cache.read(SERVER_ID, JETZT)).toBe(3_072);
  });

  it('schreibt einen veralteten Wert nicht fort', () => {
    const cache = new LatestDiskUsageCache(60_000);
    cache.remember(SERVER_ID, 3_072, JETZT);

    expect(cache.read(SERVER_ID, new Date(JETZT.getTime() + 61_000))).toBeNull();
  });

  it('lässt einen Wert weit aus der Zukunft verfallen (W2-14)', () => {
    const cache = new LatestDiskUsageCache(60_000);
    cache.remember(SERVER_ID, 3_072, new Date(JETZT.getTime() + CLOCK_SKEW_TOLERANCE_MS + 1_000));

    expect(cache.read(SERVER_ID, JETZT)).toBeNull();
  });

  it('vergisst einen gelöschten Server', () => {
    /*
     * Sonst hinge der Wert bis zum Neustart des Backends am gelöschten Server –
     * kleines, aber unbegrenztes Wachstum (Fundpunkt 137).
     */
    const cache = new LatestDiskUsageCache(60_000);
    cache.remember(SERVER_ID, 3_072, JETZT);
    cache.forget(SERVER_ID);

    expect(cache.read(SERVER_ID, JETZT)).toBeNull();
  });
});

/**
 * Zwischenspeicher der Engine-Messwerte (Fundpunkt 179).
 *
 * Er überbrückt den Abfrage-Rahmen: Unter `STATS_UPDATE` fließen zwei
 * Nutzlasten, und nur eine misst CPU, Arbeitsspeicher und Netzverkehr.
 *
 * Anders als die beiden anderen Speicher hat er eine **kurze** Frist, und die
 * ist der eigentliche Gegenstand dieser Prüfungen: `ServerLiveStats` trägt nur
 * einen Zeitstempel für den ganzen Satz, ein gemerkter Wert wird also mit der
 * Empfangszeit des Abfrage-Rahmens ausgeliefert. Das Fenster ist damit genau
 * die Spanne, um die ein Wert älter sein kann, als er aussieht – und darf
 * deshalb nicht wachsen.
 */
describe('Zwischenspeicher der Engine-Messwerte (Fundpunkt 179)', () => {
  const JETZT = new Date('2026-09-01T10:00:00.000Z');
  const STAND = {
    cpuPercent: 42.5,
    ramUsedMb: 2_048,
    networkRxBytes: 1_024,
    networkTxBytes: 2_048,
    networkRxPackets: 12,
    networkTxPackets: 8,
  };

  it('gibt den zuletzt gemeldeten Stand zurück', () => {
    const cache = new LatestEngineStatsCache();
    cache.remember(SERVER_ID, STAND, JETZT);

    expect(cache.read(SERVER_ID, JETZT)).toEqual(STAND);
  });

  it('kennt einen Server ohne Meldung nicht', () => {
    expect(new LatestEngineStatsCache().read(SERVER_ID, JETZT)).toEqual(EMPTY_ENGINE_STATS);
  });

  it('lässt einen Rahmen ohne jede Zahl den bekannten Stand nicht löschen', () => {
    // Meldet die Runtime für einen Rahmen zu allem `null`, ist das keine
    // Messung. Verdrängte das den bekannten Stand, spränge die Anzeige bei
    // jedem solchen Rahmen auf „—".
    const cache = new LatestEngineStatsCache();
    cache.remember(SERVER_ID, STAND, JETZT);
    cache.remember(SERVER_ID, EMPTY_ENGINE_STATS, JETZT);

    expect(cache.read(SERVER_ID, JETZT)).toEqual(STAND);
  });

  /*
   * **Der Test, der umfällt, wenn jemand die Entscheidung zurückdreht.**
   *
   * Das ist der Preis dieses Wegs: Ein gemerkter Wert wird mit der Empfangszeit
   * des Abfrage-Rahmens ausgeliefert, sieht also frischer aus, als er ist. Die
   * Frist ist die einzige Schranke dagegen. Wer sie auf die fünf Minuten der
   * beiden anderen Speicher „vereinheitlicht", liefert eine CPU-Last von vor
   * fünf Minuten als aktuelle Messung aus – hier fällt das auf.
   */
  it('liefert einen Stand nicht mehr aus, sobald er einen Abfrage-Takt überdauert hat', () => {
    const cache = new LatestEngineStatsCache();
    cache.remember(SERVER_ID, STAND, JETZT);

    // Ein Abfrage-Rahmen kommt frühestens nach `AGENT_QUERY_INTERVAL_SECONDS`
    // (Vorgabe 60 s). So alt darf ein Engine-Wert nie werden.
    expect(cache.read(SERVER_ID, new Date(JETZT.getTime() + 60_000))).toEqual(EMPTY_ENGINE_STATS);
  });

  it('hält die Vorgabe-Frist beim Zehnfachen des Strom-Takts', () => {
    // Der Statistik-Strom liefert etwa einmal je Sekunde. Das Fenster braucht
    // Luft für einen Aussetzer, mehr aber auch nicht: Es ist die Spanne, um die
    // eine Zahl das beschriebene Geschehen überleben kann.
    expect(LIVE_ENGINE_STATS_MAX_AGE_MS).toBe(10_000);

    const cache = new LatestEngineStatsCache();
    cache.remember(SERVER_ID, STAND, JETZT);

    expect(cache.read(SERVER_ID, new Date(JETZT.getTime() + LIVE_ENGINE_STATS_MAX_AGE_MS))).toEqual(
      STAND,
    );
    expect(
      cache.read(SERVER_ID, new Date(JETZT.getTime() + LIVE_ENGINE_STATS_MAX_AGE_MS + 1)),
    ).toEqual(EMPTY_ENGINE_STATS);
  });

  it('lässt einen Stand weit aus der Zukunft verfallen (W2-14)', () => {
    const cache = new LatestEngineStatsCache();
    cache.remember(SERVER_ID, STAND, new Date(JETZT.getTime() + CLOCK_SKEW_TOLERANCE_MS + 1_000));

    expect(cache.read(SERVER_ID, JETZT)).toEqual(EMPTY_ENGINE_STATS);
  });

  it('vergisst einen gelöschten Server', () => {
    const cache = new LatestEngineStatsCache();
    cache.remember(SERVER_ID, STAND, JETZT);
    cache.forget(SERVER_ID);

    expect(cache.read(SERVER_ID, JETZT)).toEqual(EMPTY_ENGINE_STATS);
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

/**
 * Umrechnung von `cpuPercent` in Kerne (Lastenheft §3.3, Warnung auf
 * Server-Ebene).
 *
 * Die Stelle, an der ein stiller Faktor 100 entstehen kann: Der Vertrag misst
 * Prozent **eines Kerns**, die Schwellwertprüfung rechnet in Kernen gegen
 * `resourceLimits.cpuCores`. Wer beides verwechselt, bekommt entweder in jedem
 * Takt eine Warnung oder nie eine – und merkt es lange nicht.
 */
describe('cpuPercent in Kerne', () => {
  it('liest einen Wert über 100 als mehrere Kerne', () => {
    // 250 % eines Kerns sind 2,5 ausgelastete Kerne – nicht 250 % des
    // Kontingents. Gegenprobe zur naheliegenden Fehlrechnung.
    expect(cpuCoresFromPercent(250)).toBe(2.5);
    expect(cpuCoresFromPercent(380)).toBe(3.8);
  });

  it('rechnet Werte unter 100 auf einen Bruchteil eines Kerns', () => {
    expect(cpuCoresFromPercent(42.5)).toBe(0.425);
    expect(cpuCoresFromPercent(0)).toBe(0);
  });

  it('macht aus „kein Messwert" keine Null', () => {
    expect(cpuCoresFromPercent(null)).toBeNull();
  });
});

describe('Stand der Server-Last', () => {
  const JETZT = new Date('2026-09-01T10:00:00.000Z');
  const TAKT_MS = 60_000;

  function last(overrides: Partial<ServerLoadSnapshot> = {}): ServerLoadSnapshot {
    return {
      serverId: SERVER_ID,
      nodeId: NODE_ID,
      ownerId: OWNER_ID,
      limits: { ramMb: 4096, cpuCores: 2, diskMb: 20_480 },
      usedRamMb: 3900,
      usedCpuCores: 0.4,
      usedDiskMb: null,
      ...overrides,
    };
  }

  it('liefert den zuletzt geschriebenen Stand einer Node', () => {
    const stand = new ServerLoadRegistry(2 * TAKT_MS);
    stand.replace(NODE_ID, [last()], JETZT);

    expect(stand.list(JETZT)).toEqual([last()]);
  });

  it('ersetzt den Stand einer Node vollständig, statt ihn zu ergänzen', () => {
    // Der Fall „Server gestoppt": Er taucht in der nächsten Abtastung nicht
    // mehr auf und darf danach keine Warnung mehr auslösen.
    const stand = new ServerLoadRegistry(2 * TAKT_MS);
    const zweiter = '44444444-4444-4444-8444-000000000001';

    stand.replace(NODE_ID, [last(), last({ serverId: zweiter })], JETZT);
    stand.replace(NODE_ID, [last()], new Date(JETZT.getTime() + TAKT_MS));

    expect(
      stand.list(new Date(JETZT.getTime() + TAKT_MS)).map((eintrag) => eintrag.serverId),
    ).toEqual([SERVER_ID]);
  });

  it('hält Nodes auseinander', () => {
    const stand = new ServerLoadRegistry(2 * TAKT_MS);
    const andere = '55555555-5555-4555-8555-000000000002';

    stand.replace(NODE_ID, [last()], JETZT);
    stand.replace(andere, [last({ nodeId: andere })], JETZT);

    expect(stand.list(JETZT)).toHaveLength(2);
  });

  it('lässt einen Stand nach zwei Takten verfallen', () => {
    // Zwei Takte ohne Messung heißen: Der Agent ist weg oder die Abtastung
    // scheitert. Auf so einen Wert hin zu warnen wäre eine Meldung über einen
    // Zustand, den niemand mehr misst.
    const stand = new ServerLoadRegistry(2 * TAKT_MS);
    stand.replace(NODE_ID, [last()], JETZT);

    expect(stand.list(new Date(JETZT.getTime() + 2 * TAKT_MS))).toHaveLength(1);
    expect(stand.list(new Date(JETZT.getTime() + 2 * TAKT_MS + 1))).toEqual([]);
  });

  it('lässt einen Stand weit aus der Zukunft verfallen', () => {
    // Sonst altert er nie – dieselbe Falle wie beim Zwischenspeicher der
    // Server-Abfrage (W2-14).
    const stand = new ServerLoadRegistry(2 * TAKT_MS);
    stand.replace(NODE_ID, [last()], new Date(JETZT.getTime() + 2 * 60 * 60 * 1000));

    expect(stand.list(JETZT)).toEqual([]);
  });

  it('vergisst eine Node auf Anforderung', () => {
    const stand = new ServerLoadRegistry(2 * TAKT_MS);
    stand.replace(NODE_ID, [last()], JETZT);
    stand.forget(NODE_ID);

    expect(stand.list(JETZT)).toEqual([]);
  });
});
