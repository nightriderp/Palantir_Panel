/**
 * Live-Kanal der Inbox (Pflichtenheft §5.3, `notifications.ts` in
 * `@palantir/contracts`).
 *
 * Zwei Teile, bewusst getrennt:
 *
 * - {@link createNotificationHub} – hält die offenen Verbindungen je Konto und
 *   kennt weder Fastify noch `ws`. Damit ist die Zustelllogik ohne Netzwerk
 *   prüfbar (CLAUDE.md §4).
 * - {@link registerNotificationLiveRoute} – der schmale Anschluss an Fastify.
 *
 * **Der Empfänger kommt aus der Sitzung**, nicht aus einem Frame: Ein Client
 * kann damit nicht die Inbox eines fremden Kontos abonnieren. Wer nicht
 * angemeldet ist, bekommt die Verbindung gar nicht erst.
 */

import { type WebSocket } from '@fastify/websocket';
import type { NotificationServerFrame } from '@palantir/contracts';
import { notificationClientFrameSchema } from '@palantir/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Clock, LiveNotificationPayload, LiveNotificationPublisher } from './ports.js';
import { systemClock } from './ports.js';
import type { NotificationService } from './service.js';

/**
 * Close-Code für eine Verbindung ohne gültige Sitzung.
 *
 * Wie beim Agent-Kanal (`CLOSE_CODE_UNAUTHORIZED` in `agent-gateway.ts`) ein
 * eigener Code aus dem privaten Bereich, damit das Frontend „nicht angemeldet"
 * von „Backend gerade weg" unterscheiden kann.
 */
export const CLOSE_CODE_UNAUTHORIZED = 4401;

/** Der Ausschnitt einer WebSocket-Verbindung, den der Hub braucht. */
export interface LiveSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface NotificationHub extends LiveNotificationPublisher {
  /** Meldet eine Verbindung an; die Rückgabe meldet sie wieder ab. */
  attach(userId: string, socket: LiveSocket): () => void;
  /** Offene Verbindungen eines Kontos – für Tests und den Health-Blick. */
  connectionCount(userId: string): number;
}

export interface NotificationHubOptions {
  readonly now?: Clock;
}

export function createNotificationHub(options: NotificationHubOptions = {}): NotificationHub {
  const now: Clock = options.now ?? systemClock;
  /** Ein Konto kann mehrere Tabs offen haben – deshalb ein Set je Konto. */
  const connections = new Map<string, Set<LiveSocket>>();

  function send(socket: LiveSocket, frame: NotificationServerFrame): void {
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      /*
       * Eine gerade geschlossene Verbindung ist kein Fehler des auslösenden
       * Vorgangs. Die Meldung steht in der Datenbank und wird beim nächsten
       * Abruf geliefert (Pflichtenheft §14).
       */
    }
  }

  return {
    attach(userId, socket) {
      const existing = connections.get(userId) ?? new Set<LiveSocket>();

      existing.add(socket);
      connections.set(userId, existing);

      return (): void => {
        const current = connections.get(userId);

        if (!current) {
          return;
        }

        current.delete(socket);

        if (current.size === 0) {
          connections.delete(userId);
        }
      };
    },

    connectionCount(userId) {
      return connections.get(userId)?.size ?? 0;
    },

    publish(userId, payload: LiveNotificationPayload) {
      const sockets = connections.get(userId);

      if (!sockets) {
        return;
      }

      // Der Hub bekommt das fertige DTO vom Service; er formt es nicht selbst.
      const frame: NotificationServerFrame = {
        kind: 'event',
        event: 'notification.created',
        data: payload,
        sentAt: now().toISOString(),
      };

      for (const socket of sockets) {
        send(socket, frame);
      }
    },
  };
}

export interface NotificationLiveRouteOptions {
  readonly hub: NotificationHub;
  readonly notifications: NotificationService;
  /** Konto-Id des Aufrufers aus der Sitzung (B1); `null` = nicht angemeldet. */
  resolveUserId(request: FastifyRequest): string | null;
  readonly path?: string;
}

/**
 * Hängt den WebSocket-Endpunkt ein (Standardpfad `/live/notifications`).
 *
 * Bewusst ein eigener Pfad neben dem Server-Live-Kanal aus F3: Die Inbox hängt
 * am angemeldeten Konto und soll offen bleiben, egal welche Seite gerade
 * angezeigt wird.
 */
export function registerNotificationLiveRoute(
  app: FastifyInstance,
  options: NotificationLiveRouteOptions,
): void {
  app.get(
    options.path ?? '/live/notifications',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest): Promise<void> => {
      const userId = options.resolveUserId(request);

      if (userId === null) {
        socket.close(CLOSE_CODE_UNAUTHORIZED, 'Nicht angemeldet.');

        return;
      }

      const detach = options.hub.attach(userId, socket);

      socket.on('close', () => {
        detach();
      });

      socket.on('message', (data: unknown) => {
        const parsed = notificationClientFrameSchema.safeParse(parseFrame(String(data)));

        if (!parsed.success) {
          // Unverständliche Frames werden verworfen, nicht beantwortet – ein
          // Fehler-Frame gäbe nur Auskunft über das erwartete Format.
          return;
        }

        if (parsed.data.kind === 'ping') {
          socket.send(JSON.stringify({ kind: 'pong', sentAt: new Date().toISOString() }));

          return;
        }

        if (parsed.data.kind === 'unsubscribe') {
          detach();

          return;
        }

        void options.notifications.countUnread(userId).then((unreadCount) => {
          socket.send(
            JSON.stringify({
              kind: 'subscribed',
              data: { unreadCount },
              sentAt: new Date().toISOString(),
            }),
          );
        });
      });
    },
  );
}

/** Nicht-JSON kommt als `null` zurück und fällt damit durch die Schema-Prüfung. */
function parseFrame(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
