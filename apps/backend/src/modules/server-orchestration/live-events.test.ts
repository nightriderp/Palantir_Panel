/**
 * Tests der Übersetzung Agent-Ereignis → Live-Kanal (Gefundener Punkt 101).
 *
 * Geprüft werden die beiden Nutzlasten, die unter dem Namen `STATS_UPDATE`
 * fließen, und die Konsolenzeile aus `LOG_LINE` – jeweils gegen die Formen aus
 * `@palantir/contracts`. Reine Funktionen, deshalb ohne Fakes und ohne
 * Datenbank.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_QUERY_SNAPSHOT,
  consoleLineFromAgentPayload,
  containerIdFromPayload,
  isServerQueryPayload,
  liveStatsFromAgentPayload,
  querySnapshotFromPayload,
} from './live-events.js';

const SERVER_ID = '44444444-4444-4444-8444-000000000001';
const EMITTED_AT = '2026-08-31T12:00:00.000Z';

/** Messwerte, wie die Container-Runtime sie meldet (`AgentContainerStats` plus `at`). */
const RUNTIME_STATS = {
  containerId: 'palantir-container-1',
  cpuPercent: 42.5,
  memoryUsedBytes: 2 * 1024 * 1024 * 1024,
  memoryLimitBytes: 4 * 1024 * 1024 * 1024,
  networkRxBytes: 1_024,
  networkTxBytes: 2_048,
  blockReadBytes: 0,
  blockWriteBytes: 0,
  pids: 12,
  sampledAt: '2026-08-31T11:59:59.000Z',
  at: EMITTED_AT,
};

/** Ergebnis der Server-Abfrage des Agents (`AgentServerQueryPayload`). */
const QUERY_PAYLOAD = {
  source: 'serverQuery',
  containerId: 'palantir-container-1',
  reachable: true,
  playersOnline: 7,
  playersMax: 20,
  pingMs: 23,
  reason: null,
  at: '2026-08-31T11:59:58.000Z',
};

describe('containerIdFromPayload', () => {
  it('liest die Container-Id, sonst null', () => {
    expect(containerIdFromPayload(RUNTIME_STATS)).toBe('palantir-container-1');
    expect(containerIdFromPayload({ containerId: '' })).toBeNull();
    expect(containerIdFromPayload({})).toBeNull();
    expect(containerIdFromPayload(undefined)).toBeNull();
  });
});

describe('isServerQueryPayload', () => {
  it('unterscheidet die beiden STATS_UPDATE-Nutzlasten am Kennzeichen', () => {
    expect(isServerQueryPayload(QUERY_PAYLOAD)).toBe(true);
    expect(isServerQueryPayload(RUNTIME_STATS)).toBe(false);
    expect(isServerQueryPayload(null)).toBe(false);
  });
});

describe('liveStatsFromAgentPayload', () => {
  it('rechnet die Messwerte der Container-Runtime in ServerLiveStats um', () => {
    const stats = liveStatsFromAgentPayload(
      RUNTIME_STATS,
      { playersOnline: 3, playersMax: 20, pingMs: 15, players: [] },
      EMITTED_AT,
    );

    expect(stats).toEqual({
      cpuPercent: 42.5,
      // 2 GiB in MiB – `ServerLiveStats` zählt in MiB, der Agent in Bytes.
      ramUsedMb: 2_048,
      diskUsedMb: null,
      // Spielerzahl und Antwortzeit kennt die Engine nicht; sie kommen aus der
      // zuletzt gemeldeten Abfrage.
      pingMs: 15,
      playersOnline: 3,
      playersMax: 20,
      networkRxBytes: 1_024,
      networkTxBytes: 2_048,
      updatedAt: '2026-08-31T11:59:59.000Z',
    });
  });

  it('füllt aus der Server-Abfrage nur, was sie misst', () => {
    const stats = liveStatsFromAgentPayload(QUERY_PAYLOAD, EMPTY_QUERY_SNAPSHOT, EMITTED_AT);

    expect(stats).toEqual({
      cpuPercent: null,
      ramUsedMb: null,
      diskUsedMb: null,
      pingMs: 23,
      playersOnline: 7,
      playersMax: 20,
      networkRxBytes: null,
      networkTxBytes: null,
      updatedAt: '2026-08-31T11:59:58.000Z',
    });
  });

  it('nimmt den Ereignis-Zeitstempel, wenn die Nutzlast keinen trägt', () => {
    const { sampledAt: _sampledAt, at: _at, ...ohneZeit } = RUNTIME_STATS;

    expect(liveStatsFromAgentPayload(ohneZeit, EMPTY_QUERY_SNAPSHOT, EMITTED_AT).updatedAt).toBe(
      EMITTED_AT,
    );
  });

  it('ergibt lauter null statt zu raten, wenn die Nutzlast unbrauchbar ist', () => {
    const stats = liveStatsFromAgentPayload(
      { cpuPercent: 'viel', memoryUsedBytes: null },
      EMPTY_QUERY_SNAPSHOT,
      EMITTED_AT,
    );

    expect(stats.cpuPercent).toBeNull();
    expect(stats.ramUsedMb).toBeNull();
    expect(stats.updatedAt).toBe(EMITTED_AT);
  });
});

