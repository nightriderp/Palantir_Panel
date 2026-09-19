/**
 * Drizzle-Umsetzung der Bilder-Ablage eines Spieltyps.
 *
 * Ein Bild je Spieltyp und Stelle: Das Schreiben ist deshalb ein Upsert auf
 * den zusammengesetzten Schlüssel, kein Anlegen daneben.
 */

import { and, eq } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { gameTypeImages } from '../../db/schema.js';
import {
  type GameTypeImageKind,
  type GameTypeImageRecord,
  type GameTypeImageRepository,
} from './index.js';

export function createDrizzleGameTypeImageRepository(db: DbConnection): GameTypeImageRepository {
  return {
    async find(gameTypeId, kind) {
      const [row] = await db
        .select()
        .from(gameTypeImages)
        .where(and(eq(gameTypeImages.gameTypeId, gameTypeId), eq(gameTypeImages.kind, kind)))
        .limit(1);

      return row === undefined
        ? null
        : {
            gameTypeId: row.gameTypeId,
            kind: row.kind,
            data: row.data,
            mimeType: row.mimeType,
            updatedAt: row.updatedAt,
          };
    },

    async listUpdatedAt() {
      /*
       * Ohne die Bilddaten: Die Liste beantwortet nur „gibt es eines und wie
       * alt ist es". Sie läuft bei jedem Abruf der Spieleliste – mit den Bytes
       * wären das ein paar Megabyte je Seitenaufruf.
       */
      const rows = await db
        .select({
          gameTypeId: gameTypeImages.gameTypeId,
          kind: gameTypeImages.kind,
          updatedAt: gameTypeImages.updatedAt,
        })
        .from(gameTypeImages);

      const stand = new Map<string, Partial<Record<GameTypeImageKind, Date>>>();

      for (const row of rows) {
        const eintrag = stand.get(row.gameTypeId) ?? {};
        eintrag[row.kind] = row.updatedAt;
        stand.set(row.gameTypeId, eintrag);
      }

      return stand;
    },

    async save(input) {
      const [row] = await db
        .insert(gameTypeImages)
        .values({
          gameTypeId: input.gameTypeId,
          kind: input.kind,
          data: input.data,
          mimeType: input.mimeType,
          uploadedById: input.uploadedById,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [gameTypeImages.gameTypeId, gameTypeImages.kind],
          set: {
            data: input.data,
            mimeType: input.mimeType,
            uploadedById: input.uploadedById,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (row === undefined) {
        throw new Error('Das Bild konnte nicht gespeichert werden.');
      }

      return {
        gameTypeId: row.gameTypeId,
        kind: row.kind,
        data: row.data,
        mimeType: row.mimeType,
        updatedAt: row.updatedAt,
      } satisfies GameTypeImageRecord;
    },

    async remove(gameTypeId, kind) {
      const rows = await db
        .delete(gameTypeImages)
        .where(and(eq(gameTypeImages.gameTypeId, gameTypeId), eq(gameTypeImages.kind, kind)))
        .returning({ gameTypeId: gameTypeImages.gameTypeId });

      return rows.length > 0;
    },
  };
}
