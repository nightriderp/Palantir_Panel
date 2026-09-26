/**
 * Übersichts-Kacheln ohne Server (Betreiber-Wunsch 26.09.2026).
 *
 * Eine Kachel, hinter der kein `game_servers`-Datensatz steht: ein Server auf
 * einer fremden Instanz, ein Community-Discord. Vom Administrator angelegt,
 * für jedes freigeschaltete Konto sichtbar – anders als `server_pins`, die je
 * Betrachter gelten.
 *
 * **Warum eine eigene Tabelle und kein Sonderfall in `game_servers`.** Ein
 * Server-Datensatz zieht Lebenszyklus, Node, Kontingent und Berechtigungen
 * nach sich; eine Kachel hat davon nichts. Ein „Server ohne Node" wäre eine
 * Zeile, die in jeder Abfrage der Orchestrierung als Sonderfall aufträte.
 *
 * `game_type_id` hängt wie bei `game_type_images` an der **Kennung** der
 * Registry, nicht an einem Fremdschlüssel – Spieltypen sind Code, keine
 * Tabelle. Verschwindet ein Spieltyp, bleibt die Kachel ohne Bild stehen.
 */

import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const overviewTiles = pgTable('overview_tiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  /** Kennung des Spieltyps (Registry, kein FK); `null` = kein Spiel aus dem Katalog. */
  gameTypeId: text('game_type_id'),
  /** Spielbezeichnung als Text, z. B. „CS2 · Surf". */
  gameLabel: text('game_label'),
  /** Verbindungsadresse, wie ein Spieler sie eintippt. */
  address: text('address'),
  /** Ziel des Knopfes (nur http/https, geprüft in `@palantir/validation`). */
  linkUrl: text('link_url'),
  linkLabel: text('link_label'),
  /** Reihenfolge in der Übersicht – kleine Zahl zuerst. */
  sortOrder: integer('sort_order').notNull().default(0),
  /** Ausgeschaltet = nicht in der Übersicht, aber nicht gelöscht. */
  enabled: boolean('enabled').notNull().default(true),
  /**
   * Wer sie angelegt hat; `null`, wenn das Konto später verschwindet.
   *
   * **Bewusst ohne Index**, wie bei `announcements.published_by_user_id`: Eine
   * Handvoll Zeilen, angelegt von Administratoren – die Tabelle wächst nicht
   * mit der Nutzung.
   */
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
