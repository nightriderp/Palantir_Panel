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
import {
  NOTIFICATION_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS,
  NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED,
  type NotificationServerFrame,
} from '@palantir/contracts';
import { notificationClientFrameSchema } from '@palantir/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fireAndForget } from '../../lib/fire-and-forget.js';
import { startWebSocketHeartbeat } from '../../lib/ws-heartbeat.js';
import { createWebSocketOriginGuard } from '../../lib/ws-origin.js';
import type { Clock, LiveNotificationPayload, LiveNotificationPublisher } from './ports.js';
import { systemClock } from './ports.js';
import type { NotificationService } from './service.js';

/**
 * Close-Code für eine Verbindung ohne gültige Sitzung.
 *
 * Quelle ist jetzt die geteilte Konstante aus `@palantir/contracts`
 * ({@link NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED}), damit Backend und Frontend
 * dieselbe Zahl nutzen. Der bisherige Name bleibt als Re-Export erhalten, damit
 * Aufrufer (`index.ts`, Tests) unverändert weiterlaufen.
 */
export const CLOSE_CODE_UNAUTHORIZED = NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED;

/**
 * Close-Code „zu viele gleichzeitige Verbindungen dieses Kontos" (Fundpunkt
 * 142, Audit W2-3).
 *
 * Bewusst **keine zweite Zahl**: Es ist dieselbe 4029 wie am Chat-Kanal, und
 * das Frontend soll sie an beiden Kanälen gleich lesen (neu verbinden, nur
 * nicht sofort und nicht hundertfach). Der Name gehört aber dem Kanal: Bis
 * Fundpunkt 157 stand hier die Chat-Konstante, was den Inbox-Kanal der
 * Entscheidung eines fremden Kanals unterworfen hätte. Jetzt kommt der Wert aus
 * `NOTIFICATION_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS`, wie schon bei
 * {@link CLOSE_CODE_UNAUTHORIZED}.
 */
export const CLOSE_CODE_TOO_MANY_CONNECTIONS = NOTIFICATION_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS;

/**
 * Wie viele gleichzeitige Live-Verbindungen ein Konto am Inbox-Kanal haben darf
 * (Fundpunkt 142).
 *
 * Dieselbe Zahl und dieselbe Begründung wie am Chat-Kanal
 * (`CHAT_LIVE_MAX_CONNECTIONS_PER_USER`): Zehn decken den realistischen Fall ab
 * (mehrere Geräte, mehrere Tabs, ein Reload, dessen alte Verbindung noch nicht
 * abgeräumt ist) und begrenzen trotzdem den Hebel – jede Meldung wird je
 * Verbindung einmal gesendet.
 *
 * Bewusst eine Konstante und keine Umgebungsvariable: Es gibt keinen
 * Betriebsfall, in dem hier eine andere Zahl gebraucht würde (CLAUDE.md §8).
 */
export const NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER = 10;

/** Der Ausschnitt einer WebSocket-Verbindung, den der Hub braucht. */
export interface LiveSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface NotificationHub extends LiveNotificationPublisher {
  /** Meldet eine Verbindung an; die Rückgabe meldet sie wieder ab. */
  attach(userId: string, socket: LiveSocket): () => void;
  /**
   * Schließt **alle** Verbindungen eines Kontos und meldet sie ab; liefert
   * zurück, wie viele es waren.
   *
   * Anschluss für Sperre und Sitzungswiderruf (Audit W2-2,
   * `backend-community-visibility-03`): Die Sitzung wird sonst nur im Handshake
   * geprüft, ein offener Kanal überlebte beides. Wer das auslöst, entscheidet
   * `server.ts`; der Verteiler kennt weder Sitzungen noch Sperren.
   */
  closeAll(userId: string, code: number, reason?: string): number;
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

  /**
   * Schließt die ältesten Verbindungen eines Kontos, bis die Obergrenze wieder
   * eingehalten ist (Fundpunkt 142, Audit W2-3).
   *
   * Ein `Set` behält die Einfügereihenfolge; der erste Eintrag ist damit die
   * älteste Verbindung. Sie wird zuerst abgemeldet und dann geschlossen – ihr
   * `close`-Ereignis meldet dieselbe Verbindung gleich noch einmal ab, was
   * idempotent ist, aber eine Zustellung dazwischen darf es nicht mehr geben.
   *
   * Bewusst die ältesten und nicht die neue: Eine halboffene Verbindung
   * (Mobilfunk, Proxy-Timeout ohne FIN) bleibt bis zum TCP-Timeout im Verteiler
   * stehen; würde die neue abgewiesen, sperrte sich ein Nutzer mit wackliger
   * Leitung selbst aus. Konten anderer Nutzer sind nie betroffen – gezählt wird
   * je Konto.
   */
  function trimOldest(userId: string): void {
    const sockets = connections.get(userId);

    if (!sockets) {
      return;
    }

    while (sockets.size > NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER) {
      const aeltester = sockets.values().next().value;

      if (aeltester === undefined) {
        return;
      }

      sockets.delete(aeltester);

      try {
        aeltester.close(
          CLOSE_CODE_TOO_MANY_CONNECTIONS,
          'Zu viele gleichzeitige Verbindungen dieses Kontos.',
        );
      } catch {
        // Verbindung ist bereits weg; mehr als schließen war nicht zu tun.
      }
    }
  }

