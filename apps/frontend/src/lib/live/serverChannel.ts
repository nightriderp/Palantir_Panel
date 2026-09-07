import {
  type LiveServerEventFrame,
  type LiveTopic,
  type ServerStatus,
  isLiveServerEventName,
} from '@palantir/contracts';

/**
 * Reine Bausteine des Server-Live-Kanals (`/live`, Pflichtenheft §5.3).
 *
 * Frame-Auswertung und Lebenszeichen stehen bewusst getrennt vom Provider: So
 * sind beide ohne WebSocket und ohne React prüfbar (CLAUDE.md §4) – dasselbe
 * Vorgehen wie bei `notificationChannel.ts`, `backoff.ts` und
 * `consoleBuffer.ts`.
 *
 * **PROVISORIUM.** Die Frames `resync`, `pong` und `error` sowie die
 * Close-Codes stehen noch nicht in `@palantir/contracts/server-live.ts`; der
 * Contracts-PR dieser Runde (#238) war bereits durch, als W2-5 sie brauchte,
 * und CLAUDE.md §6 verlangt für Contracts-Änderungen einen eigenen, zuerst zu
 * mergenden PR. Das Gegenstück im Backend
 * (`apps/backend/src/modules/server-orchestration/live-frames.ts`) trägt
 * denselben Hinweis – beide müssen bis zum nächsten Contracts-PR von Hand
 * gleich gehalten werden.
 */

/**
 * Close-Code des Backends für „nicht angemeldet" bzw. „Sitzung beendet".
 *
 * Ein erneuter Versuch endete genauso; deshalb wird danach nicht neu verbunden.
 */
export const CLOSE_CODE_UNAUTHORIZED = 4401;

/** Angemeldet, aber nicht freigeschaltet (Lastenheft §3.1). Ebenfalls endgültig. */
export const CLOSE_CODE_FORBIDDEN = 4403;

/**
 * Abstand zwischen zwei Lebenszeichen.
 *
 * 30 s, derselbe Takt wie im Inbox-Kanal: nginx schließt eine stille
 * WebSocket-Verbindung nach 60 s (`proxy_read_timeout`), und ein Lebenszeichen
 * je halbem Timeout hält sie auch dann offen, wenn eines verloren geht
 * (`event-flow-03`).
 */
export const PING_INTERVAL_MS = 30_000;

/**
 * Wartezeit auf das `pong`, bevor die Verbindung als tot gilt.
 *
 * 10 s: großzügig gegenüber jeder normalen Laufzeit und trotzdem deutlich
 * kürzer als der nächste Ping-Takt – sonst liefen zwei offene Fristen
 * gleichzeitig. Ein „halb offener" Socket (Netz weg, `close` kommt nie) wird
 * damit spätestens nach 40 s bemerkt statt gar nicht.
 */
export const PONG_TIMEOUT_MS = 10_000;

/** Ist-Stand nach `subscribe` – siehe Provisorium-Hinweis oben. */
export interface ServerLiveResyncFrame {
  kind: 'resync';
  topic: LiveTopic;
  data: { status: ServerStatus; statusMessage: string | null };
  sentAt: string;
}

/** Antwort auf ein Lebenszeichen. */
export interface ServerLivePongFrame {
  kind: 'pong';
  sentAt: string;
}

/** Abgelehntes Frame – heute nur beim Konsolenbefehl. */
export interface ServerLiveErrorFrame {
  kind: 'error';
  topic: LiveTopic | null;
  code: string;
  message: string;
  sentAt: string;
}

export type ServerLiveFrame =
  LiveServerEventFrame | ServerLiveResyncFrame | ServerLivePongFrame | ServerLiveErrorFrame;

function istRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function leseTopic(value: unknown): LiveTopic | null {
  if (!istRecord(value) || value.resource !== 'server' || typeof value.id !== 'string') {
    return null;
  }

  return { resource: 'server', id: value.id };
}

/**
 * Frame des Backends aus einer empfangenen Nachricht lesen; `null`, wenn sie
 * nicht zu diesem Kanal gehört.
 *
 * Fremde oder beschädigte Nachrichten werden verworfen statt beantwortet –
 * dieselbe Haltung wie im Backend und im Inbox-Kanal.
 */
