/**
 * Agent-Protokoll (Pflichtenheft §2.2 und §5.3).
 *
 * Dies ist die Vertragsgrenze zwischen Backend (B3) und Homeserver-Agent (A1/A2/A3).
 * Beide Seiten kennen ausschließlich die hier definierten Rahmen ("Frames") –
 * es gibt keine Absprachen am Code vorbei (CLAUDE.md §3).
 *
 * Grundprinzip der Architektur (Pflichtenheft §1, §2.2, §18): Die Verbindung
 * wird **immer vom Agent ausgehend** durch den WireGuard-Tunnel aufgebaut. Der
 * Agent öffnet niemals selbst einen Listener. Alle Frames laufen über diese eine
 * persistente WebSocket-Verbindung.
 *
 * **Authentifizierung:** Das Pre-Shared-Token (`AGENT_TOKEN`) wird beim
 * WebSocket-Handshake im `Authorization: Bearer ...`-Header mitgegeben, nicht als
 * Feld im `hello`-Frame. Damit taucht es nicht in Nachrichten-Logs auf, und die
 * Verbindung wird abgelehnt, bevor überhaupt ein Frame fließt (Defense in Depth
 * zusätzlich zur WireGuard-Verschlüsselung).
 *
 * **Änderungen:** bevorzugt additiv (neue optionale Felder, neue Befehle/Events
 * ans Ende der Listen). Das Entfernen oder Umbenennen bestehender Felder ist ein
 * Breaking Change und im Commit/PR als solcher zu kennzeichnen (CLAUDE.md §3).
 */

import type { ApiResponse } from './envelope.js';
import type { ServerLivePlayer } from './game-server.js';

/**
 * Version des Protokolls. Der Agent schickt sie im `hello`-Frame, das Backend
 * bestätigt sie im `welcome`-Frame. Passen die Versionen nicht zusammen, wird
 * die Verbindung mit `AGENT_PROTOCOL_VERSION_MISMATCH` abgelehnt, statt mit
 * halb verstandenen Nachrichten weiterzuarbeiten.
 *
 * Erhöht wird sie nur bei Breaking Changes – additive Ergänzungen lassen die
 * Version unverändert.
 */
export const AGENT_PROTOCOL_VERSION = 1;

/**
 * Format der Korrelations-ID (Pflichtenheft §2.2): UUID (Version 4), erzeugt
 * vom **Backend** beim Absenden des Befehls. Der Agent übernimmt sie unverändert
 * in das Ergebnis und verwirft Befehle mit einer bereits verarbeiteten ID.
 *
 * Dasselbe ID-Format wie alle Entitäten (`idSchema` in `@palantir/validation`).
 */
export type CorrelationId = string;

// ---------------------------------------------------------------------------
// Befehle: Backend -> Agent (Pflichtenheft §5.3)
// ---------------------------------------------------------------------------

