/**
 * Testdoubles der Notification-Engine.
 *
 * Bewusst eine eigene Datei statt Fakes in jeder Testdatei: Service-, Routen-
 * und Live-Tests arbeiten auf demselben Bestand, und zwei leicht verschiedene
 * Nachbauten desselben Repositories wären eine Fehlerquelle für sich. Die Datei
 * wird **nicht** aus `index.ts` re-exportiert – sie gehört zu den Tests, nicht
 * zur Schnittstelle des Moduls.
 */

import type {
  NotifiableEventName,
  NotificationEvent,
  NotificationSeverity,
} from '@palantir/contracts';
import { type PermissionActor, buildPermissionActor } from '../rbac/index.js';
import type {
  NotificationTransport,
  OutboundMessage,
  RecipientDirectory,
  ResolvedChannelTarget,
  RoleNameLookup,
} from './ports.js';
import { NotificationTransportError } from './ports.js';
import type {
  AnnouncementRecord,
  CreateAnnouncementData,
  CreateChannelData,
  CreateNotificationData,
  CreateRuleData,
  DeliveryOutcome,
  NotificationChannelRecord,
  NotificationDeliveryRecord,
  NotificationFilter,
  NotificationPreferencesRecord,
  NotificationRecord,
  NotificationRepository,
  NotificationRuleRecord,
  UpdateAnnouncementData,
  UpdateChannelData,
  UpdateRuleData,
} from './repository.js';

let nextId = 0;

