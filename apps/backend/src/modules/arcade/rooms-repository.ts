/**
 * Datenzugriffe der Online-Räume (Neubau 26.09.2026).
 *
 * Zwei Zusicherungen:
 *  - **Optimistische Sperre.** {@link ArcadeRoomRepository.update} schreibt
 *    nur, wenn `version` noch die erwartete ist. Wer verliert, lädt neu.
 *  - **Chat getrennt vom Rest.** Chatzeilen hängt ein eigenes `UPDATE` an
 *    (`appendChat`), und `update` fasst die Spalte `chat` nie an. Sonst
 *    überschriebe ein Zug mit seiner geladenen Kopie eine gleichzeitig
 *    geschriebene Chatzeile – und Chat soll Züge nicht an der Version
 *    scheitern lassen, also schützt die Version ihn nicht.
 */

import { type ArcadeGameId } from '@palantir/contracts';
import { and, count, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import {
  type ArcadeRoomChatRecord,
  type ArcadeRoomRow,
  arcadeRooms,
} from '../../db/schema/arcade.js';
import { users } from '../../db/schema/users.js';
import { type ArcadeRoom, type RoomProfile, type StoredMatch } from './rooms.js';

export type NewArcadeRoom = Pick<
  ArcadeRoom,
  'code' | 'gameId' | 'hostUserId' | 'isPrivate' | 'seats' | 'options'
>;

export interface ArcadeRoomRepository {
  /** Legt einen Raum an; `null`, wenn der Code unter den offenen Räumen schon vergeben ist. */
  insert(room: NewArcadeRoom): Promise<ArcadeRoom | null>;
  findById(id: string): Promise<ArcadeRoom | null>;
  /** Nicht geschlossener Raum mit diesem Code. */
  findOpenByCode(code: string): Promise<ArcadeRoom | null>;
  /**
   * Räume für die Lobby-Liste: öffentliche Lobbys, eigene Räume in Lobby oder
   * laufend und eigene beendete seit `finishedSince`.
   */
  listVisible(
    userId: string,
    gameId: ArcadeGameId | null,
    finishedSince: Date,
  ): Promise<ArcadeRoom[]>;
  /** Räume in Lobby oder laufend, die das Konto leitet. */
  countOpenByHost(userId: string): Promise<number>;
  /**
   * Schreibt alles außer `chat`, wenn `version` noch `expectedVersion` ist.
   * `false` bei verlorener Sperre.
   */
  update(room: ArcadeRoom, expectedVersion: number): Promise<boolean>;
  /** Hängt eine Chatzeile an und kürzt auf die letzten `limit`; `false`, wenn der Raum zu ist. */
  appendChat(id: string, line: ArcadeRoomChatRecord, limit: number): Promise<boolean>;
  listRunningIds(): Promise<string[]>;
  /** Schließt Räume ohne Änderung seit `cutoff` und liefert sie (Stand nach dem Schließen). */
  closeIdle(cutoff: Date): Promise<ArcadeRoom[]>;
  /** Anzeigename und Profilbild je Konto. */
  profiles(userIds: readonly string[]): Promise<Map<string, RoomProfile>>;
}

function toRoom(row: ArcadeRoomRow): ArcadeRoom {
  return {
    id: row.id,
    code: row.code,
    gameId: row.gameId,
    hostUserId: row.hostUserId,
    status: row.status,
    isPrivate: row.isPrivate,
    seats: row.seats,
    options: row.options,
    match: (row.match ?? null) as StoredMatch | null,
    version: row.version,
    chat: row.chat,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  };
}

/** Postgres-Fehler „eindeutiger Index verletzt" – auch hinter Drizzles Hülle. */
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, i = 0; current && i < 3; i += 1) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === '23505') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/** Sitzt das Konto im Raum? (`seats @> [{"userId": …}]`) */
function sitztIm(userId: string) {
  return sql`${arcadeRooms.seats} @> ${JSON.stringify([{ userId }])}::jsonb`;
}

