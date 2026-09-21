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

import { type AchievementId } from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Rohbytes in Postgres (`bytea`).
 *
 * Drizzle bringt für `bytea` keinen eigenen Spaltentyp mit; der Treiber
 * liefert und nimmt aber `Buffer`. Deshalb hier einmal benannt, statt an der
 * Spalte mit einem `any` zu arbeiten.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

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
    /**
     * Profilbild des Kontos – als Bytes an der Zeile, nicht als Datei.
     *
     * ⚠️ Bewusst in der Datenbank, gegen die Faustregel „keine Blobs in die
     * DB": Ein Panel dieser Größe hat ein paar Dutzend Konten, das sind ein
     * paar Megabyte. Dafür fällt zweierlei weg. Erstens die Sicherung – der
     * nächtliche `pg_dump` läuft ohnehin, ein Bilderordner müsste eigens in
     * den Plan und wäre beim Vergessen unwiederbringlich. Zweitens die
     * Deploy-Falle: Ein Verzeichnis unter `/opt/palantir` müsste **außerhalb**
     * des Release-Ordners liegen, sonst räumt jedes Deployment es ab.
     *
     * **Anders als bei den Schriften** (`uploaded_fonts`), und das mit Absicht:
     * Eine Schriftdatei ist bis zu 8 MiB groß und geht bei jedem Seitenaufruf
     * über die Leitung – die liegt deshalb als Datei im Ablageort. Ein
     * Profilbild ist nach dem Zuschneiden im Browser wenige Zehntel davon und
     * wird selten geladen. Bei dieser Größe wiegt der Vorteil schwerer, dass
     * es ohne Zutun im nächtlichen Abzug steckt.
     *
     * Verkleinert und zugeschnitten wird im Browser (höchstens 512×512); das
     * Backend prüft nur Größe und Typ und braucht damit keine Bildbibliothek.
     */
    avatarData: bytea('avatar_data'),
    /** MIME-Typ des Bildes; nur gesetzt, wenn auch `avatarData` gesetzt ist. */
    avatarMimeType: text('avatar_mime_type'),
    /**
     * Wann das Bild zuletzt gesetzt wurde. Steht als `avatarUpdatedAt` im
     * `AccountDto` und hängt dort an der Bild-Adresse, damit der Browser nach
     * einem neuen Bild nicht das alte aus seinem Zwischenspeicher zeigt.
     */
    avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true }),
    /**
     * Abzeichen, dessen Titel das Konto neben seinem Anzeigenamen trägt;
     * `null`, wenn es keinen trägt (Betreiber-Wunsch 21.09.2026).
     *
     * Gespeichert wird die **Kennung des Abzeichens**, nicht der Titeltext:
     * Wird ein Titel im Katalog später umformuliert, trägt das Konto weiter
     * denselben Titel in neuer Schreibweise – ein gespeicherter Text bliebe
     * dagegen auf dem alten Stand stehen.
     *
     * Bewusst **ohne** Fremdschlüssel auf `user_achievements`: Ein solcher
     * müsste auf das Paar (Konto, Abzeichen) zeigen und liefe damit im Kreis
     * zurück auf diese Tabelle. Dass das Konto das Abzeichen wirklich
     * freigeschaltet hat, prüft der Service bei der Wahl
     * (`ACHIEVEMENT_NOT_UNLOCKED`). Verlieren kann es das Abzeichen danach
     * nicht – Abzeichen werden nie entzogen.
     */
    titleAchievementId: text('title_achievement_id').$type<AchievementId>(),
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
