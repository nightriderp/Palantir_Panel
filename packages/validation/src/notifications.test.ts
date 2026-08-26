import { describe, expect, it } from 'vitest';
import {
  createAnnouncementInputSchema,
  createNotificationChannelInputSchema,
  createNotificationRuleInputSchema,
  discordWebhookUrlSchema,
  markNotificationsReadInputSchema,
  notificationClientFrameSchema,
  notificationQuerySchema,
  updateNotificationChannelInputSchema,
} from './notifications.js';

const ROLE_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';

describe('Discord-Webhook-URL', () => {
  it('nimmt beide gültigen Hostnamen an', () => {
    expect(
      discordWebhookUrlSchema.safeParse('https://discord.com/api/webhooks/123456/abcDEF-_').success,
    ).toBe(true);
    expect(
      discordWebhookUrlSchema.safeParse('https://discordapp.com/api/webhooks/123456/abcDEF-_')
        .success,
    ).toBe(true);
  });

  it('lehnt fremde Ziele und unverschlüsselte Verbindungen ab', () => {
    expect(discordWebhookUrlSchema.safeParse('https://example.com/api/webhooks/1/x').success).toBe(
      false,
    );
    expect(
      discordWebhookUrlSchema.safeParse('http://discord.com/api/webhooks/123456/abc').success,
    ).toBe(false);
    expect(discordWebhookUrlSchema.safeParse('kein-url').success).toBe(false);
  });
});

describe('Kanal anlegen und ändern', () => {
  it('kommt ohne Webhook-URL aus – dann gilt DISCORD_WEBHOOK_URL aus der .env', () => {
    const result = createNotificationChannelInputSchema.parse({ name: 'Systemkanal' });

    expect(result).toEqual({
      name: 'Systemkanal',
      type: 'discordWebhook',
      target: {},
      enabled: true,
    });
  });

  it('lehnt eine Änderung ohne einziges Feld ab', () => {
    expect(updateNotificationChannelInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('Regel anlegen (Lastenheft §3.6)', () => {
  it('setzt „nur Inbox“ als Standard, wenn kein Kanal gewählt ist', () => {
    const result = createNotificationRuleInputSchema.parse({
      event: 'backup.failed',
      recipientScope: 'resourceOwner',
    });

    expect(result.channelId).toBeNull();
    expect(result.inboxEnabled).toBe(true);
  });

  /** Ohne eigene Angabe erbt die Meldung die Dringlichkeit des Ereignisses. */
  it('übernimmt die Dringlichkeit des Ereignisses, solange keine gewählt ist', () => {
    const result = createNotificationRuleInputSchema.parse({
      event: 'backup.failed',
      recipientScope: 'resourceOwner',
    });

    expect(result.severity).toBeNull();
  });

  it('verlangt beim Empfängerkreis „Rolle“ eine Rolle', () => {
    expect(
      createNotificationRuleInputSchema.safeParse({
        event: 'user.registered',
        recipientScope: 'role',
      }).success,
    ).toBe(false);

    expect(
      createNotificationRuleInputSchema.safeParse({
        event: 'user.registered',
        recipientScope: 'role',
        recipientRoleId: ROLE_ID,
      }).success,
    ).toBe(true);
  });

  it('lehnt eine Rolle bei anderen Empfängerkreisen ab', () => {
    expect(
      createNotificationRuleInputSchema.safeParse({
        event: 'user.registered',
        recipientScope: 'allUsers',
        recipientRoleId: ROLE_ID,
      }).success,
    ).toBe(false);
  });

  /** Eine Regel ohne Inbox und ohne Kanal wäre stiller Ausfall statt sichtbarer Fehler. */
  it('lehnt eine Regel ab, die niemanden erreichen würde', () => {
    expect(
      createNotificationRuleInputSchema.safeParse({
        event: 'server.crashed',
        recipientScope: 'resourceOwner',
        inboxEnabled: false,
      }).success,
    ).toBe(false);

    expect(
      createNotificationRuleInputSchema.safeParse({
        event: 'server.crashed',
        recipientScope: 'resourceOwner',
        inboxEnabled: false,
        channelId: CHANNEL_ID,
      }).success,
    ).toBe(true);
  });

  it('lässt nur Ereignisse zu, die eine Benachrichtigung auslösen dürfen', () => {
    expect(
      createNotificationRuleInputSchema.safeParse({
        event: 'server.statsUpdated',
        recipientScope: 'resourceOwner',
      }).success,
    ).toBe(false);
  });
});

describe('Inbox-Abfrage', () => {
  it('liefert Standardwerte für Seitengröße und Versatz', () => {
    expect(notificationQuerySchema.parse({})).toEqual({
      unreadOnly: false,
      limit: 25,
      offset: 0,
    });
  });

  it('begrenzt die Seitengröße', () => {
    expect(notificationQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('markiert ohne Id-Liste alle Meldungen', () => {
    expect(markNotificationsReadInputSchema.parse({})).toEqual({ read: true });
  });
});

describe('Systemweite Ankündigung', () => {
  it('läuft ohne Angabe nicht ab', () => {
    const result = createAnnouncementInputSchema.parse({
      title: 'Wartung',
      body: 'Am Sonntag ab 02:00 Uhr steht das Panel kurz still.',
    });

    expect(result.expiresAt).toBeNull();
    expect(result.severity).toBe('info');
  });

  it('begrenzt den Text auf die Länge, die auch extern ankommt', () => {
    expect(
      createAnnouncementInputSchema.safeParse({ title: 'Wartung', body: 'x'.repeat(1801) }).success,
    ).toBe(false);
  });
});

describe('Frames des Live-Kanals', () => {
  it('kennt nur die drei vereinbarten Formen', () => {
    expect(notificationClientFrameSchema.safeParse({ kind: 'subscribe' }).success).toBe(true);
    expect(notificationClientFrameSchema.safeParse({ kind: 'ping' }).success).toBe(true);
    expect(notificationClientFrameSchema.safeParse({ kind: 'consoleCommand' }).success).toBe(false);
  });

  /** Der Empfänger kommt aus der Sitzung – ein Frame-Feld dafür gibt es bewusst nicht. */
  it('trägt keine fremde Konto-Id', () => {
    const result = notificationClientFrameSchema.parse({ kind: 'subscribe', userId: 'fremd' });

    expect(result).toEqual({ kind: 'subscribe' });
  });
});