/** Fortlaufende, aber UUID-förmige Ids – die Routen prüfen auf UUID-Format. */
export function testId(prefix = '0'): string {
  nextId += 1;

  return `${prefix.repeat(8).slice(0, 8)}-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

/** Handelnder mit `notification.manage` – die einzige Permission des Moduls. */
export function adminActor(): PermissionActor {
  return buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['notification.manage'] }],
  });
}

/** Handelnder ohne jedes Recht – für die Prüfung der Guards. */
export function plainActor(): PermissionActor {
  return buildPermissionActor({ isOwner: false, roles: [] });
}

export function serverEvent(
  event: Extract<NotifiableEventName, `server.${string}`> = 'server.crashed',
  overrides: Partial<{
    serverId: string;
    serverName: string;
    ownerId: string;
    memberUserIds: string[];
    detail: string | null;
    at: string;
    actorId: string | null;
  }> = {},
): NotificationEvent {
  return {
    event,
    payload: {
      at: '2026-08-26T12:00:00.000Z',
      actorId: null,
      serverId: testId('1'),
      serverName: 'Wüstensturm',
      ownerId: testId('2'),
      memberUserIds: [],
      detail: null,
      ...overrides,
    },
  } as NotificationEvent;
}

export function testChannel(
  overrides: Partial<NotificationChannelRecord> = {},
): NotificationChannelRecord {
  return {
    id: testId('4'),
    name: 'Systemkanal',
    type: 'discordWebhook',
    webhookUrl: 'https://discord.com/api/webhooks/123456/geheim',
    username: null,
    enabled: true,
    lastDeliveryAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
    updatedAt: new Date('2026-08-26T00:00:00.000Z'),
    ...overrides,
  };
}

export function testRule(overrides: Partial<NotificationRuleRecord> = {}): NotificationRuleRecord {
  return {
    id: testId('5'),
    event: 'server.crashed',
    channelId: null,
    recipientScope: 'resourceOwner',
    recipientRoleId: null,
    inboxEnabled: true,
    severity: null,
    enabled: true,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
    updatedAt: new Date('2026-08-26T00:00:00.000Z'),
    ...overrides,
  };
}

/** Verzeichnis mit festem Bestand – ohne Datenbank. */
export function fakeDirectory(
  options: {
    activeUserIds?: string[];
    roleMembers?: Record<string, string[]>;
    displayNames?: Record<string, string>;
  } = {},
): RecipientDirectory {
  return {
    listActiveUserIds: () => Promise.resolve([...(options.activeUserIds ?? [])]),
    listUserIdsWithRole: (roleId) => Promise.resolve([...(options.roleMembers?.[roleId] ?? [])]),
    findDisplayNames: (userIds) =>
      Promise.resolve(
        new Map(
          userIds
            .map((id): [string, string] | null => {
              const name = options.displayNames?.[id];

              return name === undefined ? null : [id, name];
            })
            .filter((entry): entry is [string, string] => entry !== null),
        ),
      ),
  };
}

/**
 * Rollen-Nachschlag mit festem Bestand – ohne B2 und ohne Datenbank.
 *
 * Bildet die Zusicherung des Ports nach: Unbekannte Ids fehlen schlicht in der
 * Rückgabe, der Aufrufer behandelt sie als `null`.
 */
export function fakeRoleLookup(names: Record<string, string> = {}): RoleNameLookup {
  return {
    findRoleNames: (roleIds) =>
      Promise.resolve(
        new Map(
          roleIds
            .map((id): [string, string] | null => {
              const name = names[id];

              return name === undefined ? null : [id, name];
            })
            .filter((entry): entry is [string, string] => entry !== null),
        ),
      ),
  };
}

export interface RecordingTransport extends NotificationTransport {
  readonly sent: { target: ResolvedChannelTarget; message: OutboundMessage }[];
}

/** Transport, der mitschreibt statt zu senden. */
export function recordingTransport(): RecordingTransport {
  const sent: { target: ResolvedChannelTarget; message: OutboundMessage }[] = [];

  return {
    sent,
    send(target, message) {
      sent.push({ target, message });

      return Promise.resolve();
    },
  };
}

/**
 * Transport, der immer scheitert.
 *
 * Trägt die zentrale Prüfung dieses Moduls: Ein solcher Kanal darf den
 * auslösenden Vorgang nicht scheitern lassen (Pflichtenheft §14).
 */
export function failingTransport(retryable = false): NotificationTransport & {
  attempts: () => number;
} {
  let attempts = 0;

  return {
    attempts: () => attempts,
    send() {
      attempts += 1;

      return Promise.reject(
        new NotificationTransportError(
          'NOTIFICATION_DELIVERY_FAILED',
          'Der Kanal war nicht erreichbar.',
          retryable,
        ),
      );
    },
  };
}

/**
 * Repository im Arbeitsspeicher.
 *
 * Bildet die Regeln nach, die in der Datenbank als Index stehen: eindeutige
 * Kanalnamen ohne Rücksicht auf Groß-/Kleinschreibung und höchstens eine
 * Inbox-Meldung je Ankündigung und Konto.
 */
export interface FakeRepository extends NotificationRepository {
  readonly channels: NotificationChannelRecord[];
  readonly rules: NotificationRuleRecord[];
  readonly notifications: NotificationRecord[];
  readonly announcements: AnnouncementRecord[];
  readonly deliveries: NotificationDeliveryRecord[];
}

export function fakeRepository(
  seed: {
    channels?: NotificationChannelRecord[];
    rules?: NotificationRuleRecord[];
    notifications?: NotificationRecord[];
  } = {},
): FakeRepository {
  const channels: NotificationChannelRecord[] = [...(seed.channels ?? [])];
  const rules: NotificationRuleRecord[] = [...(seed.rules ?? [])];
  const notifications: NotificationRecord[] = [...(seed.notifications ?? [])];
  const announcements: AnnouncementRecord[] = [];
  const deliveries: NotificationDeliveryRecord[] = [];
  const preferences = new Map<string, NotificationPreferencesRecord>();
  const now = new Date('2026-08-26T12:00:00.000Z');

  function replaceChannel(index: number, next: NotificationChannelRecord): void {
    channels.splice(index, 1, next);
  }

  return {
    channels,
    rules,
    notifications,
    announcements,
    deliveries,

    listChannels: () => Promise.resolve([...channels]),
    findChannelById: (id) => Promise.resolve(channels.find((c) => c.id === id) ?? null),
    findChannelByName: (name) =>
      Promise.resolve(channels.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null),

    createChannel: (data: CreateChannelData) => {
      const record = testChannel({ ...data, id: testId('4') });

      channels.push(record);

      return Promise.resolve(record);
    },

    updateChannel: (id, data: UpdateChannelData) => {
      const index = channels.findIndex((c) => c.id === id);

      if (index < 0) {
        return Promise.resolve(null);
      }

      const next = { ...channels[index], ...data, updatedAt: now } as NotificationChannelRecord;

      replaceChannel(index, next);

      return Promise.resolve(next);
    },

    deleteChannel: (id) => {
      const index = channels.findIndex((c) => c.id === id);

      if (index >= 0) {
        channels.splice(index, 1);
      }

      return Promise.resolve();
    },

    recordChannelOutcome: (id, outcome) => {
      const index = channels.findIndex((c) => c.id === id);

      if (index < 0) {
        return Promise.resolve();
      }

      replaceChannel(index, {
        ...channels[index],
        ...(outcome.status === 'delivered'
          ? { lastDeliveryAt: outcome.at, lastFailureCode: null, lastFailureMessage: null }
          : { lastFailureCode: outcome.code, lastFailureMessage: outcome.message }),
      } as NotificationChannelRecord);

      return Promise.resolve();
    },

    countRulesPerChannel: () => {
      const counts = new Map<string, number>();

      for (const rule of rules) {
        if (rule.channelId !== null) {
          counts.set(rule.channelId, (counts.get(rule.channelId) ?? 0) + 1);
        }
      }

      return Promise.resolve(counts);
    },

    listRules: () => Promise.resolve([...rules]),
    listEnabledRulesForEvent: (event) =>
      Promise.resolve(rules.filter((rule) => rule.event === event && rule.enabled)),
    findRuleById: (id) => Promise.resolve(rules.find((rule) => rule.id === id) ?? null),

    findMatchingRule: (data) =>
      Promise.resolve(
        rules.find(
          (rule) =>
            rule.event === data.event &&
            rule.channelId === data.channelId &&
            rule.recipientScope === data.recipientScope &&
            rule.recipientRoleId === data.recipientRoleId,
        ) ?? null,
      ),

    createRule: (data: CreateRuleData) => {
      const record = testRule({ ...data, id: testId('5') });

      rules.push(record);

      return Promise.resolve(record);
    },

    updateRule: (id, data: UpdateRuleData) => {
      const index = rules.findIndex((rule) => rule.id === id);

      if (index < 0) {
        return Promise.resolve(null);
      }

      const next = { ...rules[index], ...data, updatedAt: now } as NotificationRuleRecord;

      rules.splice(index, 1, next);

      return Promise.resolve(next);
    },

    deleteRule: (id) => {
      const index = rules.findIndex((rule) => rule.id === id);

      if (index >= 0) {
        rules.splice(index, 1);
      }

      return Promise.resolve();
    },

    createNotifications: (data: readonly CreateNotificationData[]) => {
      const created: NotificationRecord[] = [];

      for (const entry of data) {
        // Der Unique-Index `notifications_announcement_user_idx` aus der
        // Migration – hier nachgebildet, damit die Doppelzustellung einer
        // Ankündigung auch im Test nicht entstehen kann.
        const duplicate =
          entry.announcementId !== null &&
          notifications.some(
            (existing) =>
              existing.announcementId === entry.announcementId && existing.userId === entry.userId,
          );

        if (duplicate) {
          continue;
        }

        const record: NotificationRecord = {
          id: testId('6'),
          readAt: null,
          createdAt: now,
          ...entry,
        };

        notifications.push(record);
        created.push(record);
      }

      return Promise.resolve(created);
    },

    listNotifications: (filter: NotificationFilter) => {
      const mine = notifications.filter((entry) => entry.userId === filter.userId);
      const matching = mine.filter(
        (entry) =>
          (!filter.unreadOnly || entry.readAt === null) &&
          (filter.event === undefined || entry.event === filter.event) &&
          (filter.severity === undefined || entry.severity === filter.severity),
      );

      return Promise.resolve({
        entries: matching.slice(filter.offset, filter.offset + filter.limit),
        total: matching.length,
        unreadCount: mine.filter((entry) => entry.readAt === null).length,
      });
    },

    findNotificationById: (id) =>
      Promise.resolve(notifications.find((entry) => entry.id === id) ?? null),

    markRead: (userId, ids, read) => {
      let changed = 0;

      for (const [index, entry] of notifications.entries()) {
        if (entry.userId !== userId) {
          continue;
        }

        if (ids !== null && !ids.includes(entry.id)) {
          continue;
        }

        if (read === (entry.readAt !== null)) {
          continue;
        }

        notifications.splice(index, 1, { ...entry, readAt: read ? now : null });
        changed += 1;
      }

      return Promise.resolve(changed);
    },

    deleteNotification: (id) => {
      const index = notifications.findIndex((entry) => entry.id === id);

      if (index >= 0) {
        notifications.splice(index, 1);
      }

      return Promise.resolve();
    },

    countUnread: (userId) =>
      Promise.resolve(
        notifications.filter((entry) => entry.userId === userId && entry.readAt === null).length,
      ),

    // Persoenliche Zustell-Einstellung (Gefundener Punkt 93)
    findPreferences: (userId) =>
      Promise.resolve(preferences.get(userId) ?? { userId, mutedEvents: [], updatedAt: null }),

    savePreferences: (userId, mutedEvents) => {
      const eintrag = { userId, mutedEvents: [...mutedEvents], updatedAt: new Date() };
      preferences.set(userId, eintrag);

      return Promise.resolve(eintrag);
    },

    findMutedRecipients: (userIds, event) =>
      Promise.resolve(
        new Set(
          userIds.filter((userId) => preferences.get(userId)?.mutedEvents.includes(event) === true),
        ),
      ),

    listAnnouncements: () => Promise.resolve([...announcements]),
    findAnnouncementById: (id) =>
      Promise.resolve(announcements.find((entry) => entry.id === id) ?? null),

    createAnnouncement: (data: CreateAnnouncementData) => {
      const record: AnnouncementRecord = {
        id: testId('7'),
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
        ...data,
      };

      announcements.push(record);

      return Promise.resolve(record);
    },

    updateAnnouncement: (id, data: UpdateAnnouncementData) => {
      const index = announcements.findIndex((entry) => entry.id === id);

      if (index < 0) {
        return Promise.resolve(null);
      }

      const next = { ...announcements[index], ...data, updatedAt: now } as AnnouncementRecord;

      announcements.splice(index, 1, next);

      return Promise.resolve(next);
    },

    deleteAnnouncement: (id) => {
      const index = announcements.findIndex((entry) => entry.id === id);

      if (index >= 0) {
        announcements.splice(index, 1);
      }

      // Der Fremdschlüssel `on delete cascade` aus der Migration.
      for (let i = notifications.length - 1; i >= 0; i -= 1) {
        if (notifications[i]?.announcementId === id) {
          notifications.splice(i, 1);
        }
      }

      return Promise.resolve();
    },

    countNotificationsPerAnnouncement: () => {
      const counts = new Map<string, number>();

      for (const entry of notifications) {
        if (entry.announcementId !== null) {
          counts.set(entry.announcementId, (counts.get(entry.announcementId) ?? 0) + 1);
        }
      }

      return Promise.resolve(counts);
    },

    startDelivery: (data) => {
      const record: NotificationDeliveryRecord = {
        id: testId('8'),
        status: 'pending',
        attempts: 0,
        failureCode: null,
        failureMessage: null,
        createdAt: now,
        deliveredAt: null,
        ...data,
      };

      deliveries.push(record);

      return Promise.resolve(record);
    },

    finishDelivery: (id, outcome: DeliveryOutcome) => {
      const index = deliveries.findIndex((entry) => entry.id === id);

      if (index >= 0) {
        deliveries.splice(index, 1, {
          ...deliveries[index],
          ...outcome,
        } as NotificationDeliveryRecord);
      }

      return Promise.resolve();
    },

    listDeliveries: (limit) => Promise.resolve(deliveries.slice(0, limit)),
  };
}

/** Dringlichkeit einer Meldung – Kurzform für Erwartungen im Test. */
export function severitiesOf(records: readonly NotificationRecord[]): NotificationSeverity[] {
  return records.map((record) => record.severity);
}
