/**
 * Drizzle-Umsetzung der Datenzugriffe der Notification-Engine.
 *
 * Enthält ausschließlich Datenzugriff – jede fachliche Regel (Regelauswertung,
 * Empfängerkreis, Rechteprüfung, Textbildung) liegt in `service.ts`,
 * `recipients.ts` und `messages.ts`. Die Schnittstellen darüber
 * ({@link NotificationRepository}, {@link RecipientDirectory}) machen den
 * Service ohne Datenbank testbar (CLAUDE.md §4).
 */

import { GUEST_ROLE_NAME } from '@palantir/contracts';
import type {
  ErrorCode,
  NotifiableEventName,
  NotificationChannelType,
  NotificationDeliveryStatus,
  NotificationRecipientScope,
  NotificationSeverity,
  NotificationSubjectType,
} from '@palantir/contracts';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import {
  announcements,
  notificationChannels,
  notificationDeliveries,
  notificationPreferences,
  notificationRules,
  notifications,
} from '../../db/schema/notifications.js';
import { roles, userRoles } from '../../db/schema/rbac.js';
import { users } from '../../db/schema/users.js';
import type { RecipientDirectory } from './ports.js';

// ---------------------------------------------------------------------------
// Datensätze
// ---------------------------------------------------------------------------

/**
 * Kanal, wie ihn der Service sieht.
 *
 * Trägt die Webhook-URL – sie verlässt die Anwendung nie (das DTO in `dto.ts`
 * lässt sie weg), wird für den Versand aber gebraucht.
 */
