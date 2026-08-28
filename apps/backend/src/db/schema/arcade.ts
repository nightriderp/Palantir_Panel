/**
 * Tabelle des Arbeitspakets F8 – Arcade (Pflichtenheft §6 und §17, Lastenheft §3.9).
 *
 * Enthält die Entität `ArcadeScore`: ein persistierter Punktestand eines Kontos
 * in einem der Minispiele. Die Spiele selbst laufen rein clientseitig; das
 * Backend ist nur die Instanz, die den Punktestand speichert – eine Bestenliste
 * ausschließlich im Browser genügt der Anforderung nicht (Lastenheft §3.9).
 *
 * Es wird **jeder** abgesendete Versuch gespeichert (nicht nur der beste): So
 * bleibt `gamesPlayed` zählbar und die Bestenliste lässt sich jederzeit aus den
 * Rohdaten neu berechnen. Der Bestwert je Konto entsteht als Aggregat in der
 * Abfrage, nicht als überschriebene Zeile.
 */

import { type ArcadeGameId } from '@palantir/contracts';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Punktestand eines Kontos in einem Minispiel (Pflichtenheft §6, `ArcadeScore`).
 *
 * `gameId` ist bewusst `text` mit Typbindung an `ArcadeGameId` statt eines
 * Postgres-Enums: ein zusätzliches Spiel wäre sonst eine Migration am Typ, nicht
 * nur am Katalog (dieselbe Überlegung wie bei `host_nodes.status`). Gültige
 * Werte sichert die Route über das Zod-Schema aus `@palantir/validation` ab.
 *
 * Löscht der Betreiber ein Konto, verschwinden dessen Punktestände mit
 * (`ON DELETE CASCADE`) – ein verwaister Eintrag hätte keine Bedeutung.
 */
export const arcadeScores = pgTable(
  'arcade_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: text('game_id').$type<ArcadeGameId>().notNull(),
    score: integer('score').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Bestenliste je Spiel: schnell die höchsten Punktestände finden.
    index('arcade_scores_game_score_idx').on(table.gameId, table.score.desc()),
    // Eigene Statistik: alle Versuche eines Kontos in einem Spiel.
    index('arcade_scores_user_game_idx').on(table.userId, table.gameId),
  ],
);

export type ArcadeScoreRow = typeof arcadeScores.$inferSelect;
export type NewArcadeScoreRow = typeof arcadeScores.$inferInsert;
