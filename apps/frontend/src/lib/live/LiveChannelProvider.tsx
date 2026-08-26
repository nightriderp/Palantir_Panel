'use client';

import {
  type LiveClientFrame,
  type LiveServerEventFrame,
  type LiveTopic,
  isLiveServerEventName,
} from '@palantir/contracts';
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

/**
 * Der Live-Kanal zwischen Browser und Backend (Pflichtenheft §5.3).
 *
 * Genau **eine** WebSocket-Verbindung für den ganzen eingeloggten Bereich.
 * Ansichten abonnieren darüber einzelne Ressourcen und bekommen die Ereignisse
 * als Rückruf. Konsole und Live-Messwerte laufen ausschließlich hierüber – es
 * wird nirgends im Sekundentakt nachgeladen.
 *
 * Bricht die Verbindung ab, versucht der Provider es mit wachsender Wartezeit
 * erneut und meldet alle noch offenen Abos danach automatisch wieder an.
 */

export type LiveConnectionState = 'connecting' | 'open' | 'closed';

type FrameListener = (frame: LiveServerEventFrame) => void;

export interface LiveChannelApi {
  connection: LiveConnectionState;
  /**
   * Abonniert eine Ressource und liefert die Abmeldefunktion zurück.
   *
   * Mehrere Ansichten dürfen dieselbe Ressource abonnieren; abgemeldet wird
   * beim Backend erst, wenn die letzte von ihnen geht.
   */
  subscribe: (topic: LiveTopic, listener: FrameListener) => () => void;
  /** Schickt ein Frame; `false`, wenn die Verbindung gerade nicht offen ist. */
  send: (frame: LiveClientFrame) => boolean;
}

const LiveChannelContext = createContext<LiveChannelApi | null>(null);

function topicKey(topic: LiveTopic): string {
  return `${topic.resource}:${topic.id}`;
}

/** Adresse des Live-Kanals, abgeleitet aus der API-Adresse. */
function liveChannelUrl(): string {
  const configured = process.env.NEXT_PUBLIC_LIVE_WS_URL;
  if (configured) return configured;

  const base = API_BASE_URL || (typeof window === 'undefined' ? '' : window.location.origin);
  return `${base.replace(/^http/, 'ws')}/live`;
}

/** Ereignis-Frame aus einer empfangenen Nachricht lesen; `null`, wenn fremd. */
function parseEventFrame(raw: string): LiveServerEventFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as { kind?: unknown; event?: unknown; topic?: unknown };
  if (candidate.kind !== 'event') return null;
  if (typeof candidate.event !== 'string' || !isLiveServerEventName(candidate.event)) return null;

  const topic = candidate.topic as { resource?: unknown; id?: unknown } | undefined;
  if (!topic || topic.resource !== 'server' || typeof topic.id !== 'string') return null;

  return parsed as LiveServerEventFrame;
}

export interface LiveChannelProviderProps {
  children: ReactNode;
}

export function LiveChannelProvider({ children }: LiveChannelProviderProps) {
  const [connection, setConnection] = useState<LiveConnectionState>('connecting');

  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Map<string, Set<FrameListener>>());
  const topicsRef = useRef(new Map<string, LiveTopic>());
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUsRef = useRef(false);

  const sendRaw = useCallback((frame: LiveClientFrame): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }, []);

  // Aufbau der Verbindung inklusive Wiederanlauf. Läuft einmal für den ganzen
  // eingeloggten Bereich; die Abhängigkeitsliste ist deshalb bewusst leer.
  useEffect(() => {
    closedByUsRef.current = false;

    function connect() {
      setConnection('connecting');

      let socket: WebSocket;
      try {
        socket = new WebSocket(liveChannelUrl());
      } catch {
        scheduleRetry();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        attemptRef.current = 0;
        setConnection('open');
        // Nach einem Wiederanlauf kennt das Backend die Abos nicht mehr.
        for (const topic of topicsRef.current.values()) {
          sendRaw({ kind: 'subscribe', topic });
        }
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const frame = parseEventFrame(event.data);
        if (!frame) return;
        const listeners = listenersRef.current.get(topicKey(frame.topic));
        if (!listeners) return;
        for (const listener of listeners) listener(frame);
      };

      socket.onclose = () => {
        socketRef.current = null;
        setConnection('closed');
        if (!closedByUsRef.current) scheduleRetry();
      };

      socket.onerror = () => {
        // Der Fehler zieht immer ein `close` nach sich; dort wird neu versucht.
        socket.close();
      };
    }

    function scheduleRetry() {
      if (closedByUsRef.current) return;
      const delay = reconnectDelayMs(attemptRef.current, Math.random());
      attemptRef.current += 1;
      retryTimerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      closedByUsRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [sendRaw]);

  const subscribe = useCallback(
    (topic: LiveTopic, listener: FrameListener) => {
      const key = topicKey(topic);
      let listeners = listenersRef.current.get(key);

      if (!listeners) {
        listeners = new Set();
        listenersRef.current.set(key, listeners);
        topicsRef.current.set(key, topic);
        sendRaw({ kind: 'subscribe', topic });
      }
      listeners.add(listener);

      return () => {
        const current = listenersRef.current.get(key);
        if (!current) return;
        current.delete(listener);
        if (current.size > 0) return;

        listenersRef.current.delete(key);
        topicsRef.current.delete(key);
        sendRaw({ kind: 'unsubscribe', topic });
      };
    },
    [sendRaw],
  );

  const value = useMemo<LiveChannelApi>(
    () => ({ connection, subscribe, send: sendRaw }),
    [connection, subscribe, sendRaw],
  );

  return <LiveChannelContext.Provider value={value}>{children}</LiveChannelContext.Provider>;
}

/**
 * Zugriff auf den Live-Kanal.
 *
 * Wirft bewusst, wenn der Provider fehlt: eine Ansicht, die stillschweigend
 * ohne Live-Daten läuft, wäre schwerer zu bemerken als ein klarer Fehler.
 */
export function useLiveChannel(): LiveChannelApi {
  const api = useContext(LiveChannelContext);
  if (!api) {
    throw new Error('useLiveChannel() braucht einen <LiveChannelProvider> im Baum.');
  }
  return api;
}
