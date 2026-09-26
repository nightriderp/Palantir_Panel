/**
 * Drizzle-Umsetzung des {@link UserPresetRepository}.
 */

import { and, asc, count, eq } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { userPresets } from '../../db/schema.js';
import { type UserPresetRecord, type UserPresetRepository } from './index.js';

export function createDrizzleUserPresetRepository(db: DbConnection): UserPresetRepository {
  const auswahl = {
    id: userPresets.id,
    userId: userPresets.userId,
    gameType: userPresets.gameType,
    name: userPresets.name,
    values: userPresets.values,
    createdAt: userPresets.createdAt,
    updatedAt: userPresets.updatedAt,
  };

  return {
    async listByUser(userId, gameType) {
      return db
        .select(auswahl)
        .from(userPresets)
        .where(and(eq(userPresets.userId, userId), eq(userPresets.gameType, gameType)))
        .orderBy(asc(userPresets.name));
    },

    async countByUser(userId, gameType) {
      const [zeile] = await db
        .select({ anzahl: count() })
        .from(userPresets)
        .where(and(eq(userPresets.userId, userId), eq(userPresets.gameType, gameType)));

      return zeile?.anzahl ?? 0;
    },

    async findById(id) {
      const [zeile] = await db.select(auswahl).from(userPresets).where(eq(userPresets.id, id));

      return zeile ?? null;
    },

    async create(input) {
      const [zeile] = await db.insert(userPresets).values(input).returning(auswahl);

      if (!zeile) {
        throw new Error('Das Profil konnte nicht angelegt werden.');
      }

      return zeile satisfies UserPresetRecord;
    },

    async update(id, changes) {
      const [zeile] = await db
        .update(userPresets)
        .set(changes)
        .where(eq(userPresets.id, id))
        .returning(auswahl);

      return zeile ?? null;
    },

    async delete(id) {
      const geloescht = await db
        .delete(userPresets)
        .where(eq(userPresets.id, id))
        .returning({ id: userPresets.id });

      return geloescht.length > 0;
    },
  };
}
