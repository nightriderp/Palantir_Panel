import type { NotificationEvent } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { isNotificationError } from './errors.js';
import type { JobRunner, LiveNotificationPayload, NotificationAuditSink } from './ports.js';
import { createNotificationService, type NotificationServiceOptions } from './service.js';
import {
  adminActor,
  fakeDirectory,
  fakeRepository,
  fakeRoleLookup,
  failingTransport,
  recordingTransport,
  serverEvent,
  testChannel,
  testId,
  testRule,
  type FakeRepository,
} from './test-doubles.js';

const OWNER = 'owner-1';
const MEMBER = 'member-1';
const ADMIN = 'admin-1';
const ROLE_ID = testId('9');

/** Führt Hintergrundläufe sofort aus und sammelt sie, damit Tests sie abwarten können. */
function immediateJobs(): JobRunner & { settled: () => Promise<void> } {
  const running: Promise<void>[] = [];
  const runner: JobRunner = (job) => {
    running.push(job());
  };

  return Object.assign(runner, {
    settled: async (): Promise<void> => {
      await Promise.all(running);
    },
  });
}

function recordingAudit(): NotificationAuditSink & {
  entries: { action: string; targetId: string }[];
} {
  const entries: { action: string; targetId: string }[] = [];

  return {
    entries,
    record(entry) {
      entries.push({ action: entry.action, targetId: entry.targetId });
    },
  };
}

function build(
  overrides: Partial<NotificationServiceOptions> & { repository?: FakeRepository } = {},
) {
  const repository = overrides.repository ?? fakeRepository();
  const jobs = immediateJobs();
  const live: LiveNotificationPayload[] = [];
  const service = createNotificationService({
    repository,
    directory: fakeDirectory({ activeUserIds: [OWNER, MEMBER, ADMIN] }),
    transport: recordingTransport(),
    jobs,
    live: {
      publish(_userId, payload) {
        live.push(payload);
      },
    },
    now: () => new Date('2026-08-26T12:00:00.000Z'),
    ...overrides,
  });

  return { service, repository, jobs, live };
}

