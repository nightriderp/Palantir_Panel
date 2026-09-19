/**
 * Bilder eines Spieltyps: Symbol und Kachelbild (Betreiber-Wunsch 19.09.2026).
 *
 * **Warum in der Datenbank und nicht im Image oder auf der Platte.** Dieselbe
 * Überlegung wie bei Profilbildern und hochgeladenen Schriften: Die Instanz
 * läuft in einem Container, ihr Dateisystem ist flüchtig, und ein zweiter Ort
 * für Daten wäre ein zweiter Ort zum Sichern. Ein Symbol wiegt Kilobytes; der
 * nächtliche Abzug merkt davon nichts.
 *
 * **Warum eine eigene Tabelle und keine Spalten an einer Spieltyp-Tabelle.**
 * Es gibt keine: Spieltypen stehen als Code in der Registry
 * (`modules/server-orchestration/game-registry.ts`), nicht in der Datenbank.
 * Diese Tabelle hängt deshalb an der **Kennung** des Spieltyps und nicht an
 * einem Fremdschlüssel. Verschwindet ein Spieltyp aus der Registry, bleibt
 * sein Bild als Waise liegen – das ist ein paar Kilobyte wert, verglichen mit
 * einer Kaskade, die beim nächsten Umbenennen Bilder löscht.
 */

import { customType, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** Rohbytes in Postgres; wie in `users.ts`, siehe Kommentar dort. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** Welche Stelle ein Bild füllt. */
export type GameTypeImageKind = 'icon' | 'cover';

export const gameTypeImages = pgTable(
  'game_type_images',
  {
    /** Kennung des Spieltyps, z. B. `minecraft-vanilla` (Registry, kein FK). */
    gameTypeId: text('game_type_id').notNull(),
    /** `icon` (quadratisch) oder `cover` (Kachelbild, breit). */
    kind: text('kind').$type<GameTypeImageKind>().notNull(),
    data: bytea('data').notNull(),
    mimeType: text('mime_type').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Wer es hochgeladen hat; `null`, wenn das Konto später verschwindet.
     *
     * Das Bild bleibt dann stehen: Es gehört zur Vorlage, nicht zur Person.
     */
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.gameTypeId, table.kind] }),
    // Trägt das Auflisten aller Bilder für die Spieleliste (ein Abruf je Seite).
    index('game_type_images_kind_idx').on(table.kind),
    index('game_type_images_uploaded_by_idx').on(table.uploadedById),
  ],
);
