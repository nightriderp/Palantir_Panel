'use client';

import {
  type LiveClientFrame,
  type LiveServerEventFrame,
  type LiveTopic,
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
import {
  CLOSE_CODE_FORBIDDEN,
  CLOSE_CODE_UNAUTHORIZED,
  errorToConsoleFrame,
  parseServerLiveFrame,
  resyncToEventFrame,
  startHeartbeat,
  type Heartbeat,
} from './serverChannel';

/**
 * Der Live-Kanal zwischen Browser und Backend (Pflichtenheft §5.3).
 *
 * Genau **eine** WebSocket-Verbindung für den ganzen eingeloggten Bereich.
 * Ansichten abonnieren darüber einzelne Ressourcen und bekommen die Ereignisse
 * als Rückruf. Konsole und Live-Messwerte laufen ausschließlich hierüber – es
 * wird nirgends im Sekundentakt nachgeladen.
 *
 * Bricht die Verbindung ab, versucht der Provider es mit wachsender Wartezeit
 * erneut und meldet alle noch offenen Abos danach automatisch wieder an. Das
 * Backend antwortet auf jedes `subscribe` mit dem Ist-Stand (`resync`), damit
 * ein Statuswechsel während der Lücke nicht verloren geht (`event-flow-03`);
 * ein Lebenszeichen im 30-Sekunden-Takt hält die Verbindung durch Reverse
 * Proxies offen und erkennt eine, die nur noch auf dem Papier steht.
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
  const heartbeatRef = useRef<Heartbeat | null>(null);
  /** Laufende Nummer für die Ids der selbst erzeugten Konsolenzeilen. */
  const localLineRef = useRef(0);

  /**
   * Rohes Frame schicken.
   *
   * Nimmt bewusst mehr als `LiveClientFrame` entgegen: Das Lebenszeichen
   * (`{ kind: 'ping' }`) steht noch nicht im Vertrag – siehe den
   * Provisorium-Hinweis in `serverChannel.ts`.
   */
  const sendJson = useCallback((frame: unknown): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }, []);

  const sendRaw = useCallback((frame: LiveClientFrame): boolean => sendJson(frame), [sendJson]);

  // Aufbau der Verbindung inklusive Wiederanlauf. Läuft einmal für den ganzen
  // eingeloggten Bereich; die Abhängigkeitsliste ist deshalb bewusst leer.
  useEffect(() => {
    closedByUsRef.current = false;

    /** Ereignis-Frame an alle Zuhörer des Themas ausliefern. */
    function dispatch(frame: LiveServerEventFrame) {
      const listeners = listenersRef.current.get(topicKey(frame.topic));
      if (!listeners) return;
      for (const listener of listeners) listener(frame);
    }

    function stopHeartbeat() {
      heartbeatRef.current?.stop();
      heartbeatRef.current = null;
    }

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
        // Nach einem Wiederanlauf kennt das Backend die Abos nicht mehr. Es
        // antwortet auf jedes `subscribe` mit dem Ist-Stand (`resync`), damit
        // ein Wechsel während der Lücke nicht verloren geht (event-flow-03).
        for (const topic of topicsRef.current.values()) {
          sendRaw({ kind: 'subscribe', topic });
        }

        stopHeartbeat();
        heartbeatRef.current = startHeartbeat({
          send: () => {
            sendJson({ kind: 'ping' });
          },
          onTimeout: () => {
            // Keine Antwort: Die Verbindung steht nur noch auf dem Papier.
            // Schließen löst den gewohnten Wiederanlauf über `onclose` aus.
            socket.close();
          },
        });
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const frame = parseServerLiveFrame(event.data);
        if (!frame) return;

        if (frame.kind === 'pong') {
          heartbeatRef.current?.pong();
          return;
        }

        if (frame.kind === 'resync') {
          dispatch(resyncToEventFrame(frame));
          return;
        }

        if (frame.kind === 'error') {
          localLineRef.current += 1;
          const zeile = errorToConsoleFrame(frame, `local-${localLineRef.current}`);
          if (zeile) dispatch(zeile);
          return;
        }

        dispatch(frame);
      };

      socket.onclose = (event) => {
        socketRef.current = null;
        stopHeartbeat();
        setConnection('closed');

        // Ohne gültige Sitzung oder ohne Freischaltung endete jeder weitere
        // Versuch genauso – das wäre eine Schleife, kein Wiederanlauf.
        if (event.code === CLOSE_CODE_UNAUTHORIZED || event.code === CLOSE_CODE_FORBIDDEN) return;
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
      stopHeartbeat();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [sendJson, sendRaw]);

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