describe('Auslösen eines Ereignisses (Pflichtenheft §14)', () => {
  it('tut nichts, solange keine Regel auf das Ereignis hört', async () => {
    const { service, repository } = build();

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));

    expect(repository.notifications).toHaveLength(0);
  });

  it('stellt dem Besitzer in die Inbox zu', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { service, live } = build({ repository });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));

    expect(repository.notifications).toHaveLength(1);
    expect(repository.notifications[0]?.userId).toBe(OWNER);
    expect(repository.notifications[0]?.title).toContain('abgestürzt');
    // Der Live-Kanal bekommt dieselbe Meldung samt Zähler.
    expect(live).toHaveLength(1);
    expect(live[0]?.unreadCount).toBe(1);
  });

  /**
   * Der Grund, warum `NotificationRuleDto.severity` null-fähig ist: Ein fester
   * Vorgabewert an der Regel würde ein fehlgeschlagenes Backup herabstufen.
   */
  it('übernimmt ohne eigene Angabe die Dringlichkeit des Ereignisses', async () => {
    const repository = fakeRepository({
      rules: [testRule({ event: 'server.failed', severity: null })],
    });
    const { service } = build({ repository });

    await service.publish(serverEvent('server.failed', { ownerId: OWNER }));

    expect(repository.notifications[0]?.severity).toBe('error');
  });

  it('lässt die Regel die Dringlichkeit überschreiben, wenn eine gesetzt ist', async () => {
    const repository = fakeRepository({
      rules: [testRule({ event: 'server.failed', severity: 'info' })],
    });
    const { service } = build({ repository });

    await service.publish(serverEvent('server.failed', { ownerId: OWNER }));

    expect(repository.notifications[0]?.severity).toBe('info');
  });

  it('erreicht bei „Servermitglieder" Besitzer und Mitverwalter', async () => {
    const repository = fakeRepository({
      rules: [testRule({ event: 'server.stopped', recipientScope: 'serverMembers' })],
    });
    const { service } = build({ repository });

    await service.publish(
      serverEvent('server.stopped', { ownerId: OWNER, memberUserIds: [MEMBER] }),
    );

    expect(repository.notifications.map((entry) => entry.userId)).toEqual([OWNER, MEMBER]);
  });

  it('erreicht bei „Rolle" die Träger der Rolle', async () => {
    const repository = fakeRepository({
      rules: [
        testRule({
          event: 'user.registered',
          recipientScope: 'role',
          recipientRoleId: ROLE_ID,
        }),
      ],
    });
    const { service } = build({
      repository,
      directory: fakeDirectory({ roleMembers: { [ROLE_ID]: [ADMIN] } }),
    });

    const registration: NotificationEvent = {
      event: 'user.registered',
      payload: {
        at: '2026-08-26T12:00:00.000Z',
        actorId: null,
        userId: 'usr',
        displayName: 'Neuling',
        awaitingApproval: true,
      },
    };

    await service.publish(registration);

    expect(repository.notifications.map((entry) => entry.userId)).toEqual([ADMIN]);
  });

  it('überspringt abgeschaltete Regeln', async () => {
    const repository = fakeRepository({
      rules: [testRule({ event: 'server.crashed', enabled: false })],
    });
    const { service } = build({ repository });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));

    expect(repository.notifications).toHaveLength(0);
  });

  it('schickt zusätzlich an den externen Kanal, wenn die Regel einen trägt', async () => {
    const channel = testChannel();
    const repository = fakeRepository({
      channels: [channel],
      rules: [testRule({ event: 'server.crashed', channelId: channel.id })],
    });
    const transport = recordingTransport();
    const { service, jobs } = build({ repository, transport });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    await jobs.settled();

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.target.webhookUrl).toBe(channel.webhookUrl);
    expect(repository.deliveries[0]?.status).toBe('delivered');
    expect(repository.channels[0]?.lastDeliveryAt).not.toBeNull();
  });

  it('stellt bei einer Regel ohne Kanal ausschließlich in die Inbox zu', async () => {
    const repository = fakeRepository({ rules: [testRule({ channelId: null })] });
    const transport = recordingTransport();
    const { service, jobs } = build({ repository, transport });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    await jobs.settled();

    expect(repository.notifications).toHaveLength(1);
    expect(transport.sent).toHaveLength(0);
    expect(repository.deliveries).toHaveLength(0);
  });

  it('überspringt einen Kanal ohne Ziel, statt zu scheitern', async () => {
    // Kanal ohne eigene URL, und `DISCORD_WEBHOOK_URL` ist nicht gesetzt.
    const channel = testChannel({ webhookUrl: null });
    const repository = fakeRepository({
      channels: [channel],
      rules: [testRule({ channelId: channel.id })],
    });
    const transport = recordingTransport();
    const { service, jobs } = build({ repository, transport, defaultWebhookUrl: null });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    await jobs.settled();

    expect(transport.sent).toHaveLength(0);
    // Die Inbox wird trotzdem gefüllt – sie hängt nicht am Kanal.
    expect(repository.notifications).toHaveLength(1);
  });

  it('greift bei einem Kanal ohne eigene URL auf DISCORD_WEBHOOK_URL zurück', async () => {
    const channel = testChannel({ webhookUrl: null });
    const repository = fakeRepository({
      channels: [channel],
      rules: [testRule({ channelId: channel.id })],
    });
    const transport = recordingTransport();
    const { service, jobs } = build({
      repository,
      transport,
      defaultWebhookUrl: 'https://discord.com/api/webhooks/999/aus-der-env',
    });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    await jobs.settled();

    expect(transport.sent[0]?.target.webhookUrl).toBe(
      'https://discord.com/api/webhooks/999/aus-der-env',
    );
  });
});

