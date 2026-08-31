/**
 * WebSocket-Endpunkt `/agent` (Pflichtenheft §2.2).
 *
 * Der schmale Teil: Fastify und `ws` an {@link AgentSession} anschließen. Die
 * Protokoll-Logik selbst steht in `agent-gateway.ts` und kennt weder Fastify
 * noch `ws` – deshalb liegt hier so wenig wie möglich.
 *
 * **Neue Abhängigkeit `@fastify/websocket`** (CLAUDE.md §1): Das Agent-Protokoll
 * aus Pflichtenheft §2.2/§5.3 verlangt eine persistente, vom Agent ausgehende
 * WebSocket-Verbindung; Fastify kann WebSockets ohne dieses Plugin nicht
 * annehmen. Es ist das offizielle Fastify-Plugin und setzt auf `ws` auf –
 * dieselbe Bibliothek, die der Agent für die Gegenseite benutzt (A1).
 *
 * **Authentifizierung:** Das Pre-Shared-Token wird im `Authorization:
 * Bearer …`-Header des Handshakes geprüft, **bevor** die Verbindung angenommen
 * wird. Eine abgelehnte Verbindung wird mit Close-Code 4401 beendet, damit der
 * Agent „falsches Token" von „Backend gerade weg" unterscheiden kann
 * (`CLOSE_CODE_UNAUTHORIZED` in `apps/agent/src/connection/websocket-transport.ts`).
 */

// Der Import bringt die Typerweiterung für `{ websocket: true }` mit; das
// Plugin selbst wird in `server.ts` registriert.
import { type WebSocket } from '@fastify/websocket';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  type AgentGatewayLogger,
  type AgentRegistry,
  type AgentSessionHandlers,
  AgentSession,
  CLOSE_CODE_UNAUTHORIZED,
  bearerTokenFrom,
  isAuthorizedAgentHandshake,
} from './agent-gateway.js';

export interface AgentRouteOptions {
  readonly agents: AgentRegistry;
  readonly handlers: AgentSessionHandlers;
  readonly log: AgentGatewayLogger;
  /**
   * Gemeinsames `AGENT_TOKEN` aus der zentralen `.env`.
   *
   * Der Rückfallweg für eine Installation mit genau einem Homeserver
   * (Pflichtenheft §1, §2.1): Wer kein Token je Node vergeben hat, meldet sich
   * weiter hiermit an und landet auf der vorgegebenen Node.
   */
  readonly token: string | undefined;
  /**
   * Node zu einem vorgelegten Agent-Token (B8, Gefundener Punkt 57).
   *
   * Das ist der Weg für mehrere Nodes: Jede bekommt ihr eigenes Token, und
   * darüber ist die Verbindung eindeutig zugeordnet. `null`, wenn zu diesem
   * Token keine Node gehört – dann greift der Rückfallweg über
   * {@link AgentRouteOptions.token}.
   */
  resolveHostIdByToken?(token: string): Promise<string | null>;
  /**
   * Vorgegebene Node für den Rückfallweg über das gemeinsame Token.
   *
   * Phase 1 betreibt genau einen Homeserver; solange kein Token je Node
   * vergeben ist, wird die Verbindung dieser Node zugeordnet.
   */
  resolveHostId(): Promise<string | null>;
  readonly commandTimeoutMs?: number;
}

export function registerAgentRoute(app: FastifyInstance, options: AgentRouteOptions): void {
  app.get(
    '/agent',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest): Promise<void> => {
      /*
       * Zwei Wege, in dieser Reihenfolge (Gefundener Punkt 57):
       *
       * 1. Ein Token je Node – dann ist die Verbindung eindeutig zugeordnet und
       *    ein kompromittierter Agent betrifft nur seine eigene Node.
       * 2. Das gemeinsame `AGENT_TOKEN` aus der `.env` – der Rückfallweg für
       *    eine Installation mit genau einem Homeserver. Er bleibt erhalten,
       *    damit eine bestehende Installation nach dem Update weiterläuft,
       *    ohne dass jemand zuerst Token vergeben muss.
       */
      const presented = bearerTokenFrom(request.headers.authorization);
      const hostIdByToken =
        presented === null ? null : ((await options.resolveHostIdByToken?.(presented)) ?? null);

      if (
        hostIdByToken === null &&
        !isAuthorizedAgentHandshake(request.headers.authorization, options.token)
      ) {
        options.log.warn(
          { ip: request.ip },
          'Agent-Verbindung ohne gültiges Pre-Shared-Token abgelehnt',
        );
        socket.close(CLOSE_CODE_UNAUTHORIZED, 'Ungültiges Agent-Token.');

        return;
      }

      const hostId = hostIdByToken ?? (await options.resolveHostId());

      if (hostId === null) {
        options.log.error(
          { ip: request.ip },
          'Agent-Verbindung abgelehnt: es ist keine Node eingerichtet',
        );
        socket.close(CLOSE_CODE_UNAUTHORIZED, 'Es ist keine Node eingerichtet.');

        return;
      }

      const session = new AgentSession({
        hostId,
        socket: {
          send: (data: string) => {
            socket.send(data);
          },
          close: (code: number, reason: string) => {
            socket.close(code, reason);
          },
        },
        handlers: options.handlers,
        log: options.log,
        commandTimeoutMs: options.commandTimeoutMs,
      });

      options.agents.register(session);

      socket.on('message', (data: unknown) => {
        session.handleMessage(String(data));
      });

      socket.on('close', (code: number, reason: Buffer) => {
        session.handleSocketClosed(code, reason.toString());
        options.agents.unregister(session);
      });

      socket.on('error', (error: Error) => {
        options.log.error({ hostId, error: error.message }, 'Fehler auf der Agent-Verbindung');
      });
    },
  );
}
