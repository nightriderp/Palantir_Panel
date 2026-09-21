/**
 * Tabelle der Erfolge (Betreiber-Wunsch 21.09.2026).
 *
 * Enthält die Entität `UserAchievement`: die Tatsache, dass ein Konto ein
 * Abzeichen aus dem Katalog in `@palantir/contracts` freigeschaltet hat.
 *
 * **Warum eine Zeile je Freischaltung und keine laufende Neuberechnung.** Die
 * Auslöser hängen am Audit-Log, und dessen Einträge wandern nach 24 Monaten ins
 * Archiv (Pflichtenheft §6). Würde die Übersicht bei jedem Aufruf aus dem Log
 * neu gezählt, verlöre ein Konto seine Abzeichen still in dem Moment, in dem
 * die alten Einträge wegrollen. Die Freischaltung ist deshalb ein eigener,
 * festgehaltener Zustand – das Log ist nur ihr Auslöser, nicht ihr Speicher.
 *
 * **Kein Punktestand.** Es gibt bewusst keine `xp`- oder `points`-Spalte: Die
 * Stufe ergibt sich allein aus der Zahl der Zeilen je Konto
 * (`levelForUnlocked`). Ein mitgeführter Punktestand wäre eine zweite Wahrheit
 * neben diesen Zeilen und könnte von ihnen abweichen.
 */

import { type AchievementId } from '@palantir/contracts';
import { index, pgTable, timestamp, uniqueIndex, uuid, text } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Ein freigeschaltetes Abzeichen eines Kontos.
 *
 * `achievementId` ist `text` mit Typbindung an `AchievementId` statt eines
 * Postgres-Enums – dieselbe Überlegung wie bei `arcade_scores.game_id`: Ein
 * neues Abzeichen wäre sonst eine Migration am Typ und nicht nur am Katalog.
 * Gültige Werte sichert die Route über das Zod-Schema aus `@palantir/validation`
 * ab, das Vergeben über die Regel-Tabelle des Moduls.
 *
 * Löscht der Betreiber ein Konto, verschwinden dessen Abzeichen mit
 * (`ON DELETE CASCADE`) – anders als beim Audit-Log gibt es hier nichts
 * nachzuweisen, ein verwaistes Abzeichen hätte keine Bedeutung.
 */
export const userAchievements = pgTable(
  'user_achievements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementId: text('achievement_id').$type<AchievementId>().notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Ein Abzeichen je Konto genau einmal – in der Datenbank abgesichert, nicht
     * nur im Anwendungscode.
     *
     * Das ist zugleich die Stelle, an der die Vergabe nebenläufigkeitssicher
     * wird: Zwei Ereignisse desselben Kontos können dieselbe Bedingung
     * gleichzeitig erfüllen (etwa zwei Sicherungen im selben Moment). Statt das
     * über eine Sperre zu lösen, schreibt das Repository mit
     * `ON CONFLICT DO NOTHING` – der zweite Schreibversuch läuft dann ins Leere
     * und meldet „war schon da", statt zu scheitern.
     */
    uniqueIndex('user_achievements_user_achievement_idx').on(table.userId, table.achievementId),
    /** Übersicht eines Kontos: alle seine Abzeichen. */
    index('user_achievements_user_idx').on(table.userId),
  ],
);

export type UserAchievementRow = typeof userAchievements.$inferSelect;
export type NewUserAchievementRow = typeof userAchievements.$inferInsert;
