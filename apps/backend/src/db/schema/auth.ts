/**
 * Tabellen des Arbeitspakets B1 – Auth & Identity (Pflichtenheft §6 und §7).
 *
 * Enthält die Entitäten `AuthMethod` und `Session`. Die Entität `User` liegt in
 * `users.ts` und wurde aus B2 heraus angelegt (WORK_STATUS.md, Gefundener Punkt
 * 11); B1 erweitert sie dort ausschließlich additiv.
 */

import { type AuthMethodType } from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Erlaubte Werte der Spalte `type` für den Check-Constraint.
 *
 * Bewusst als Literal wiederholt statt aus `AUTH_METHOD_TYPES` erzeugt:
 * Drizzle Kit lädt diese Datei beim Erzeugen der Migration über den
 * CommonJS-Loader und kann das reine ESM-Paket `@palantir/contracts` dort nicht
 * auflösen – ein Wert-Import würde `db:generate` scheitern lassen (Typ-Importe
 * sind unproblematisch, sie verschwinden beim Übersetzen). Damit die Liste
 * nicht auseinanderläuft, hält der Test `schema/auth.test.ts` sie gegen
 * `AUTH_METHOD_TYPES` – ein neuer Typ im Vertrag ohne Migration hier lässt die
 * Tests scheitern. Dasselbe Muster nutzt A1 für die Fehlercode-Zuordnung.
 */
export const AUTH_METHOD_TYPE_CHECK_VALUES = [
  'password',
  'discord',
  'twitch',
  'steam',
] as const satisfies readonly AuthMethodType[];

const authMethodTypeList = sql.raw(
  AUTH_METHOD_TYPE_CHECK_VALUES.map((type) => `'${type}'`).join(', '),
);

/**
 * Eine Login-Methode eines Kontos (Pflichtenheft §6, Entität `AuthMethod`).
 *
 * Ein Konto kann mehrere Methoden haben – Passwort und OAuth/OpenID
 * nebeneinander (Lastenheft §3.1). Welche Spalten gefüllt sind, hängt am `type`:
 *
 * - `password`: `passwordHash` gesetzt, `providerUserId` leer
 * - `discord`/`twitch`/`steam`: `providerUserId` gesetzt, `passwordHash` leer
 *
 * Diese Regel steht als Check-Constraint in der Migration, damit ein
 * OAuth-Eintrag nicht versehentlich zum Passwort-Login werden kann.
 */
