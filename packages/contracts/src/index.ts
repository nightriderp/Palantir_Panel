/**
 * @palantir/contracts
 *
 * Vertragsgrenze zwischen Backend, Frontend und Agent (Pflichtenheft §4, CLAUDE.md §3).
 *
 * Enthalten sind die paket-übergreifende Basis (Response-Envelope,
 * Fehlercode-Katalog, Benennungsschema der WebSocket-Events), die bereits
 * gebrauchten fachlichen DTOs und das Agent-Protokoll (Befehle, Ereignisse,
 * Frames, Korrelations-ID-Format). Weitere DTOs (inkl. `permissions`-Objekt aus
 * B2) und die Nutzdaten der einzelnen Agent-Befehle kommen aus den jeweiligen
 * Arbeitspaketen – jeweils über einen eigenen, kleinen PR, niemals nebenbei in
 * einem Feature-PR (CLAUDE.md §6).
 *
 * Änderungen sind bevorzugt additiv (neue optionale Felder). Breaking Changes
 * an bestehenden Feldern werden im Commit und PR explizit gekennzeichnet.
 */

export {
  type ApiErrorBody,
  type ApiErrorResponse,
  type ApiResponse,
  type ApiSuccessResponse,
  fail,
  httpStatusForResponse,
  isFail,
  isOk,
  ok,
} from './envelope.js';

export {
  ERROR_CATALOG,
  ERROR_CODES,
  type ErrorCode,
  type ErrorDefinition,
  defaultMessageForErrorCode,
  httpStatusForErrorCode,
  isErrorCode,
} from './errors.js';

export {
  WEBSOCKET_EVENTS,
  type EventNameScheme,
  type WebSocketEventName,
  isWebSocketEventName,
} from './events.js';

export * from './server-lifecycle.js';
export * from './backup.js';
export * from './schedule.js';
export * from './game-server.js';
export * from './game-type.js';
export * from './server-member.js';
export * from './server-files.js';
export * from './server-jobs.js';
export * from './server-live.js';
export * from './subdomain.js';
export * from './permissions.js';
export * from './resources.js';
export * from './role.js';
export * from './auth.js';

// Notification-Engine (Arbeitspaket B6): Ereignis-Nutzdaten, Kanäle, Regeln,
// Inbox, systemweite Ankündigungen und der Live-Kanal der Inbox.
export * from './notifications.js';

// Admin-Funktionen (Arbeitspaket B8): Nodes, öffentlicher Port-Pool,
// Audit-Log, Speicherverwaltung und Freischalt-Warteliste.
export * from './host-node.js';
export * from './address.js';
export * from './audit.js';
export * from './storage.js';
export * from './registration-request.js';

export {
  AGENT_COMMANDS,
  AGENT_CONTAINER_STATUSES,
  AGENT_EVENTS,
  AGENT_PROTOCOL_VERSION,
  type AgentCommandName,
  type AgentCommandResultFrame,
  type AgentContainerState,
  type AgentContainerStatus,
  type AgentEventFrame,
  type AgentEventName,
  type AgentFrameKind,
  type AgentHelloFrame,
  type AgentStateReportFrame,
  type AgentStateReportReason,
  type AgentToBackendFrame,
  type BackendCommandFrame,
  type BackendStateRequestFrame,
  type BackendToAgentFrame,
  type BackendWelcomeFrame,
  type CorrelationId,
  isAgentCommandName,
  isAgentContainerStatus,
  isAgentEventName,
} from './agent-protocol.js';

export {
  IMPLEMENTED_AGENT_COMMANDS,
  type AgentCommandPayloads,
  type AgentCommandResults,
  type AgentContainerStats,
  type AgentFileEntry,
  type AgentFileEntryType,
  type AgentLogLine,
  type AgentLogStreamName,
  type AgentPortMapping,
  type AgentPortProtocol,
  type AgentResourceLimits,
  type AgentStorageEntry,
  type AgentStorageEntryKind,
  type AgentVolumeMount,
  type CreateBackupCommandPayload,
  type CreateBackupCommandResult,
  type GetStorageBreakdownCommandPayload,
  type GetStorageBreakdownCommandResult,
  type CreateCommandPayload,
  type CreateCommandResult,
  type DeleteBackupCommandPayload,
  type DeleteBackupCommandResult,
  type DeleteCommandPayload,
  type DownloadBackupCommandPayload,
  type DownloadBackupCommandResult,
  type ExecConsoleCommandPayload,
  type ExecConsoleCommandResult,
  type FileListCommandPayload,
  type FileListCommandResult,
  type FileReadCommandPayload,
  type FileReadCommandResult,
  type FileWriteCommandPayload,
  type GetLogsCommandPayload,
  type GetLogsCommandResult,
  type GetStatsCommandPayload,
  type ImplementedAgentCommandName,
  type RestartCommandPayload,
  type RestoreBackupCommandPayload,
  type RestoreBackupCommandResult,
  type StartCommandPayload,
  type StopCommandPayload,
  isImplementedAgentCommand,
} from './agent-commands.js';
