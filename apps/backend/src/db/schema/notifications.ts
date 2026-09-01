/**
 * Tabellen des Arbeitspakets B6 – Notification-Engine (Pflichtenheft §6 und
 * §14, Lastenheft §3.6).
 *
 * Enthält die Entitäten `NotificationChannel` und `NotificationRule` aus
 * Pflichtenheft §6 sowie drei Tabellen, die das Pflichtenheft nicht als
 * Entitäten führt, ohne die die geforderte Funktion aber nicht umsetzbar wäre
 * (jeweils begründet an der Tabelle selbst):
 *
 * - `notifications` – die Inbox im Panel; ohne sie gäbe es nur den externen Weg
 * - `announcements` – systemweite Ankündigungen (Lastenheft §3.6)
 * - `notification_deliveries` – Protokoll der Zustellung nach außen
 *
 * Die Trennung von Kanal und Regel ist die Vorgabe aus Pflichtenheft §14 und
 * bewusst auch in der Datenbank abgebildet: ein Kanal ohne Regel ist gültig
 * (frisch angelegt), eine Regel ohne Kanal ebenfalls (nur Inbox).
 */

import {
  type NotifiableEventName,
  type NotificationChannelType,
  type NotificationDeliveryStatus,
  type NotificationRecipientScope,
  type NotificationSeverity,
  type NotificationSubjectType,
} from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { roles } from './rbac.js';
import { users } from './users.js';

/**
 * Kanal nach außen (Pflichtenheft §6, Entität `NotificationChannel`).
 *
 * `webhook_url` ist ein Geheimnis: Wer sie hat, schreibt in den Discord-Kanal.
 * Sie wird deshalb nie in einem DTO ausgeliefert (`NotificationChannelDto`
 * trägt nur eine gekürzte Kurzform). Für den Standardkanal einer Instanz bleibt
 * die Spalte `null` – dann gilt `DISCORD_WEBHOOK_URL` aus der zentralen `.env`
 * (Pflichtenheft §12.1, CLAUDE.md §2: kein Geheimnis im Code, und hier auch
 * keines in der Datenbank, solange es nicht sein muss).
 */
export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: text('type').$type<NotificationChannelType>().notNull().default('discordWebhook'),
    /** `null` = Kanal nutzt `DISCORD_WEBHOOK_URL` aus der zentralen `.env`. */
    webhookUrl: text('webhook_url'),
    /** Abweichender Absendername in Discord; `null` = Vorgabe des Webhooks. */
    username: text('username'),
    enabled: boolean('enabled').notNull().default(true),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
    /** Benannter Code aus `ERROR_CATALOG` der letzten gescheiterten Zustellung – nie Freitext. */
    lastFailureCode: text('last_failure_code'),
    lastFailureMessage: text('last_failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Kanalnamen tragen die Auswahl im Regel-Editor (F10). Zwei gleich
     * benannte Kanäle wären dort nicht unterscheidbar – ohne Rücksicht auf
     * Groß-/Kleinschreibung, wie bei `users.username`.
     */
    uniqueIndex('notification_channels_name_lower_idx').on(sql`lower(${table.name})`),
  ],
);

/**
 * Regel (Pflichtenheft §6, Entität `NotificationRule`): Ereignis → Kanal →
 * Empfängerkreis.
 *
 * `channel_id` ist bewusst nullable: Eine Regel ohne Kanal stellt ausschließlich
 * in die Inbox zu. Die Inbox ist der Grundweg, der externe Kanal die Ergänzung
 * (Lastenheft §3.6) – ohne diese Möglichkeit erreichte ein Ereignis niemanden,
 * solange kein Discord-Webhook eingerichtet ist.
 *
 * Gelöscht wird ein Kanal nicht, solange Regeln daran hängen
 * (`NOTIFICATION_CHANNEL_IN_USE` im Service). Der Fremdschlüssel steht deshalb
 * auf `restrict` und nicht auf `set null`: Eine Regel, die still ihr Ziel
 * verliert und danach nur noch in die Inbox schreibt, wäre die unangenehmere
 * Überraschung.
 */
