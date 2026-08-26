/**
 * WebSocket-Übertragung des Agents (Pflichtenheft §2.2).
 *
 * Der Agent baut die Verbindung **ausgehend** durch den WireGuard-Tunnel auf
 * und öffnet niemals selbst einen Listener (Pflichtenheft §1, §18).
 *
 * **Warum `ws` und nicht das eingebaute `WebSocket` aus Node 22:** Die globale
 * Implementierung erlaubt keine eigenen Header beim Handshake. Das
 * Pre-Shared-Token muss aber genau dort mitgehen (`Authorization: Bearer …`),
 * damit es nicht in Nachrichten-Logs landet und die Verbindung bereits vor dem
 * ersten Frame abgewiesen werden kann. `ws` ist die etablierte Node-Bibliothek
 * dafür und ohne Alternative im Ökosystem.
 *
 * **Heartbeat:** Ein durch NAT oder Router still gestorbener Tunnel liefert
 * kein `close` – der Socket bliebe scheinbar offen und der Reconnect würde nie
 * anlaufen. Deshalb schickt der Agent regelmäßig ein WebSocket-Ping und
 * verwirft die Verbindung, wenn das Pong ausbleibt.
 */

import { WebSocket } from 'ws';
import type { Transport, TransportFactory, TransportHandlers } from './transport.js';

export interface WebSocketTransportOptions {
  /** WebSocket-Endpunkt des Backends aus `AGENT_BACKEND_WS_URL`. */
  readonly url: string;
  /** Pre-Shared-Token aus `AGENT_TOKEN`. */
  readonly token: string;
  /** Abstand zwischen zwei Pings. */
  readonly heartbeatIntervalMs?: number;
  /** Frist für das Pong, bevor die Verbindung als tot gilt. */
  readonly heartbeatTimeoutMs?: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Eigener Close-Code für „Authentifizierung abgelehnt" aus dem für
 * Anwendungen reservierten Bereich (4000–4999).
 */
export const CLOSE_CODE_UNAUTHORIZED = 4401;

/**
 * Baut eine Transport-Factory für den echten WebSocket.
 *
 * Das Token wird hier verlangt und nicht optional behandelt: Ohne Token gibt es
 * keine Verbindung – auch nicht für lokale Tests (CLAUDE.md §2). Tests nutzen
 * statt dessen ein Testdouble für {@link TransportFactory}.
 */
export function createWebSocketTransportFactory(
  options: WebSocketTransportOptions,
): TransportFactory {
  if (options.token.trim().length === 0) {
    throw new Error(
      'AGENT_TOKEN ist leer – der Agent verbindet sich nicht ohne Pre-Shared-Token (Pflichtenheft §2.2).',
    );
  }

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;

  return (handlers: TransportHandlers): Transport => {
    const socket = new WebSocket(options.url, {
      headers: { Authorization: `Bearer ${options.token}` },
    });

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimer: ReturnType<typeof setTimeout> | null = null;
    let unauthorized = false;
    let closeReported = false;

    const stopHeartbeat = (): void => {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (pongTimer !== null) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    };

    const startHeartbeat = (): void => {
      heartbeatTimer = setInterval(() => {
        if (pongTimer !== null) {
          // Auf das vorige Ping kam noch keine Antwort – nicht nachlegen.
          return;
        }
        pongTimer = setTimeout(() => {
          pongTimer = null;
          socket.terminate();
        }, heartbeatTimeoutMs);

        socket.ping();
      }, heartbeatIntervalMs);
    };

    socket.on('open', () => {
      startHeartbeat();
      handlers.onOpen();
    });

    socket.on('pong', () => {
      if (pongTimer !== null) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    });

    socket.on('message', (data) => {
      handlers.onMessage(data.toString());
    });

    // Fehlgeschlagener HTTP-Upgrade: Nur hier ist der Status sichtbar, im
    // 'close'-Ereignis nicht mehr.
    socket.on('unexpected-response', (_request, response) => {
      unauthorized = response.statusCode === 401 || response.statusCode === 403;
      handlers.onError(
        new Error(`Backend hat den Handshake abgelehnt (HTTP ${response.statusCode ?? 0}).`),
      );
      response.resume();
      socket.terminate();
    });

    socket.on('error', (error: Error) => {
      handlers.onError(error);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      stopHeartbeat();
      if (closeReported) {
        return;
      }
      closeReported = true;
      handlers.onClose({
        code,
        reason: reason.toString(),
        unauthorized: unauthorized || code === CLOSE_CODE_UNAUTHORIZED,
      });
    });

    return {
      send(raw: string): void {
        if (socket.readyState !== WebSocket.OPEN) {
          handlers.onError(new Error('Senden nicht möglich – Verbindung ist nicht offen.'));
          return;
        }
        socket.send(raw, (error) => {
          if (error) {
            handlers.onError(error);
          }
        });
      },
      close(code?: number, reason?: string): void {
        stopHeartbeat();
        if (socket.readyState === WebSocket.CONNECTING) {
          // Ein noch nicht offener Socket lässt sich nicht sauber schließen.
          socket.terminate();
          return;
        }
        socket.close(code, reason);
      },
    };
  };
}
