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
  'GET_STORAGE_BREAKDOWN',
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
