/**
 * Hochgeladene Schriften der Oberfläche (Arbeitspaket S-2).
 *
 * Der Vertrag steht in `packages/contracts/src/font.ts`; hier liegt nur, was
 * eine hochgeladene Schrift in der Datenbank ausmacht. **Mitgelieferte
 * Schriften stehen bewusst nicht in dieser Tabelle**: Sie liegen als Dateien im
 * Auslieferungsverzeichnis, tragen eine Kennung mit dem Präfix `bundled-`
 * (siehe `BUNDLED_FONT_ID_PREFIX`) und lassen sich damit ohne Datenbankabfrage
 * auflösen. Eine Zeile je mitgelieferter Schrift wäre eine zweite Wahrheit
 * neben dem Auslieferungsverzeichnis – und nach dem nächsten Aufspielen
 * veraltet.
 *
 * **Die Datei selbst steht ebenfalls nicht hier.** Sie liegt unter
 * `FONT_UPLOAD_DIR` auf der VPS, wie die Audit-Archive und die Panel-Abzüge
 * (.env.example Abschnitt 18). Eine Schriftdatei ist bis zu 8 MiB groß und
 * wird bei jedem Seitenaufruf ausgeliefert; in der Datenbank wäre sie in jedem
 * Abzug, in jeder Replikation und in jedem Arbeitsspeicher-Puffer noch einmal
 * enthalten. Die Spalte {@link uploadedFonts.sha256} ist der Zeiger darauf: der
 * Dateiname im Ablageort ergibt sich aus `id` und Format, die Prüfsumme belegt,
 * dass die Datei noch die ist, die hochgeladen wurde.
 */

import { type FontFormat } from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const uploadedFonts = pgTable(
  'uploaded_fonts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Name, der im `font-family` der erzeugten `@font-face`-Regel steht.
     *
     * Geprüft wird er beim Hochladen gegen `fontFamilyNameSchema`
     * (`@palantir/validation`) – hier steht nur das Ergebnis.
     */
    family: text('family').notNull(),
    /** Anzeigename in der Oberfläche; rein zur Darstellung, nie im CSS. */
    label: text('label').notNull(),
    /** Format aus `FONT_FORMATS`, entschieden an den Kopfbytes der Datei. */
    format: text('format').$type<FontFormat>().notNull(),
    /**
     * Größe der Schriftdatei in Bytes.
     *
     * `integer` reicht: Die größte Grenze im `FONT_FORMAT_CATALOG` liegt bei
     * 8 MiB, also gut zwei Zehnerpotenzen unter dem Wertebereich.
     */
    sizeBytes: integer('size_bytes').notNull(),
    /** Variable Schrift – eine Datei über einen ganzen Gewichtsbereich. */
    variable: boolean('variable').notNull().default(false),
    /**
     * Dicktengleich – jedes Zeichen ist gleich breit (`FontDto.monospace`).
     *
     * **Eine Angabe, keine Messung**: Der Wert kommt beim Hochladen aus dem
     * Formular, nicht aus der Datei. Ihn auszulesen hieße, die `post`-Tabelle
     * der Schrift zu entpacken – ein Parser über fremdbestimmte Daten. Vorgabe
     * `false`, weil das der häufigere Fall ist und eine falsch als
     * dicktengleich gemeldete Schrift in der Konsole mehr Schaden anrichtet als
     * umgekehrt.
     */
    monospace: boolean('monospace').notNull().default(false),
    /** Kleinstes verfügbares Gewicht; bei statischen Schriften gleich `weightMax`. */
    weightMin: integer('weight_min').notNull(),
    weightMax: integer('weight_max').notNull(),
    /**
     * SHA-256 der Datei in Hexschreibweise (64 Zeichen).
     *
     * Zeiger und Prüfsumme in einem: Ob die Datei im Ablageort noch dieselbe
     * ist, lässt sich damit ohne zweite Quelle feststellen.
     */
    sha256: text('sha256').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Konto des Hochladenden; `null`, sobald es gelöscht ist.
     *
     * Der Anzeigename daneben ist eine **Kopie** zum Zeitpunkt des Uploads und
     * bleibt auch dann lesbar – dieselbe Aufteilung wie im Audit-Log
     * (Pflichtenheft §6).
     */
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    uploadedByDisplayName: text('uploaded_by_display_name'),
  },
  (table) => [
    /**
     * Ein `font-family`-Name kommt genau einmal vor – ohne Rücksicht auf
     * Groß-/Kleinschreibung, weil CSS Familiennamen so vergleicht.
     *
     * Zwei Schriften mit demselben Namen ergäben zwei `@font-face`-Regeln für
     * dieselbe Familie: Die zweite überschriebe die erste, und welche der
     * beiden Dateien der Browser lädt, hinge an der Reihenfolge im erzeugten
     * CSS. Dasselbe Muster wie `users_username_lower_idx` und
     * `notification_channels_name_lower_idx`.
     */
    uniqueIndex('uploaded_fonts_family_lower_idx').on(sql`lower(${table.family})`),
    /**
     * Der Gewichtsbereich muss in die CSS-Grenzen passen und darf nicht
     * umgedreht sein (`FONT_WEIGHT_MIN`/`FONT_WEIGHT_MAX`, `fontWeightRangeSchema`).
     *
     * Die Prüfung steht zusätzlich in der Datenbank, weil ein umgedrehter
     * Bereich in der erzeugten `@font-face`-Regel wirkungslos wäre – die
     * Schrift bliebe stumm, ohne dass irgendwo ein Fehler auftaucht.
     */
    check(
      'uploaded_fonts_weight_range',
      sql`${table.weightMin} >= 1 and ${table.weightMax} <= 1000 and ${table.weightMin} <= ${table.weightMax}`,
    ),
  ],
);

export type UploadedFontRow = typeof uploadedFonts.$inferSelect;
export type NewUploadedFontRow = typeof uploadedFonts.$inferInsert;
