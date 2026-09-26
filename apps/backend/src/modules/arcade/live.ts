/**
 * Live-Kanal der Spielhalle (`GET /arcade/live`, Neubau 26.09.2026).
 *
 * Aufbau wie der Chat-Kanal (`chat/live.ts`, `chat/routes.ts`): Eine
 * Verbindung gehört genau einem angemeldeten, freigeschalteten Konto;
 * adressiert wird je Konto, nicht je Raum. Der Kanal trägt nur die Meldung
 * „im Raum hat sich etwas getan" (`arcadeRoom.updated` mit Version und
 * Status) – den Raum selbst lädt der Browser danach über REST, und dort gilt
 * die Sichtbarkeitsregel des Dienstes. So kann über den Kanal keine verdeckte
 * Information (Handkarten) an den falschen Sitz gelangen.
 *
 * Nebenbei beantwortet der Verteiler, wer gerade im Raum ist (`isOnline`,
 * Sitz-DTO `online`).
 */

import { type WebSocket } from '@fastify/websocket';
import {
  ARCADE_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS,
  ARCADE_LIVE_CLOSE_CODE_UNAUTHORIZED,
  type ArcadeLiveServerFrame,
  type ArcadeRoomUpdatedPayload,
} from '@palantir/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { startWebSocketHeartbeat } from '../../lib/ws-heartbeat.js';
import { createWebSocketOriginGuard } from '../../lib/ws-origin.js';

/** Gleichzeitige Verbindungen je Konto – dieselbe Überlegung wie am Chat-Kanal. */
export const ARCADE_LIVE_MAX_CONNECTIONS_PER_USER = 10;

const SESSION_CHECK_INTERVAL_MS = 60_000;

export interface ArcadeLiveSocket {
  send(data: string): void;
  close(code: number, reason?: string): void;
}

/** Zustellung an ein Konto und Auskunft, ob es verbunden ist. */
export interface ArcadeLiveDelivery {
  deliver(userId: string, frame: ArcadeLiveServerFrame): void;
  isOnline(userId: string): boolean;
}

export const noopArcadeLiveDelivery: ArcadeLiveDelivery = {
  deliver() {
    // absichtlich leer
  },
  isOnline() {
    return false;
  },
};

export class ArcadeLiveHub implements ArcadeLiveDelivery {
  readonly #sockets = new Map<string, Set<ArcadeLiveSocket>>();

  /** Meldet eine Verbindung an; die Abmeldung ist idempotent. */
  register(userId: string, socket: ArcadeLiveSocket): () => void {
    const existing = this.#sockets.get(userId) ?? new Set<ArcadeLiveSocket>();

    existing.add(socket);
    this.#sockets.set(userId, existing);

    // Über der Grenze fällt die älteste Verbindung weg, nicht die neue (siehe Chat).
    while (existing.size > ARCADE_LIVE_MAX_CONNECTIONS_PER_USER) {
      const aeltester = existing.values().next().value;

      if (aeltester === undefined) break;
      existing.delete(aeltester);

      try {
        aeltester.close(
          ARCADE_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS,
          'Zu viele gleichzeitige Verbindungen dieses Kontos.',
        );
      } catch {
        // Verbindung ist bereits weg.
      }
    }

    return (): void => {
      const sockets = this.#sockets.get(userId);

      if (!sockets) return;
      sockets.delete(socket);
      if (sockets.size === 0) this.#sockets.delete(userId);
    };
  }