export function parseServerLiveFrame(raw: string): ServerLiveFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!istRecord(parsed)) return null;

  if (parsed.kind === 'pong') {
    return { kind: 'pong', sentAt: typeof parsed.sentAt === 'string' ? parsed.sentAt : '' };
  }

  if (parsed.kind === 'resync') {
    const topic = leseTopic(parsed.topic);
    const data = parsed.data;
    if (topic === null || !istRecord(data) || typeof data.status !== 'string') return null;

    return {
      kind: 'resync',
      topic,
      data: {
        status: data.status as ServerStatus,
        statusMessage: typeof data.statusMessage === 'string' ? data.statusMessage : null,
      },
      sentAt: typeof parsed.sentAt === 'string' ? parsed.sentAt : '',
    };
  }

  if (parsed.kind === 'error') {
    if (typeof parsed.message !== 'string' || typeof parsed.code !== 'string') return null;

    return {
      kind: 'error',
      topic: leseTopic(parsed.topic),
      code: parsed.code,
      message: parsed.message,
      sentAt: typeof parsed.sentAt === 'string' ? parsed.sentAt : '',
    };
  }

  if (parsed.kind !== 'event') return null;
  if (typeof parsed.event !== 'string' || !isLiveServerEventName(parsed.event)) return null;
  if (leseTopic(parsed.topic) === null) return null;

  return parsed as unknown as LiveServerEventFrame;
}

/**
 * Übersetzt den Ist-Stand in ein `server.statusChanged`-Frame.
 *
 * Auf der Leitung ist `resync` ein eigenes Frame – innerhalb des Browsers ist
 * es aber genau das, was ein Statuswechsel auch ist: der jüngste bekannte
 * Stand. Die Übersetzung erspart jedem Konsumenten (`useServerLive`,
 * `useServerListLive` und allem, was noch kommt) einen zweiten Zweig, und die
 * Reihenfolgenummer aus `event-flow-04` greift ohne Zutun – der Schnappschuss
 * ist jünger als die REST-Antwort, die vor der Lücke geladen wurde.
 */
export function resyncToEventFrame(frame: ServerLiveResyncFrame): LiveServerEventFrame {
  return {
    kind: 'event',
    event: 'server.statusChanged',
    topic: frame.topic,
    data: {
      serverId: frame.topic.id,
      status: frame.data.status,
      statusMessage: frame.data.statusMessage,
    },
    sentAt: frame.sentAt,
  };
}

/**
 * Übersetzt eine Ablehnung in eine Konsolenzeile.
 *
 * Ein zu langer oder mehrzeiliger Befehl wird vom Backend abgewiesen
 * (`contracts-validation-04`). Ohne diese Zeile stünde die Eingabe im Feld und
 * es passierte sichtbar nichts. `null`, wenn die Ablehnung kein Thema trägt –
 * dann gibt es keine Konsole, in die sie gehörte.
 */
export function errorToConsoleFrame(
  frame: ServerLiveErrorFrame,
  lineId: string,
): LiveServerEventFrame | null {
  if (frame.topic === null) return null;

  return {
    kind: 'event',
    event: 'server.consoleLineAppended',
    topic: frame.topic,
    data: {
      serverId: frame.topic.id,
      line: {
        id: lineId,
        serverId: frame.topic.id,
        source: 'system',
        text: frame.message,
        timestamp: frame.sentAt,
      },
    },
    sentAt: frame.sentAt,
  };
}

export interface HeartbeatOptions {
  /** Ein Lebenszeichen abschicken. */
  send: () => void;
  /** Kein `pong` innerhalb der Frist – die Verbindung gilt als tot. */
  onTimeout: () => void;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface Heartbeat {
  /** Ein eingetroffenes `pong` melden. */
  pong: () => void;
  /** Takt und offene Frist beenden (bei `close` oder beim Aufräumen). */
  stop: () => void;
}

/**
 * Lebenszeichen mit Wächter (`event-flow-03`).
 *
 * Zwei Aufgaben in einem: Der Takt hält die Verbindung durch Reverse Proxies
 * offen, die Frist erkennt eine Verbindung, die nur noch auf dem Papier steht.
 * Solange eine Frist läuft, wird kein zweiter Ping geschickt – sonst würde ein
 * langsamer Rückweg mehrere Fristen übereinander stapeln.
 */
export function startHeartbeat(options: HeartbeatOptions): Heartbeat {
  const intervalMs = options.intervalMs ?? PING_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? PONG_TIMEOUT_MS;

  let frist: ReturnType<typeof setTimeout> | null = null;

  const takt = setInterval(() => {
    if (frist !== null) return;

    options.send();
    frist = setTimeout(() => {
      frist = null;
      options.onTimeout();
    }, timeoutMs);
  }, intervalMs);

  return {
    pong() {
      if (frist !== null) {
        clearTimeout(frist);
        frist = null;
      }
    },
    stop() {
      clearInterval(takt);
      if (frist !== null) {
        clearTimeout(frist);
        frist = null;
      }
    },
  };
}
