/**
 * Spiel-Wünsche (Betreiber, 19.09.2026).
 *
 * Eigene Tabelle statt einer Spalte an `quota_requests`: Beide Vorgänge sehen
 * gleich aus – ein Konto bittet, der Betreiber beschiedet –, sie meinen aber
 * Verschiedenes. Eine gemeinsame Tabelle hätte für jede Sorte Spalten
 * mitgeführt, die die andere nie füllt, und jede Abfrage hätte erst die Sorte
 * aussortieren müssen.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { type GameRequestStatus } from '@palantir/contracts';
import { users } from './users.js';

export const gameRequests = pgTable(
  'game_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Das gewünschte Spiel als freier Text.
     *
     * Keine Kennung aus der Spiele-Registry: Gewünscht wird gerade das, was es
     * dort noch nicht gibt.
     */
    game: text('game').notNull(),
    /** Begründung; freiwillig, deshalb `null` erlaubt. */
    reason: text('reason'),
    /**
     * Zustand (`GameRequestStatus`).
     *
     * Bewusst `text` mit Vorgabe statt eines Enum-Typs – wie bei
     * `quota_requests`: Ein weiterer Zustand soll keine Migration des Typs
     * verlangen.
     */
    status: text('status').$type<GameRequestStatus>().notNull().default('pending'),
    decisionNote: text('decision_note'),
    decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Ein offener Wunsch je Konto; erledigte bleiben als Beleg stehen.
    uniqueIndex('game_requests_open_per_user_idx')
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index('game_requests_status_created_idx').on(table.status, table.createdAt.desc()),
    // Trägt die Kaskade beim Löschen eines Kontos und die Liste „meine Wünsche".
    index('game_requests_user_id_idx').on(table.userId),
    // Trägt das `ON DELETE SET NULL`, wenn ein Administrator-Konto verschwindet.
    index('game_requests_decided_by_id_idx').on(table.decidedById),
  ],
);
