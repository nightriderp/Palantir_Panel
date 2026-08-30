/**
 * Tabellen des Arbeitspakets B7 – Chat & Moderation (Pflichtenheft §6, §15).
 *
 * Enthält die Entitäten `Conversation`, `Message` und `MessageReport`.
 *
 * **Warum es keine Teilnehmertabelle für den Server-Chat gibt:** Pflichtenheft
 * §15 sagt „Teilnehmerkreis folgt `ServerMember`". Eine zweite, gespiegelte
 * Liste müsste bei jeder Mitgliederänderung nachgeführt werden und wäre nach dem
 * ersten vergessenen Aufruf falsch – mit der Folge, dass jemand mitliest, der
 * nicht mehr Mitglied ist. `conversation_participants` trägt deshalb
 * ausschließlich die beiden Konten einer DM; beim Server-Chat wird der
 * Teilnehmerkreis bei jeder Prüfung aus `game_servers.owner_id` und
 * `server_members` gelesen.
 */

import {
  type ConversationType,
  type MessageModerationAction,
  type MessageReportStatus,
} from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { gameServers } from './server-orchestration.js';
import { users } from './users.js';

/**
 * Konversation (Pflichtenheft §6, `Conversation`).
 *
 * `dmKey` ist die sortierte Verkettung der beiden Konto-IDs einer DM. Sie steht
 * hier, weil „genau eine Unterhaltung je Paar" sonst nur eine Anwendungsregel
 * wäre: Zwei gleichzeitige Anfragen würden beide keine bestehende Unterhaltung
 * finden und beide eine anlegen. Mit dem eindeutigen Index scheitert die zweite
 * beim Schreiben.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').$type<ConversationType>().notNull(),
    /**
     * Nur beim `server_chat` gesetzt. Löscht mit: Verschwindet der Server,
     * verschwindet sein Gruppen-Chat – er hat ohne ihn keinen Teilnehmerkreis
     * mehr.
     */
    serverId: uuid('server_id').references(() => gameServers.id, { onDelete: 'cascade' }),
    /** Sortierte `<userId>:<userId>`-Verkettung der DM; `null` beim Server-Chat. */
    dmKey: text('dm_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Höchstens ein Gruppen-Chat je Server. */
    uniqueIndex('conversations_server_id_idx')
      .on(table.serverId)
      .where(sql`${table.serverId} is not null`),
    /** Höchstens eine Unterhaltung je Kontopaar. */
    uniqueIndex('conversations_dm_key_idx')
      .on(table.dmKey)
      .where(sql`${table.dmKey} is not null`),
  ],
);

/**
 * Teilnehmer einer **Direktnachricht**.
 *
 * Beim Server-Chat bleibt diese Tabelle leer (siehe Dateikopf). Beide
 * Fremdschlüssel löschen mit: Ohne Konversation oder ohne Konto hätte die
 * Zuordnung keine Bedeutung.
 */
export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('conversation_participants_user_id_idx').on(table.userId),
  ],
);

/**
 * Serverseitiger Lesezustand je Teilnehmer (Pflichtenheft §15, Fundpunkt 95).
 *
 * Eine Zeile je (Konversation, Konto): `lastReadAt` ist der Zeitpunkt, bis zu
 * dem dieses Konto die Konversation gelesen hat. Der Ungelesen-Zähler wird
 * daraus abgeleitet (Nachrichten danach, nicht vom Konto selbst, nicht
 * gelöscht) und muss deshalb nirgends gespiegelt werden – so bleibt er über
 * Geräte hinweg konsistent, statt wie zuvor nur lokal in einer Sitzung zu
 * zählen.
 *
 * Gilt für DMs **und** Server-Chats gleichermaßen: Die Tabelle bezieht sich auf
 * die Konversation, nicht auf `conversation_participants` (die beim Server-Chat
 * leer bleibt). Eine Zeile entsteht erst, wenn ein Konto zum ersten Mal als
 * gelesen markiert – wer nie gelesen hat, hat keinen Eintrag und alles gilt als
 * ungelesen. Beide Fremdschlüssel löschen mit: Ohne Konversation oder Konto
 * hätte der Lesestand keine Bedeutung.
 */
export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.userId] })],
);

/**
 * Nachricht (Pflichtenheft §6, `Message`).
 *
 * Eine gelöschte Nachricht wird **nicht** entfernt, sondern mit `deletedAt`
 * markiert: Der Verlauf bliebe sonst lückenhaft, und eine laufende Meldung
 * verlöre ihren Bezug. Ausgeliefert wird sie mit leerem Inhalt.
 *
 * `senderId` löscht mit dem Konto mit. Wer sein Konto löschen lässt
 * (Lastenheft §3.1), soll seine Beiträge nicht als Karteileiche zurücklassen.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Wer gelöscht hat – der Absender selbst oder ein Moderator. `ON DELETE SET
     * NULL`, damit das Löschen eines Moderator-Kontos nicht die Nachrichten
     * mitnimmt, über die er entschieden hat.
     */
    deletedById: uuid('deleted_by_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    /** Verlauf einer Konversation, jüngste zuerst – die einzige Leseform. */
    index('messages_conversation_created_idx').on(table.conversationId, table.createdAt),
    index('messages_sender_id_idx').on(table.senderId),
  ],
);

/**
 * Meldung zu einer Nachricht (Pflichtenheft §6, `MessageReport`).
 *
 * `reportedContent` ist eine Kopie des Inhalts zum Zeitpunkt der Meldung. Sie
 * ist der Grund, warum eine Entscheidung nachvollziehbar bleibt, nachdem die
 * Nachricht gelöscht wurde – und zugleich die **einzige** Stelle, an der ein
 * Moderator überhaupt an einen Nachrichteninhalt kommt (Pflichtenheft §15).
 */
export const messageReports = pgTable(
  'message_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    reportedById: uuid('reported_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    /** Inhalt der Nachricht zum Zeitpunkt der Meldung. */
    reportedContent: text('reported_content').notNull(),
    status: text('status').$type<MessageReportStatus>().notNull().default('open'),
    actionTaken: text('action_taken').$type<MessageModerationAction>(),
    moderatorNote: text('moderator_note'),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Dieselbe Nachricht meldet dasselbe Konto nur einmal. In der Datenbank
     * abgesichert und nicht nur im Dienst: Zwei gleichzeitige Meldungen
     * bestünden die Prüfung sonst beide.
     */
    uniqueIndex('message_reports_message_reporter_idx').on(table.messageId, table.reportedById),
    /** Die Moderationsübersicht filtert nach Stand und sortiert nach Eingang. */
    index('message_reports_status_created_idx').on(table.status, table.createdAt),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;
export type ConversationParticipantRow = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipantRow = typeof conversationParticipants.$inferInsert;
export type ConversationReadRow = typeof conversationReads.$inferSelect;
export type NewConversationReadRow = typeof conversationReads.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type MessageReportRow = typeof messageReports.$inferSelect;
export type NewMessageReportRow = typeof messageReports.$inferInsert;
