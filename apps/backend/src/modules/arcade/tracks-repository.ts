/**
 * Datenzugriffe der Spielhallen-Musik (Neubau 26.09.2026).
 *
 * Listen lesen nie die Spalte `data` – die Bytes gehen nur über
 * {@link ArcadeTrackRepository.audio} raus, ein Stück je Abruf.
 */

import { and, desc, eq, ne } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { arcadeTracks } from '../../db/schema/arcade.js';
import { users } from '../../db/schema/users.js';
import { type ArcadeTrackRecord, type ArcadeTrackRepository } from './tracks.js';

export function createDrizzleArcadeTrackRepository(db: Database): ArcadeTrackRepository {
  const listColumns = {
    id: arcadeTracks.id,
    gameId: arcadeTracks.gameId,
    title: arcadeTracks.title,
    mimeType: arcadeTracks.mimeType,
    sizeBytes: arcadeTracks.sizeBytes,
    isActive: arcadeTracks.isActive,
    uploadedAt: arcadeTracks.uploadedAt,
    uploadedByDisplayName: users.displayName,
  };

  async function byId(id: string): Promise<ArcadeTrackRecord | null> {
    const [row] = await db
      .select(listColumns)
      .from(arcadeTracks)
      .leftJoin(users, eq(users.id, arcadeTracks.uploadedBy))
      .where(eq(arcadeTracks.id, id));

    return row ?? null;
  }

  return {
    async list() {
      return db
        .select(listColumns)
        .from(arcadeTracks)
        .leftJoin(users, eq(users.id, arcadeTracks.uploadedBy))
        .orderBy(arcadeTracks.gameId, desc(arcadeTracks.uploadedAt));
    },

    async listActive() {
      return db
        .select({
          id: arcadeTracks.id,
          gameId: arcadeTracks.gameId,
          title: arcadeTracks.title,
          mimeType: arcadeTracks.mimeType,
        })
        .from(arcadeTracks)
        .where(eq(arcadeTracks.isActive, true));
    },

    async audio(id) {
      const [row] = await db
        .select({ id: arcadeTracks.id, mimeType: arcadeTracks.mimeType, data: arcadeTracks.data })
        .from(arcadeTracks)
        .where(eq(arcadeTracks.id, id));

      return row ?? null;
    },

    async insert(input) {
      const [row] = await db
        .insert(arcadeTracks)
        .values({
          gameId: input.gameId,
          title: input.title,
          mimeType: input.mimeType,
          sizeBytes: input.data.length,
          data: input.data,
          isActive: false,
          uploadedBy: input.uploadedBy,
        })
        .returning({ id: arcadeTracks.id });

      const record = row ? await byId(row.id) : null;

      if (!record) throw new Error('Musikstück wurde nicht gespeichert.');

      return record;
    },

    async activate(id) {
      return db.transaction(async (tx) => {
        const [track] = await tx
          .select({ gameId: arcadeTracks.gameId })
          .from(arcadeTracks)
          .where(eq(arcadeTracks.id, id))
          .for('update');

        if (!track) return false;

        // Erst die anderen aus, dann dieses an – der partielle eindeutige
        // Index erlaubt nie zwei aktive Stücke je Spiel.
        await tx
          .update(arcadeTracks)
          .set({ isActive: false })
          .where(
            and(
              eq(arcadeTracks.gameId, track.gameId),
              eq(arcadeTracks.isActive, true),
              ne(arcadeTracks.id, id),
            ),
          );
        await tx.update(arcadeTracks).set({ isActive: true }).where(eq(arcadeTracks.id, id));

        return true;
      });
    },

    async deactivate(id) {
      const rows = await db
        .update(arcadeTracks)
        .set({ isActive: false })
        .where(eq(arcadeTracks.id, id))
        .returning({ id: arcadeTracks.id });

      return rows.length > 0;
    },

    async remove(id) {
      const rows = await db
        .delete(arcadeTracks)
        .where(eq(arcadeTracks.id, id))
        .returning({ id: arcadeTracks.id });

      return rows.length > 0;
    },
  };
}
