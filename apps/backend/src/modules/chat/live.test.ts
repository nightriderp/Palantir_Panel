/**
 * Live-Zustellung (Pflichtenheft §5.3).
 *
 * Der Verteiler adressiert je Konto. Dass er selbst keinen Teilnehmerkreis
 * auflöst, ist Absicht: Die Sichtbarkeitsregel steht in `visibility.ts` und
 * soll nicht an zwei Stellen leben.
 */

import {
  CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS as VERTRAG_TOO_MANY_CONNECTIONS,
  CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED as VERTRAG_UNAUTHORIZED,
} from '@palantir/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED,
  CHAT_LIVE_MAX_CONNECTIONS_PER_USER,
  type ChatHeartbeatSocket,
  ChatLiveHub,
  conversationReadFrame,
  messageSentFrame,
  startChatHeartbeat,
} from './live.js';
import { ALEX, BEA } from './test-doubles.js';

interface FakeSocket {
  readonly sent: string[];
  /** Mitschrift der `close`-Aufrufe – `closeAll` muss Code und Grund durchreichen. */
  readonly closed: { code: number; reason: string | undefined }[];
  send(data: string): void;
  close(code: number, reason?: string): void;
}

function fakeSocket(): FakeSocket {
  const sent: string[] = [];
  const closed: { code: number; reason: string | undefined }[] = [];

  return {
    sent,
    closed,
    send: (data) => sent.push(data),
    close: (code, reason) => closed.push({ code, reason }),
  };
}

const FRAME = messageSentFrame(
  {
    conversationId: 'c',
    message: {
      id: 'm',
      conversationId: 'c',
      senderId: ALEX,
      senderDisplayName: 'Alex',
      content: 'Hallo',
      createdAt: '2026-08-26T12:00:00.000Z',
      deletedAt: null,
      deletedByModerator: null,
      reportedByViewer: false,
      permissions: { canDelete: false, canReport: true },
    },
  },
  new Date('2026-08-26T12:00:01.000Z'),
);

describe('ChatLiveHub', () => {
  it('stellt nur dem adressierten Konto zu', () => {
    const hub = new ChatLiveHub();
    const alex = fakeSocket();
    const bea = fakeSocket();

    hub.register(ALEX, alex);
    hub.register(BEA, bea);
    hub.deliver(BEA, FRAME);

    expect(alex.sent).toHaveLength(0);
    expect(bea.sent).toHaveLength(1);
    expect(JSON.parse(bea.sent[0] ?? '{}')).toMatchObject({
      kind: 'event',
      event: 'message.sent',
    });
  });

  it('bedient alle Verbindungen eines Kontos – mehrere Geräte oder Tabs', () => {
    const hub = new ChatLiveHub();
    const handy = fakeSocket();
    const laptop = fakeSocket();

    hub.register(ALEX, handy);
    hub.register(ALEX, laptop);

    expect(hub.connectionCount(ALEX)).toBe(2);

    hub.deliver(ALEX, FRAME);

    expect(handy.sent).toHaveLength(1);
    expect(laptop.sent).toHaveLength(1);
  });

  it('meldet eine Verbindung ab, auch wenn close und error nacheinander kommen', () => {
    const hub = new ChatLiveHub();
    const socket = fakeSocket();
    const abmelden = hub.register(ALEX, socket);

    abmelden();
    abmelden();

    expect(hub.connectionCount(ALEX)).toBe(0);

    hub.deliver(ALEX, FRAME);

    expect(socket.sent).toHaveLength(0);
  });

  /** Ein halb geschlossener Socket darf die anderen nicht um ihre Nachricht bringen. */
  it('stellt weiter zu, wenn eine Verbindung beim Senden scheitert', () => {
    const hub = new ChatLiveHub();
    const kaputt = {
      send: (): never => {
        throw new Error('socket closed');
      },
      close: (): void => {
        // für diesen Test ohne Bedeutung
      },
    };
    const heil = fakeSocket();

    hub.register(ALEX, kaputt);
    hub.register(ALEX, heil);

    expect(() => {
      hub.deliver(ALEX, FRAME);
    }).not.toThrow();
    expect(heil.sent).toHaveLength(1);
  });

  it('verwirft eine Zustellung an ein Konto ohne offene Verbindung', () => {
    const hub = new ChatLiveHub();

    expect(() => {
      hub.deliver(ALEX, FRAME);
    }).not.toThrow();
  });
});