describe('Spielerliste (Gefundener Punkt 51)', () => {
  it('reicht die Namen aus der Server-Abfrage durch', () => {
    const stats = liveStatsFromAgentPayload(
      { ...QUERY_PAYLOAD, players: [{ name: 'Ana' }, { name: 'Bo' }] },
      EMPTY_QUERY_SNAPSHOT,
      EMITTED_AT,
    );

    expect(stats.players).toEqual([{ name: 'Ana' }, { name: 'Bo' }]);
  });

  it('legt die zuletzt gemeldeten Namen neben die Messwerte der Engine', () => {
    const stats = liveStatsFromAgentPayload(
      RUNTIME_STATS,
      { playersOnline: 2, playersMax: 20, pingMs: 15, players: [{ name: 'Ana' }] },
      EMITTED_AT,
    );

    // Die Engine kennt keine Spieler; die Namen stammen aus der letzten Abfrage.
    expect(stats.players).toEqual([{ name: 'Ana' }]);
  });

  it('lässt das Feld weg, wenn keine Namen vorliegen', () => {
    // Fehlend heißt „keine Angabe" – eine leere Liste würde als „niemand da"
    // gelesen, und das wäre eine Behauptung, die die Abfrage nicht deckt.
    expect(
      liveStatsFromAgentPayload(QUERY_PAYLOAD, EMPTY_QUERY_SNAPSHOT, EMITTED_AT).players,
    ).toBeUndefined();
  });

  it('wirft unbrauchbare Einträge weg, statt leere Zeilen zu melden', () => {
    const stats = liveStatsFromAgentPayload(
      { ...QUERY_PAYLOAD, players: [{ name: 'Ana' }, {}, { name: '   ' }, 'Bo'] },
      EMPTY_QUERY_SNAPSHOT,
      EMITTED_AT,
    );

    expect(stats.players).toEqual([{ name: 'Ana' }]);
  });
});

describe('querySnapshotFromPayload', () => {
  it('liest Spielerzahl und Antwortzeit', () => {
    expect(querySnapshotFromPayload(QUERY_PAYLOAD)).toEqual({
      playersOnline: 7,
      playersMax: 20,
      pingMs: 23,
      // Die Beispiel-Nutzlast trägt keine Namen – leer heißt „keine Angabe".
      players: [],
    });
    expect(querySnapshotFromPayload({ reachable: false })).toEqual(EMPTY_QUERY_SNAPSHOT);
  });
});

describe('consoleLineFromAgentPayload', () => {
  it('übersetzt eine stdout-Zeile in eine ServerConsoleLine', () => {
    const line = consoleLineFromAgentPayload(
      SERVER_ID,
      {
        containerId: 'palantir-container-1',
        stream: 'stdout',
        message: '[12:00:00] Server gestartet',
        timestamp: '2026-08-31T11:59:57.000Z',
        at: EMITTED_AT,
      },
      'zeile-1',
      EMITTED_AT,
    );

    expect(line).toEqual({
      id: 'zeile-1',
      serverId: SERVER_ID,
      source: 'stdout',
      text: '[12:00:00] Server gestartet',
      timestamp: '2026-08-31T11:59:57.000Z',
    });
  });

  it('behält stderr als eigene Herkunft', () => {
    const line = consoleLineFromAgentPayload(
      SERVER_ID,
      { stream: 'stderr', message: 'Warnung', at: EMITTED_AT },
      'zeile-2',
      EMITTED_AT,
    );

    expect(line?.source).toBe('stderr');
    expect(line?.timestamp).toBe(EMITTED_AT);
  });

  it('kennzeichnet eine unbekannte Herkunft als system, statt zu raten', () => {
    const line = consoleLineFromAgentPayload(
      SERVER_ID,
      { stream: 'irgendwas', message: 'Text' },
      'zeile-3',
      EMITTED_AT,
    );

    expect(line?.source).toBe('system');
  });

  it('verwirft Zeilen ohne Text', () => {
    expect(
      consoleLineFromAgentPayload(SERVER_ID, { stream: 'stdout', message: '' }, 'x', EMITTED_AT),
    ).toBeNull();
    expect(consoleLineFromAgentPayload(SERVER_ID, undefined, 'x', EMITTED_AT)).toBeNull();
  });
});
