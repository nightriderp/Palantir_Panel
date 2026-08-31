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
 *   die Engine-Werte bleiben `null`, weil die Abfrage sie nicht misst.
 *
 * Belegter Plattenplatz je Container ist in keiner der beiden Quellen enthalten
 * – dieselbe Lücke wie beim Verlauf (P5); die Speicherübersicht (B8) misst
 * node-weit.
 */
export function liveStatsFromAgentPayload(
  payload: unknown,
  query: ServerQuerySnapshot,
  emittedAt: string,
): ServerLiveStats {
  const daten = isRecord(payload) ? payload : {};

  if (isServerQueryPayload(payload)) {
    const abfrage = querySnapshotFromPayload(payload);

    return {
      cpuPercent: null,
      ramUsedMb: null,
      diskUsedMb: null,
      pingMs: abfrage.pingMs,
      playersOnline: abfrage.playersOnline,
      playersMax: abfrage.playersMax,
      // Leere Liste heißt „keine Angabe" – dann bleibt das Feld weg, statt als
      // „niemand da" gelesen zu werden (Gefundener Punkt 51).
      ...(abfrage.players.length > 0 ? { players: abfrage.players } : {}),
      networkRxBytes: null,
      networkTxBytes: null,
      updatedAt: stringOrNull(daten.at) ?? emittedAt,
    };
  }

  const memoryUsedBytes = numberOrNull(daten.memoryUsedBytes);

  return {
    cpuPercent: numberOrNull(daten.cpuPercent),
    ramUsedMb: memoryUsedBytes === null ? null : toMebibytes(memoryUsedBytes),
    diskUsedMb: null,
    pingMs: query.pingMs,
    playersOnline: query.playersOnline,
    playersMax: query.playersMax,
    ...(query.players.length > 0 ? { players: query.players } : {}),
    networkRxBytes: numberOrNull(daten.networkRxBytes),
    networkTxBytes: numberOrNull(daten.networkTxBytes),
    updatedAt: stringOrNull(daten.sampledAt) ?? stringOrNull(daten.at) ?? emittedAt,
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