export interface NotificationChannelRecord {
  readonly id: string;
  readonly name: string;
  readonly type: NotificationChannelType;
  /** `null` = Kanal nutzt `DISCORD_WEBHOOK_URL` aus der zentralen `.env`. */
  readonly webhookUrl: string | null;
  readonly username: string | null;
  readonly enabled: boolean;
  readonly lastDeliveryAt: Date | null;
  readonly lastFailureCode: string | null;
  readonly lastFailureMessage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NotificationRuleRecord {
  readonly id: string;
  readonly event: NotifiableEventName;
  readonly channelId: string | null;
  readonly recipientScope: NotificationRecipientScope;
  readonly recipientRoleId: string | null;
  readonly inboxEnabled: boolean;
  /** `null` = die Dringlichkeit des Ereignisses übernehmen. */
  readonly severity: NotificationSeverity | null;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NotificationRecord {
  readonly id: string;
  readonly userId: string;
  readonly event: NotifiableEventName;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
  readonly subjectType: NotificationSubjectType | null;
  readonly subjectId: string | null;
  readonly subjectName: string | null;
  readonly data: Record<string, unknown>;
  readonly ruleId: string | null;
  readonly announcementId: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface AnnouncementRecord {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly severity: NotificationSeverity;
  readonly publishedByUserId: string | null;
  readonly publishedAt: Date;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NotificationDeliveryRecord {
  readonly id: string;
  readonly channelId: string;
  readonly ruleId: string | null;
  readonly event: NotifiableEventName;
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
}

// ---------------------------------------------------------------------------
// Eingabedaten
// ---------------------------------------------------------------------------

export interface CreateChannelData {
  readonly name: string;
  readonly type: NotificationChannelType;
  readonly webhookUrl: string | null;
  readonly username: string | null;
  readonly enabled: boolean;
}

export interface UpdateChannelData {
  readonly name?: string;
  readonly webhookUrl?: string | null;
  readonly username?: string | null;
  readonly enabled?: boolean;
}

export interface CreateRuleData {
  readonly event: NotifiableEventName;
  readonly channelId: string | null;
  readonly recipientScope: NotificationRecipientScope;
  readonly recipientRoleId: string | null;
  readonly inboxEnabled: boolean;
  readonly severity: NotificationSeverity | null;
  readonly enabled: boolean;
}

export interface UpdateRuleData {
  readonly channelId?: string | null;
  readonly recipientScope?: NotificationRecipientScope;
  readonly recipientRoleId?: string | null;
  readonly inboxEnabled?: boolean;
  readonly severity?: NotificationSeverity | null;
  readonly enabled?: boolean;
}

export interface CreateNotificationData {
  readonly userId: string;
  readonly event: NotifiableEventName;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
  readonly subjectType: NotificationSubjectType | null;
  readonly subjectId: string | null;
  readonly subjectName: string | null;
  readonly data: Record<string, unknown>;
  readonly ruleId: string | null;
  readonly announcementId: string | null;
}

export interface NotificationFilter {
  readonly userId: string;
  readonly unreadOnly: boolean;
  readonly event?: NotifiableEventName;
  readonly severity?: NotificationSeverity;
  readonly limit: number;
  readonly offset: number;
}

export interface NotificationPage {
  readonly entries: NotificationRecord[];
  readonly total: number;
  readonly unreadCount: number;
}

export interface CreateAnnouncementData {
  readonly title: string;
  readonly body: string;
  readonly severity: NotificationSeverity;
  readonly publishedByUserId: string | null;
  readonly expiresAt: Date | null;
}

export interface UpdateAnnouncementData {
  readonly title?: string;
  readonly body?: string;
  readonly severity?: NotificationSeverity;
  readonly expiresAt?: Date | null;
}

export interface DeliveryOutcome {
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly failureCode: ErrorCode | null;
  readonly failureMessage: string | null;
  readonly deliveredAt: Date | null;
}

// ---------------------------------------------------------------------------
// Schnittstelle
// ---------------------------------------------------------------------------

export interface NotificationRepository {
  // Kanäle
  listChannels(): Promise<NotificationChannelRecord[]>;
  findChannelById(channelId: string): Promise<NotificationChannelRecord | null>;
  findChannelByName(name: string): Promise<NotificationChannelRecord | null>;
  createChannel(data: CreateChannelData): Promise<NotificationChannelRecord>;
  updateChannel(
    channelId: string,
    data: UpdateChannelData,
  ): Promise<NotificationChannelRecord | null>;
  deleteChannel(channelId: string): Promise<void>;
  /**
   * Hält den Zustellstand am Kanal fest (`lastDeliveryAt`, `lastFailureCode`).
   *
   * Bewusst getrennt von {@link NotificationRepository.updateChannel}: Das ist
   * kein Bearbeiten durch einen Admin, sondern eine Beobachtung des Betriebs –
   * sie soll `updatedAt` nicht anfassen und keinen Namenskonflikt auslösen.
   */
  recordChannelOutcome(
    channelId: string,
    outcome:
      { status: 'delivered'; at: Date } | { status: 'failed'; code: ErrorCode; message: string },
  ): Promise<void>;
  /** Anzahl Regeln je Kanal – trägt `NotificationChannelDto.ruleCount`. */
  countRulesPerChannel(): Promise<ReadonlyMap<string, number>>;

  // Regeln
  listRules(): Promise<NotificationRuleRecord[]>;
  /** Aktive Regeln zu einem Ereignis – der heiße Pfad beim Auslösen. */
  listEnabledRulesForEvent(event: NotifiableEventName): Promise<NotificationRuleRecord[]>;
  findRuleById(ruleId: string): Promise<NotificationRuleRecord | null>;
  findMatchingRule(data: {
    event: NotifiableEventName;
    channelId: string | null;
    recipientScope: NotificationRecipientScope;
    recipientRoleId: string | null;
  }): Promise<NotificationRuleRecord | null>;
  createRule(data: CreateRuleData): Promise<NotificationRuleRecord>;
  updateRule(ruleId: string, data: UpdateRuleData): Promise<NotificationRuleRecord | null>;
  deleteRule(ruleId: string): Promise<void>;

  // Inbox
  /** Legt mehrere Meldungen auf einmal an; leere Eingabe erzeugt nichts. */
  createNotifications(data: readonly CreateNotificationData[]): Promise<NotificationRecord[]>;
  listNotifications(filter: NotificationFilter): Promise<NotificationPage>;
  findNotificationById(notificationId: string): Promise<NotificationRecord | null>;
  /** Setzt den Lesestatus; ohne `ids` gilt der Vorgang für alle Meldungen des Kontos. */
  markRead(userId: string, ids: readonly string[] | null, read: boolean): Promise<number>;
  deleteNotification(notificationId: string): Promise<void>;
  countUnread(userId: string): Promise<number>;

  // Persönliche Zustell-Einstellung (Gefundener Punkt 93)
  /** Abbestellte Ereignisse eines Kontos; leere Liste, solange nichts gesetzt wurde. */
  findPreferences(userId: string): Promise<NotificationPreferencesRecord>;
  /** Ersetzt die abbestellten Ereignisse vollständig. */
  savePreferences(
    userId: string,
    mutedEvents: readonly NotifiableEventName[],
  ): Promise<NotificationPreferencesRecord>;
  /**
   * Von welchen der genannten Konten ist dieses Ereignis abbestellt?
   *
   * Eine Abfrage statt einer je Empfänger: Ein Ereignis kann hunderte
   * Empfänger haben, und der Versand soll nicht an der Zahl der Abfragen
   * hängen.
   */
  findMutedRecipients(
    userIds: readonly string[],
    event: NotifiableEventName,
  ): Promise<ReadonlySet<string>>;

  // Ankündigungen
  listAnnouncements(): Promise<AnnouncementRecord[]>;
  findAnnouncementById(announcementId: string): Promise<AnnouncementRecord | null>;
  createAnnouncement(data: CreateAnnouncementData): Promise<AnnouncementRecord>;
  updateAnnouncement(
    announcementId: string,
    data: UpdateAnnouncementData,
  ): Promise<AnnouncementRecord | null>;
  deleteAnnouncement(announcementId: string): Promise<void>;
  countNotificationsPerAnnouncement(): Promise<ReadonlyMap<string, number>>;

  // Zustellung nach außen
  startDelivery(data: {
    channelId: string;
    ruleId: string | null;
    event: NotifiableEventName;
  }): Promise<NotificationDeliveryRecord>;
  finishDelivery(deliveryId: string, outcome: DeliveryOutcome): Promise<void>;
  listDeliveries(limit: number): Promise<NotificationDeliveryRecord[]>;
}

/** Zustell-Einstellung eines Kontos (Gefundener Punkt 93). */
export interface NotificationPreferencesRecord {
  readonly userId: string;
  readonly mutedEvents: readonly NotifiableEventName[];
  /** `null`, solange das Konto nichts gespeichert hat. */
  readonly updatedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Umsetzung
// ---------------------------------------------------------------------------

type ChannelRow = typeof notificationChannels.$inferSelect;
type RuleRow = typeof notificationRules.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;
type AnnouncementRow = typeof announcements.$inferSelect;
type DeliveryRow = typeof notificationDeliveries.$inferSelect;

function toChannel(row: ChannelRow): NotificationChannelRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    webhookUrl: row.webhookUrl,
    username: row.username,
    enabled: row.enabled,
    lastDeliveryAt: row.lastDeliveryAt,
    lastFailureCode: row.lastFailureCode,
    lastFailureMessage: row.lastFailureMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRule(row: RuleRow): NotificationRuleRecord {
  return {
    id: row.id,
    event: row.event,
    channelId: row.channelId,
    recipientScope: row.recipientScope,
    recipientRoleId: row.recipientRoleId,
    inboxEnabled: row.inboxEnabled,
    severity: row.severity,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    event: row.event,
    severity: row.severity,
    title: row.title,
    body: row.body,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    data: row.data,
    ruleId: row.ruleId,
    announcementId: row.announcementId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

function toAnnouncement(row: AnnouncementRow): AnnouncementRecord {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    publishedByUserId: row.publishedByUserId,
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDelivery(row: DeliveryRow): NotificationDeliveryRecord {
  return {
    id: row.id,
    channelId: row.channelId,
    ruleId: row.ruleId,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
  };
}

export function createDrizzleNotificationRepository(db: Database): NotificationRepository {
  return {
    async listChannels() {
      const rows = await db.select().from(notificationChannels).orderBy(notificationChannels.name);

      return rows.map(toChannel);
    },

    async findChannelById(channelId) {
      const [row] = await db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, channelId))
        .limit(1);

      return row ? toChannel(row) : null;
    },

    async findChannelByName(name) {
      // Ohne Rücksicht auf Groß-/Kleinschreibung – wie der Unique-Index.
      const [row] = await db
        .select()
        .from(notificationChannels)
        .where(sql`lower(${notificationChannels.name}) = lower(${name})`)
        .limit(1);

      return row ? toChannel(row) : null;
    },

    async createChannel(data) {
      const [row] = await db.insert(notificationChannels).values(data).returning();

      if (!row) {
        throw new Error('Der Benachrichtigungskanal konnte nicht angelegt werden.');
      }

      return toChannel(row);
    },

    async updateChannel(channelId, data) {
      const [row] = await db
        .update(notificationChannels)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationChannels.id, channelId))
        .returning();

      return row ? toChannel(row) : null;
    },

    async deleteChannel(channelId) {
      await db.delete(notificationChannels).where(eq(notificationChannels.id, channelId));
    },

    async recordChannelOutcome(channelId, outcome) {
      await db
        .update(notificationChannels)
        .set(
          outcome.status === 'delivered'
            ? { lastDeliveryAt: outcome.at, lastFailureCode: null, lastFailureMessage: null }
            : { lastFailureCode: outcome.code, lastFailureMessage: outcome.message },
        )
        .where(eq(notificationChannels.id, channelId));
    },

    async countRulesPerChannel() {
      const rows = await db
        .select({ channelId: notificationRules.channelId, value: count() })
        .from(notificationRules)
        .groupBy(notificationRules.channelId);

      const result = new Map<string, number>();

      for (const row of rows) {
        // Regeln ohne Kanal („nur Inbox") zählen bei keinem Kanal mit.
        if (row.channelId !== null) {
          result.set(row.channelId, Number(row.value));
        }
      }

      return result;
    },

    async listRules() {
      const rows = await db
        .select()
        .from(notificationRules)
        .orderBy(notificationRules.event, notificationRules.createdAt);

      return rows.map(toRule);
    },

    async listEnabledRulesForEvent(event) {
      const rows = await db
        .select()
        .from(notificationRules)
        .where(and(eq(notificationRules.event, event), eq(notificationRules.enabled, true)));

      return rows.map(toRule);
    },

    async findRuleById(ruleId) {
      const [row] = await db
        .select()
        .from(notificationRules)
        .where(eq(notificationRules.id, ruleId))
        .limit(1);

      return row ? toRule(row) : null;
    },

    async findMatchingRule(data) {
      const [row] = await db
        .select()
        .from(notificationRules)
        .where(
          and(
            eq(notificationRules.event, data.event),
            data.channelId === null
              ? isNull(notificationRules.channelId)
              : eq(notificationRules.channelId, data.channelId),
            eq(notificationRules.recipientScope, data.recipientScope),
            data.recipientRoleId === null
              ? isNull(notificationRules.recipientRoleId)
              : eq(notificationRules.recipientRoleId, data.recipientRoleId),
          ),
        )
        .limit(1);

      return row ? toRule(row) : null;
    },

    async createRule(data) {
      const [row] = await db.insert(notificationRules).values(data).returning();

      if (!row) {
        throw new Error('Die Benachrichtigungsregel konnte nicht angelegt werden.');
      }

      return toRule(row);
    },

    async updateRule(ruleId, data) {
      const [row] = await db
        .update(notificationRules)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationRules.id, ruleId))
        .returning();

      return row ? toRule(row) : null;
    },

    async deleteRule(ruleId) {
      await db.delete(notificationRules).where(eq(notificationRules.id, ruleId));
    },

    async createNotifications(data) {
      if (data.length === 0) {
        return [];
      }

      /*
       * `onConflictDoNothing`: Für Ankündigungen sperrt ein Unique-Index
       * (`notifications_announcement_user_idx`) die zweite Meldung an dasselbe
       * Konto. Ein zweiter Veröffentlichungsversuch soll die vorhandenen
       * Meldungen nicht verdoppeln und auch nicht mit einem Fehler enden.
       */
      const rows = await db
        .insert(notifications)
        .values([...data])
        .onConflictDoNothing()
        .returning();

      return rows.map(toNotification);
    },

    async listNotifications(filter) {
      const where = and(
        eq(notifications.userId, filter.userId),
        filter.unreadOnly ? isNull(notifications.readAt) : undefined,
        filter.event ? eq(notifications.event, filter.event) : undefined,
        filter.severity ? eq(notifications.severity, filter.severity) : undefined,
      );

      const [rows, [totalRow], [unreadRow]] = await Promise.all([
        db
          .select()
          .from(notifications)
          .where(where)
          .orderBy(desc(notifications.createdAt))
          .limit(filter.limit)
          .offset(filter.offset),
        db.select({ value: count() }).from(notifications).where(where),
        db
          .select({ value: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, filter.userId), isNull(notifications.readAt))),
      ]);

      return {
        entries: rows.map(toNotification),
        total: Number(totalRow?.value ?? 0),
        unreadCount: Number(unreadRow?.value ?? 0),
      };
    },

    async findNotificationById(notificationId) {
      const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, notificationId))
        .limit(1);

      return row ? toNotification(row) : null;
    },

