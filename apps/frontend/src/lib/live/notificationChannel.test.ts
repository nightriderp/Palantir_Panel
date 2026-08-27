import { describe, expect, it } from 'vitest';
import { notificationChannelUrl, parseNotificationFrame } from './notificationChannel';

describe('notificationChannelUrl', () => {
  it('hängt den Inbox-Pfad an eine vorgegebene Live-Adresse', () => {
    expect(notificationChannelUrl('wss://api.example.tld/live', 'https://api.example.tld')).toBe(
      'wss://api.example.tld/live/notifications',
    );
  });

  it('entfernt einen abschließenden Schrägstrich der Vorgabe', () => {
    expect(notificationChannelUrl('wss://api.example.tld/live/', 'https://api.example.tld')).toBe(
      'wss://api.example.tld/live/notifications',
    );
  });

  it('leitet die Adresse aus der API-Basis ab, wenn keine Vorgabe da ist', () => {
    expect(notificationChannelUrl(undefined, 'https://api.example.tld')).toBe(
      'wss://api.example.tld/live/notifications',
    );
    expect(notificationChannelUrl('', 'http://localhost:4000')).toBe(
      'ws://localhost:4000/live/notifications',
    );
  });
});

describe('parseNotificationFrame', () => {
  it('liest ein Ereignis-Frame mit Meldung und Zähler', () => {
    const frame = parseNotificationFrame(
      JSON.stringify({
        kind: 'event',
        event: 'notification.created',
        data: { notification: { id: 'n1' }, unreadCount: 3 },
        sentAt: '2026-08-27T10:00:00.000Z',
      }),
    );

    expect(frame?.kind).toBe('event');
  });

  it('liest ein subscribed- und ein pong-Frame', () => {
    expect(
      parseNotificationFrame(
        JSON.stringify({ kind: 'subscribed', data: { unreadCount: 0 }, sentAt: 'x' }),
      )?.kind,
    ).toBe('subscribed');
    expect(parseNotificationFrame(JSON.stringify({ kind: 'pong', sentAt: 'x' }))?.kind).toBe(
      'pong',
    );
  });

  it('verwirft Nicht-JSON, fremde Ereignisse und unvollständige Nutzlast', () => {
    expect(parseNotificationFrame('kein json')).toBeNull();
    expect(
      parseNotificationFrame(JSON.stringify({ kind: 'event', event: 'server.statsUpdated' })),
    ).toBeNull();
    expect(
      parseNotificationFrame(
        JSON.stringify({ kind: 'event', event: 'notification.created', data: { unreadCount: 1 } }),
      ),
    ).toBeNull();
    expect(parseNotificationFrame(JSON.stringify({ kind: 'subscribed', data: {} }))).toBeNull();
  });
});