describe('Fehlgeschlagene Zustellung (Pflichtenheft §14, die zentrale Zusicherung)', () => {
  it('lässt den auslösenden Vorgang nicht scheitern', async () => {
    const channel = testChannel();
    const repository = fakeRepository({
      channels: [channel],
      rules: [testRule({ channelId: channel.id })],
    });
    const { service, jobs } = build({ repository, transport: failingTransport() });

    await expect(
      service.publish(serverEvent('server.crashed', { ownerId: OWNER })),
    ).resolves.toBeUndefined();
    await jobs.settled();

    // Die Inbox ist trotzdem gefüllt, der Fehlversuch steht im Protokoll.
    expect(repository.notifications).toHaveLength(1);
    expect(repository.deliveries[0]?.status).toBe('failed');
    expect(repository.deliveries[0]?.failureCode).toBe('NOTIFICATION_DELIVERY_FAILED');
    expect(repository.channels[0]?.lastFailureCode).toBe('NOTIFICATION_DELIVERY_FAILED');
  });

  it('wiederholt nur bei vorübergehenden Fehlern', async () => {
    const channel = testChannel();
    const repository = fakeRepository({
      channels: [channel],
      rules: [testRule({ channelId: channel.id })],
    });
    const retryable = failingTransport(true);
    const { service, jobs } = build({
      repository,
      transport: retryable,
      deliveryAttempts: 3,
      sleep: () => Promise.resolve(),
    });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    await jobs.settled();

    expect(retryable.attempts()).toBe(3);
    expect(repository.deliveries[0]?.attempts).toBe(3);
  });

  it('wiederholt einen endgültigen Fehler nicht', async () => {
    const channel = testChannel();
    const repository = fakeRepository({
      channels: [channel],
      rules: [testRule({ channelId: channel.id })],
    });
    const permanent = failingTransport(false);
    const { service, jobs } = build({ repository, transport: permanent, deliveryAttempts: 3 });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    await jobs.settled();

    expect(permanent.attempts()).toBe(1);
  });

  /** Auch ein Datenbankfehler darf den Serverstart nicht mitreißen. */
  it('verschluckt auch einen Fehler beim Laden der Regeln', async () => {
    const repository = fakeRepository();

    repository.listEnabledRulesForEvent = () =>
      Promise.reject(new Error('Datenbank nicht erreichbar'));

    const { service } = build({ repository });

    await expect(
      service.publish(serverEvent('server.crashed', { ownerId: OWNER })),
    ).resolves.toBeUndefined();
  });
});

