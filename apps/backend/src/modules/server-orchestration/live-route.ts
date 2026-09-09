import { randomUUID } from 'node:crypto';
import { type WebSocket } from '@fastify/websocket';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  type ConsoleLineSource,
  type LiveClientFrame,
  type LiveTopic,
  type ServerConsoleLine,
  type ServerLiveExtraFrame,
} from '@palantir/contracts';
import { liveClientFrameSchema } from '@palantir/validation';
import { fireAndForget } from '../../lib/fire-and-forget.js';
import { createWebSocketOriginGuard } from '../../lib/ws-origin.js';
import { requireActor } from '../rbac/index.js';
import { type GameRegistry } from './game-registry.js';
import { type ServerLiveHub } from './live-hub.js';
import {
  LIVE_CLOSE_CODE_FORBIDDEN,
  LIVE_CLOSE_CODE_UNAUTHORIZED,
  LIVE_MAX_FRAME_BYTES,
  SUBSCRIPTION_CHECK_INTERVAL_MS,
} from './live-frames.js';
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
 *
 * **Vier Zusagen aus Audit W2-5:**
 * 1. Eingehende Frames werden gegen `liveClientFrameSchema` aus
 *    `@palantir/validation` geprüft – derselbe Regelsatz wie auf dem REST-Weg,
 *    Konsolenbefehle also über `consoleCommandSchema`
 *    (`contracts-validation-04`).
 * 2. Zeilen-Ids tragen die Kennung dieses Prozesses, damit der Browser nach
 *    einem Backend-Neustart keine neuen Zeilen für Wiederholungen hält
 *    (`event-flow-07`).
 * 3. `subscribe` beantwortet ein `resync` mit dem Ist-Stand, und ein `ping`
 *    hält die Verbindung durch Reverse Proxies offen (`event-flow-03`).
 * 4. Abos werden am offenen Kanal wiederkehrend nachgeprüft; die Herkunft des
 *    Handshakes wird gegen die Panel-Adresse geprüft (`orchestration-core-09`,
 *    `security-matrix-04`).
 */
export interface ServerLiveRouteOptions {
  readonly hub: ServerLiveHub;
  readonly service: ServerOrchestrationService;
  readonly repository: ServerRepository;
  readonly registry: GameRegistry;
  readonly baseDomain: string;
  /**
   * Panel-Adresse (`PUBLIC_WEB_URL`) für die Herkunftsprüfung des Handshakes
   * (`security-matrix-04`). Ohne Angabe bleibt die Prüfung aus – so laufen
   * Tests und Entwicklungsaufbauten ohne konfigurierte Adresse weiter.
   */
  readonly allowedOrigin?: string;
  /** Abstand der wiederkehrenden Abo-Prüfung; Vorgabe 60 s. Nur für Tests gedacht. */
  readonly subscriptionCheckIntervalMs?: number;
}

