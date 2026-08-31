'use client';

import { type NotificationDto } from '@palantir/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
 * Bewusst eine **eigene** Verbindung neben {@link LiveChannelProvider}: Der
 * Kanal aus F3 abonniert einzelne Server (`{ resource: 'server', id }`), die
 * Inbox hängt dagegen am angemeldeten Konto. Genau so ist es im Backend
 * getrennt (`/live/notifications`, eigener Endpunkt in B6) und in
 * `notifications.ts` in `@palantir/contracts` begründet.
 *
 * Genau **eine** Verbindung für den ganzen eingeloggten Bereich: Glocke in der
 * Kopfleiste und Posteingang hören beide hier mit. Vorher hielt der Posteingang
 * seine eigene Verbindung; mit der Glocke wären es auf `/notifications` zwei
 * gewesen, die dieselben Meldungen doppelt übertragen.
 *
 * Kein Polling: Neue Meldungen kommen ausschließlich über diesen Kanal herein.
 * Wer nicht angemeldet ist, wird vom Backend mit {@link CLOSE_CODE_UNAUTHORIZED}
 * abgewiesen – dann wird nicht erneut verbunden, weil ein Wiederanlauf daran
 * nichts ändern würde.
 */

type NotificationListener = (notification: NotificationDto, unreadCount: number) => void;

export interface NotificationLiveApi {
  connection: LiveConnectionState;
  /** Ungelesene laut Backend; `null`, solange der Kanal noch nichts gemeldet hat. */
  unreadCount: number | null;
  /** Die Verbindung wurde als „nicht angemeldet" abgewiesen. */
  unauthorized: boolean;
  /** Hört auf neue Meldungen; liefert die Abmeldefunktion zurück. */
  subscribe: (listener: NotificationListener) => () => void;
  /**
   * Zähler nach lokalem Lesen anpassen.
   *
   * Das Backend meldet über den Kanal nur **neue** Meldungen. Wird etwas
   * gelesen, bliebe der Punkt an der Glocke sonst stehen, bis die nächste
   * Meldung eintrifft.
   */
  setUnreadCount: (count: number) => void;
}

const NotificationLiveContext = createContext<NotificationLiveApi | null>(null);

export function NotificationLiveProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<LiveConnectionState>('connecting');
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const listeners = useRef(new Set<NotificationListener>());

  const subscribe = useCallback((listener: NotificationListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

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
          for (const listener of listeners.current) {
            listener(frame.data.notification, frame.data.unreadCount);
          }
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

  const value = useMemo<NotificationLiveApi>(
    () => ({ connection, unreadCount, unauthorized, subscribe, setUnreadCount }),
    [connection, unreadCount, unauthorized, subscribe],
  );

  return (
    <NotificationLiveContext.Provider value={value}>{children}</NotificationLiveContext.Provider>
  );
}

/**
 * Zugang zum Inbox-Kanal.
 *
 * Außerhalb des Providers gibt es keine Verbindung – dann bleibt der Zähler
 * `null` und `subscribe` tut nichts. So bleibt eine Ansicht auch außerhalb des
 * eingeloggten Rahmens darstellbar (Tests, Storybook), statt zu scheitern.
 */
export function useNotificationLive(): NotificationLiveApi {
  return useContext(NotificationLiveContext) ?? OHNE_KANAL;
}

const OHNE_KANAL: NotificationLiveApi = {
  connection: 'closed',
  unreadCount: null,
  unauthorized: false,
  subscribe: () => () => {},
  setUnreadCount: () => {},
};
