/**
 * Datenzugriff der Panel-Sicherungen (Drizzle).
 *
 * Keine Joins: Eine Panel-Sicherung gehört der Instanz und keinem Konto –
 * anders als die Server-Backups aus B5 hat sie weder Besitzer noch Node.
 */

import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { panelBackups } from '../../db/schema.js';
import { type PanelBackupRecord, type PanelBackupRepository } from './index.js';

export function createDrizzlePanelBackupRepository(db: DbConnection): PanelBackupRepository {
  async function ladeNach(id: string): Promise<PanelBackupRecord> {
    const [row] = await db.select().from(panelBackups).where(eq(panelBackups.id, id)).limit(1);

    if (!row) {
      throw new Error('Die Sicherung konnte nicht gelesen werden.');
    }

    return row;
  }

  return {
    async create(trigger, storagePath) {
      const [row] = await db
        .insert(panelBackups)
        .values({ trigger, storagePath, status: 'running' })
        .returning();

      if (!row) {
        throw new Error('Die Sicherung konnte nicht angelegt werden.');
      }

      return row;
    },

    async finish(id, sizeBytes) {
      await db
        .update(panelBackups)
        .set({ status: 'completed', sizeBytes, completedAt: new Date(), failureMessage: null })
        .where(eq(panelBackups.id, id));

      return ladeNach(id);
    },

    async fail(id, message) {
      await db
        .update(panelBackups)
        .set({ status: 'failed', failureMessage: message, completedAt: new Date() })
        .where(eq(panelBackups.id, id));

      return ladeNach(id);
    },

    async findById(id) {
      const [row] = await db.select().from(panelBackups).where(eq(panelBackups.id, id)).limit(1);

      return row ?? null;
    },

    async list(limit) {
      return db.select().from(panelBackups).orderBy(desc(panelBackups.startedAt)).limit(limit);
    },

    async findLatest() {
      const [row] = await db
        .select()
        .from(panelBackups)
        .orderBy(desc(panelBackups.startedAt))
        .limit(1);

      return row ?? null;
    },

    async findRunning() {
      const [row] = await db
        .select()
        .from(panelBackups)
        .where(eq(panelBackups.status, 'running'))
        .limit(1);

      return row ?? null;
    },

    async remove(id) {
      await db.delete(panelBackups).where(eq(panelBackups.id, id));
    },

    async listFinishedBefore(before) {
      return db
        .select()
        .from(panelBackups)
        .where(
          and(
            inArray(panelBackups.status, ['completed', 'failed']),
            lt(panelBackups.startedAt, before),
          ),
        )
        .orderBy(desc(panelBackups.startedAt));
    },
  };
}
