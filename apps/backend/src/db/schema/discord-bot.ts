/**
 * Zuordnung Panel ↔ Discord für den Bot (Pflichtenheft §14a.4, §14a.10).
 *
 * **Bewusst ohne Fremdschlüssel.** Wird ein Server oder ein Konto gelöscht,
 * muss der Abgleich den zugehörigen Discord-Kanal noch entfernen können –
 * dafür braucht er die Kanal-Id aus genau dieser Zeile. Mit einer Kaskade wäre
 * sie weg, bevor der Bot aufräumen kann, und der Kanal bliebe in Discord
 * stehen. Verwaiste Zeilen räumt der Abgleich selbst ab.
 */

import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Kategorie „<Name>s Server" je Besitzer; ab dem 51. Server eine Folgekategorie. */
export const discordOwnerCategories = pgTable(
  'discord_owner_categories',
  {
    userId: uuid('user_id').notNull(),
    /** 1, 2, … – Discord erlaubt 50 Kanäle je Kategorie. */
    sequence: integer('sequence').notNull(),
    channelId: text('channel_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.sequence] })],
);

/** Kanal und Status-Kachel je Gameserver. */
export const discordServerChannels = pgTable('discord_server_channels', {
  serverId: uuid('server_id').primaryKey(),
  channelId: text('channel_id').notNull(),
  /** Nachricht mit der Status-Kachel; `null`, bis sie das erste Mal geschrieben ist. */
  statusMessageId: text('status_message_id'),
  /** Fingerabdruck des zuletzt geschriebenen Inhalts – gleich heißt: nicht bearbeiten. */
  lastRenderedHash: text('last_rendered_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