/**
 * Sperre und Sitzungswiderruf am offenen Kanal (Audit W2-2,
 * `backend-community-visibility-03`).
 *
 * Vorher überlebte ein einmal angemeldeter Socket beides und bekam weiter
 * private Nachrichten, obwohl jeder REST-Aufruf desselben Kontos längst
 * abgelehnt wurde.
 */
describe('ChatLiveHub.closeAll', () => {
  it('schließt bei einer Kontosperre alle Verbindungen des Kontos mit dem Code', () => {
    const hub = new ChatLiveHub();
    const handy = fakeSocket();
    const laptop = fakeSocket();

    hub.register(BEA, handy);
    hub.register(BEA, laptop);

    expect(hub.closeAll(BEA, CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED, 'Konto gesperrt.')).toBe(2);

    expect(handy.closed).toEqual([
      { code: CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED, reason: 'Konto gesperrt.' },
    ]);
    expect(laptop.closed).toEqual([
      { code: CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED, reason: 'Konto gesperrt.' },
    ]);
  });

  it('stellt nach einem Sitzungswiderruf nichts mehr zu', () => {
    const hub = new ChatLiveHub();
    const socket = fakeSocket();

    hub.register(BEA, socket);
    hub.closeAll(BEA, CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED);

    expect(hub.connectionCount(BEA)).toBe(0);

    hub.deliver(BEA, FRAME);

    expect(socket.sent).toHaveLength(0);
    expect(socket.closed[0]?.code).toBe(CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED);
  });

  it('lässt die Verbindungen anderer Konten unberührt', () => {
    const hub = new ChatLiveHub();
    const alex = fakeSocket();
    const bea = fakeSocket();

    hub.register(ALEX, alex);
    hub.register(BEA, bea);
    hub.closeAll(BEA, CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED);

    expect(alex.closed).toHaveLength(0);
    expect(hub.connectionCount(ALEX)).toBe(1);
  });

  it('schließt die übrigen Verbindungen, auch wenn eine dabei scheitert', () => {
    const hub = new ChatLiveHub();
    const kaputt = {
      send: (): void => {
        // für diesen Test ohne Bedeutung
      },
      close: (): never => {
        throw new Error('socket already gone');
      },
    };
    const heil = fakeSocket();

    hub.register(BEA, kaputt);
    hub.register(BEA, heil);

    expect(() => hub.closeAll(BEA, CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED)).not.toThrow();
    expect(heil.closed).toHaveLength(1);
  });

  it('bleibt wirkungslos, wenn das Konto keine Verbindung hat', () => {
    const hub = new ChatLiveHub();

    expect(hub.closeAll(ALEX, CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED)).toBe(0);
  });
});

describe('conversationReadFrame', () => {
  it('baut ein conversation.read-Frame mit Lesestand und Zähler', () => {
    const frame = conversationReadFrame(
      { conversationId: 'c', lastReadAt: '2026-08-26T12:00:00.000Z', unreadCount: 0 },
      new Date('2026-08-26T12:00:01.000Z'),
    );

    expect(frame).toEqual({
      kind: 'event',
      event: 'conversation.read',
      data: { conversationId: 'c', lastReadAt: '2026-08-26T12:00:00.000Z', unreadCount: 0 },
      sentAt: '2026-08-26T12:00:01.000Z',
    });
  });
});

/**
 * Verbindungsobergrenze je Konto (Audit W2-3,
 * `backend-community-visibility-11`).
 *
 * Ohne sie vervielfachte ein Konto mit tausenden offenen Sockets jede
 * Zustellung – auch die fremder Beiträge im Server-Chat.
 */