export function registerServerLiveRoute(
  app: FastifyInstance,
  options: ServerLiveRouteOptions,
): void {
  const { hub, service, repository, registry, baseDomain } = options;

  /** Berechnet den DTO eines Servers aus Sicht des Aufrufers. */
  async function serverDtoFor(request: FastifyRequest, serverId: string) {
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
    });
  }

  app.get(
    '/live',
    {
      websocket: true,
      // Cross-Site-WebSocket-Hijacking: Handshakes unterliegen nicht CORS
      // (`security-matrix-04`). Abgelehnt wird vor dem Upgrade.
      onRequest: createWebSocketOriginGuard(options.allowedOrigin),
    },
    (socket: WebSocket, request: FastifyRequest) => {
      // Auth: Es braucht sowohl das Konto (B1) als auch den Rechte-Akteur (B2).
      let authenticated = (request.viewerUserId ?? null) !== null;
      // Und die Freischaltung (Lastenheft §3.1): Ein Konto in der Warteliste soll
      // keine Live-Verbindung offenhalten (security-matrix-06). Ein `preHandler`
      // kommt hier nicht in Frage – der Handshake ist bereits vollzogen, also
      // wird derselbe Actor-Wert geprüft, den `requireApproved()` liest.
      let approved = false;
      try {
        approved = requireActor(request).approved;
      } catch {
        authenticated = false;
      }
      if (!authenticated) {
        socket.close(LIVE_CLOSE_CODE_UNAUTHORIZED, 'Nicht angemeldet.');

        return;
      }
      if (!approved) {
        socket.close(LIVE_CLOSE_CODE_FORBIDDEN, 'Konto ist noch nicht freigeschaltet.');

        return;
      }

      const registration = hub.register(
        {
          send: (data: string) => {
            socket.send(data);
          },
          close: (code: number, reason?: string) => {
            socket.close(code, reason);
          },
        },
        request.viewerUserId ?? null,
      );

      /** Frame an genau diese Verbindung – nicht an alle Abonnenten des Themas. */
      function reply(frame: ServerLiveExtraFrame): void {
        try {
          socket.send(JSON.stringify(frame));
        } catch {
          // Verbindung gerade weg; das `close`-Ereignis räumt gleich auf.
        }
      }

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
        const roh = parseJson(text);
        const geprueft = liveClientFrameSchema.safeParse(roh);

        if (!geprueft.success) {
          // Nur der abgelehnte Konsolenbefehl bekommt eine Rückmeldung: Sonst
          // stünde die Zeile im Eingabefeld und nichts passierte. Alles andere
          // wird kommentarlos verworfen (contracts-validation-04).
          if (istRecord(roh) && roh.kind === 'consoleCommand') {
            reply({
              kind: 'error',
              topic: leseTopic(roh.topic),
              code: 'VALIDATION_FAILED',
              message: erstesProblem(geprueft.error.issues),
              sentAt: new Date().toISOString(),
            });
          }

          return;
        }

        const frame: LiveClientFrame = geprueft.data;

        // Das Lebenszeichen trägt als einziges Frame kein Thema (Vertrag:
        // `server-live.ts`) – es gilt der Verbindung, nicht einem Abo.
        if (frame.kind === 'ping') {
          reply({ kind: 'pong', sentAt: new Date().toISOString() });

          return;
        }

        if (frame.topic.resource === 'serverList') {
          // Listen-Thema (Fundpunkt 173): keine Rechteprüfung je Server nötig –
          // der Hub liefert nur, was Besitzer, Mitglied oder `server.view.any`
          // sehen dürfen. Ein Konsolenbefehl hat auf der Liste kein Ziel.
          if (frame.kind === 'subscribe') {
            registration.subscribeList({
              seesAll: requireActor(request).permissions.has('server.view.any'),
            });
          } else if (frame.kind === 'unsubscribe') {
            registration.unsubscribeList();
          } else {
            reply({
              kind: 'error',
              topic: frame.topic,
              code: 'VALIDATION_FAILED',
              message: 'Ein Konsolenbefehl braucht einen Server, keine Liste.',
              sentAt: new Date().toISOString(),
            });
          }

          return;
        }

        const serverId = frame.topic.id;

        switch (frame.kind) {
          case 'subscribe': {
            try {
              const dto = await serverDtoFor(request, serverId);
              if (dto.permissions.canView) {
                registration.subscribe(serverId);
                // Ist-Stand sofort hinterher (event-flow-03): Nach einem
                // Wiederanlauf meldet der Browser seine Abos erneut an und
                // hätte sonst bis zum nächsten Ereignis den alten Zustand
                // angezeigt – bei `running` kommt keins mehr außer Messwerten.
                reply({
                  kind: 'resync',
                  topic: frame.topic,
                  data: { status: dto.status, statusMessage: dto.statusMessage },
                  sentAt: new Date().toISOString(),
                });
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
            // Leerzeichen sind laut Schema erlaubt; ein reiner Leerbefehl ist
            // trotzdem keiner.
            const command = frame.command.trim();
            if (command.length === 0) {
              return;
            }

            try {
              const dto = await serverDtoFor(request, serverId);
              if (!dto.permissions.canUseConsole) {
                reply({
                  kind: 'error',
                  topic: frame.topic,
                  code: 'PERMISSION_DENIED',
                  message: 'Für die Konsole dieses Servers fehlt die Berechtigung.',
                  sentAt: new Date().toISOString(),
                });

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

      /**
       * Wiederkehrende Nachprüfung der Abos (`orchestration-core-09`).
       *
       * Der Rechte-Schnappschuss stammt aus dem Handshake. Entfernte der
       * Besitzer danach ein Mitglied, liefen Status, Messwerte (inklusive
       * Spielernamen) und Konsolenzeilen weiter, bis der Socket zufällig
       * schloss. Die Mitgliedschaft wird hier je Abo frisch aus der Datenbank
       * gelesen; fällt `canView` weg, endet das Abo.
       *
       * Nur ein klares „darf nicht mehr" beendet ein Abo: Ein
       * Infrastrukturfehler (Datenbank kurz weg) lässt es stehen, ein
       * gelöschter Server (`isServerOrchestrationError`) nicht.
       */
      async function pruefeAbos(): Promise<void> {
        for (const serverId of registration.subscribedServerIds()) {
          try {
            const dto = await serverDtoFor(request, serverId);
            if (!dto.permissions.canView) {
              registration.unsubscribe(serverId);
            }
          } catch (error) {
            if (isServerOrchestrationError(error)) {
              registration.unsubscribe(serverId);
            }
          }
        }
      }

      const timer = setInterval(() => {
        fireAndForget(pruefeAbos(), app.log, { vorgang: 'Live-Abos nachprüfen' });
      }, options.subscriptionCheckIntervalMs ?? SUBSCRIPTION_CHECK_INTERVAL_MS);

      // Der Zeitgeber darf das Beenden des Prozesses nicht aufhalten.
      timer.unref();

      const cleanup = (): void => {
        clearInterval(timer);
        registration.close();
      };

      socket.on('message', (raw: unknown) => {
        const text = bufferToString(raw);

        // Grenze vor dem Parsen: Ein mehrere Megabyte großes „Frame" soll gar
        // nicht erst durch `JSON.parse` (security-matrix-05 für diesen Kanal).
        if (Buffer.byteLength(text, 'utf8') > LIVE_MAX_FRAME_BYTES) {
          return;
        }

        // Die Frame-Verarbeitung fängt ihre Fehler je Fall selbst; das Netz
        // darunter verhindert, dass ein unerwarteter Wurf das Backend beendet
        // (Audit W0-5, Fundpunkt 126).
        fireAndForget(handleFrame(text), app.log, {
          vorgang: 'Live-Frame des Browsers verarbeiten',
        });
      });
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
}

/**
 * Kennung dieses Backend-Prozesses in jeder Zeilen-Id (`event-flow-07`).
 *
 * Vorher war die Id `${serverId}-${n}` mit einem Zähler, der bei jedem Start
 * wieder bei 0 begann. Nach einem Deploy erzeugte das Backend erneut `…-1`,
 * `…-2`, … – der Puffer im Browser hielt sie für schon gesehene Zeilen und
 * verwarf sie still (`consoleBuffer.ts` entdoppelt über die Id). Der Nutzer sah
 * auf seinen Befehl hin nichts, ohne Fehlermeldung.
 *
 * 12 Hex-Zeichen (48 Bit) sind knapp genug für lesbare Ids und weit jenseits
 * dessen, was über die Neustarts einer Instanz kollidieren könnte.
 */
export const LIVE_BOOT_ID = randomUUID().replaceAll('-', '').slice(0, 12);

// Fortlaufender Zähler für stabile, eindeutige Zeilen-Ids innerhalb des Prozesses.
let lineSequence = 0;

export function buildConsoleLine(
  serverId: string,
  source: ConsoleLineSource,
  text: string,
): ServerConsoleLine {
  lineSequence += 1;

  return {
    id: `${serverId}-${LIVE_BOOT_ID}-${lineSequence}`,
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

/** Nicht-JSON kommt als `null` zurück und fällt damit durch die Schema-Prüfung. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function istRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Thema aus einem abgelehnten Frame – nur zur Zuordnung der Fehlermeldung. */
function leseTopic(value: unknown): LiveTopic | null {
  if (!istRecord(value)) {
    return null;
  }

  if (value.resource === 'serverList' && value.id === 'all') {
    return { resource: 'serverList', id: 'all' };
  }

  if (value.resource !== 'server' || typeof value.id !== 'string') {
    return null;
  }

  return { resource: 'server', id: value.id };
}

/**
 * Erste Beanstandung als lesbarer Satz.
 *
 * Bewusst nur eine und ohne den Rohbaum: Die Meldung landet in der Konsole des
 * Nutzers, nicht im Log eines Entwicklers.
 */
function erstesProblem(issues: readonly { path: (string | number)[]; message: string }[]): string {
  const issue = issues[0];

  if (!issue) {
    return 'Der Befehl wurde abgelehnt.';
  }

  const feld = issue.path.join('.');

  return feld.length > 0 ? `${feld}: ${issue.message}` : issue.message;
}
