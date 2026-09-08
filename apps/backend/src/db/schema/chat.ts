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
  boolean,
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
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    /**
     * `user_id` steht im Primärschlüssel an zweiter Stelle und wird davon nicht
     * getragen (Audit backend-db-07). Die Kaskade beim Löschen eines Kontos
     * (`delete from conversation_reads where user_id = …`) läse die Tabelle
     * sonst vollständig – sie wächst mit Konversationen × Konten.
     */
    index('conversation_reads_user_id_idx').on(table.userId),
  ],
);

/**
 * Nachricht (Pflichtenheft §6, `Message`).
 *
 * Eine gelöschte Nachricht wird **nicht** entfernt, sondern mit `deletedAt`
 * markiert: Der Verlauf bliebe sonst lückenhaft, und eine laufende Meldung
 * verlöre ihren Bezug. Ausgeliefert wird sie mit leerem Inhalt.
 *
 * `senderId` wird beim Löschen des Kontos **geleert**, nicht mitgelöscht
 * (Fundpunkt 141). Vorher stand die Spalte auf `ON DELETE CASCADE`: Wer sein
 * Konto löschen ließ (Lastenheft §3.1), riss damit seine Hälfte aus **fremden**
 * Unterhaltungen heraus. Beim Gegenüber blieb ein Verlauf zurück, in dem nur
 * noch die eigenen Beiträge standen – ohne Hinweis, dass dort je etwas anderes
 * stand. Die Nachricht bleibt deshalb stehen, die Kennung fällt weg; angezeigt
 * wird `DELETED_ACCOUNT_DISPLAY_NAME` aus `@palantir/contracts`.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** `null`, sobald das Konto des Absenders gelöscht wurde (Fundpunkt 141). */
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Wer gelöscht hat – der Absender selbst oder ein Moderator. `ON DELETE SET
     * NULL`, damit das Löschen eines Moderator-Kontos nicht die Nachrichten
     * mitnimmt, über die er entschieden hat.
     */
    deletedById: uuid('deleted_by_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Wurde die Nachricht im Zuge einer Meldung entfernt? `null`, solange sie
     * steht.
     *
     * Bis Fundpunkt 141 leitete das DTO die Angabe aus `deletedById !==
     * senderId` ab. Das trägt nicht mehr: Beide Spalten stehen auf `SET NULL`,
     * und sind Absender **und** Moderator gelöscht, sind beide `null` – der
     * Vergleich behauptete dann „vom Absender selbst gelöscht" und benannte
     * eine Moderationsentscheidung als Rücknahme durch den Verfasser. Der
     * Vertrag verlangt deshalb ausdrücklich, dass das Backend die Angabe
     * *führt* statt sie zu erschließen (`MessageDto.deletedByModerator`).
     *
     * Dieselbe Begründung wie bei `message_reports.reported_content`: eine
     * Tatsache, die eine Entscheidung nachvollziehbar hält, wird festgehalten
     * und nicht aus Kennungen rekonstruiert, die später wegfallen dürfen.
     */
    deletedByModerator: boolean('deleted_by_moderator'),
  },
  (table) => [
    /** Verlauf einer Konversation, jüngste zuerst – die einzige Leseform. */
    index('messages_conversation_created_idx').on(table.conversationId, table.createdAt),
    /**
     * Trägt seit Fundpunkt 141 zusätzlich das `ON DELETE SET NULL` der Spalte:
     * Ohne ihn müsste PostgreSQL beim Löschen **jedes** Kontos die gesamte
     * Nachrichtentabelle lesen. Bewusst nicht partiell wie
     * `messages_deleted_by_id_idx` – `sender_id` ist im Regelfall gesetzt, eine
     * Bedingung `is not null` schlösse also fast nichts aus und nähme dem Index
     * seinen zweiten Zweck (Nachrichten eines Kontos finden).
     */
    index('messages_sender_id_idx').on(table.senderId),
    /**
     * Trägt das `ON DELETE SET NULL` beim Löschen eines Moderator-Kontos (Audit
     * backend-db-07). Ohne ihn liest PostgreSQL für **jede** gelöschte
     * `users`-Zeile die gesamte – potenziell größte – Tabelle der Installation.
     *
     * Bewusst partiell: Gelöschte Nachrichten sind die Ausnahme, in der
     * weit überwiegenden Zahl der Zeilen ist die Spalte `null`. Der Index bleibt
     * damit klein, und für die Kaskade genügt er: PostgreSQL erkennt, dass
     * `deleted_by_id = $1` die Bedingung `is not null` einschließt.
     */
    index('messages_deleted_by_id_idx')
      .on(table.deletedById)
      .where(sql`${table.deletedById} is not null`),
  ],
);

