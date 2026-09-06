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
import { type SourceAllowlist, isSourceAllowed } from './source-allowlist.js';

export interface AgentRouteOptions {
  readonly agents: AgentRegistry;
  readonly handlers: AgentSessionHandlers;
  readonly log: AgentGatewayLogger;
  /**
   * Zulässige Quelladressen (`AGENT_SOURCE_ALLOWLIST`, Fundpunkt 121).
   *
   * Zweite Schicht hinter dem Deployment (Traefik lässt `/agent` aus, der
   * Host-Port hängt an der Tunnel-Adresse): Kommt die Gegenstelle nicht aus
   * dem Tunnelnetz, wird das Token gar nicht erst geprüft. Leer oder nicht
   * gesetzt = keine Prüfung.
   */
  readonly sourceAllowlist?: SourceAllowlist;
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
       * Zuerst die Quelladresse (Fundpunkt 121, W0-2), erst danach das Token.
       *
       * Geprüft wird die Adresse der TCP-Gegenstelle
       * (`request.socket.remoteAddress`), bewusst nicht `request.ip`: Das folgt
       * mit `TRUSTED_PROXY_HOPS=1` (`server.ts`) einem `X-Forwarded-For`-Header
       * der direkt verbundenen Gegenstelle – auf dem Agent-Weg steht aber kein
       * Proxy, dessen Header hier gelten dürfte. Der Agent kommt durch den
       * WireGuard-Tunnel an den Host-Port `WIREGUARD_VPS_IP:4000`
       * (`deploy/vps/docker-compose.yml`); Docker reicht ihn per DNAT in den
       * Container und lässt die Absenderadresse stehen, die Gegenstelle ist
       * also die Tunnel-Adresse des Homeservers (`WIREGUARD_HOME_IP`). Nur eine
       * Verbindung vom VPS-Host selbst liefe über Dockers Userland-Proxy und
       * erschiene als Bridge-Adresse – von dort kommt der Agent nie. Über
       * Traefik wäre die Gegenstelle der Traefik-Container aus dem Docker-Netz,
       * also außerhalb des Tunnelnetzes, selbst wenn das Label im Deployment
       * fehlte. Ein Nachbar-Container im Docker-Netz könnte `request.ip` per
       * gefälschtem Header ins Tunnelnetz legen, seine Socket-Adresse nicht.
       *
       * Gleicher Close-Code wie beim Token: Der Agent versucht bei 4401 keinen
       * Reconnect, das Protokoll nennt den Grund.
       */
      const peer = request.socket.remoteAddress;

      if (!isSourceAllowed(options.sourceAllowlist ?? [], peer)) {
        options.log.warn(
          { peer: peer ?? null, ip: request.ip },
          'Agent-Verbindung von einer Quelladresse außerhalb von AGENT_SOURCE_ALLOWLIST abgelehnt',
        );
        socket.close(CLOSE_CODE_UNAUTHORIZED, 'Quelladresse nicht zugelassen.');

        return;
      }

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
