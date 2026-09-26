/**
 * Tabellen der Spielhalle (Pflichtenheft §6 und §17, Lastenheft §3.9).
 *
 * - `arcade_scores`: persistierte Ergebnisse. Seit dem Neubau (26.09.2026)
 *   rechnet das Backend jedes Ergebnis selbst nach (`verified`); der
 *   Altbestand davor war client-authoritativ und bleibt unverifiziert stehen.
 * - `arcade_seeds`: vom Backend ausgegebene, einmal verwendbare Startwerte.
 * - `arcade_rooms`: Online-Räume der rundenbasierten Spiele, der Server ist
 *   Schiedsrichter.
 * - `arcade_tracks`: hochgeladene Musikstücke je Spiel.
 *
 * Es wird **jeder** Versuch gespeichert (nicht nur der beste): So bleibt
 * `gamesPlayed` zählbar und die Bestenliste lässt sich jederzeit aus den
 * Rohdaten neu berechnen. Der Bestwert (bzw. die Siegzahl) je Konto entsteht
 * als Aggregat in der Abfrage, nicht als überschriebene Zeile.
 */

import {
  type ArcadeBotLevel,
  type ArcadeGameId,
  type ArcadeRoomStatus,
  type ArcadeTrackMimeType,
} from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** Rohbytes in Postgres; wie in `users.ts`, siehe Kommentar dort. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Ergebnis eines Kontos in einem Spiel (Pflichtenheft §6, `ArcadeScore`).
 *
 * `gameId` ist bewusst `text` mit Typbindung an `ArcadeGameId` statt eines
 * Postgres-Enums: ein zusätzliches Spiel wäre sonst eine Migration am Typ, nicht
 * nur am Katalog (dieselbe Überlegung wie bei `host_nodes.status`).
 *
 * Bei Spielen mit `metric: 'wins'` ist jede Zeile ein Sieg (`score = 1`).
 *
 * Löscht der Betreiber ein Konto, verschwinden dessen Ergebnisse mit
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
    /**
     * Startwert, aus dem die Partie nachgerechnet wurde (Neubau 26.09.2026).
     *
     * Kein Fremdschlüssel: Abgelaufene Startwerte räumt das Backend weg, der
     * Eintrag in der Bestenliste soll bleiben. Bei Siegen aus Online-Räumen
     * und beim Altbestand leer.
     */
    seedId: uuid('seed_id'),
    /** Fassung der Spielregeln, gegen die gerechnet wurde; Altbestand leer. */
    gameVersion: integer('game_version'),
    /**
     * Hat das Backend den Stand selbst errechnet (Band nachgespielt oder Sieg
     * im Online-Raum)? Der Altbestand vor dem Neubau war client-authoritativ
     * und bleibt als `false` stehen.
     */
    verified: boolean('verified').notNull().default(false),
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

/**
 * Vom Backend ausgegebene Startwerte (Neubau 26.09.2026, Vorbild
 * Schwesterprojekt).
 *
 * Einmal verwendbar: `used_at` wird beim Einreichen atomar gesetzt. Ein Band
 * mit selbst gewähltem Startwert kommt so nicht in die Bestenliste, und wer
 * denselben Startwert zweimal spielt, kann ihn nur einmal einreichen.
 */
export const arcadeSeeds = pgTable(
  'arcade_seeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: text('game_id').$type<ArcadeGameId>().notNull(),
    /** uint32 – `bigint`, weil `integer` bei 2^31 aufhört. */
    seed: bigint('seed', { mode: 'number' }).notNull(),
    gameVersion: integer('game_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    index('arcade_seeds_user_game_idx').on(table.userId, table.gameId),
    // Aufräumen abgelaufener Startwerte.
    index('arcade_seeds_expires_idx').on(table.expiresAt),
  ],
);

export type ArcadeSeedRow = typeof arcadeSeeds.$inferSelect;

/** Belegung eines Sitzes im Raum, wie sie in `arcade_rooms.seats` liegt. */
export interface ArcadeRoomSeatRecord {
  kind: 'human' | 'bot' | 'open';
  userId: string | null;
  botLevel: ArcadeBotLevel | null;
}

/** Eine Chatzeile im Raum, wie sie in `arcade_rooms.chat` liegt. */
export interface ArcadeRoomChatRecord {
  id: string;
  userId: string | null;
  displayName: string;
  text: string;
  sentAt: string;
}

/**
 * Online-Räume der rundenbasierten Spiele (Neubau 26.09.2026).
 *
 * Der Server ist Schiedsrichter: Die laufende Partie (`match`, ein
 * `TurnMatch` aus `@palantir/arcade`) liegt vollständig hier, samt verdeckter
 * Information. Nach außen geht nur die Sicht je Sitz.
 *
 * Sitze, Partie und Chat als `jsonb`: Sie werden immer als Ganzes gelesen und
 * geschrieben, und `version` schützt jede Änderung gegen eine gleichzeitige
 * zweite (optimistische Sperre).
 */
export const arcadeRooms = pgTable(
  'arcade_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Sechsstelliger Beitrittscode; eindeutig unter den nicht geschlossenen Räumen. */
    code: text('code').notNull(),
    gameId: text('game_id').$type<ArcadeGameId>().notNull(),
    hostUserId: uuid('host_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<ArcadeRoomStatus>().notNull().default('lobby'),
    isPrivate: boolean('is_private').notNull().default(false),
    seats: jsonb('seats').$type<ArcadeRoomSeatRecord[]>().notNull(),
    options: jsonb('options').$type<unknown>().notNull(),
    /** Laufende oder beendete Partie; `null` in der Lobby. */
    match: jsonb('match').$type<unknown>(),
    version: integer('version').notNull().default(0),
    chat: jsonb('chat')
      .$type<ArcadeRoomChatRecord[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('arcade_rooms_open_code_idx')
      .on(table.code)
      .where(sql`${table.status} <> 'closed'`),
    index('arcade_rooms_status_idx').on(table.status),
    index('arcade_rooms_host_idx').on(table.hostUserId),
    check(
      'arcade_rooms_status_check',
      sql`${table.status} in ('lobby', 'running', 'finished', 'closed')`,
    ),
  ],
);

export type ArcadeRoomRow = typeof arcadeRooms.$inferSelect;

/**
 * Hochgeladene Musikstücke der Spielhalle (Admin-Seite „Arcade-Musik").
 *
 * Je Spiel höchstens ein aktives Stück (partieller eindeutiger Index). Ohne
 * aktives Stück spielt die Oberfläche die mitgelieferte Melodie.
 */
export const arcadeTracks = pgTable(
  'arcade_tracks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: text('game_id').$type<ArcadeGameId>().notNull(),
    title: text('title').notNull(),
    /** Aus den ersten Bytes erkannt, nicht vom Browser übernommen. */
    mimeType: text('mime_type').$type<ArcadeTrackMimeType>().notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    /** Wer es hochgeladen hat; `null`, wenn das Konto später verschwindet. */
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('arcade_tracks_active_game_idx')
      .on(table.gameId)
      .where(sql`${table.isActive}`),
    index('arcade_tracks_game_idx').on(table.gameId),
    index('arcade_tracks_uploaded_by_idx').on(table.uploadedBy),
  ],
);

export type ArcadeTrackRow = typeof arcadeTracks.$inferSelect;
