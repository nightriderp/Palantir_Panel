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
  EMPTY_ENGINE_STATS,
  EMPTY_QUERY_SNAPSHOT,
  consoleLineFromAgentPayload,
  containerIdFromPayload,
  engineStatsFromPayload,
  hasEngineMeasurement,
  isServerQueryPayload,
  liveStatsFromAgentPayload,
  querySnapshotFromPayload,
} from './live-events.js';

const SERVER_ID = '44444444-4444-4444-8444-000000000001';
const EMITTED_AT = '2026-08-31T12:00:00.000Z';
/**
 * Zeit des Backends beim Empfang – seit W2-14 der Zeitstempel jeder Messung
 * (orchestration-features-03). Bewusst ein anderer Wert als die Zeitstempel in
 * der Nutzlast, damit sichtbar wird, welche Uhr gewinnt.
 */
const RECEIVED_AT = '2026-08-31T12:00:05.000Z';

/** Messwerte, wie die Container-Runtime sie meldet (`AgentContainerStats` plus `at`). */
const RUNTIME_STATS = {
  containerId: 'palantir-container-1',
  cpuPercent: 42.5,
  memoryUsedBytes: 2 * 1024 * 1024 * 1024,
  memoryLimitBytes: 4 * 1024 * 1024 * 1024,
  networkRxBytes: 1_024,
  networkTxBytes: 2_048,
  networkRxPackets: 12,
  networkTxPackets: 8,
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
  /*
   * Belegter Plattenplatz (Fundpunkte 168 und 175).
   *
   * Er steht in keiner der beiden `STATS_UPDATE`-Nutzlasten: Der Agent misst
   * ihn am Datenordner, nicht im Statistik-Strom der Engine, und meldet ihn
   * deshalb nur auf `GET_STATS`. Das Backend reicht den zuletzt abgetasteten
   * Wert hier herein – in **beide** Zweige.
   */
  it('trägt den gemessenen Plattenplatz in den Live-Rahmen', () => {
    const stats = liveStatsFromAgentPayload(
      RUNTIME_STATS,
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
      3_072,
    );

    expect(stats.diskUsedMb).toBe(3_072);
  });

  /*
   * Der wichtigste Fall (Fundpunkt 175). Das Frontend ersetzt die Messwerte je
   * Rahmen vollständig (`useServerLive`: `setStats(frame.data.stats)`). Stünde
   * im Zweig der Server-Abfrage weiter ein festes `null`, löschte der nächste
   * Abfrage-Rahmen den gerade gelieferten Wert wieder – die Kachel „Platte"
   * spränge im Takt der Abfrage zwischen Zahl und „—".
   */
  it('überschreibt den gemessenen Plattenplatz nicht mit der Server-Abfrage', () => {
    const stats = liveStatsFromAgentPayload(
      QUERY_PAYLOAD,
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
      3_072,
    );

    expect(stats.diskUsedMb).toBe(3_072);
    // Was die Abfrage wirklich misst, bleibt davon unberührt.
    expect(stats.playersOnline).toBe(7);
    expect(stats.cpuPercent).toBeNull();
  });

  it('lässt den Plattenplatz leer, solange nichts gemessen ist', () => {
    /*
     * „nicht gemessen", **nicht** „null Bytes belegt": Aus einer 0 rechnete die
     * Schwellwert-Prüfung „0 % belegt" und schwiege auch bei voller Platte.
     */
    expect(
      liveStatsFromAgentPayload(RUNTIME_STATS, EMPTY_QUERY_SNAPSHOT, RECEIVED_AT).diskUsedMb,
    ).toBeNull();

    expect(
      liveStatsFromAgentPayload(QUERY_PAYLOAD, EMPTY_QUERY_SNAPSHOT, RECEIVED_AT).diskUsedMb,
    ).toBeNull();
  });

  it('liest den Plattenplatz nicht aus der Nutzlast des Live-Rahmens', () => {
    /*
     * Der Zweig, der `diskUsedBytes` aus der Nutzlast las, war nie erreichbar:
     * Der Live-Rahmen entsteht aus dem agent-internen `ContainerStats` des
     * Statistik-Stroms, und das kennt kein Feld für den Plattenplatz. Er ist
     * entfernt – maßgeblich ist allein der abgetastete Wert. Sonst gäbe es zwei
     * Quellen für dieselbe Zahl, und welche gewinnt, entschiede der Zufall der
     * Reihenfolge.
     */
    const stats = liveStatsFromAgentPayload(
      { ...RUNTIME_STATS, diskUsedBytes: 9 * 1024 * 1024 * 1024 },
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
      3_072,
    );

    expect(stats.diskUsedMb).toBe(3_072);
  });

  it('rechnet die Messwerte der Container-Runtime in ServerLiveStats um', () => {
    const stats = liveStatsFromAgentPayload(
      RUNTIME_STATS,
      { playersOnline: 3, playersMax: 20, pingMs: 15, players: [] },
      RECEIVED_AT,
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
      networkRxPackets: 12,
      networkTxPackets: 8,
      updatedAt: RECEIVED_AT,
    });
  });

  it('laesst die Paket-Zaehler weg, wenn der Agent sie nicht meldet', () => {
    // Aeltere Agents kennen die Felder nicht (Mockup-Abgleich 4.8). Sie sollen
    // dann fehlen und nicht als `null` auftauchen: „nicht gemeldet" ist etwas
    // anderes als „gemessen, aber leer".
    const { networkRxPackets, networkTxPackets, ...ohnePakete } = RUNTIME_STATS;
    void networkRxPackets;
    void networkTxPackets;

    const stats = liveStatsFromAgentPayload(
      ohnePakete,
      { playersOnline: 3, playersMax: 20, pingMs: 15, players: [] },
      RECEIVED_AT,
    );

    expect(stats).not.toHaveProperty('networkRxPackets');
    expect(stats).not.toHaveProperty('networkTxPackets');
  });

  it('lässt die Engine-Kacheln leer, solange nichts gemessen wurde', () => {
    /*
     * Die Gegenprobe zu Fundpunkt 179: Ohne gemerkten Engine-Stand wird nichts
     * erfunden. Ein „—" darf nur dort stehen, wo wirklich nichts bekannt ist –
     * aber dort muss es auch stehen.
     */
    const stats = liveStatsFromAgentPayload(QUERY_PAYLOAD, EMPTY_QUERY_SNAPSHOT, RECEIVED_AT);

    expect(stats).toEqual({
      cpuPercent: null,
      ramUsedMb: null,
      diskUsedMb: null,
      pingMs: 23,
      playersOnline: 7,
      playersMax: 20,
      networkRxBytes: null,
      networkTxBytes: null,
      updatedAt: RECEIVED_AT,
    });
  });

  it('stempelt mit der Empfangszeit, nicht mit den Zeitstempeln des Agents (W2-14)', () => {
    /*
     * `sampledAt` und `at` stammen aus derselben Agent-Uhr wie `emittedAt`.
     * Bis W2-14 gewann der Wert aus der Nutzlast – eine vorgehende Uhr des
     * Homeservers meldete damit Messungen aus der Zukunft, eine nachgehende
     * ließ frische Werte alt aussehen (orchestration-features-03).
     */
    expect(
      liveStatsFromAgentPayload(RUNTIME_STATS, EMPTY_QUERY_SNAPSHOT, RECEIVED_AT).updatedAt,
    ).toBe(RECEIVED_AT);
    expect(
      liveStatsFromAgentPayload(QUERY_PAYLOAD, EMPTY_QUERY_SNAPSHOT, RECEIVED_AT).updatedAt,
    ).toBe(RECEIVED_AT);
  });

  it('trägt die Empfangszeit auch, wenn die Nutzlast keinen Zeitstempel hat', () => {
    const { sampledAt: _sampledAt, at: _at, ...ohneZeit } = RUNTIME_STATS;

    expect(liveStatsFromAgentPayload(ohneZeit, EMPTY_QUERY_SNAPSHOT, RECEIVED_AT).updatedAt).toBe(
      RECEIVED_AT,
    );
  });

  it('ergibt lauter null statt zu raten, wenn die Nutzlast unbrauchbar ist', () => {
    const stats = liveStatsFromAgentPayload(
      { cpuPercent: 'viel', memoryUsedBytes: null },
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
    );

    expect(stats.cpuPercent).toBeNull();
    expect(stats.ramUsedMb).toBeNull();
    expect(stats.updatedAt).toBe(RECEIVED_AT);
  });
});