    async markRead(userId, ids, read) {
      const rows = await db
        .update(notifications)
        .set({ readAt: read ? new Date() : null })
        .where(
          and(
            eq(notifications.userId, userId),
            ids === null ? undefined : inArray(notifications.id, [...ids]),
            // Bereits im Zielzustand stehende Meldungen bleiben unberührt,
            // damit `readAt` nicht bei jedem Klick neu gesetzt wird.
            read ? isNull(notifications.readAt) : sql`${notifications.readAt} is not null`,
          ),
        )
        .returning({ id: notifications.id });

      return rows.length;
    },

    async deleteNotification(notificationId) {
      await db.delete(notifications).where(eq(notifications.id, notificationId));
    },

    async findPreferences(userId) {
      const [row] = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId));

      if (row === undefined) {
        // Kein Eintrag heisst "nichts abbestellt" - dafuer wird keine Zeile angelegt.
        return { userId, mutedEvents: [], updatedAt: null };
      }

      return { userId, mutedEvents: row.mutedEvents, updatedAt: row.updatedAt };
    },

    async savePreferences(userId, mutedEvents) {
      const werte = [...mutedEvents];
      const [row] = await db
        .insert(notificationPreferences)
        .values({ userId, mutedEvents: werte })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { mutedEvents: werte, updatedAt: new Date() },
        })
        .returning();

      return {
        userId,
        mutedEvents: row?.mutedEvents ?? werte,
        updatedAt: row?.updatedAt ?? null,
      };
    },

    async findMutedRecipients(userIds, event) {
      if (userIds.length === 0) {
        return new Set<string>();
      }

      const rows = await db
        .select({
          userId: notificationPreferences.userId,
          mutedEvents: notificationPreferences.mutedEvents,
        })
        .from(notificationPreferences)
        .where(inArray(notificationPreferences.userId, [...userIds]));

      return new Set(
        rows.filter((row) => row.mutedEvents.includes(event)).map((row) => row.userId),
      );
    },

    async countUnread(userId) {
      const [row] = await db
        .select({ value: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

      return Number(row?.value ?? 0);
    },

    async listAnnouncements() {
      const rows = await db.select().from(announcements).orderBy(desc(announcements.publishedAt));

      return rows.map(toAnnouncement);
    },

    async findAnnouncementById(announcementId) {
      const [row] = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, announcementId))
        .limit(1);

      return row ? toAnnouncement(row) : null;
    },

    async createAnnouncement(data) {
      const [row] = await db.insert(announcements).values(data).returning();

      if (!row) {
        throw new Error('Die Ankündigung konnte nicht angelegt werden.');
      }

      return toAnnouncement(row);
    },

    async updateAnnouncement(announcementId, data) {
      const [row] = await db
        .update(announcements)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(announcements.id, announcementId))
        .returning();

      return row ? toAnnouncement(row) : null;
    },

    async deleteAnnouncement(announcementId) {
      await db.delete(announcements).where(eq(announcements.id, announcementId));
    },

    async countNotificationsPerAnnouncement() {
      const rows = await db
        .select({ announcementId: notifications.announcementId, value: count() })
        .from(notifications)
        .groupBy(notifications.announcementId);

      const result = new Map<string, number>();

      for (const row of rows) {
        if (row.announcementId !== null) {
          result.set(row.announcementId, Number(row.value));
        }
      }

      return result;
    },

    async startDelivery(data) {
      const [row] = await db.insert(notificationDeliveries).values(data).returning();

      if (!row) {
        throw new Error('Der Zustellversuch konnte nicht protokolliert werden.');
      }

      return toDelivery(row);
    },

    async finishDelivery(deliveryId, outcome) {
      await db
        .update(notificationDeliveries)
        .set(outcome)
        .where(eq(notificationDeliveries.id, deliveryId));
    },

    async listDeliveries(limit) {
      const rows = await db
        .select()
        .from(notificationDeliveries)
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(limit);

      return rows.map(toDelivery);
    },
  };
}