export const AGENT_COMMANDS = [
  'CREATE',
  'START',
  'STOP',
  'RESTART',
  'DELETE',
  'GET_STATS',
  'GET_LOGS',
  'EXEC_CONSOLE',
  'FILE_LIST',
  'FILE_READ',
  'FILE_WRITE',
  'CREATE_BACKUP',
  'RESTORE_BACKUP',
  /**
   * Archiv eines Backups blockweise vom Homeserver holen (Lastenheft §3.3,
   * „vollständiger Export/Download aller Serverdaten").
   *
   * Ergänzung dieser Sitzung (B5) zum Katalog aus Pflichtenheft §5.3, dort
   * nachgetragen. Begründung: Der Agent öffnet nie einen eigenen Listener
   * (Pflichtenheft §18), es gibt also keinen zweiten Weg für die Bytes. Ein
   * blockweises Ziehen über diese Verbindung kommt ohne neuen Frame-Typ aus –
   * das Backend fordert Block für Block an und reicht ihn direkt an den
   * HTTP-Download weiter, statt ein mehrere Gigabyte großes Archiv am Stück in
   * den Speicher zu laden.
   */
  'DOWNLOAD_BACKUP',
  /**
   * Archiv eines Backups auf dem Homeserver entfernen (Lastenheft §3.3
   * Aufbewahrungsregel, §3.8 Speicherverwaltung).
   *
   * Ergänzung dieser Sitzung (B5) zum Katalog aus Pflichtenheft §5.3, dort
   * nachgetragen. Ohne diesen Befehl könnte das Backend zwar den Datensatz
   * löschen, das Archiv bliebe aber für immer auf der Platte liegen – die
   * Aufbewahrungsregel würde also gar keinen Speicher freigeben.
   */
  'DELETE_BACKUP',
  'GET_STORAGE_BREAKDOWN',
  /**
   * Periodische Server-Abfrage eines Servers ein- bzw. ausschalten
   * (Pflichtenheft §9, Lastenheft §3.3).
   *
   * Ergänzung dieser Sitzung (A3) zum Katalog aus Pflichtenheft §5.3, dort
   * nachgetragen. Begründung: Der Auto-Shutdown verlangt eine „periodische
   * Spielerabfrage durch den Agent" und der Übergang `starting → running` einen
   * bestandenen Health-Check. Beides braucht die Abfrage **auf dem
   * Homeserver** – nur dort ist der Spiel-Port ohne Umweg erreichbar, und nur
   * dort kann eine spätere `gamedig`-Abfrage per UDP hin. Was abgefragt wird
   * (Port und Abfrageart), weiß aber ausschließlich das Backend: Es kennt die
   * `GameTypeDefinition` und die Portvergabe, der Agent kennt keine Spiele.
   * Dieser Befehl ist die Übergabe dieser Angaben – bewusst als eigener,
   * wiederholbarer Befehl und nicht als Anhängsel an `START`, damit das Backend
   * die Ziele nach einem Verbindungsabriss ohne Serverneustart wieder setzen
   * kann.
   */
  'SET_SERVER_QUERY',
  /**
   * Einen Posten der Speicherübersicht tatsächlich von der Platte entfernen
   * (Lastenheft §3.8, Pflichtenheft §16).
   *
   * Ergänzung dieser Sitzung (A3) zum Katalog aus Pflichtenheft §5.3, dort
   * nachgetragen. `GET_STORAGE_BREAKDOWN` meldet nur, was belegt ist; ohne
   * diesen Befehl gäbe es keinen Weg, ungenutzte Images oder verwaiste Daten
   * wieder freizugeben – der Storage-Explorer könnte nur zusehen.
   *
   * **Ob** gelöscht werden darf, entscheidet weiterhin ausschließlich das
   * Backend (`classifyEntry()` in B8). Der Agent führt aus und lehnt nur das
   * ab, was er selbst als unzulässig erkennt: Datenordner aktiver Server sind
   * hierüber grundsätzlich nicht löschbar (Lastenheft §3.8).
   */
  'REMOVE_STORAGE_ENTRY',
  /**
   * Datei oder Verzeichnis im Container löschen (Datei-Manager, Lastenheft §3.3).
   *
   * Ergänzung dieser Sitzung (WELLE 0) zum Katalog aus Pflichtenheft §5.3, dort
   * nachgetragen. Der Datei-Manager konnte bisher auflisten, lesen und schreiben
   * (`FILE_LIST`/`FILE_READ`/`FILE_WRITE`), aber weder löschen noch hochladen –
   * ohne diese beiden Befehle bliebe P2 auf halbem Weg stehen. **Ausgeführt**
   * wird der Befehl erst von P2; bis dahin steht er nicht in
   * `IMPLEMENTED_AGENT_COMMANDS` (`AGENT_COMMAND_NOT_IMPLEMENTED`).
   */
  'FILE_DELETE',
  /**
   * Vom Datei-Manager hochgeladene Datei im Container ablegen (Lastenheft §3.3).
   *
   * Ergänzung dieser Sitzung (WELLE 0), Begründung wie bei `FILE_DELETE`.
   * Bewusst getrennt von `FILE_WRITE`: Dieses speichert eine im Editor
   * bearbeitete Textdatei zurück, `FILE_UPLOAD` legt eine hochgeladene (auch
   * binäre, auch neue) Datei ab. Ausführung ebenfalls in P2.
   */
  'FILE_UPLOAD',
  /**
   * Ein hochgeladenes Archiv in den Datenordner eines Servers entpacken
   * (Weltdaten-Übernahme, Lastenheft §3.3 „Migration von anderen
   * Hosting-Anbietern"; Arbeitspaket P4).
   *
   * Ergänzung dieser Sitzung zum Katalog aus Pflichtenheft §5.3, dort
   * nachgetragen. Bewusst ein eigener Befehl und nicht mehrere `FILE_UPLOAD`:
   * Ein Weltordner besteht aus tausenden Dateien; einzeln übertragen wären das
   * ebenso viele Befehle. Bewusst auch nicht `RESTORE_BACKUP`: Dort liegt das
   * Archiv bereits auf dem Homeserver und trägt eine beim Sichern gebildete
   * Prüfsumme – hier kommt es vom Nutzer über das Backend und ist kein Backup.
   *
   * **Ausgeführt** wird der Befehl erst von P4; bis dahin steht er nicht in
   * `IMPLEMENTED_AGENT_COMMANDS` (`AGENT_COMMAND_NOT_IMPLEMENTED`).
   */
  'FILE_EXTRACT',
] as const;

