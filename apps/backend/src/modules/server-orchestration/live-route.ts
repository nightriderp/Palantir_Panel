import { type WebSocket } from '@fastify/websocket';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  type ConsoleLineSource,
  type LiveClientFrame,
  type ServerConsoleLine,
} from '@palantir/contracts';
import { requireActor } from '../rbac/index.js';
import { type GameRegistry } from './game-registry.js';
import { type ServerLiveHub } from './live-hub.js';
import { toGameServerDto } from './dto.js';
import { isServerOrchestrationError } from './errors.js';
import { type ServerRepository } from './repository.js';
import { type ServerOrchestrationService } from './service.js';

/**
 * Browserseitiger Live-Kanal `/live` (Pflichtenheft §5.3).
 *
 * Gegenstück zum Agent-Kanal `/agent`: Hier hängt der Browser, nicht der
 * Homeserver. Der Client abonniert einzelne Server (`subscribe`) und bekommt
 * deren Ereignisse als Frames; über `consoleCommand` schickt er Konsolenzeilen.
 *
 * Authentifiziert wird über dieselbe Sitzung wie bei den REST-Routen (B1) – die
 * `onRequest`-Hooks laufen auch beim WebSocket-Handshake. Ohne angemeldetes
 * Konto wird die Verbindung gar nicht erst angenommen. Ein Abo entsteht nur für
 * Server, die der Aufrufer sehen darf (`permissions.canView`); Konsolenbefehle
 * verlangen zusätzlich `permissions.canUseConsole`. Die Prüfung liegt also auch
 * hier am `permissions`-Objekt und nicht im Client.
 */
export interface ServerLiveRouteOptions {
  readonly hub: ServerLiveHub;
  readonly service: ServerOrchestrationService;
  readonly repository: ServerRepository;
  readonly registry: GameRegistry;
  readonly baseDomain: string;
}

export function registerServerLiveRoute(
  app: FastifyInstance,
  options: ServerLiveRouteOptions,
): void {
  const { hub, service, repository, registry, baseDomain } = options;

  /** Berechnet das `permissions`-Objekt eines Servers für den Aufrufer. */
  async function permissionsFor(request: FastifyRequest, serverId: string) {
    const actor = requireActor(request);
    const viewerId = request.viewerUserId ?? null;
    const server = await service.requireServer(serverId);
    const members = await repository.listMembers(serverId);

    return toGameServerDto(server, {
      actor,
      viewerId,
      viewerMemberLevel:
        viewerId === null
          ? null
          : (members.find((member) => member.userId === viewerId)?.level ?? null),
      memberCount: members.length,
      registry,
      baseDomain,
      recentCrashCount: service.recentCrashCount(server),
    }).permissions;
  }

  app.get('/live', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    // Auth: Es braucht sowohl das Konto (B1) als auch den Rechte-Akteur (B2).
    let authenticated = (request.viewerUserId ?? null) !== null;
    try {
      requireActor(request);
    } catch {
      authenticated = false;
    }
    if (!authenticated) {
      socket.close(4401, 'Nicht angemeldet.');

      return;
    }

    const registration = hub.register({
      send: (data: string) => {
        socket.send(data);
      },
    });

    function pushLine(serverId: string, source: ConsoleLineSource, text: string): void {
      hub.publish('server.consoleLineAppended', {
        serverId,
        line: buildConsoleLine(serverId, source, text),
      });
    }

    function pushOutput(serverId: string, source: ConsoleLineSource, block: string): void {
      for (const line of block.split('\n')) {
        if (line.length > 0) {
          pushLine(serverId, source, line);
        }
      }
    }

    async function handleFrame(text: string): Promise<void> {
      const frame = parseClientFrame(text);
      if (frame === null) {
        return;
      }
      const serverId = frame.topic.id;

      switch (frame.kind) {
        case 'subscribe': {
          try {
            const permissions = await permissionsFor(request, serverId);
            if (permissions.canView) {
              registration.subscribe(serverId);
            }
          } catch {
            // Nicht sichtbar oder nicht vorhanden: kein Abo, keine Rückmeldung –
            // die Existenz eines fremden Servers ist selbst schon eine Information.
          }

          return;
        }
        case 'unsubscribe': {
          registration.unsubscribe(serverId);

          return;
        }
        case 'consoleCommand': {
          // Nur für einen abonnierten Server, und nur mit Konsolenrecht.
          if (!registration.isSubscribed(serverId)) {
            return;
          }
          const command = frame.command.trim();
          if (command.length === 0) {
            return;
          }

          try {
            const permissions = await permissionsFor(request, serverId);
            if (!permissions.canUseConsole) {
              return;
            }

            // Eingabe sofort spiegeln, damit erkennbar bleibt, was abgeschickt
            // wurde; danach die Antwort des Agenten anhängen. (Der laufende
            // stdout-Stream ist ein dokumentierter Folgeschritt – bis dahin
            // liefert der Request/Response-Weg die Ausgabe eines Befehls.)
            pushLine(serverId, 'input', `> ${command}`);
            const result = await service.execConsole(serverId, command);
            pushOutput(serverId, 'stdout', result.stdout);
            pushOutput(serverId, 'stderr', result.stderr);
          } catch (error) {
            const message = isServerOrchestrationError(error)
              ? error.message
              : 'Der Befehl konnte nicht ausgeführt werden.';
            pushLine(serverId, 'system', message);
          }

          return;
        }
      }
    }

    socket.on('message', (raw: unknown) => {
      void handleFrame(bufferToString(raw));
    });
    socket.on('close', () => registration.close());
    socket.on('error', () => registration.close());
  });
}

// Fortlaufender Zähler für stabile, eindeutige Zeilen-Ids innerhalb des Prozesses.
let lineSequence = 0;

function buildConsoleLine(
  serverId: string,
  source: ConsoleLineSource,
  text: string,
): ServerConsoleLine {
  lineSequence += 1;

  return {
    id: `${serverId}-${lineSequence}`,
    serverId,
    source,
    text,
    timestamp: new Date().toISOString(),
  };
}

/** Wandelt die eingehende WebSocket-Nutzlast robust in einen String. */
function bufferToString(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw instanceof Buffer) {
    return raw.toString('utf8');
  }

  return String(raw);
}

/** Liest ein `LiveClientFrame`; `null`, wenn die Nachricht nicht passt. */
function parseClientFrame(text: string): LiveClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const candidate = parsed as {
    kind?: unknown;
    topic?: { resource?: unknown; id?: unknown };
    command?: unknown;
  };
  const topic = candidate.topic;
  if (!topic || topic.resource !== 'server' || typeof topic.id !== 'string') {
    return null;
  }

  if (candidate.kind === 'subscribe' || candidate.kind === 'unsubscribe') {
    return { kind: candidate.kind, topic: { resource: 'server', id: topic.id } };
  }
  if (candidate.kind === 'consoleCommand' && typeof candidate.command === 'string') {
    return {
      kind: 'consoleCommand',
      topic: { resource: 'server', id: topic.id },
      command: candidate.command,
    };
  }

  return null;
}
