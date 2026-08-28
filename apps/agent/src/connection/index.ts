/**
 * A1 – Core-Verbindung des Agents (STRUKTUR.md, Pflichtenheft §2.2).
 *
 * Öffentliche Fläche des Arbeitspakets: A2 (Runtime) und A3 (Jobs) binden sich
 * über {@link AgentRuntimePort} bzw. {@link AgentConnection.sendEvent} an, das
 * Protokoll selbst kommt aus `@palantir/contracts`.
 */

export { ExponentialBackoff, DEFAULT_BACKOFF_OPTIONS, type BackoffOptions } from './backoff.js';
export {
  CorrelationStore,
  DEFAULT_CORRELATION_STORE_OPTIONS,
  type CorrelationStoreOptions,
  type ProcessedCommand,
} from './correlation-store.js';
export {
  AgentConnection,
  consoleLogger,
  type AgentConnectionOptions,
  type ConnectionLogger,
  type ConnectionState,
} from './agent-connection.js';
export type {
  AgentRuntimePort,
  CommandExecution,
  CommandExecutor,
  ContainerStateSource,
  OutboundEvent,
} from './ports.js';
export type {
  Transport,
  TransportCloseInfo,
  TransportFactory,
  TransportHandlers,
} from './transport.js';
export {
  CLOSE_CODE_UNAUTHORIZED,
  createWebSocketTransportFactory,
  type WebSocketTransportOptions,
} from './websocket-transport.js';

export {
  ContainerRuntimeAdapter,
  RUNTIME_ERROR_TO_API_CODE,
  toAgentContainerState,
  toContainerSpec,
  toErrorResponse,
  toOutboundEvent,
  type OutboundEventSink,
  type RuntimeAdapterOptions,
} from './runtime-adapter.js';

export { createNodeStatsReader, readNodeStats } from './node-stats.js';

import { AgentConnection, type AgentConnectionOptions } from './agent-connection.js';
import type { AgentRuntimePort } from './ports.js';
import { createWebSocketTransportFactory } from './websocket-transport.js';

export interface CreateAgentConnectionOptions extends Omit<
  AgentConnectionOptions,
  'transportFactory'
> {
  /** WebSocket-Endpunkt des Backends (`AGENT_BACKEND_WS_URL`). */
  readonly backendWsUrl: string;
  /** Pre-Shared-Token (`AGENT_TOKEN`). */
  readonly token: string;
  readonly runtime: AgentRuntimePort;
}

/**
 * Erzeugt die einsatzfertige Verbindung über einen echten WebSocket.
 *
 * Ohne Token wirft die Funktion – es gibt keinen Weg, den Agent ohne
 * Authentifizierung zu verbinden (CLAUDE.md §2).
 */
export function createAgentConnection(options: CreateAgentConnectionOptions): AgentConnection {
  const { backendWsUrl, token, ...connectionOptions } = options;

  return new AgentConnection({
    ...connectionOptions,
    transportFactory: createWebSocketTransportFactory({ url: backendWsUrl, token }),
  });
}
