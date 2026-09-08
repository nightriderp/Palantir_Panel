/**
 * Übersetzung der Agent-Ereignisse in die Nutzlasten des Live-Kanals
 * (Pflichtenheft §5.3, WORK_STATUS.md Gefundener Punkt 101).
 *
 * Der Agent meldet, was seine Container-Runtime und seine Server-Abfrage sehen;
 * der Browser erwartet die Formen aus `@palantir/contracts`
 * ({@link ServerConsoleLine}, {@link ServerLiveStats}). Dazwischen fehlte bisher
 * die Abbildung: Der Live-Hub reichte die Agent-Nutzlast unverändert weiter,
 * obwohl sie andere Feldnamen und Einheiten trägt.
 *
 * **Eine Abbildung an genau einer Stelle.** Unter dem Namen `STATS_UPDATE`
 * fließen zwei verschiedene Nutzlasten – die Messwerte der Container-Runtime und
 * das Ergebnis der Server-Abfrage – und keine davon ist ein `ServerLiveStats`.
 * Beide landen hier, damit die Unterscheidung nicht an mehreren Stellen
 * nachgebaut wird.
 *
 * Reine Funktionen ohne Datenbank und ohne HTTP: Die Formen sollen ohne
 * laufenden Agent prüfbar sein (CLAUDE.md §4).
 */

import {
  type ConsoleLineSource,
  type ServerConsoleLine,
  type ServerLivePlayer,
  type ServerLiveStats,
} from '@palantir/contracts';

/** Ein Byte-Wert in MiB, kaufmännisch gerundet. */
function toMebibytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Container-Id aus der Nutzlast eines Agent-Ereignisses.
 *
 * Die Ereignisse der Container-Runtime tragen keine `serverId` – die Runtime
 * kennt nur ihre Container (`runtime-adapter.ts` meldet deshalb `null`). Die
 * Zuordnung übernimmt das Backend über `ServerRepository.findByContainerId()`,
 * das die Id ohnehin am Server-Datensatz führt.
 */
export function containerIdFromPayload(payload: unknown): string | null {
  return isRecord(payload) ? stringOrNull(payload.containerId) : null;
}

/**
 * Stand der letzten Server-Abfrage, soweit er für die Messwerte gebraucht wird.
 *
 * Spielerzahl und Antwortzeit kennt **nur** die Abfrage des Agents; die
 * Container-Engine liefert beides nicht. Damit ein Messwert-Ereignis aus der
 * Engine trotzdem eine vollständige Anzeige ergibt, wird der zuletzt gemeldete
 * Abfragestand danebengelegt – dieselbe Zusammenführung, die P5 beim Abtasten
 * für den Verlauf macht.
 */
export interface ServerQuerySnapshot {
  readonly playersOnline: number | null;
  readonly playersMax: number | null;
  readonly pingMs: number | null;
  /**
   * Namen der verbundenen Spieler (Gefundener Punkt 51).
   *
   * Leer heißt „keine Angabe": Nur die Abfrage über das Spielprotokoll liefert
   * Namen, und manche Server geben nur einen Auszug heraus. Die belastbare Zahl
   * bleibt `playersOnline`.
   */
  readonly players: readonly ServerLivePlayer[];
}

/** Abfragestand ohne jede Angabe. */
export const EMPTY_QUERY_SNAPSHOT: ServerQuerySnapshot = Object.freeze({
  playersOnline: null,
  playersMax: null,
  pingMs: null,
  players: [],
});

/**
 * Messwerte der Container-Engine, soweit der Live-Kanal sie trägt (Fundpunkt 179).
 *
 * Das Gegenstück zum {@link ServerQuerySnapshot}: CPU, Arbeitsspeicher und
 * Netzverkehr kennt **nur** der Statistik-Strom der Engine; die Server-Abfrage
 * misst nichts davon. Damit ein Abfrage-Rahmen trotzdem eine vollständige
 * Anzeige ergibt, wird der zuletzt gemeldete Engine-Stand danebengelegt –
 * dieselbe Zusammenführung wie in der anderen Richtung.
 *
 * Eine Messung, nicht sechs: Alle Felder stammen aus **einem** Rahmen und
 * tragen deshalb ein gemeinsames Alter. Feldweises Merken vermischte Werte aus
 * verschiedenen Sekunden zu einer Momentaufnahme, die es nie gab.
 */
