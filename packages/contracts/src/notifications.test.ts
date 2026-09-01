import { describe, expect, it } from 'vitest';
import { WEBSOCKET_EVENTS } from './events.js';
import { LIVE_SERVER_EVENTS } from './server-live.js';
import {
  MUTABLE_NOTIFICATION_EVENTS,
  NOTIFIABLE_EVENTS,
  NOTIFICATION_CHANNEL_TYPES,
  NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED,
  NOTIFICATION_LIVE_EVENTS,
  NOTIFICATION_RECIPIENT_SCOPES,
  NOTIFICATION_SEVERITIES,
  isMutableNotificationEvent,
  isNotifiableEventName,
  isNotificationLiveEventName,
} from './notifications.js';

describe('Auslösende Ereignisse (Pflichtenheft §14)', () => {
  it('enthält die im Pflichtenheft genannten Anlässe', () => {
    expect([...NOTIFIABLE_EVENTS]).toEqual(
      expect.arrayContaining([
        'server.started',
        'server.stopped',
        'server.crashed',
        'backup.failed',
        'autoShutdown.triggered',
        'resource.low',
        'user.registered',
        'message.reported',
      ]),
    );
  });

  it('steht vollständig im Katalog WEBSOCKET_EVENTS', () => {
    for (const event of NOTIFIABLE_EVENTS) {
      expect(WEBSOCKET_EVENTS).toContain(event);
    }
  });

  /**
   * Die Trennung aus Pflichtenheft §14: Live-Ereignisse halten nur eine offene
   * Ansicht aktuell. Stünde `server.statsUpdated` hier, entstünden mehrere
   * Meldungen je Minute und Server.
   */
  it('enthält kein reines Live-Ereignis des Server-Kanals', () => {
    for (const event of LIVE_SERVER_EVENTS) {
      expect(NOTIFIABLE_EVENTS).not.toContain(event);
    }
  });

  it('enthält nicht die Zustellung selbst – sonst löste jede Meldung die nächste aus', () => {
    expect(NOTIFIABLE_EVENTS).not.toContain('notification.created');
  });

  it('führt jeden Namen nur einmal', () => {
    expect(new Set(NOTIFIABLE_EVENTS).size).toBe(NOTIFIABLE_EVENTS.length);
  });

  it('isNotifiableEventName() erkennt Live-Ereignisse und Unbekanntes', () => {
    expect(isNotifiableEventName('backup.failed')).toBe(true);
    expect(isNotifiableEventName('announcement.published')).toBe(true);
    expect(isNotifiableEventName('server.statsUpdated')).toBe(false);
    expect(isNotifiableEventName('server.exploded')).toBe(false);
  });
});

describe('Live-Kanal der Inbox (Pflichtenheft §5.3)', () => {
  it('steht im Katalog WEBSOCKET_EVENTS', () => {
    for (const event of NOTIFICATION_LIVE_EVENTS) {
      expect(WEBSOCKET_EVENTS).toContain(event);
    }
  });

  it('überschneidet sich nicht mit dem Server-Live-Kanal', () => {
    for (const event of NOTIFICATION_LIVE_EVENTS) {
      expect(LIVE_SERVER_EVENTS).not.toContain(event);
    }
  });

  it('isNotificationLiveEventName() erkennt unbekannte Namen', () => {
    expect(isNotificationLiveEventName('notification.created')).toBe(true);
    expect(isNotificationLiveEventName('server.statusChanged')).toBe(false);
  });

  it('beendet nicht angemeldete Verbindungen mit Close-Code 4401 (privater Bereich)', () => {
    expect(NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED).toBe(4401);
    expect(NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED).toBeGreaterThanOrEqual(4000);
    expect(NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED).toBeLessThanOrEqual(4999);
  });
});

describe('Aufzählungen der Notification-Engine', () => {
  it('kennt in Version 1 genau den Discord-Webhook (Lastenheft §3.6)', () => {
    expect([...NOTIFICATION_CHANNEL_TYPES]).toEqual(['discordWebhook']);
  });

  it('führt die Empfängerkreise aus Lastenheft §3.6', () => {
    expect([...NOTIFICATION_RECIPIENT_SCOPES]).toEqual([
      'resourceOwner',
      'serverMembers',
      'role',
      'allUsers',
    ]);
  });

  it('führt drei Dringlichkeitsstufen', () => {
    expect([...NOTIFICATION_SEVERITIES]).toEqual(['info', 'warning', 'error']);
  });
});

describe('Abbestellbare Ereignisse (Gefundener Punkt 93)', () => {
  it('umfasst jedes Ereignis ausser der Ankuendigung', () => {
    // Die Liste steht ausgeschrieben, damit `z.enum()` einen Tupel-Typ
    // bekommt – dieser Test haelt sie mit NOTIFIABLE_EVENTS im Gleichschritt.
    expect([...MUTABLE_NOTIFICATION_EVENTS]).toEqual(
      NOTIFIABLE_EVENTS.filter((event) => event !== 'announcement.published'),
    );
  });

  it('erkennt eine Ankuendigung nicht als abbestellbar', () => {
    expect(isMutableNotificationEvent('announcement.published')).toBe(false);
    expect(isMutableNotificationEvent('backup.failed')).toBe(true);
    expect(isMutableNotificationEvent('gibtesnicht')).toBe(false);
  });
});