/** Alle gültigen Befehlsnamen – verhindert Freitext-Befehle. */
export type AgentCommandName = (typeof AGENT_COMMANDS)[number];

export function isAgentCommandName(value: string): value is AgentCommandName {
  return (AGENT_COMMANDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Ereignisse: Agent -> Backend (Pflichtenheft §5.3)
// ---------------------------------------------------------------------------

export const AGENT_EVENTS = ['STATUS_CHANGED', 'STATS_UPDATE', 'LOG_LINE', 'CRASHED'] as const;

/** Alle gültigen Ereignisnamen des Agent-Kanals. */
export type AgentEventName = (typeof AGENT_EVENTS)[number];

export function isAgentEventName(value: string): value is AgentEventName {
  return (AGENT_EVENTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Ist-Zustand der Container (Pflichtenheft §2.2)
// ---------------------------------------------------------------------------

/**
 * Container-Zustände, wie der Agent sie an der Runtime tatsächlich **beobachtet**
 * – bewusst die Docker-Zustände und nicht die Server-Lifecycle-Zustände aus
 * Pflichtenheft §9 (`creating`, `starting`, `running`, ...).
 *
 * Begründung: Der Lifecycle-Zustand ist eine Auslegung des Backends (z. B. gilt
 * ein Server erst nach erfolgreichem Health-Check als `running`, ein gestarteter
 * Prozess allein reicht nicht). Der Agent meldet nur die Beobachtung; die
 * Zuordnung auf den Lifecycle-Zustand macht der Soll/Ist-Abgleich in B3.
 */
export const AGENT_CONTAINER_STATUSES = [
  'created',
  'running',
  'restarting',
  'paused',
  'removing',
  'exited',
  'dead',
  /** Container ist bekannt, sein Zustand aber gerade nicht ermittelbar. */
  'unknown',
] as const;

export type AgentContainerStatus = (typeof AGENT_CONTAINER_STATUSES)[number];

export function isAgentContainerStatus(value: string): value is AgentContainerStatus {
  return (AGENT_CONTAINER_STATUSES as readonly string[]).includes(value);
}

/** Beobachteter Zustand eines einzelnen Containers. */
export interface AgentContainerState {
  /** ID des zugehörigen `GameServer`, oder `null` bei nicht zuordenbarem Container. */
  readonly serverId: string | null;
  /** Container-ID der Runtime. */
  readonly containerId: string;
  readonly status: AgentContainerStatus;
  /** Exit-Code des zuletzt beendeten Laufs, sonst `null`. */
  readonly exitCode: number | null;
  /** Startzeitpunkt des laufenden Containers als ISO-8601, sonst `null`. */
  readonly startedAt: string | null;
  /** Zeitpunkt der Beobachtung als ISO-8601. */
  readonly observedAt: string;
}

/**
 * Gemessene Ist-Ressourcen der Node, wie der Agent sie zum Berichtszeitpunkt
 * vom Betriebssystem abliest (Pflichtenheft §11: „harte Prüfung der tatsächlich
 * freien Ressourcen der Ziel-VM").
 *
 * Bewusst **gemessen**, nicht konfiguriert: Die Kapazitätsprüfung soll gegen
 * das rechnen, was die VM wirklich hat, nicht gegen im Panel hinterlegte
 * Sollwerte. Vergrößert sich etwa die Platte der VM, folgt das Panel ohne
 * Eingriff. Die Werte begleiten den Ist-Zustands-Bericht und sind darum
 * optional: ein Agent, der sie (noch) nicht liefert, bleibt gültig.
 *
 * Speicher bezieht sich auf das Dateisystem von `AGENT_DATA_DIR` – dort liegen
 * die Server-Datenordner, deren Platzbedarf die Kapazitätsprüfung deckelt.
 */
export interface AgentNodeStats {
  /** Logische CPU-Kerne der VM. */
  readonly cpuCores: number;
  /**
   * Systemlast der letzten Minute (Unix `loadavg`), oder `null`, wo die
   * Plattform sie nicht führt (z. B. Windows in der Entwicklung).
   */
  readonly cpuLoad1m: number | null;
  /** Gesamter Arbeitsspeicher der VM in MB. */
  readonly ramTotalMb: number;
  /** Momentan verfügbarer Arbeitsspeicher in MB. */
  readonly ramAvailableMb: number;
  /** Gesamtgröße des Datenverzeichnis-Dateisystems in MB. */
  readonly diskTotalMb: number;
  /** Momentan freier Speicher desselben Dateisystems in MB. */
  readonly diskAvailableMb: number;
  /** Zeitpunkt der Messung als ISO-8601. */
  readonly observedAt: string;
}

// ---------------------------------------------------------------------------
// Frames: Agent -> Backend
// ---------------------------------------------------------------------------

/**
 * Erster Frame nach dem Verbindungsaufbau. Enthält bewusst **kein** Token –
 * die Authentifizierung ist zu diesem Zeitpunkt bereits über den
 * `Authorization`-Header des Handshakes erfolgt.
 */
export interface AgentHelloFrame {
  readonly kind: 'hello';
  readonly protocolVersion: number;
  /** Version des Agent-Pakets, nur für Diagnose/Logging. */
  readonly agentVersion: string;
  /**
   * Node, für die sich dieser Agent hält (`HostNode.id`, Pflichtenheft §6);
   * `null` oder fehlend, wenn der Agent sie nicht kennt.
   *
   * Kein Ersatz für die Authentifizierung: Zugeordnet wird die Verbindung über
   * das Token im `Authorization`-Header, das je Node vergeben wird. Die Kennung
   * ist die zweite Angabe daneben – nennt der Agent eine andere Node als sein
   * Token, wird die Verbindung abgelehnt, statt der einen oder der anderen
   * Angabe zu glauben (WORK_STATUS.md, Gefundener Punkt 57).
   *
   * Optional und additiv: Ein Agent, der die Kennung nicht kennt, verbindet
   * sich wie bisher allein über sein Token.
   */
  readonly nodeId?: string | null;
  readonly sentAt: string;
}

/** Anlass eines Ist-Zustands-Berichts. */
export type AgentStateReportReason =
  /** Direkt nach (Wieder-)Verbindung – Grundlage des Soll/Ist-Abgleichs in B3. */
  | 'connected'
  /** Auf ausdrückliche Anforderung des Backends (`stateRequest`). */
  | 'requested';

/**
 * Vollständiger Ist-Zustand **aller** dem Agent bekannten Container
 * (Pflichtenheft §2.2). Bewusst immer vollständig, nie als Teilmenge oder Delta:
 * nur so kann das Backend Abweichungen erkennen, die während der Trennung
 * entstanden sind (z. B. ein zwischenzeitlich abgestürzter Server).
 */
export interface AgentStateReportFrame {
  readonly kind: 'stateReport';
  readonly reason: AgentStateReportReason;
  readonly containers: readonly AgentContainerState[];
  /**
   * Gemessene Ist-Ressourcen der Node (siehe {@link AgentNodeStats}). Optional
   * und additiv: Ein Agent, der sie noch nicht sendet, bleibt gültig; das
   * Backend behält dann seinen zuletzt bekannten Stand.
   */
  readonly nodeStats?: AgentNodeStats;
  readonly reportedAt: string;
}

/** Unaufgefordertes Ereignis vom Agent (Statuswechsel, Stats, Log-Zeile, Absturz). */
export interface AgentEventFrame {
  readonly kind: 'event';
  readonly event: AgentEventName;
  readonly serverId: string | null;
  /**
   * Ereignis-spezifische Nutzdaten. Bewusst offen: Die konkrete Form je Ereignis
   * bringen A2 (Runtime) und A3 (Jobs) additiv mit, sobald sie die Ereignisse
   * tatsächlich erzeugen. A1 reicht sie nur durch.
   */
  readonly payload?: unknown;
  readonly emittedAt: string;
}

/**
 * Ergebnis eines Befehls, immer mit derselben Korrelations-ID wie der Befehl.
 *
 * Das Ergebnis nutzt den Response-Envelope aus Pflichtenheft §5.1 – Fehler sind
 * damit auch hier benannte Codes aus dem Katalog und keine Freitext-Strings.
 */
export interface AgentCommandResultFrame {
  readonly kind: 'commandResult';
  readonly correlationId: CorrelationId;
  readonly command: AgentCommandName;
  readonly result: ApiResponse<unknown>;
  /**
   * `true`, wenn dieser Befehl bereits verarbeitet war und **nicht erneut
   * ausgeführt** wurde (Pflichtenheft §2.2). Das gespeicherte Ergebnis wird
   * trotzdem noch einmal geschickt: Ein Retry entsteht meist gerade deshalb,
   * weil das erste Ergebnis das Backend nicht erreicht hat.
   */
  readonly duplicate: boolean;
  readonly completedAt: string;
}

/**
 * Nutzlast von `STATS_UPDATE`, wenn sie aus der **periodischen Server-Abfrage**
 * des Agents stammt (Arbeitspaket A3, Pflichtenheft §9).
 *
 * Bewusst kein eigenes Ereignis: Das Backend zieht den Aktivitätszeitpunkt für
 * den Auto-Shutdown bereits aus `STATS_UPDATE` nach
 * (`handleStatsUpdate()` in B3). Ein zweites Ereignis mit derselben Bedeutung
 * müsste dort erst verdrahtet werden und hätte bis dahin gar keine Wirkung.
 *
 * `STATS_UPDATE` trägt damit zwei Arten von Nutzlast: die Container-Messwerte
 * der Runtime (`AgentContainerStats`) und dieses Abfrageergebnis. Sie sind am
 * Feld `source` unterscheidbar.
 */
export interface AgentServerQueryPayload {
  readonly source: 'serverQuery';
  readonly containerId: string;
  /** Hat der Server auf die Abfrage geantwortet? */
  readonly reachable: boolean;
  /**
   * Verbundene Spieler. `null`, wenn die Abfrageart keine Spielerzahl liefert
   * (reiner Port-Connect-Test) oder der Server nicht geantwortet hat.
   */
  readonly playersOnline: number | null;
  readonly playersMax: number | null;
  /**
   * Namen der verbundenen Spieler, soweit die Abfrage sie herausgibt
   * (Gefundener Punkt 51).
   *
   * Optional und additiv. Der Port-Connect-Test liefert sie nie; `gamedig`
   * liefert sie je nach Spiel und Servereinstellung ganz, teilweise oder gar
   * nicht. Fehlt das Feld, heißt das „keine Angabe", nicht „niemand da".
   */
  readonly players?: readonly ServerLivePlayer[];
  /** Antwortzeit in Millisekunden; `null`, wenn nicht erreichbar. */
  readonly pingMs: number | null;
  /** Grund des Fehlschlags; `null`, wenn erreichbar. */
  readonly reason: string | null;
  /** Zeitpunkt der Abfrage als ISO-8601. */
  readonly at: string;
}

export type AgentToBackendFrame =
  AgentHelloFrame | AgentStateReportFrame | AgentEventFrame | AgentCommandResultFrame;

// ---------------------------------------------------------------------------
// Frames: Backend -> Agent
// ---------------------------------------------------------------------------

/** Bestätigung des Handshakes durch das Backend. */
export interface BackendWelcomeFrame {
  readonly kind: 'welcome';
  readonly protocolVersion: number;
  readonly sentAt: string;
}

/** Befehl an den Agent, immer mit Korrelations-ID (Pflichtenheft §2.2). */
export interface BackendCommandFrame {
  readonly kind: 'command';
  readonly correlationId: CorrelationId;
  readonly command: AgentCommandName;
  /** Betroffener `GameServer`, oder `null` bei node-weiten Befehlen (z. B. `GET_STORAGE_BREAKDOWN`). */
  readonly serverId: string | null;
  /**
   * Befehls-spezifische Nutzdaten. Bewusst offen: die konkrete Form je Befehl
   * bringen A2 (Runtime) und B3 (Orchestrierung) additiv mit. A1 validiert nur
   * den Rahmen und reicht die Nutzdaten unverändert an die Runtime weiter.
   */
  readonly payload?: unknown;
  readonly issuedAt: string;
}

/** Aufforderung, den vollständigen Ist-Zustand erneut zu melden. */
export interface BackendStateRequestFrame {
  readonly kind: 'stateRequest';
  readonly requestedAt: string;
}

export type BackendToAgentFrame =
  BackendWelcomeFrame | BackendCommandFrame | BackendStateRequestFrame;

/** Alle Frame-Kennungen beider Richtungen (z. B. für Logging/Metriken). */
export type AgentFrameKind = AgentToBackendFrame['kind'] | BackendToAgentFrame['kind'];