/**
 * Messwerte der Engine im Abfrage-Rahmen (Fundpunkt 179).
 *
 * Dasselbe Muster wie beim Plattenplatz (Fundpunkt 175), nur in der anderen
 * Richtung: CPU, Arbeitsspeicher und Netzverkehr kennt allein der
 * Statistik-Strom. Weil das Frontend die Messwerte je Rahmen vollständig
 * ersetzt, löschte jeder Abfrage-Rahmen die drei Kacheln, bis der nächste
 * Engine-Rahmen kam.
 */
describe('Engine-Messwerte im Zweig der Server-Abfrage (Fundpunkt 179)', () => {
  /** Ein gemerkter Engine-Stand, wie ihn `LatestEngineStatsCache` liefert. */
  const GEMERKT = {
    cpuPercent: 42.5,
    ramUsedMb: 2_048,
    networkRxBytes: 1_024,
    networkTxBytes: 2_048,
    networkRxPackets: 12,
    networkTxPackets: 8,
  };

  it('löscht CPU, Arbeitsspeicher und Netzverkehr nicht mehr aus der Anzeige', () => {
    const stats = liveStatsFromAgentPayload(
      QUERY_PAYLOAD,
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
      null,
      GEMERKT,
    );

    expect(stats).toMatchObject({
      cpuPercent: 42.5,
      ramUsedMb: 2_048,
      networkRxBytes: 1_024,
      networkTxBytes: 2_048,
      networkRxPackets: 12,
      networkTxPackets: 8,
    });
    // Was die Abfrage wirklich misst, bleibt davon unberührt.
    expect(stats).toMatchObject({ pingMs: 23, playersOnline: 7, playersMax: 20 });
  });

  it('lässt die Paket-Zähler auch hier weg, wenn die Engine sie nie gemeldet hat', () => {
    // „nicht gemeldet" ist etwas anderes als „gemessen, aber leer" – die
    // Unterscheidung darf über den Zwischenspeicher nicht verloren gehen.
    const stats = liveStatsFromAgentPayload(
      QUERY_PAYLOAD,
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
      null,
      { ...GEMERKT, networkRxPackets: null, networkTxPackets: null },
    );

    expect(stats).not.toHaveProperty('networkRxPackets');
    expect(stats).not.toHaveProperty('networkTxPackets');
  });

  it('lässt den frischen Engine-Rahmen gegen den gemerkten Stand gewinnen', () => {
    /*
     * Der Zwischenspeicher überbrückt nur die Lücke. Meldet die Engine selbst,
     * ist das die Messung – sonst hinge die Anzeige an einem alten Wert, obwohl
     * gerade ein neuer eintrifft.
     */
    const stats = liveStatsFromAgentPayload(
      RUNTIME_STATS,
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
      null,
      { ...GEMERKT, cpuPercent: 99, ramUsedMb: 1, networkRxBytes: 7, networkTxBytes: 9 },
    );

    expect(stats).toMatchObject({
      cpuPercent: 42.5,
      ramUsedMb: 2_048,
      networkRxBytes: 1_024,
      networkTxBytes: 2_048,
    });
  });
});