export interface EngineStatsSnapshot {
  readonly cpuPercent: number | null;
  readonly ramUsedMb: number | null;
  readonly networkRxBytes: number | null;
  readonly networkTxBytes: number | null;
  /** Paket-Zähler sind optional im Agent-Protokoll; `null` heißt „nicht gemeldet". */
  readonly networkRxPackets: number | null;
  readonly networkTxPackets: number | null;
}

/** Engine-Stand ohne jede Messung. */
export const EMPTY_ENGINE_STATS: EngineStatsSnapshot = Object.freeze({
  cpuPercent: null,
  ramUsedMb: null,
  networkRxBytes: null,
  networkTxBytes: null,
  networkRxPackets: null,
  networkTxPackets: null,
});

/**
 * Engine-Messwerte aus der Nutzlast eines Statistik-Rahmens.
 *
 * `memoryUsedBytes` wird in MiB umgerechnet, weil `ServerLiveStats.ramUsedMb`
 * in MiB zählt.
 */
export function engineStatsFromPayload(payload: unknown): EngineStatsSnapshot {
  if (!isRecord(payload) || isServerQueryPayload(payload)) {
    return EMPTY_ENGINE_STATS;
  }

  const memoryUsedBytes = numberOrNull(payload.memoryUsedBytes);

  return {
    cpuPercent: numberOrNull(payload.cpuPercent),
    ramUsedMb: memoryUsedBytes === null ? null : toMebibytes(memoryUsedBytes),
    networkRxBytes: numberOrNull(payload.networkRxBytes),
    networkTxBytes: numberOrNull(payload.networkTxBytes),
    networkRxPackets: numberOrNull(payload.networkRxPackets),
    networkTxPackets: numberOrNull(payload.networkTxPackets),
  };
}

/**
 * Hat dieser Stand überhaupt eine Messung?
 *
 * Ein Rahmen, in dem die Engine zu allem schweigt, ist kein Messwert und darf
 * einen bekannten Stand deshalb nicht verdrängen (siehe `LatestEngineStatsCache`).
 */
export function hasEngineMeasurement(engine: EngineStatsSnapshot): boolean {
  return (
    engine.cpuPercent !== null ||
    engine.ramUsedMb !== null ||
    engine.networkRxBytes !== null ||
    engine.networkTxBytes !== null ||
    engine.networkRxPackets !== null ||
    engine.networkTxPackets !== null
  );
}

/**
 * Engine-Stand in die Felder von {@link ServerLiveStats} bringen.
 *
 * Eine Stelle für beide Zweige, damit die Anzeige nicht davon abhängt, aus
 * welcher Nutzlast der Rahmen entstanden ist.
 */
function engineFelder(
  engine: EngineStatsSnapshot,
): Pick<ServerLiveStats, 'cpuPercent' | 'ramUsedMb' | 'networkRxBytes' | 'networkTxBytes'> &
  Partial<Pick<ServerLiveStats, 'networkRxPackets' | 'networkTxPackets'>> {
  return {
    cpuPercent: engine.cpuPercent,
    ramUsedMb: engine.ramUsedMb,
    networkRxBytes: engine.networkRxBytes,
    networkTxBytes: engine.networkTxBytes,
    /*
     * Paket-Zaehler sind optional im Agent-Protokoll (Mockup-Abgleich 4.8):
     * Ein aelterer Agent meldet sie nicht, dann fehlen sie auch hier. Ein
     * ausdrueckliches null waere eine andere Aussage - "gemessen, aber leer".
     */
    ...(engine.networkRxPackets === null ? {} : { networkRxPackets: engine.networkRxPackets }),
    ...(engine.networkTxPackets === null ? {} : { networkTxPackets: engine.networkTxPackets }),
  };
}

/**
 * Ist die Nutzlast das Ergebnis der Server-Abfrage (`AgentServerQueryPayload`)?
 *
 * Die Abfrage kennzeichnet sich selbst mit `source: 'serverQuery'`; die
 * Messwerte der Container-Runtime tragen kein solches Feld. Deshalb wird hier
 * nach dem Kennzeichen entschieden und nicht danach, welche Felder zufällig
 * gesetzt sind.
 */
export function isServerQueryPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.source === 'serverQuery';
}

/** Spielerzahl und Antwortzeit aus einer Abfrage-Nutzlast, soweit vorhanden. */
export function querySnapshotFromPayload(payload: unknown): ServerQuerySnapshot {
  if (!isRecord(payload)) {
    return EMPTY_QUERY_SNAPSHOT;
  }

  return {
    playersOnline: numberOrNull(payload.playersOnline),
    playersMax: numberOrNull(payload.playersMax),
    pingMs: numberOrNull(payload.pingMs),
    players: spielernamen(payload.players),
  };
}