  return {
    attach(userId, socket) {
      const existing = connections.get(userId) ?? new Set<LiveSocket>();

      existing.add(socket);
      connections.set(userId, existing);
      trimOldest(userId);

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

    closeAll(userId, code, reason = 'Sitzung beendet.') {
      const sockets = connections.get(userId);

      if (!sockets || sockets.size === 0) {
        return 0;
      }

      const open = [...sockets];

      // Erst abmelden, dann schließen: Das `close`-Ereignis meldet dieselbe
      // Verbindung gleich noch einmal ab – das ist idempotent, eine Zustellung
      // dazwischen darf es aber nicht mehr geben.
      connections.delete(userId);

      for (const socket of open) {
        try {
          socket.close(code, reason);
        } catch {
          // Verbindung ist bereits weg; mehr als schließen war nicht zu tun.
        }
      }

      return open.length;
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
  /**
   * Panel-Adresse (`PUBLIC_WEB_URL`) für die Herkunftsprüfung des
   * WebSocket-Handshakes (Audit W2-5, `security-matrix-04`).
   *
   * Ohne Angabe bleibt die Prüfung aus – so laufen Tests und
   * Entwicklungsaufbauten ohne konfigurierte Adresse weiter.
   */
  readonly allowedOrigin?: string;
  /**
   * Abstand zweier Server-Pings; Vorgabe `WS_HEARTBEAT_INTERVAL_MS` aus
   * `lib/ws-heartbeat.ts` (Fundpunkt 142).
   *
   * Der Betrieb setzt das nicht – die 30 s sind für jeden Aufbau richtig. Der
   * Parameter besteht, damit ein Test den Takt beobachten kann, ohne eine halbe
   * Minute zu warten; dieselbe Rolle wie `sessionCheckIntervalMs` am
   * Chat-Kanal.
   */
  readonly heartbeatIntervalMs?: number;
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
    {
      websocket: true,
      // Cross-Site-WebSocket-Hijacking: Handshakes unterliegen nicht CORS
      // (Audit W2-5, `security-matrix-04`). Abgelehnt wird vor dem Upgrade.
      onRequest: createWebSocketOriginGuard(options.allowedOrigin),
    },
    async (socket: WebSocket, request: FastifyRequest): Promise<void> => {
      const userId = options.resolveUserId(request);

      if (userId === null) {
        socket.close(CLOSE_CODE_UNAUTHORIZED, 'Nicht angemeldet.');

        return;
      }

      let detach = options.hub.attach(userId, socket);
      let angemeldet = true;

      /*
       * Server-seitiges Lebenszeichen (Fundpunkt 142, Audit W2-3): Eine
       * halboffene Verbindung meldet weder `close` noch `error` und bliebe
       * sonst bis zum TCP-Timeout im Verteiler – samt ihrer Kopie jeder
       * Meldung. Derselbe Zyklus wie am Chat-Kanal (`lib/ws-heartbeat.ts`).
       */
      const stopHeartbeat = startWebSocketHeartbeat(
        socket,
        options.heartbeatIntervalMs === undefined
          ? {}
          : { intervalMs: options.heartbeatIntervalMs },
      );

      const cleanup = (): void => {
        stopHeartbeat();
        detach();
        angemeldet = false;
      };

      socket.on('close', cleanup);
      // Wie am Chat-Kanal: `error` und `close` können nacheinander kommen, die
      // Abmeldung ist idempotent – aber ohne `error`-Zweig bliebe ein Zeitgeber
      // stehen, wenn nur dieses Ereignis feuert.
      socket.on('error', cleanup);

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
          angemeldet = false;

          return;
        }

        /*
         * `subscribe` nach einem `unsubscribe` meldet die Verbindung wirklich
         * wieder an (Audit W3-4, `backend-community-08`).
         *
         * Vorher bestätigte der Zweig unten nur mit `subscribed` samt Zähler,
         * ohne je wieder `attach` zu rufen: Der Client hielt sich für
         * angemeldet, bekam aber bis zum Neuaufbau der Verbindung kein
         * `notification.created` mehr. Der Wächter hält das idempotent – ein
         * zweites `subscribe` ohne zwischenzeitliches `unsubscribe` lässt die
         * bestehende Abmeldefunktion stehen, statt sie zu ersetzen.
         */
        if (!angemeldet) {
          detach = options.hub.attach(userId, socket);
          angemeldet = true;
        }

        // Ohne Fänger würde eine kurz nicht erreichbare Datenbank hier das
        // ganze Backend beenden (Audit W0-5, backend-community-02). Der Client
        // bekommt dann kein `subscribed`; sein Abo steht trotzdem.
        fireAndForget(
          options.notifications.countUnread(userId).then((unreadCount) => {
            socket.send(
              JSON.stringify({
                kind: 'subscribed',
                data: { unreadCount },
                sentAt: new Date().toISOString(),
              }),
            );
          }),
          app.log,
          { vorgang: 'Ungelesene Meldungen beim Abonnieren zählen', userId },
        );
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