describe('engineStatsFromPayload', () => {
  it('liest die Messwerte der Engine und rechnet den Arbeitsspeicher in MiB', () => {
    expect(engineStatsFromPayload(RUNTIME_STATS)).toEqual({
      cpuPercent: 42.5,
      ramUsedMb: 2_048,
      networkRxBytes: 1_024,
      networkTxBytes: 2_048,
      networkRxPackets: 12,
      networkTxPackets: 8,
    });
  });

  it('liest aus einer Abfrage-Nutzlast nichts', () => {
    /*
     * Die Abfrage misst keine Ressourcen. Läse hier jemand ihre Felder, käme
     * ein erfundener Stand in den Zwischenspeicher – und der stünde dann bis
     * zum Ablauf der Frist als Messung in der Anzeige.
     */
    expect(engineStatsFromPayload(QUERY_PAYLOAD)).toEqual(EMPTY_ENGINE_STATS);
    expect(engineStatsFromPayload(null)).toEqual(EMPTY_ENGINE_STATS);
  });

  it('unterscheidet „keine Messung" von „gemessen"', () => {
    expect(hasEngineMeasurement(EMPTY_ENGINE_STATS)).toBe(false);
    expect(hasEngineMeasurement(engineStatsFromPayload(RUNTIME_STATS))).toBe(true);
    // Ein einzelner Wert genügt: Die Runtime meldet nicht immer alles.
    expect(hasEngineMeasurement({ ...EMPTY_ENGINE_STATS, cpuPercent: 0 })).toBe(true);
  });
});

describe('Spielerliste (Gefundener Punkt 51)', () => {
  it('reicht die Namen aus der Server-Abfrage durch', () => {
    const stats = liveStatsFromAgentPayload(
      { ...QUERY_PAYLOAD, players: [{ name: 'Ana' }, { name: 'Bo' }] },
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
    );

    expect(stats.players).toEqual([{ name: 'Ana' }, { name: 'Bo' }]);
  });

  it('legt die zuletzt gemeldeten Namen neben die Messwerte der Engine', () => {
    const stats = liveStatsFromAgentPayload(
      RUNTIME_STATS,
      { playersOnline: 2, playersMax: 20, pingMs: 15, players: [{ name: 'Ana' }] },
      RECEIVED_AT,
    );

    // Die Engine kennt keine Spieler; die Namen stammen aus der letzten Abfrage.
    expect(stats.players).toEqual([{ name: 'Ana' }]);
  });

  it('lässt das Feld weg, wenn keine Namen vorliegen', () => {
    // Fehlend heißt „keine Angabe" – eine leere Liste würde als „niemand da"
    // gelesen, und das wäre eine Behauptung, die die Abfrage nicht deckt.
    expect(
      liveStatsFromAgentPayload(QUERY_PAYLOAD, EMPTY_QUERY_SNAPSHOT, RECEIVED_AT).players,
    ).toBeUndefined();
  });

  it('wirft unbrauchbare Einträge weg, statt leere Zeilen zu melden', () => {
    const stats = liveStatsFromAgentPayload(
      { ...QUERY_PAYLOAD, players: [{ name: 'Ana' }, {}, { name: '   ' }, 'Bo'] },
      EMPTY_QUERY_SNAPSHOT,
      RECEIVED_AT,
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