/**
 * Spielernamen aus einer Agent-Nutzlast.
 *
 * Streng geprüft statt durchgereicht: Was über den Agent-Kanal hereinkommt,
 * landet unverändert im Browser. Namenlose oder unbrauchbare Einträge fallen
 * weg, statt als leere Zeile in der Liste zu stehen.
 */
function spielernamen(wert: unknown): readonly ServerLivePlayer[] {
  if (!Array.isArray(wert)) {
    return [];
  }

  return wert
    .map((eintrag) =>
      isRecord(eintrag) && typeof eintrag.name === 'string' ? eintrag.name.trim() : '',
    )
    .filter((name) => name.length > 0)
    .map((name) => ({ name }));
}

/**
 * Nutzlast eines `STATS_UPDATE` in die Form des Live-Kanals bringen.
 *
 * Beide Quellen ergeben denselben Typ, nur mit unterschiedlich gefüllten
 * Feldern:
 *
 * - **Container-Runtime** (`AgentContainerStats` plus `at`): CPU, Arbeitsspeicher
 *   und Netzverkehr. `memoryUsedBytes` wird in MiB umgerechnet, weil
 *   `ServerLiveStats.ramUsedMb` in MiB zählt. Spielerzahl und Antwortzeit kommen
 *   aus dem mitgegebenen Abfragestand.
 * - **Server-Abfrage** (`AgentServerQueryPayload`): Spielerzahl und Antwortzeit;
 *   die Engine-Werte kommen aus dem mitgegebenen Engine-Stand, weil die Abfrage
 *   sie nicht misst.
 *
 * **Beide Zweige werden vollständig befüllt** (Fundpunkt 179). Vorher stand im
 * Zweig der Server-Abfrage ein festes `null` für CPU, Arbeitsspeicher und
 * Netzverkehr. Weil das Frontend die Messwerte je Rahmen vollständig ersetzt
 * (`useServerLive`), löschte jeder Abfrage-Rahmen die drei Kacheln kurz aus der
 * Anzeige – im Takt von `AGENT_QUERY_INTERVAL_SECONDS` sprangen sie auf „—",
 * bis der nächste Engine-Rahmen kam. Genau derselbe Fehler wie beim
 * Plattenplatz (Fundpunkt 175), nur in der anderen Richtung.
 *
 * **Warum das Zusammenführen hier steht und nicht im Browser.** Nur hier ist
 * bekannt, *warum* ein Feld leer ist: `isServerQueryPayload` unterscheidet
 * „diese Quelle misst CPU gar nicht" von „CPU ist unbekannt". Im Browser
 * kommen beide Fälle als dasselbe `null` an; ein Zusammenführen dort müsste die
 * pauschale Regel „`null` überschreibt nie" anwenden und könnte einen alten Wert
 * nie wieder loswerden. Der Zwischenspeicher hier hat dagegen eine Frist
 * (`LatestEngineStatsCache`): Bleibt der Statistik-Strom aus, verfällt der Wert
 * und die Kachel steht wieder auf „—" – dort, wo wirklich nichts bekannt ist.
 *
 * **Der belegte Plattenplatz steht in keiner der beiden Nutzlasten**
 * (Fundpunkt 175). Er kommt nicht aus dem Statistik-Strom der Engine, sondern
 * aus einer eigenen Messung des Agents am Datenordner, und die erreicht das
 * Backend über `GET_STATS` – also über die Abtastung, nicht über den Strom.
 * Deshalb wird er hier als eigener Wert hereingereicht (`diskUsedMb`), aus dem
 * Zwischenspeicher der letzten Abtastung (`LatestDiskUsageCache`).
 *
 * Er steht bewusst in **beiden** Zweigen. Das Frontend ersetzt die Messwerte je
 * Rahmen vollständig (`useServerLive`); stünde im Zweig der Server-Abfrage
 * weiter ein festes `null`, löschte der nächste Abfrage-Rahmen den gerade erst
 * gelieferten Wert wieder aus der Anzeige – die Platte spränge im Takt der
 * Abfrage zwischen Zahl und „—".
 *
 * **`updatedAt` kommt vom Backend** (W2-14, orchestration-features-03). Die
 * Nutzlast trägt zwar eigene Zeitstempel (`sampledAt`, `at`) – die stammen aber
 * alle aus derselben Agent-Uhr wie `emittedAt`. Geht diese Uhr vor, behauptet
 * die Anzeige eine Messung aus der Zukunft; geht sie nach, sieht ein frischer
 * Wert alt aus. Deshalb steht hier die Empfangszeit des Backends: dieselbe Uhr,
 * die auch den Verlauf stempelt (`stats-history.ts`), damit Live-Anzeige und
 * Diagramm nicht in zwei Zeitrechnungen laufen.
 *
 * @param receivedAt Zeit des Backends beim Empfang des Ereignisses (ISO-8601).
 * @param diskUsedMb Zuletzt gemessener Plattenplatz des Datenordners in MiB;
 *   `null` heißt „nicht gemessen", **nicht** „null Bytes belegt" – aus einer
 *   fehlenden Messung darf nie eine Warnung entstehen.
 * @param engine Zuletzt gemeldeter Stand der Container-Engine. Wird **nur** im
 *   Zweig der Server-Abfrage gebraucht; ein Engine-Rahmen trägt seine Werte
 *   selbst und der gemerkte Stand hat gegen ihn nichts zu sagen.
 */
