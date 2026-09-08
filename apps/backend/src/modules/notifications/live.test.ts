import websocket from '@fastify/websocket';
import {
  CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS as VERTRAG_TOO_MANY_CONNECTIONS,
  type NotificationDto,
} from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLOSE_CODE_TOO_MANY_CONNECTIONS,
  NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER,
  createNotificationHub,
  registerNotificationLiveRoute,
  type LiveSocket,
} from './live.js';
import type { NotificationService } from './service.js';

function fakeSocket(): LiveSocket & {
  frames: unknown[];
  closed: { code: number | undefined; reason: string | undefined }[];
} {
  const frames: unknown[] = [];
  const closed: { code: number | undefined; reason: string | undefined }[] = [];

  return {
    frames,
    closed,
    send(data) {
      frames.push(JSON.parse(data));
    },
    close(code, reason) {
      closed.push({ code, reason });
    },
  };
}

/** Socket, der beim Senden scheitert – z. B. weil er gerade geschlossen wurde. */
function brokenSocket(): LiveSocket {
  return {
    send() {
      throw new Error('Verbindung bereits geschlossen');
    },
    close() {
      // im Test ohne Bedeutung
    },
  };
}

const notification = { id: 'n1', title: 'Server ist abgestürzt' } as unknown as NotificationDto;

describe('Live-Kanal der Inbox (Pflichtenheft §5.3)', () => {
  it('stellt nur an das Konto zu, dem die Meldung gehört', () => {
    const hub = createNotificationHub();
    const meins = fakeSocket();
    const fremdes = fakeSocket();

    hub.attach('user-1', meins);
    hub.attach('user-2', fremdes);

    hub.publish('user-1', { notification, unreadCount: 3 });

    expect(meins.frames).toHaveLength(1);
    expect(fremdes.frames).toHaveLength(0);
  });

  it('schickt das vereinbarte Frame samt Zähler', () => {
    const hub = createNotificationHub({ now: () => new Date('2026-08-26T12:00:00.000Z') });
    const socket = fakeSocket();

    hub.attach('user-1', socket);
    hub.publish('user-1', { notification, unreadCount: 3 });

    expect(socket.frames[0]).toEqual({
      kind: 'event',
      event: 'notification.created',
      data: { notification, unreadCount: 3 },
      sentAt: '2026-08-26T12:00:00.000Z',
    });
  });

  /** Ein Konto kann mehrere Tabs offen haben. */
  it('erreicht alle offenen Verbindungen desselben Kontos', () => {
    const hub = createNotificationHub();
    const tabA = fakeSocket();
    const tabB = fakeSocket();

    hub.attach('user-1', tabA);
    hub.attach('user-1', tabB);
    hub.publish('user-1', { notification, unreadCount: 1 });

    expect(tabA.frames).toHaveLength(1);
    expect(tabB.frames).toHaveLength(1);
    expect(hub.connectionCount('user-1')).toBe(2);
  });

  it('vergisst eine abgemeldete Verbindung', () => {
    const hub = createNotificationHub();
    const socket = fakeSocket();
    const detach = hub.attach('user-1', socket);

    detach();
    hub.publish('user-1', { notification, unreadCount: 1 });

    expect(socket.frames).toHaveLength(0);
    expect(hub.connectionCount('user-1')).toBe(0);
  });

  it('bleibt still, wenn niemand verbunden ist', () => {
    const hub = createNotificationHub();

    expect(() => {
      hub.publish('user-1', { notification, unreadCount: 1 });
    }).not.toThrow();
  });

  /**
   * Der auslösende Vorgang darf an einer gerade geschlossenen Verbindung nicht
   * scheitern (Pflichtenheft §14) – die Meldung steht in der Datenbank.
   */
  it('scheitert nicht an einer Verbindung, die beim Senden abbricht', () => {
    const hub = createNotificationHub();
    const gesund = fakeSocket();

    hub.attach('user-1', brokenSocket());
    hub.attach('user-1', gesund);

    expect(() => {
      hub.publish('user-1', { notification, unreadCount: 1 });
    }).not.toThrow();
    // Die zweite Verbindung bekommt ihre Meldung trotzdem.
    expect(gesund.frames).toHaveLength(1);
  });

  /**
   * Audit W2-2, `backend-community-visibility-03`: Die Sitzung wurde nur im
   * Handshake geprueft – Sperre und Remote-Logout liessen den Kanal offen.
   */
  it('schliesst bei Sperre oder Widerruf alle Verbindungen des Kontos', () => {
    const hub = createNotificationHub();
    const handy = fakeSocket();
    const laptop = fakeSocket();
    const fremdes = fakeSocket();

    hub.attach('user-1', handy);
    hub.attach('user-1', laptop);
    hub.attach('user-2', fremdes);

    expect(hub.closeAll('user-1', 4401, 'Sitzung beendet.')).toBe(2);

    expect(handy.closed).toEqual([{ code: 4401, reason: 'Sitzung beendet.' }]);
    expect(laptop.closed).toEqual([{ code: 4401, reason: 'Sitzung beendet.' }]);
    expect(fremdes.closed).toHaveLength(0);
    expect(hub.connectionCount('user-1')).toBe(0);

    hub.publish('user-1', { notification, unreadCount: 1 });

    expect(handy.frames).toHaveLength(0);
  });
});

