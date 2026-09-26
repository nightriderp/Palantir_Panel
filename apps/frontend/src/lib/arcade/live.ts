'use client';

import { type ArcadeLiveEventFrame, type ArcadeRoomUpdatedPayload } from '@palantir/contracts';
import { useEffect, useEffectEvent, useState } from 'react';
import { API_BASE_URL } from '@/lib/api/client';
import { reconnectDelayMs } from '@/lib/live/backoff';
import { type LiveConnectionState } from '@/lib/live/LiveChannelProvider';

/**
 * Live-Kanal der Spielhalle (`/arcade/live`).
 *
 * Eine eigene Verbindung neben Server-, Inbox- und Chat-Kanal – aber nur,
 * solange ein Raum offen ist: Der Kanal meldet bloß „Raum X hat jetzt Fassung
 * N", den Inhalt holt die Ansicht per REST. So bleibt verdeckte Information
 * (Handkarten, Codenames-Schlüssel) aus dem Rundruf heraus; jeder Browser
 * bekommt seine Sicht nur über die Route, die sein Konto prüft.
 */

/** Wie bei Chat- und Inbox-Kanal: „nicht angemeldet" – kein neuer Versuch. */
export const ARCADE_LIVE_CLOSE_UNAUTHORIZED = 4401;

export const ARCADE_LIVE_PING_MS = 30_000;

const ARCADE_LIVE_PATH = '/arcade/live';

/**
 * Adresse des Kanals. `configured` ist `NEXT_PUBLIC_LIVE_WS_URL` (Server-Kanal
 * `…/live`); die Spielhalle liegt daneben, nicht darunter – dieselbe Ableitung
 * wie beim Chat-Kanal.
 */
export function arcadeChannelUrl(configured: string | undefined, apiBaseUrl: string): string {
  if (configured) {
    const ohne = configured.replace(/\/+$/, '');
    if (ohne.endsWith(ARCADE_LIVE_PATH)) return ohne;
    return `${ohne.replace(/\/live$/, '')}${ARCADE_LIVE_PATH}`;
  }
  return `${apiBaseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}${ARCADE_LIVE_PATH}`;
}

/** Ereignis-Frame lesen; alles andere (auch `pong`) ergibt `null`. */
export function parseArcadeFrame(raw: string): ArcadeLiveEventFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const frame = parsed as { kind?: unknown; event?: unknown; data?: unknown };
  if (frame.kind !== 'event' || frame.event !== 'arcadeRoom.updated') return null;
  const data = frame.data as Partial<ArcadeRoomUpdatedPayload> | null;
  if (typeof data !== 'object' || data === null) return null;
  if (typeof data.roomId !== 'string' || typeof data.version !== 'number') return null;
  return parsed as ArcadeLiveEventFrame;
}

/**
 * Verbindung zum Spielhallen-Kanal mit Wiederverbinden (Backoff wie
 * `lib/live/*`). `enabled = false` baut keine Verbindung auf.
 */
export function useArcadeLive(
  onEvent: (data: ArcadeRoomUpdatedPayload) => void,
  enabled = true,
): { connection: LiveConnectionState } {
  const [connection, setConnection] = useState<LiveConnectionState>('connecting');
  const eingetroffen = useEffectEvent(onEvent);

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const stopPing = () => {
      if (ping !== null) clearInterval(ping);
      ping = null;
    };

    const scheduleRetry = () => {
      if (stopped) return;
      const delay = reconnectDelayMs(attempt, Math.random());
      attempt += 1;
      retry = setTimeout(connect, delay);
    };

    function connect() {
      setConnection('connecting');
      let next: WebSocket;
      try {
        next = new WebSocket(arcadeChannelUrl(process.env.NEXT_PUBLIC_LIVE_WS_URL, API_BASE_URL));
      } catch {
        scheduleRetry();
        return;
      }
      socket = next;
      next.onopen = () => {
        attempt = 0;
        setConnection('open');
        ping = setInterval(() => {
          if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ kind: 'ping' }));
        }, ARCADE_LIVE_PING_MS);
      };
      next.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const frame = parseArcadeFrame(event.data);
        if (frame) eingetroffen(frame.data);
      };
      next.onclose = (event) => {
        socket = null;
        stopPing();
        setConnection('closed');
        if (event.code === ARCADE_LIVE_CLOSE_UNAUTHORIZED) return;
        scheduleRetry();
      };
      next.onerror = () => next.close();
    }

    connect();
    return () => {
      stopped = true;
      if (retry !== null) clearTimeout(retry);
      stopPing();
      socket?.close();
      socket = null;
    };
  }, [enabled]);

  return { connection };
}