export function createDrizzleArcadeRoomRepository(db: Database): ArcadeRoomRepository {
  return {
    async insert(room) {
      try {
        const [row] = await db
          .insert(arcadeRooms)
          .values({
            code: room.code,
            gameId: room.gameId,
            hostUserId: room.hostUserId,
            isPrivate: room.isPrivate,
            seats: room.seats,
            options: room.options ?? {},
            status: 'lobby',
          })
          .returning();

        return row ? toRoom(row) : null;
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async findById(id) {
      const [row] = await db.select().from(arcadeRooms).where(eq(arcadeRooms.id, id));

      return row ? toRoom(row) : null;
    },

    async findOpenByCode(code) {
      const [row] = await db
        .select()
        .from(arcadeRooms)
        .where(and(eq(arcadeRooms.code, code), ne(arcadeRooms.status, 'closed')));

      return row ? toRoom(row) : null;
    },

    async listVisible(userId, gameId, finishedSince) {
      const eigene = or(eq(arcadeRooms.hostUserId, userId), sitztIm(userId));
      const rows = await db
        .select()
        .from(arcadeRooms)
        .where(
          and(
            gameId === null ? undefined : eq(arcadeRooms.gameId, gameId),
            or(
              and(eq(arcadeRooms.status, 'lobby'), eq(arcadeRooms.isPrivate, false)),
              and(inArray(arcadeRooms.status, ['lobby', 'running']), eigene),
              and(
                eq(arcadeRooms.status, 'finished'),
                gt(arcadeRooms.finishedAt, finishedSince),
                eigene,
              ),
            ),
          ),
        )
        .orderBy(sql`${arcadeRooms.updatedAt} desc`)
        .limit(100);

      return rows.map(toRoom);
    },

    async countOpenByHost(userId) {
      const [row] = await db
        .select({ anzahl: count() })
        .from(arcadeRooms)
        .where(
          and(
            eq(arcadeRooms.hostUserId, userId),
            inArray(arcadeRooms.status, ['lobby', 'running']),
          ),
        );

      return Number(row?.anzahl ?? 0);
    },

    async update(room, expectedVersion) {
      const rows = await db
        .update(arcadeRooms)
        .set({
          hostUserId: room.hostUserId,
          status: room.status,
          seats: room.seats,
          options: room.options ?? {},
          match: room.match,
          version: room.version,
          updatedAt: room.updatedAt,
          finishedAt: room.finishedAt,
        })
        .where(and(eq(arcadeRooms.id, room.id), eq(arcadeRooms.version, expectedVersion)))
        .returning({ id: arcadeRooms.id });

      return rows.length > 0;
    },

    async appendChat(id, line, limit) {
      /*
       * Anhängen und Kürzen in einem Ausdruck: die letzten `limit` Elemente
       * von `chat || [line]`, in ursprünglicher Reihenfolge.
       */
      const rows = await db
        .update(arcadeRooms)
        .set({
          chat: sql`(
            select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
            from (
              select e, i
              from jsonb_array_elements(${arcadeRooms.chat} || ${JSON.stringify([line])}::jsonb)
                with ordinality as x(e, i)
              order by i desc
              limit ${limit}
            ) t
          )`,
          updatedAt: new Date(),
        })
        .where(and(eq(arcadeRooms.id, id), ne(arcadeRooms.status, 'closed')))
        .returning({ id: arcadeRooms.id });

      return rows.length > 0;
    },

    async listRunningIds() {
      const rows = await db
        .select({ id: arcadeRooms.id })
        .from(arcadeRooms)
        .where(eq(arcadeRooms.status, 'running'));

      return rows.map((row) => row.id);
    },

    async closeIdle(cutoff) {
      const rows = await db
        .update(arcadeRooms)
        .set({
          status: 'closed',
          version: sql`${arcadeRooms.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(ne(arcadeRooms.status, 'closed'), lt(arcadeRooms.updatedAt, cutoff)))
        .returning();

      return rows.map(toRoom);
    },

    async profiles(userIds) {
      const map = new Map<string, RoomProfile>();

      if (userIds.length === 0) return map;

      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          avatarUpdatedAt: users.avatarUpdatedAt,
        })
        .from(users)
        .where(inArray(users.id, [...new Set(userIds)]));

      for (const row of rows) {
        map.set(row.id, { displayName: row.displayName, avatarUpdatedAt: row.avatarUpdatedAt });
      }

      return map;
    },
  };
}