/**
 * Meldung zu einer Nachricht (Pflichtenheft §6, `MessageReport`).
 *
 * `reportedContent` ist eine Kopie des Inhalts zum Zeitpunkt der Meldung. Sie
 * ist der Grund, warum eine Entscheidung nachvollziehbar bleibt, nachdem die
 * Nachricht gelöscht wurde – und zugleich die **einzige** Stelle, an der ein
 * Moderator überhaupt an einen Nachrichteninhalt kommt (Pflichtenheft §15).
 *
 * `reportedById` wird beim Löschen des Melder-Kontos geleert, die Meldung
 * bleibt (Fundpunkt 141). Vorher nahm `ON DELETE CASCADE` sie mit, samt
 * `reportedContent`: Wer eine Belästigung meldete und danach – womöglich gerade
 * deswegen – sein Konto löschte, zog seine eigene Meldung zurück, ohne das zu
 * wollen. Ein noch offener Fall verschwand dabei mitsamt der Beweiskopie.
 */
export const messageReports = pgTable(
  'message_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Bleibt `ON DELETE CASCADE`, anders als die beiden Konto-Verweise: Eine
     * Nachricht wird im Betrieb nie entfernt, sondern nur als gelöscht markiert
     * (siehe {@link messages}). Verschwände die Zeile doch, hätte die Meldung
     * keinen Gegenstand mehr – sie zeigte auf nichts.
     */
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** `null`, sobald das Konto der meldenden Person gelöscht wurde (Fundpunkt 141). */
    reportedById: uuid('reported_by_id').references(() => users.id, { onDelete: 'set null' }),
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
     *
     * Für gelöschte Konten greift der Index nicht mehr, und das ist so
     * gewollt: PostgreSQL zählt `NULL` in einem Unique-Index als verschieden
     * (`NULLS DISTINCT`, die Vorgabe). Zwei Meldungen derselben Nachricht durch
     * zwei inzwischen gelöschte Konten bleiben deshalb beide bestehen – hätte
     * PostgreSQL sie als gleich behandelt, wäre schon die Kaskade an ihnen
     * gescheitert und das Löschen des zweiten Kontos unmöglich geworden.
     */
    uniqueIndex('message_reports_message_reporter_idx').on(table.messageId, table.reportedById),
    /** Die Moderationsübersicht filtert nach Stand und sortiert nach Eingang. */
    index('message_reports_status_created_idx').on(table.status, table.createdAt),
    /**
     * `reported_by_id` steht im Unique-Index oben an zweiter Stelle und wird
     * davon nicht getragen (Audit backend-db-07). Gebraucht wird die Spalte
     * zweifach: von der Kaskade beim Löschen eines Kontos und von
     * `reportedMessageIds` in `ChatRepository` – die Abfrage, die zu einem
     * Seitenabruf des Verlaufs zusammenträgt, welche der gezeigten Nachrichten
     * der Betrachter bereits gemeldet hat. Sie filtert nach dem Melder und
     * einer Liste von Nachrichten-Ids; der Unique-Index führt auf
     * `message_id` und taugt dafür nicht.
     */
    index('message_reports_reported_by_id_idx').on(table.reportedById),
    /**
     * Trägt das `ON DELETE SET NULL` beim Löschen eines Moderator-Kontos
     * (Audit backend-db-07).
     */
    index('message_reports_resolved_by_id_idx').on(table.resolvedById),
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