describe('Kanalverwaltung', () => {
  it('lehnt einen doppelten Namen ab', async () => {
    const repository = fakeRepository({ channels: [testChannel({ name: 'Systemkanal' })] });
    const { service } = build({ repository });

    await expect(
      service.createChannel(adminActor(), ADMIN, {
        name: 'systemkanal',
        type: 'discordWebhook',
        target: {},
        enabled: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isNotificationError(error) && error.code === 'NOTIFICATION_CHANNEL_NAME_TAKEN',
    );
  });

  /** Die Webhook-URL verlässt die Anwendung nie – auch nicht im DTO. */
  it('liefert die Webhook-Adresse nie aus, nur eine Kurzform', async () => {
    const repository = fakeRepository({ channels: [testChannel()] });
    const { service } = build({ repository });
    const [dto] = await service.listChannels(adminActor());

    expect(JSON.stringify(dto)).not.toContain('geheim');
    expect(dto?.target.hint).toBe('discord.com/…/heim');
    expect(dto?.target.usesEnvDefault).toBe(false);
  });

  it('meldet einen Kanal ohne Ziel als nicht versandfähig', async () => {
    const repository = fakeRepository({ channels: [testChannel({ webhookUrl: null })] });
    const { service } = build({ repository, defaultWebhookUrl: null });
    const [dto] = await service.listChannels(adminActor());

    expect(dto?.deliverable).toBe(false);
    expect(dto?.target.usesEnvDefault).toBe(true);
  });

  it('löscht keinen Kanal, an dem noch Regeln hängen', async () => {
    const channel = testChannel();
    const repository = fakeRepository({
      channels: [channel],
      rules: [testRule({ channelId: channel.id })],
    });
    const { service } = build({ repository });

    await expect(service.deleteChannel(adminActor(), ADMIN, channel.id)).rejects.toSatisfy(
      (error: unknown) =>
        isNotificationError(error) && error.code === 'NOTIFICATION_CHANNEL_IN_USE',
    );
  });

  it('meldet einen Zustellfehler bei der Testnachricht an den Aufrufer', async () => {
    const channel = testChannel();
    const repository = fakeRepository({ channels: [channel] });
    const { service } = build({ repository, transport: failingTransport() });

    await expect(service.testChannel(channel.id)).rejects.toSatisfy(
      (error: unknown) =>
        isNotificationError(error) && error.code === 'NOTIFICATION_DELIVERY_FAILED',
    );
  });

  it('lehnt die Testnachricht eines Kanals ohne Ziel ab', async () => {
    const channel = testChannel({ webhookUrl: null });
    const repository = fakeRepository({ channels: [channel] });
    const { service } = build({ repository, defaultWebhookUrl: null });

    await expect(service.testChannel(channel.id)).rejects.toSatisfy(
      (error: unknown) =>
        isNotificationError(error) && error.code === 'NOTIFICATION_CHANNEL_NOT_CONFIGURED',
    );
  });

  it('protokolliert Änderungen im Audit-Log, ohne das Geheimnis mitzuschreiben', async () => {
    const audit = recordingAudit();
    const { service } = build({ audit });

    await service.createChannel(adminActor(), ADMIN, {
      name: 'Neuer Kanal',
      type: 'discordWebhook',
      target: { webhookUrl: 'https://discord.com/api/webhooks/1/streng-geheim' },
      enabled: true,
    });

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.action).toBe('notification.channelChanged');
    expect(JSON.stringify(audit.entries)).not.toContain('streng-geheim');
  });
});

describe('Regelverwaltung', () => {
  it('lehnt eine zweite Regel mit derselben Kombination ab', async () => {
    const repository = fakeRepository({
      rules: [testRule({ event: 'server.crashed', recipientScope: 'resourceOwner' })],
    });
    const { service } = build({ repository });

    await expect(
      service.createRule(adminActor(), ADMIN, {
        event: 'server.crashed',
        channelId: null,
        recipientScope: 'resourceOwner',
        recipientRoleId: null,
        inboxEnabled: true,
        severity: null,
        enabled: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isNotificationError(error) && error.code === 'NOTIFICATION_RULE_DUPLICATE',
    );
  });

  it('lehnt eine Regel auf einen unbekannten Kanal ab', async () => {
    const { service } = build();

    await expect(
      service.createRule(adminActor(), ADMIN, {
        event: 'server.crashed',
        channelId: testId('4'),
        recipientScope: 'resourceOwner',
        recipientRoleId: null,
        inboxEnabled: true,
        severity: null,
        enabled: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isNotificationError(error) && error.code === 'NOTIFICATION_CHANNEL_NOT_FOUND',
    );
  });

  /**
   * Beim Ändern entsteht der ungültige Zustand erst aus altem und neuem Stand;
   * die Eingabe-Schemas können ihn dort nicht sehen.
   */
  it('lehnt eine Änderung ab, nach der die Regel niemanden mehr erreichen würde', async () => {
    const repository = fakeRepository({ rules: [testRule({ channelId: null })] });
    const rule = repository.rules[0];
    const { service } = build({ repository });

    await expect(
      service.updateRule(adminActor(), ADMIN, rule?.id ?? '', { inboxEnabled: false }),
    ).rejects.toSatisfy(
      (error: unknown) => isNotificationError(error) && error.code === 'VALIDATION_FAILED',
    );
  });

  it('lehnt den Empfängerkreis „Rolle" ohne Rolle auch beim Ändern ab', async () => {
    const repository = fakeRepository({ rules: [testRule()] });
    const rule = repository.rules[0];
    const { service } = build({ repository });

    await expect(
      service.updateRule(adminActor(), ADMIN, rule?.id ?? '', { recipientScope: 'role' }),
    ).rejects.toSatisfy(
      (error: unknown) => isNotificationError(error) && error.code === 'VALIDATION_FAILED',
    );
  });

  it('löst den Klartext-Namen der Zielrolle in der Übersicht auf (Gefundener Punkt 84)', async () => {
    const repository = fakeRepository({
      rules: [testRule({ recipientScope: 'role', recipientRoleId: ROLE_ID })],
    });
    const { service } = build({
      repository,
      roles: fakeRoleLookup({ [ROLE_ID]: 'Administratoren' }),
    });

    const rules = await service.listRules(adminActor());

    expect(rules[0]?.recipientRoleId).toBe(ROLE_ID);
    expect(rules[0]?.recipientRoleName).toBe('Administratoren');
  });

  it('liefert bei entfernter oder unbekannter Rolle weiterhin null ohne Fehler', async () => {
    const repository = fakeRepository({
      rules: [testRule({ recipientScope: 'role', recipientRoleId: ROLE_ID })],
    });
    // Nachschlag ohne Eintrag für diese Id – die Rolle wurde entfernt.
    const { service } = build({ repository, roles: fakeRoleLookup({}) });

    const rules = await service.listRules(adminActor());

    expect(rules[0]?.recipientRoleId).toBe(ROLE_ID);
    expect(rules[0]?.recipientRoleName).toBeNull();
  });

  it('gibt den Rollennamen auch beim Anlegen und Ändern einer Regel zurück', async () => {
    const { service } = build({ roles: fakeRoleLookup({ [ROLE_ID]: 'Moderatoren' }) });

    const created = await service.createRule(adminActor(), ADMIN, {
      event: 'server.crashed',
      channelId: null,
      recipientScope: 'role',
      recipientRoleId: ROLE_ID,
      inboxEnabled: true,
      severity: null,
      enabled: true,
    });

    expect(created.recipientRoleName).toBe('Moderatoren');

    const updated = await service.updateRule(adminActor(), ADMIN, created.id, { enabled: false });

    expect(updated.recipientRoleName).toBe('Moderatoren');
  });

  it('bleibt ohne durchgereichten Rollen-Nachschlag bei null', async () => {
    const repository = fakeRepository({
      rules: [testRule({ recipientScope: 'role', recipientRoleId: ROLE_ID })],
    });
    // Kein `roles` in den Optionen: der Standard-Nachschlag liefert nichts.
    const { service } = build({ repository });

    const rules = await service.listRules(adminActor());

    expect(rules[0]?.recipientRoleName).toBeNull();
  });
});

describe('Inbox', () => {
  it('zeigt nur die eigenen Meldungen', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { service } = build({ repository });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    await service.publish(serverEvent('server.crashed', { ownerId: MEMBER }));

    const page = await service.listInbox(OWNER, { unreadOnly: false, limit: 25, offset: 0 });

    expect(page.total).toBe(1);
    expect(page.entries[0]?.userId).toBe(OWNER);
    expect(page.unreadCount).toBe(1);
  });

  it('markiert ohne Id-Liste alles als gelesen', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { service } = build({ repository });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));

    await expect(service.markRead(OWNER, { read: true })).resolves.toBe(2);
    await expect(service.countUnread(OWNER)).resolves.toBe(0);
  });

  /** Eine fremde Meldung verhält sich wie eine nicht vorhandene. */
  it('löscht keine fremde Meldung und verrät nicht, dass es sie gibt', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { service } = build({ repository });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    const foreignId = repository.notifications[0]?.id ?? '';

    await expect(service.deleteNotification(MEMBER, foreignId)).rejects.toSatisfy(
      (error: unknown) => isNotificationError(error) && error.code === 'NOTIFICATION_NOT_FOUND',
    );
    expect(repository.notifications).toHaveLength(1);
  });

  it('markiert keine fremde Meldung, auch wenn ihre Id mitgeschickt wird', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { service } = build({ repository });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));
    const foreignId = repository.notifications[0]?.id ?? '';

    await expect(service.markRead(MEMBER, { ids: [foreignId], read: true })).resolves.toBe(0);
    expect(repository.notifications[0]?.readAt).toBeNull();
  });

  it('gibt nur dem Empfänger die Rechte an seiner Meldung', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { service } = build({ repository });

    await service.publish(serverEvent('server.crashed', { ownerId: OWNER }));

    const own = await service.listInbox(OWNER, { unreadOnly: false, limit: 25, offset: 0 });

    expect(own.entries[0]?.permissions).toEqual({ canMarkRead: true, canDelete: true });
  });
});

