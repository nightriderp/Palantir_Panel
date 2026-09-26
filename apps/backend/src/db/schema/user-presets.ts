/**
 * Eigene Profile der Steuerung (Idee P / A2, Betreiber 26.09.2026).
 *
 * Ein Konto speichert die Werte der Steuerung eines Spiels unter einem Namen.
 * Eigene Tabelle statt Spalte an `users`: Ein Konto hat viele Profile, und die
 * Eindeutigkeit des Namens gilt je Konto und Spieltyp.
 */

import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { type GameConfigValues } from '@palantir/contracts';
import { users } from './users.js';

export const userPresets = pgTable(
  'user_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Spieltyp aus der Registry (`cs2`) – Text, weil die Registry im Code steht. */
    gameType: text('game_type').notNull(),
    name: text('name').notNull(),
    /** Nur Felder der Steuerung, beim Speichern gegen die Definition geprüft. */
    values: jsonb('values').$type<GameConfigValues>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_presets_user_game_name_idx').on(table.userId, table.gameType, table.name),
    // Trägt die Liste „meine Profile für dieses Spiel“ und die Kaskade.
    index('user_presets_user_game_idx').on(table.userId, table.gameType),
  ],
);
