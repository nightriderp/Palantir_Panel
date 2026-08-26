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
 * **Ergänzt in B1:** die Spalte `username` als Anmeldekennung des
 * Passwort-Verfahrens (Migration `0004_auth_identity`, dokumentiert in
 * Pflichtenheft §7). Sie ist eindeutig, `display_name` bewusst nicht – der
 * Vertrag aus F1 (`AccountDto`) trennt beide sauber. Die Passwort- und
 * Token-Felder liegen in `AuthMethod` bzw. `Session` (`schema/auth.ts`).
 */

import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Anmeldekennung des Passwort-Verfahrens (B1, Pflichtenheft §7).
     *
     * `null` bei Konten, die ausschließlich über einen externen Provider
     * angelegt wurden und noch kein Passwort haben – genau das sagt auch
     * `AccountDto.username` aus F1 zu. Sobald ein Passwort verknüpft wird,
     * kommt hier ein Wert hinein.
     */
    username: text('username'),
    /**
     * Frei wählbarer Anzeigename. Bewusst **nicht** eindeutig: bei Konten aus
     * Discord, Steam und Twitch kollidieren Anzeigenamen leicht, und der Name
     * dient nur der Darstellung. Eindeutig sein muss allein `username`.
     */
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
    /**
     * Eindeutigkeit der Anmeldekennung ohne Rücksicht auf Groß-/Kleinschreibung
     * (B1, Pflichtenheft §7): „Spieler" und „spieler" dürfen nicht nebeneinander
     * existieren, sonst wäre der Login mehrdeutig. Partiell, weil reine
     * Provider-Konten keine Kennung haben und `null` sich nicht sperren soll.
     */
    uniqueIndex('users_username_lower_idx')
      .on(sql`lower(${table.username})`)
      .where(sql`${table.username} is not null`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