describe('Systemweite Ankündigungen (Lastenheft §3.6)', () => {
  it('erreicht alle freigeschalteten Konten, auch ohne Regel', async () => {
    const repository = fakeRepository();
    const { service } = build({ repository });

    const announcement = await service.publishAnnouncement(adminActor(), ADMIN, {
      title: 'Wartung',
      body: 'Am Sonntag ab 02:00 Uhr.',
      severity: 'warning',
      expiresAt: null,
    });

    expect(announcement.recipientCount).toBe(3);
    expect(repository.notifications.map((entry) => entry.userId).sort()).toEqual(
      [ADMIN, MEMBER, OWNER].sort(),
    );
    expect(repository.notifications[0]?.severity).toBe('warning');
  });

  /** Doppelte Inbox-Meldungen verhindert der Unique-Index der Migration. */
  it('erzeugt je Konto höchstens eine Meldung, auch mit passender Regel', async () => {
    const repository = fakeRepository({
      rules: [testRule({ event: 'announcement.published', recipientScope: 'allUsers' })],
    });
    const { service } = build({ repository });

    await service.publishAnnouncement(adminActor(), ADMIN, {
      title: 'Wartung',
      body: 'Am Sonntag ab 02:00 Uhr.',
      severity: 'info',
      expiresAt: null,
    });

    expect(repository.notifications.filter((entry) => entry.userId === OWNER)).toHaveLength(1);
  });

  it('schickt eine Ankündigung zusätzlich an den externen Kanal', async () => {
    const channel = testChannel();
    const repository = fakeRepository({
      channels: [channel],
      rules: [
        testRule({
          event: 'announcement.published',
          recipientScope: 'allUsers',
          channelId: channel.id,
        }),
      ],
    });
    const transport = recordingTransport();
    const { service, jobs } = build({ repository, transport });

    await service.publishAnnouncement(adminActor(), ADMIN, {
      title: 'Wartung',
      body: 'Am Sonntag ab 02:00 Uhr.',
      severity: 'info',
      expiresAt: null,
    });
    await jobs.settled();

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.message.title).toBe('Wartung');
  });

  it('nimmt eine zurückgezogene Ankündigung aus den Inboxen', async () => {
    const repository = fakeRepository();
    const { service } = build({ repository });
    const announcement = await service.publishAnnouncement(adminActor(), ADMIN, {
      title: 'Wartung',
      body: 'Am Sonntag ab 02:00 Uhr.',
      severity: 'info',
      expiresAt: null,
    });

    await service.deleteAnnouncement(adminActor(), ADMIN, announcement.id);

    expect(repository.announcements).toHaveLength(0);
    expect(repository.notifications).toHaveLength(0);
  });

  /** Eine Korrektur am Banner darf nicht ändern, was jemand gestern gelesen hat. */
  it('lässt bereits zugestellte Meldungen bei einer Korrektur unverändert', async () => {
    const repository = fakeRepository();
    const { service } = build({ repository });
    const announcement = await service.publishAnnouncement(adminActor(), ADMIN, {
      title: 'Wartung',
      body: 'Am Sonntag ab 02:00 Uhr.',
      severity: 'info',
      expiresAt: null,
    });

    await service.updateAnnouncement(adminActor(), ADMIN, announcement.id, {
      title: 'Wartung verschoben',
    });

    expect(repository.notifications[0]?.title).toBe('Wartung');
  });

  it('meldet eine unbekannte Ankündigung als nicht vorhanden', async () => {
    const { service } = build();

    await expect(service.deleteAnnouncement(adminActor(), ADMIN, testId('7'))).rejects.toSatisfy(
      (error: unknown) => isNotificationError(error) && error.code === 'ANNOUNCEMENT_NOT_FOUND',
    );
  });
});