export const notificationRules = pgTable(
  'notification_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    event: text('event').$type<NotifiableEventName>().notNull(),
    channelId: uuid('channel_id').references(() => notificationChannels.id, {
      onDelete: 'restrict',
    }),
    recipientScope: text('recipient_scope').$type<NotificationRecipientScope>().notNull(),
    /** Rolle bei `recipient_scope = 'role'`, sonst `null`. Löscht die Rolle, verschwindet die Regel mit. */
    recipientRoleId: uuid('recipient_role_id').references(() => roles.id, { onDelete: 'cascade' }),
    inboxEnabled: boolean('inbox_enabled').notNull().default(true),
    /**
     * `null` = die Dringlichkeit des Ereignisses übernehmen (Standard).
     *
     * Bewusst nullable statt mit Vorgabewert: Ein festes `'info'` würde ein
     * fehlgeschlagenes Backup still herabstufen.
     */
    severity: text('severity').$type<NotificationSeverity>(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Trägt die Auswertung beim Auslösen: aktive Regeln zu einem Ereignis. */
    index('notification_rules_event_idx')
      .on(table.event)
      .where(sql`${table.enabled}`),
    index('notification_rules_channel_idx').on(table.channelId),
    /**
     * Keine zwei Regeln mit derselben Kombination – die zweite erzeugte nur
     * Doppelmeldungen (`NOTIFICATION_RULE_DUPLICATE`). Die Regel steht in der
     * Datenbank und nicht nur im Service, weil zwei gleichzeitige Anlagen sonst
     * beide durchkämen.
     *
     * `coalesce` statt der Spalten selbst: In PostgreSQL gelten zwei `null`
     * nicht als gleich, ein Unique-Index über nullbare Spalten würde also
     * beliebig viele „nur Inbox"-Regeln desselben Ereignisses zulassen.
     */
    uniqueIndex('notification_rules_unique_idx').on(
      table.event,
      sql`coalesce(${table.channelId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.recipientScope,
      sql`coalesce(${table.recipientRoleId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

/**
 * Systemweite Ankündigung durch einen Admin (Lastenheft §3.6, z. B.
 * Wartungshinweise).
 *
 * Eigene Tabelle statt nur einer Reihe von Inbox-Meldungen: Eine Ankündigung
 * soll sich nachträglich korrigieren oder zurückziehen lassen, ohne einzelne
 * Inbox-Einträge anzufassen, und das Frontend zeigt sie zusätzlich als Banner.
 */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    severity: text('severity').$type<NotificationSeverity>().notNull().default('info'),
    /** Veröffentlichendes Konto; `null`, wenn es später gelöscht wurde – die Ankündigung bleibt. */
    publishedByUserId: uuid('published_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    /** Ende der Banner-Anzeige; `null` = ohne Ablauf. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('announcements_published_idx').on(table.publishedAt.desc())],
);

/**
 * Eine Meldung in der Inbox eines Kontos (Lastenheft §3.6).
 *
 * `title` und `body` stehen fertig gerendert in der Zeile und werden nicht bei
 * jedem Abruf neu gebildet: Die Meldung soll den Stand zum Zeitpunkt des
 * Ereignisses zeigen. Wird ein Server später umbenannt oder gelöscht, bleibt
 * „Server »Wüstensturm« ist abgestürzt" lesbar – dieselbe Überlegung wie bei
 * `AuditLogEntryDto.actorDisplayName`.
 *
 * `data` trägt die ursprüngliche Nutzlast mit, damit eine spätere Ansicht mehr
 * daraus machen kann, ohne die Meldung neu erzeugen zu müssen.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').$type<NotifiableEventName>().notNull(),
    severity: text('severity').$type<NotificationSeverity>().notNull().default('info'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Betroffene Ressource für den Sprung aus der Inbox; `null` bei Meldungen ohne Bezug. */
    subjectType: text('subject_type').$type<NotificationSubjectType>(),
    subjectId: uuid('subject_id'),
    subjectName: text('subject_name'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Regel, aus der die Meldung entstand.
     *
     * `set null` statt `cascade`: Wird eine Regel gelöscht, sollen bereits
     * zugestellte Meldungen nicht rückwirkend aus den Inboxen verschwinden.
     */
    ruleId: uuid('rule_id').references(() => notificationRules.id, { onDelete: 'set null' }),
    announcementId: uuid('announcement_id').references(() => announcements.id, {
      onDelete: 'cascade',
    }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Trägt die Inbox-Ansicht: Meldungen eines Kontos, neueste zuerst. */
    index('notifications_user_created_idx').on(table.userId, table.createdAt.desc()),
    /** Trägt den Zähler in der Navigation, ohne die gelesenen Meldungen mitzuzählen. */
    index('notifications_unread_idx')
      .on(table.userId)
      .where(sql`${table.readAt} is null`),
    /** Eine Ankündigung erreicht jedes Konto höchstens einmal. */
    uniqueIndex('notifications_announcement_user_idx')
      .on(table.announcementId, table.userId)
      .where(sql`${table.announcementId} is not null`),
  ],
);

/**
 * Persoenliche Zustell-Einstellung eines Kontos (Lastenheft §3.6, Gefundener
 * Punkt 93).
 *
 * Eine Zeile je Konto, angelegt beim ersten Speichern - kein Eintrag bedeutet
 * "nichts abbestellt". Das haelt die Tabelle klein: Der Normalfall ist, dass
 * jemand nichts abstellt, und dafuer braucht es keine Zeile.
 *
 * Die abbestellten Ereignisse stehen als JSON-Liste und nicht als eigene
 * Tabelle mit einer Zeile je Ereignis: Sie werden immer vollstaendig gelesen
 * und vollstaendig ersetzt, nie einzeln abgefragt.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mutedEvents: jsonb('muted_events').$type<NotifiableEventName[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Protokoll einer Zustellung an einen externen Kanal.
 *
 * Notwendige Kehrseite der Vorgabe aus Pflichtenheft §14: Eine gescheiterte
 * Zustellung darf den auslösenden Vorgang nicht scheitern lassen. Ohne dieses
 * Protokoll wäre die Fehlzustellung damit vollständig unsichtbar – der Admin
 * wüsste nicht, dass seine Discord-Meldungen seit Tagen nicht ankommen.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
    /** `null` bei der Testnachricht eines Admins – sie entsteht ohne Regel. */
    ruleId: uuid('rule_id').references(() => notificationRules.id, { onDelete: 'set null' }),
    event: text('event').$type<NotifiableEventName>().notNull(),
    status: text('status').$type<NotificationDeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Benannter Code aus `ERROR_CATALOG` bei `status = 'failed'` – nie Freitext (CLAUDE.md §5). */
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    index('notification_deliveries_channel_created_idx').on(
      table.channelId,
      table.createdAt.desc(),
    ),
    index('notification_deliveries_status_idx')
      .on(table.status)
      .where(sql`${table.status} = 'failed'`),
  ],
);

export type NotificationChannelRow = typeof notificationChannels.$inferSelect;
export type NewNotificationChannelRow = typeof notificationChannels.$inferInsert;
export type NotificationRuleRow = typeof notificationRules.$inferSelect;
export type NewNotificationRuleRow = typeof notificationRules.$inferInsert;
export type AnnouncementRow = typeof announcements.$inferSelect;
export type NewAnnouncementRow = typeof announcements.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferencesRow = typeof notificationPreferences.$inferInsert;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDeliveryRow = typeof notificationDeliveries.$inferInsert;