export const authMethods = pgTable(
  'auth_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * `$type` bindet die Spalte an `AUTH_METHOD_TYPES` aus
     * `@palantir/contracts`. Die Datenbank speichert `text`; die Gültigkeit
     * sichert zusätzlich ein Check-Constraint in der Migration.
     */
    type: text('type').$type<AuthMethodType>().notNull(),
    /** Kennung beim externen Anbieter; `null` bei `password`. */
    providerUserId: text('provider_user_id'),
    /**
     * Argon2id-Hash (Pflichtenheft §7 und §18); `null` bei OAuth-Methoden.
     * Das Klartext-Passwort wird an keiner Stelle gespeichert oder geloggt.
     */
    passwordHash: text('password_hash'),
    /**
     * Anzeigename und Avatar beim Anbieter – Wiedererkennungshilfe für die
     * Freischalt-Warteliste (Lastenheft §3.1).
     */
    providerDisplayName: text('provider_display_name'),
    providerAvatarUrl: text('provider_avatar_url'),
    /**
     * Ein Admin hat das Passwort zurückgesetzt (Lastenheft §3.1). Bis zur
     * Änderung sind zustandsändernde Requests gesperrt.
     */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /**
     * Base32-kodiertes TOTP-Geheimnis (Pflichtenheft §7, nur bei `password`).
     *
     * Liegt bewusst unverschlüsselt: Wer Lesezugriff auf die Datenbank hat,
     * kommt damit an den zweiten Faktor, aber nicht am Argon2id-Passwort-Hash
     * vorbei. Eine Verschlüsselung mit einem Schlüssel aus derselben `.env`
     * würde denselben Angreifer nicht aufhalten (begründet in Pflichtenheft §7).
     */
    totpSecret: text('totp_secret'),
    /**
     * Zeitpunkt der Bestätigung. Solange `null`, liegt zwar ein Geheimnis vor,
     * die Einrichtung wurde aber nie mit einem gültigen Code abgeschlossen –
     * 2FA gilt dann als **nicht** aktiv.
     */
    totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    /**
     * Eine externe Identität gehört zu genau einem Konto. Verhindert auf
     * Datenbankebene, dass sich zwei Konten dieselbe Discord-Kennung teilen
     * (Pflichtenheft §7).
     */
    uniqueIndex('auth_methods_provider_identity_idx')
      .on(table.type, table.providerUserId)
      .where(sql`${table.providerUserId} is not null`),
    /** Je Konto höchstens eine Methode pro Typ (Lastenheft §3.1). */
    uniqueIndex('auth_methods_user_type_idx').on(table.userId, table.type),
    index('auth_methods_user_id_idx').on(table.userId),
    /** Nur Typen aus `AUTH_METHOD_TYPES` (Pflichtenheft §6). */
    check('auth_methods_type_check', sql`${table.type} in (${authMethodTypeList})`),
    /**
     * Die Belegung passt zum Typ: `password` braucht einen Hash und darf keine
     * Anbieter-Kennung tragen, jede andere Methode genau umgekehrt. Verhindert,
     * dass ein OAuth-Eintrag durch ein nachträglich gesetztes `password_hash`
     * still zum Passwort-Login wird.
     */
    check(
      'auth_methods_shape_check',
      sql`(${table.type} = 'password' and ${table.passwordHash} is not null and ${table.providerUserId} is null)
          or (${table.type} <> 'password' and ${table.providerUserId} is not null and ${table.passwordHash} is null)`,
    ),
    /** TOTP gibt es ausschließlich für Passwort-Konten (Pflichtenheft §7). */
    check(
      'auth_methods_totp_password_only_check',
      sql`${table.totpSecret} is null or ${table.type} = 'password'`,
    ),
  ],
);

/**
 * Eine angemeldete Sitzung (Pflichtenheft §6, Entität `Session`, und §7).
 *
 * Der Refresh-Token liegt ausschließlich **gehasht** hier – im Klartext
 * existiert er nur im httpOnly-Cookie des jeweiligen Geräts. Über diese Tabelle
 * läuft die Geräteübersicht und der einzelne Remote-Logout (Lastenheft §3.1).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * SHA-256 des opaken Refresh-Tokens, hexadezimal.
     *
     * Bewusst SHA-256 statt Argon2id: der Token besteht aus 32 Zufallsbytes und
     * hat damit volle Entropie – ein langsamer Hash schützt dort vor nichts,
     * liegt aber auf jedem Refresh-Request (begründet in Pflichtenheft §7).
     */
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    /**
     * Der bei der letzten Rotation ersetzte Hash (Pflichtenheft §7).
     *
     * Nur dadurch bleibt ein bereits ersetzter Token wiedererkennbar: Ohne
     * dieses Feld wäre er nach der Rotation schlicht nicht mehr auffindbar und
     * ein Diebstahl sähe aus wie ein abgelaufener Token. Taucht ein Token hier
     * auf, werden alle Sitzungen des Kontos widerrufen.
     */
    previousRefreshTokenHash: text('previous_refresh_token_hash'),
    /** Grobe Gerätekennung aus dem User-Agent, z. B. „Firefox auf Windows". */
    deviceInfo: text('device_info'),
    /** Gekürzte Herkunfts-IP als Wiedererkennungshilfe, z. B. `203.0.113.x`. */
    ipHint: text('ip_hint'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * Gesetzt beim Logout, beim Remote-Logout und bei der Token-Rotation.
     * Widerrufene Sitzungen bleiben stehen, damit die Wiederverwendung eines
     * bereits ersetzten Tokens erkennbar bleibt (Pflichtenheft §7).
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
    index('sessions_previous_refresh_token_hash_idx').on(table.previousRefreshTokenHash),
  ],
);

export type AuthMethodRow = typeof authMethods.$inferSelect;
export type NewAuthMethodRow = typeof authMethods.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
