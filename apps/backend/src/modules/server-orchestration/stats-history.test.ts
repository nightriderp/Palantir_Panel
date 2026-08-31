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
});