describe('ChatLiveHub – Verbindungsobergrenze', () => {
  it('schließt beim Überschreiten die älteste Verbindung des Kontos', () => {
    const hub = new ChatLiveHub();
    const sockets = Array.from({ length: CHAT_LIVE_MAX_CONNECTIONS_PER_USER + 1 }, () =>
      fakeSocket(),
    );

    for (const socket of sockets) {
      hub.register(ALEX, socket);
    }

    expect(hub.connectionCount(ALEX)).toBe(CHAT_LIVE_MAX_CONNECTIONS_PER_USER);
    expect(sockets[0]?.closed).toEqual([
      {
        code: CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS,
        reason: 'Zu viele gleichzeitige Verbindungen dieses Kontos.',
      },
    ]);
    // Die zuletzt geöffnete bleibt: Wer gerade neu verbindet, soll nicht
    // ausgesperrt werden, nur weil eine alte Verbindung halb offen hängt.
    expect(sockets.at(-1)?.closed).toHaveLength(0);
  });

  it('stellt der geschlossenen Verbindung nichts mehr zu', () => {
    const hub = new ChatLiveHub();
    const sockets = Array.from({ length: CHAT_LIVE_MAX_CONNECTIONS_PER_USER + 1 }, () =>
      fakeSocket(),
    );

    for (const socket of sockets) {
      hub.register(ALEX, socket);
    }

    hub.deliver(ALEX, FRAME);

    expect(sockets[0]?.sent).toHaveLength(0);
    expect(sockets.at(-1)?.sent).toHaveLength(1);
  });

  it('zählt je Konto – fremde Verbindungen bleiben unberührt', () => {
    const hub = new ChatLiveHub();
    const beas = fakeSocket();

    hub.register(BEA, beas);

    for (let nummer = 0; nummer <= CHAT_LIVE_MAX_CONNECTIONS_PER_USER; nummer += 1) {
      hub.register(ALEX, fakeSocket());
    }

    expect(hub.connectionCount(BEA)).toBe(1);
    expect(beas.closed).toHaveLength(0);
  });
});

/**
 * Server-seitiges Lebenszeichen (Audit W2-3,
 * `backend-community-visibility-11`, `backend-community-13`).
 */
describe('startChatHeartbeat', () => {
  interface FakeHeartbeatSocket extends ChatHeartbeatSocket {
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

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reißt eine Verbindung ab, die auf den Ping nicht antwortet', () => {
    const socket = fakeHeartbeatSocket();

    startChatHeartbeat(socket, { intervalMs: 1_000 });

    vi.advanceTimersByTime(1_000);

    expect(socket.pings).toHaveLength(1);
    expect(socket.terminations).toHaveLength(0);

    // Zweiter Takt ohne Pong dazwischen: Die Gegenstelle ist weg.
    vi.advanceTimersByTime(1_000);

    expect(socket.terminations).toHaveLength(1);
  });

  it('lässt eine antwortende Verbindung offen', () => {
    const socket = fakeHeartbeatSocket();

    startChatHeartbeat(socket, { intervalMs: 1_000 });

    for (let takt = 0; takt < 5; takt += 1) {
      vi.advanceTimersByTime(1_000);
      socket.pong();
    }

    expect(socket.terminations).toHaveLength(0);
    expect(socket.pings).toHaveLength(5);
  });

  it('hört auf zu pingen, sobald die Verbindung abgemeldet ist', () => {
    const socket = fakeHeartbeatSocket();

    const stop = startChatHeartbeat(socket, { intervalMs: 1_000 });

    stop();
    vi.advanceTimersByTime(10_000);

    expect(socket.pings).toHaveLength(0);
    expect(socket.terminations).toHaveLength(0);
  });
});

/**
 * Contracts-Nachzug W2-C2: Beide Close-Codes stehen im Vertrag; das Chat-Modul
 * reicht sie nur weiter. Vorher lagen sie hier und im Frontend doppelt, und ein
 * Test hielt sie gegen die Konstante des Inbox-Kanals.
 */
describe('Close-Codes des Chat-Live-Kanals', () => {
  it('nimmt beide Zahlen unverändert aus dem Vertrag', () => {
    expect(CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED).toBe(VERTRAG_UNAUTHORIZED);
    expect(CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS).toBe(VERTRAG_TOO_MANY_CONNECTIONS);
  });
});
