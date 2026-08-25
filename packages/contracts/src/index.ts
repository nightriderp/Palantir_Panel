/**
 * @palantir/contracts
 *
 * Vertragsgrenze zwischen Backend, Frontend und Agent (Pflichtenheft §4, CLAUDE.md §3).
 *
 * Enthalten ist die paket-übergreifende Basis (Response-Envelope, Fehlercode-Katalog,
 * Benennungsschema der WebSocket-Events) sowie die fachlichen DTOs, die bereits
 * gebraucht werden. Weitere DTOs und die Agent-Protokoll-Befehle kommen aus den
 * jeweiligen Arbeitspaketen – jeweils über einen eigenen, kleinen PR, niemals
 * nebenbei in einem Feature-PR (CLAUDE.md §6).
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
export * from './game-server.js';
export * from './permissions.js';
export * from './role.js';
