'use client';

import { type ChatServerEventFrame } from '@palantir/contracts';
import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api/client';
import { reconnectDelayMs } from './backoff';
import { type LiveConnectionState } from './LiveChannelProvider';
import {
  CLOSE_CODE_UNAUTHORIZED,
  PING_INTERVAL_MS,
  chatChannelUrl,
  parseChatFrame,
} from './chatChannel';

/**
 * Live-Zugang zum Chat (Pflichtenheft §5.3, Arbeitspaket B7).
 *
 * Eine **eigene** Verbindung neben dem Server-Kanal (F3) und dem Inbox-Kanal
 * (F6): Der Chat hängt am angemeldeten Konto und liefert die Ereignisse aller
 * Konversationen, an denen es teilnimmt – ohne `subscribe` je Konversation, weil
 * eine gerade erst entstandene DM sich nicht abonnieren ließe, bevor man von ihr
 * weiß (Begründung in `chat.ts` in `@palantir/contracts`).
 *
 * Kein Polling: Neue Nachrichten kommen ausschließlich über diesen Kanal herein.
 * Wer nicht angemeldet ist, wird mit {@link CLOSE_CODE_UNAUTHORIZED} abgewiesen –
 * dann wird nicht erneut verbunden.
 */

export interface ChatLiveData {
  connection: LiveConnectionState;
  /** Die Verbindung wurde als „nicht angemeldet" abgewiesen. */
  unauthorized: boolean;
}

export function useChatLive(onFrame: (frame: ChatServerEventFrame) => void): ChatLiveData {
  const [connection, setConnection] = useState<LiveConnectionState>('connecting');
  const [unauthorized, setUnauthorized] = useState(false);

  // Der Rückruf wird bei jedem Rendern neu erzeugt; die Verbindung soll deshalb
  // nicht neu aufgebaut werden. Er liegt in einer Ref und sieht so stets den
  // aktuellen Stand der Ansicht.
  const callbackRef = useRef(onFrame);
  callbackRef.current = onFrame;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let closedByUs = false;
    let stopped = false;

    function stopPing() {
      if (pingTimer !== null) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    }

    function scheduleRetry() {
      if (closedByUs || stopped) return;
      const delay = reconnectDelayMs(attempt, Math.random());
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    }

    function connect() {
      setConnection('connecting');

      let next: WebSocket;
      try {
        next = new WebSocket(chatChannelUrl(process.env.NEXT_PUBLIC_LIVE_WS_URL, API_BASE_URL));
      } catch {
        scheduleRetry();
        return;
      }
      socket = next;

      next.onopen = () => {
        attempt = 0;
        setConnection('open');
        setUnauthorized(false);
        // Lebenszeichen, damit Reverse Proxies die stille Verbindung nicht
        // schließen. Das Backend liest den Kanal nur passiv – der Ping bleibt
        // ohne Antwort und ist allein für die Zwischenstationen gedacht.
        pingTimer = setInterval(() => {
          if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ kind: 'ping' }));
        }, PING_INTERVAL_MS);
      };

      next.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const frame = parseChatFrame(event.data);
        if (frame) callbackRef.current(frame);
      };

      next.onclose = (event) => {
        socket = null;
        stopPing();
        setConnection('closed');

        if (event.code === CLOSE_CODE_UNAUTHORIZED) {
          // Ein erneuter Versuch würde ohne Sitzung genauso enden.
          setUnauthorized(true);
          return;
        }
        if (!closedByUs) scheduleRetry();
      };

      next.onerror = () => {
        // Der Fehler zieht immer ein `close` nach sich; dort wird neu versucht.
        next.close();
      };
    }

    connect();

    return () => {
      stopped = true;
      closedByUs = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      stopPing();
      socket?.close();
      socket = null;
    };
  }, []);

  return { connection, unauthorized };
}