/**
 * Verbindungsobergrenze je Konto (Fundpunkt 142, Audit W2-3).
 *
 * Der Chat-Kanal hatte sie seit W2-3, der baugleich gebaute Inbox-Kanal nicht:
 * Ohne Obergrenze vervielfachte ein Konto mit tausenden offenen Sockets jede
 * Meldung – sie wird je Verbindung einmal gesendet.
 */
describe('Verbindungsobergrenze des Inbox-Kanals (Fundpunkt 142)', () => {
  it('schließt beim Überschreiten die älteste Verbindung mit dem Code aus dem Vertrag', () => {
    const hub = createNotificationHub();
    const sockets = Array.from({ length: NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER + 1 }, () =>
      fakeSocket(),
    );

    for (const socket of sockets) {
      hub.attach('user-1', socket);
    }

    expect(hub.connectionCount('user-1')).toBe(NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER);
    expect(sockets[0]?.closed).toEqual([
      {
        code: VERTRAG_TOO_MANY_CONNECTIONS,
        reason: 'Zu viele gleichzeitige Verbindungen dieses Kontos.',
      },
    ]);
    // Die zuletzt geöffnete bleibt: Wer gerade neu verbindet, soll sich nicht
    // aussperren, nur weil eine alte Verbindung halb offen hängt.
    expect(sockets.at(-1)?.closed).toHaveLength(0);
  });

  it('nimmt die Zahl unverändert aus dem Vertrag, statt eine zweite zu erfinden', () => {
    expect(CLOSE_CODE_TOO_MANY_CONNECTIONS).toBe(VERTRAG_TOO_MANY_CONNECTIONS);
  });

  it('stellt der geschlossenen Verbindung nichts mehr zu', () => {
    const hub = createNotificationHub();
    const sockets = Array.from({ length: NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER + 1 }, () =>
      fakeSocket(),
    );

    for (const socket of sockets) {
      hub.attach('user-1', socket);
    }

    hub.publish('user-1', { notification, unreadCount: 1 });

    expect(sockets[0]?.frames).toHaveLength(0);
    expect(sockets.at(-1)?.frames).toHaveLength(1);
  });

  it('zählt je Konto – fremde Verbindungen bleiben unberührt', () => {
    const hub = createNotificationHub();
    const fremdes = fakeSocket();

    hub.attach('user-2', fremdes);

    for (let nummer = 0; nummer <= NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER; nummer += 1) {
      hub.attach('user-1', fakeSocket());
    }

    expect(hub.connectionCount('user-2')).toBe(1);
    expect(fremdes.closed).toHaveLength(0);
  });

  /** Der Abriss einer alten Verbindung darf die übrigen nicht mitnehmen. */
  it('meldet die übrigen Verbindungen weiter ab, auch wenn eine beim Schließen scheitert', () => {
    const hub = createNotificationHub();
    const kaputt: LiveSocket = {
      send() {
        // im Test ohne Bedeutung
      },
      close() {
        throw new Error('Verbindung bereits geschlossen');
      },
    };

    hub.attach('user-1', kaputt);

    expect(() => {
      for (let nummer = 0; nummer < NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER; nummer += 1) {
        hub.attach('user-1', fakeSocket());
      }
    }).not.toThrow();
    expect(hub.connectionCount('user-1')).toBe(NOTIFICATION_LIVE_MAX_CONNECTIONS_PER_USER);
  });
});

/**
 * Audit W2-5, `security-matrix-04`: WebSocket-Handshakes unterliegen nicht
 * CORS. Eine fremde Seite konnte den Inbox-Kanal des Opfers öffnen und dessen
 * Meldungen mitlesen; der Schutz hing allein an `SameSite=Lax`.
 */