  deliver(userId: string, frame: ArcadeLiveServerFrame): void {
    const sockets = this.#sockets.get(userId);

    if (!sockets || sockets.size === 0) return;

    const payload = JSON.stringify(frame);

    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        // Verbindung ist bereits weg; das `close`-Ereignis meldet sie ab.
      }
    }
  }

  isOnline(userId: string): boolean {
    return (this.#sockets.get(userId)?.size ?? 0) > 0;
  }

  /** Schließt alle Verbindungen eines Kontos (Sperre, Sitzungswiderruf). */
  closeAll(userId: string, code: number, reason = 'Sitzung beendet.'): number {
    const sockets = this.#sockets.get(userId);

    if (!sockets || sockets.size === 0) return 0;

    const open = [...sockets];
    this.#sockets.delete(userId);

    for (const socket of open) {
      try {
        socket.close(code, reason);
      } catch {
        // Verbindung ist bereits weg.
      }
    }

    return open.length;
  }

  connectionCount(userId: string): number {
    return this.#sockets.get(userId)?.size ?? 0;
  }
}

export function roomUpdatedFrame(
  data: ArcadeRoomUpdatedPayload,
  sentAt: Date,
): ArcadeLiveServerFrame {
  return { kind: 'event', event: 'arcadeRoom.updated', data, sentAt: sentAt.toISOString() };
}

export interface ArcadeLiveRouteOptions {
  readonly hub: ArcadeLiveHub;
  resolveUserId(request: FastifyRequest): string | null;
  /** Freischaltung – wie am Inbox-Kanal; im Zweifel zu. */
  isApproved(request: FastifyRequest): boolean;
  /** Wiederkehrende Sitzungsprüfung (Audit W2-2); ohne Angabe nur im Handshake. */
  isSessionValid?(request: FastifyRequest): Promise<boolean>;
  readonly sessionCheckIntervalMs?: number;
  /** Panel-Adresse für die Herkunftsprüfung (Audit W2-5, `security-matrix-04`). */
  readonly allowedOrigin?: string;
}

/** Nicht-JSON kommt als `null` zurück. */
function parseFrame(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function registerArcadeLiveRoute(
  app: FastifyInstance,
  options: ArcadeLiveRouteOptions,
): void {
  app.get(
    '/arcade/live',
    {
      websocket: true,
      // Cross-Site-WebSocket-Hijacking: vor dem Upgrade abweisen.
      onRequest: createWebSocketOriginGuard(options.allowedOrigin),
    },
    (socket: WebSocket, request: FastifyRequest) => {
      const userId = options.resolveUserId(request);

      if (userId === null) {
        socket.close(ARCADE_LIVE_CLOSE_CODE_UNAUTHORIZED, 'Nicht angemeldet.');

        return;
      }

      if (!options.isApproved(request)) {
        socket.close(ARCADE_LIVE_CLOSE_CODE_UNAUTHORIZED, 'Konto ist noch nicht freigeschaltet.');

        return;
      }

      const unregister = options.hub.register(userId, {
        send: (data: string) => {
          socket.send(data);
        },
        close: (code: number, reason?: string) => {
          socket.close(code, reason);
        },
      });

      const check = options.isSessionValid;
      const timer =
        check === undefined
          ? null
          : setInterval(() => {
              void (async (): Promise<void> => {
                let valid = true;

                try {
                  valid = await check(request);
                } catch {
                  // Infrastrukturfehler lassen den Kanal offen.
                  return;
                }

                if (!valid) {
                  socket.close(ARCADE_LIVE_CLOSE_CODE_UNAUTHORIZED, 'Sitzung nicht mehr gültig.');
                }
              })();
            }, options.sessionCheckIntervalMs ?? SESSION_CHECK_INTERVAL_MS);

      timer?.unref();

      const stopHeartbeat = startWebSocketHeartbeat(socket);

      const cleanup = (): void => {
        if (timer) clearInterval(timer);
        stopHeartbeat();
        unregister();
      };

      socket.on('close', cleanup);
      socket.on('error', cleanup);

      socket.on('message', (data: unknown) => {
        const frame = parseFrame(String(data));

        // Einziger verstandener Frame: `ping`. Alles andere wird verworfen.
        if (
          typeof frame === 'object' &&
          frame !== null &&
          (frame as { kind?: unknown }).kind === 'ping'
        ) {
          const pong: ArcadeLiveServerFrame = { kind: 'pong' };

          socket.send(JSON.stringify(pong));
        }
      });
    },
  );
}
