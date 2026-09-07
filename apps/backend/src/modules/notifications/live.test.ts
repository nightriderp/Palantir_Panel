import websocket from '@fastify/websocket';
import type { NotificationDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createNotificationHub, registerNotificationLiveRoute, type LiveSocket } from './live.js';
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
 * Audit W2-5, `security-matrix-04`: WebSocket-Handshakes unterliegen nicht
 * CORS. Eine fremde Seite konnte den Inbox-Kanal des Opfers öffnen und dessen
 * Meldungen mitlesen; der Schutz hing allein an `SameSite=Lax`.
 */
describe('Herkunft des Handshakes (security-matrix-04)', () => {
  const PANEL = 'https://panel.example.tld';

  async function baueApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });

    await app.register(websocket);

    registerNotificationLiveRoute(app, {
      hub: createNotificationHub(),
      notifications: { countUnread: async () => 0 } as unknown as NotificationService,
      resolveUserId: () => 'user-1',
      allowedOrigin: PANEL,
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
});
