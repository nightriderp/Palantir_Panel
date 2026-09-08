/**
 * Server-seitiges Lebenszeichen der Live-Kanäle (Audit W2-3, Fundpunkt 142).
 *
 * Der Zyklus lag bis Fundpunkt 142 nur im Chat-Modul; der Inbox-Kanal hatte
 * keinen. Seit er hier steht, prüfen ihn diese Tests einmal für beide Kanäle –
 * `chat/live.test.ts` prüft zusätzlich, dass der Chat-Name weiter darauf zeigt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WS_HEARTBEAT_INTERVAL_MS,
  type WebSocketHeartbeatSocket,
  startWebSocketHeartbeat,
} from './ws-heartbeat.js';

interface FakeHeartbeatSocket extends WebSocketHeartbeatSocket {
  readonly pings: number[];
  readonly terminations: number[];
  pong(): void;
}

function fakeHeartbeatSocket(): FakeHeartbeatSocket {
  const pings: number[] = [];
  const terminations: number[] = [];
  const listeners: (() => void)[] = [];

  return {
    pings,
    terminations,
    ping: () => pings.push(pings.length + 1),
    terminate: () => terminations.push(terminations.length + 1),
    on: (_event, listener) => listeners.push(listener),
    pong: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe('startWebSocketHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reißt eine Verbindung ab, die auf den Ping nicht antwortet', () => {
    const socket = fakeHeartbeatSocket();

    startWebSocketHeartbeat(socket, { intervalMs: 1_000 });

    vi.advanceTimersByTime(1_000);

    expect(socket.pings).toHaveLength(1);
    expect(socket.terminations).toHaveLength(0);

    // Zweiter Takt ohne Pong dazwischen: Die Gegenstelle ist weg.
    vi.advanceTimersByTime(1_000);

    expect(socket.terminations).toHaveLength(1);
  });

  it('lässt eine antwortende Verbindung offen', () => {
    const socket = fakeHeartbeatSocket();

    startWebSocketHeartbeat(socket, { intervalMs: 1_000 });

    for (let takt = 0; takt < 5; takt += 1) {
      vi.advanceTimersByTime(1_000);
      socket.pong();
    }

    expect(socket.terminations).toHaveLength(0);
    expect(socket.pings).toHaveLength(5);
  });

  it('hört auf zu pingen, sobald die Verbindung abgemeldet ist', () => {
    const socket = fakeHeartbeatSocket();

    const stop = startWebSocketHeartbeat(socket, { intervalMs: 1_000 });

    stop();
    vi.advanceTimersByTime(10_000);

    expect(socket.pings).toHaveLength(0);
    expect(socket.terminations).toHaveLength(0);
  });

  it('pingt ohne Angabe im vereinbarten Takt', () => {
    const socket = fakeHeartbeatSocket();

    startWebSocketHeartbeat(socket);

    vi.advanceTimersByTime(WS_HEARTBEAT_INTERVAL_MS - 1);

    expect(socket.pings).toHaveLength(0);

    vi.advanceTimersByTime(1);

    expect(socket.pings).toHaveLength(1);
  });

  /** Nach dem Abriss läuft kein Zeitgeber weiter. */
  it('hört nach dem Abriss von selbst auf', () => {
    const socket = fakeHeartbeatSocket();

    startWebSocketHeartbeat(socket, { intervalMs: 1_000 });

    vi.advanceTimersByTime(10_000);

    expect(socket.terminations).toHaveLength(1);
    expect(socket.pings).toHaveLength(1);
  });
});