/**
 * Verzeichnis der Empfänger über Drizzle.
 *
 * „Freigeschaltet" heißt hier: nicht gesperrt **und** nicht mehr auf der
 * Warteliste. Der Wartezustand ist kein eigenes Feld, sondern ergibt sich aus
 * den Rollen (`isAwaitingApproval()` in B1): Ein Konto, das ausschließlich die
 * Systemrolle „Gast" trägt, wartet noch. Diese Auslegung steht bewusst an
 * genau einer Stelle je Modul und folgt der aus B1 – zwei auseinanderlaufende
 * Auslegungen wären schlimmer als eine wiederholte.
 */
export function createDrizzleRecipientDirectory(db: Database): RecipientDirectory {
  return {
    async listActiveUserIds() {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.banned, false),
            sql`(${users.isOwner} or exists (
              select 1 from ${userRoles}
              join ${roles} on ${roles.id} = ${userRoles.roleId}
              where ${userRoles.userId} = ${users.id} and ${roles.name} <> ${GUEST_ROLE_NAME}
            ))`,
          ),
        );

      return rows.map((row) => row.id);
    },

    async listUserIdsWithRole(roleId) {
      const rows = await db
        .select({ id: users.id })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(eq(userRoles.roleId, roleId), eq(users.banned, false)));

      return rows.map((row) => row.id);
    },

    async findDisplayNames(userIds) {
      if (userIds.length === 0) {
        return new Map<string, string>();
      }

      const rows = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...userIds]));

      return new Map(rows.map((row) => [row.id, row.displayName]));
    },
  };
}