describe('Herkunft des Handshakes (security-matrix-04)', () => {
  const PANEL = 'https://panel.example.tld';

  async function baueApp(
    hub = createNotificationHub(),
    extras: { heartbeatIntervalMs?: number } = {},
  ): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });

    await app.register(websocket);

    registerNotificationLiveRoute(app, {
      hub,
      notifications: { countUnread: async () => 0 } as unknown as NotificationService,
      resolveUserId: () => 'user-1',
      allowedOrigin: PANEL,
      ...extras,
    });

    await app.ready();

    return app;
  }

  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('lässt die konfigurierte Panel-Adresse durch', async () => {
    app = await baueApp();

    const socket = await app.injectWS('/live/notifications', { headers: { origin: PANEL } });

    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });

  it('weist eine fremde Herkunft schon beim Handshake ab', async () => {
    app = await baueApp();

    await expect(
      app.injectWS('/live/notifications', { headers: { origin: 'https://boese.example' } }),
    ).rejects.toThrow('403');
  });

  /**
   * Audit W3-4, `backend-community-08`: Nach einem `unsubscribe` bestätigte ein
   * erneutes `subscribe` mit `subscribed` samt Zähler, ohne die Verbindung
   * jemals wieder anzumelden. Der Client hielt sich für abonniert, bekam aber
   * bis zum Neuaufbau kein `notification.created` mehr.
   */
  it('meldet nach unsubscribe/subscribe wirklich wieder an', async () => {
    const hub = createNotificationHub();

    app = await baueApp(hub);

    const socket = await app.injectWS('/live/notifications', { headers: { origin: PANEL } });

    /** Wartet auf das nächste Frame der Verbindung. */
    const naechstesFrame = async (): Promise<Record<string, unknown>> =>
      new Promise((resolve) => {
        socket.once('message', (raw: unknown) => {
          resolve(JSON.parse(String(raw)) as Record<string, unknown>);
        });
      });

    expect(hub.connectionCount('user-1')).toBe(1);

    socket.send(JSON.stringify({ kind: 'unsubscribe' }));
    // Der `pong` beweist, dass das `unsubscribe` davor verarbeitet wurde.
    socket.send(JSON.stringify({ kind: 'ping' }));

    expect(await naechstesFrame()).toMatchObject({ kind: 'pong' });
    expect(hub.connectionCount('user-1')).toBe(0);

    socket.send(JSON.stringify({ kind: 'subscribe' }));

    expect(await naechstesFrame()).toMatchObject({ kind: 'subscribed' });
    expect(hub.connectionCount('user-1')).toBe(1);

    const angekommen = naechstesFrame();

    hub.publish('user-1', { notification, unreadCount: 1 });

    expect(await angekommen).toMatchObject({ event: 'notification.created' });

    socket.close();
  });
});

/**
 * Server-seitiges Lebenszeichen am Inbox-Kanal (Fundpunkt 142, Audit W2-3).
 *
 * Der Chat-Kanal pingt seit W2-3, der Inbox-Kanal nicht: Eine halboffene
 * Verbindung (Mobilfunk-Abbruch, Proxy-Timeout ohne FIN) meldet weder `close`
 * noch `error` und blieb bis zum TCP-Timeout im Verteiler stehen – samt ihrer
 * Kopie jeder Meldung.
 *
 * Den Zyklus selbst prüft `lib/ws-heartbeat.test.ts`; hier steht der Nachweis,
 * dass die Route ihn überhaupt startet – vorher tat sie das nicht.
 */
describe('Lebenszeichen des Inbox-Kanals (Fundpunkt 142)', () => {
  const PANEL = 'https://panel.example.tld';

  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  /**
   * Der eingespritzte Client beantwortet den Ping **nicht** auf Protokollebene –
   * genau das macht ihn hier zur halboffenen Verbindung, um die es geht: Sie
   * bekommt ihren Ping, antwortet nie und ist nach dem nächsten Takt weg.
   */
  it('pingt und reißt eine Verbindung ohne Pong nach der Frist ab', async () => {
    const hub = createNotificationHub();

    app = Fastify({ logger: false });

    await app.register(websocket);

    registerNotificationLiveRoute(app, {
      hub,
      notifications: { countUnread: async () => 0 } as unknown as NotificationService,
      resolveUserId: () => 'user-1',
      allowedOrigin: PANEL,
      // Ohne diesen Takt müsste der Test eine ganze Minute warten.
      heartbeatIntervalMs: 20,
    });

    await app.ready();

    const socket = await app.injectWS('/live/notifications', { headers: { origin: PANEL } });

    expect(hub.connectionCount('user-1')).toBe(1);

    const gepingt = new Promise<void>((resolve) => {
      socket.once('ping', () => {
        resolve();
      });
    });
    const beendet = new Promise<void>((resolve) => {
      socket.once('close', () => {
        resolve();
      });
    });

    await gepingt;
    await beendet;

    // Der Abriss räumt auch im Verteiler auf – sonst bekäme eine tote
    // Verbindung weiter jede Meldung serialisiert.
    expect(hub.connectionCount('user-1')).toBe(0);
  });
});
