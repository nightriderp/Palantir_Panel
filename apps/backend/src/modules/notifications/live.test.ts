import type { NotificationDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { createNotificationHub, type LiveSocket } from './live.js';

function fakeSocket(): LiveSocket & { frames: unknown[] } {
  const frames: unknown[] = [];

  return {
    frames,
    send(data) {
      frames.push(JSON.parse(data));
    },
    close() {
      // im Test ohne Bedeutung
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
});
