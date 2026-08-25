/**
 * Entität `User` (Pflichtenheft §6) – Grundgerüst für Arbeitspaket B1.
 *
 * **Bewusst minimal:** hier stehen ausschließlich die Felder, die Pflichtenheft §6
 * für `User` nennt. `AuthMethod` und `Session` gehören ebenfalls zu B1 und
 * fehlen noch – B1 bringt sie mit einer eigenen Migration nach und erweitert
 * diese Tabelle bei Bedarf **additiv**.
 *
 * Angelegt wurde die Tabelle aus B2 heraus, weil `user_roles.user_id`
 * (Pflichtenheft §8) sonst dauerhaft ohne Fremdschlüssel bleiben müsste. Das
 * ist in WORK_STATUS.md unter „Gefundene Punkte" Nr. 11 vermerkt.
 *
 * Bewusst **nicht** hier festgelegt, weil es zu B1 gehört:
 * - Eindeutigkeit von `displayName` (bei OAuth-Konten kollidieren Anzeigenamen
 *   leicht – ob und wie dedupliziert wird, entscheidet der Registrierungsablauf)
 * - Passwort-/Token-Felder (liegen in `AuthMethod` bzw. `Session`)
 */

import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: text('display_name').notNull(),
    /**
     * Owner-Sonderstatus außerhalb des Rollensystems (Lastenheft §2,
     * Pflichtenheft §8): garantiert immer alle Permissions und schützt davor,
     * sich per Rollenänderung selbst auszusperren.
     */
    isOwner: boolean('is_owner').notNull().default(false),
    banned: boolean('banned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * „Genau ein Konto trägt diesen Status" (Lastenheft §2) – als partieller
     * Unique-Index in der Datenbank abgesichert, damit die Zusicherung nicht
     * allein von Anwendungscode abhängt.
     */
    uniqueIndex('users_single_owner_idx')
      .on(table.isOwner)
      .where(sql`${table.isOwner}`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