export function liveStatsFromAgentPayload(
  payload: unknown,
  query: ServerQuerySnapshot,
  receivedAt: string,
  diskUsedMb: number | null = null,
  engine: EngineStatsSnapshot = EMPTY_ENGINE_STATS,
): ServerLiveStats {
  if (isServerQueryPayload(payload)) {
    const abfrage = querySnapshotFromPayload(payload);

    return {
      ...engineFelder(engine),
      diskUsedMb,
      pingMs: abfrage.pingMs,
      playersOnline: abfrage.playersOnline,
      playersMax: abfrage.playersMax,
      // Leere Liste heißt „keine Angabe" – dann bleibt das Feld weg, statt als
      // „niemand da" gelesen zu werden (Gefundener Punkt 51).
      ...(abfrage.players.length > 0 ? { players: abfrage.players } : {}),
      updatedAt: receivedAt,
    };
  }

  /*
   * `payload.diskUsedBytes` wird hier bewusst **nicht** gelesen (Fundpunkt 175).
   * Das Feld ist zwar im Vertrag vorgesehen (`AgentContainerStats`, optional),
   * der Live-Rahmen kann es aber gar nicht tragen: Er entsteht aus dem
   * agent-internen `ContainerStats` des Statistik-Stroms, und das kennt kein
   * Feld für den Plattenplatz. Der Zweig sah zwei Fundpunkte lang so aus, als
   * täte er etwas, und war nie erreichbar. Der Wert kommt jetzt von oben,
   * aus der Abtastung – siehe Kopf dieser Funktion.
   */

  return {
    // Der frische Rahmen schlägt den gemerkten Stand: Was die Engine gerade
    // meldet, ist die Messung – der Zwischenspeicher überbrückt nur die Lücke.
    ...engineFelder(engineStatsFromPayload(payload)),
    diskUsedMb,
    pingMs: query.pingMs,
    playersOnline: query.playersOnline,
    playersMax: query.playersMax,
    ...(query.players.length > 0 ? { players: query.players } : {}),
    updatedAt: receivedAt,
  };
}

function toConsoleSource(value: unknown): ConsoleLineSource {
  // Der Agent meldet `stdout` oder `stderr`; alles andere wäre ein
  // Protokollfehler und wird als Systemzeile gekennzeichnet, statt geraten zu
  // werden.
  return value === 'stdout' || value === 'stderr' ? value : 'system';
}

/**
 * Nutzlast eines `LOG_LINE` in eine Konsolenzeile des Live-Kanals übersetzen.
 *
 * Der Agent schickt `{ containerId, stream, message, timestamp, at }`; der
 * Browser erwartet eine {@link ServerConsoleLine}. Zeilen ohne Text ergeben
 * `null` – eine leere Zeile im Verlauf hilft niemandem.
 *
 * `id` wird hereingereicht statt hier erzeugt, damit die Funktion rein bleibt
 * und der Test die Zeile vollständig vergleichen kann.
 */
export function consoleLineFromAgentPayload(
  serverId: string,
  payload: unknown,
  id: string,
  emittedAt: string,
): ServerConsoleLine | null {
  if (!isRecord(payload)) {
    return null;
  }

  const text = typeof payload.message === 'string' ? payload.message : null;

  if (text === null || text.length === 0) {
    return null;
  }

  return {
    id,
    serverId,
    source: toConsoleSource(payload.stream),
    text,
    timestamp: stringOrNull(payload.timestamp) ?? stringOrNull(payload.at) ?? emittedAt,
  };
}
