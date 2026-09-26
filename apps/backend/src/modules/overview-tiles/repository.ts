/**
 * Drizzle-Umsetzung der Ablage für Übersichts-Kacheln ohne Server.
 */

import { asc, eq } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { overviewTiles } from '../../db/schema.js';
import { type OverviewTileRecord, type OverviewTileRepository } from './index.js';

function toRecord(row: typeof overviewTiles.$inferSelect): OverviewTileRecord {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    gameTypeId: row.gameTypeId,
    gameLabel: row.gameLabel,
    address: row.address,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    sortOrder: row.sortOrder,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleOverviewTileRepository(db: DbConnection): OverviewTileRepository {
  return {
    async list() {
      const rows = await db
        .select()
        .from(overviewTiles)
        .orderBy(asc(overviewTiles.sortOrder), asc(overviewTiles.title));

      return rows.map(toRecord);
    },

    async find(id) {
      const [row] = await db.select().from(overviewTiles).where(eq(overviewTiles.id, id)).limit(1);

      return row === undefined ? null : toRecord(row);
    },

    async create(input) {
      const [row] = await db.insert(overviewTiles).values(input).returning();

      if (row === undefined) {
        throw new Error('Die Kachel konnte nicht angelegt werden.');
      }

      return toRecord(row);
    },

    async update(id, fields) {
      const [row] = await db
        .update(overviewTiles)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(overviewTiles.id, id))
        .returning();

      return row === undefined ? null : toRecord(row);
    },

    async remove(id) {
      const rows = await db
        .delete(overviewTiles)
        .where(eq(overviewTiles.id, id))
        .returning({ id: overviewTiles.id });

      return rows.length > 0;
    },
  };
}
