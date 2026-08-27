'use client';

import { type NotificationDto } from '@palantir/contracts';
import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api/client';
import { reconnectDelayMs } from './backoff';
import { type LiveConnectionState } from './LiveChannelProvider';
import {
  CLOSE_CODE_UNAUTHORIZED,
  PING_INTERVAL_MS,
  notificationChannelUrl,
  parseNotificationFrame,
} from './notificationChannel';

/**
 * Live-Zugang zur eigenen Inbox (Pflichtenheft §5.3).
 *
 * Bewusst eine **eigene** Verbindung neben `LiveChannelProvider`: Der Kanal aus
 * F3 abonniert einzelne Server (`{ resource: 'server', id }`), die Inbox hängt
 * dagegen am angemeldeten Konto. Genau so ist es im Backend getrennt
 * (`/live/notifications`, eigener Endpunkt in B6) und in `notifications.ts` in
 * `@palantir/contracts` begründet.
 *
 * Kein Polling: Neue Meldungen kommen ausschließlich über diesen Kanal herein.
 * Wer nicht angemeldet ist, wird vom Backend mit {@link CLOSE_CODE_UNAUTHORIZED}
 * abgewiesen – dann wird nicht erneut verbunden, weil ein Wiederanlauf daran
 * nichts ändern würde.
 */

export interface NotificationLiveData {
  connection: LiveConnectionState;
  /** Ungelesene laut Backend; `null`, solange der Kanal noch nichts gemeldet hat. */
  unreadCount: number | null;
  /** Die Verbindung wurde als „nicht angemeldet" abgewiesen. */
  unauthorized: boolean;
}

export function useNotificationLive(
  onNotification: (notification: NotificationDto, unreadCount: number) => void,
): NotificationLiveData {
  const [connection, setConnection] = useState<LiveConnectionState>('connecting');
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  // Der Rückruf wird bei jedem Rendern neu erzeugt; die Verbindung soll
  // deswegen nicht neu aufgebaut werden.
  const callbackRef = useRef(onNotification);
  callbackRef.current = onNotification;

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
        next = new WebSocket(
          notificationChannelUrl(process.env.NEXT_PUBLIC_LIVE_WS_URL, API_BASE_URL),
        );
      } catch {
        scheduleRetry();
        return;
      }
      socket = next;

      next.onopen = () => {
        attempt = 0;
        setConnection('open');
        setUnauthorized(false);
        next.send(JSON.stringify({ kind: 'subscribe' }));
        pingTimer = setInterval(() => {
          if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ kind: 'ping' }));
        }, PING_INTERVAL_MS);
      };

      next.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const frame = parseNotificationFrame(event.data);
        if (!frame) return;

        if (frame.kind === 'subscribed') {
          setUnreadCount(frame.data.unreadCount);
          return;
        }

        if (frame.kind === 'event') {
          setUnreadCount(frame.data.unreadCount);
          callbackRef.current(frame.data.notification, frame.data.unreadCount);
        }
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

  return { connection, unreadCount, unauthorized };
}
