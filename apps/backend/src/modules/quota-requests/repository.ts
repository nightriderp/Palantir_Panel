/**
 * Datenzugriff der Kontingent-Anfragen (Drizzle).
 *
 * Der Anzeigename des Antragstellers und der des Entscheiders kommen über zwei
 * Joins mit – die Liste zeigt Namen, nicht Ids, und ein zweiter Aufruf je Zeile
 * wäre für eine Übersicht die falsche Rechnung.
 */

import { type QuotaRequestQuery } from '@palantir/validation';
import { type QuotaRequestStatus } from '@palantir/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type DbConnection } from '../../db/client.js';
import { quotaRequests, users } from '../../db/schema.js';
import { type QuotaRequestRecord, type QuotaRequestRepository } from './index.js';

export function createDrizzleQuotaRequestRepository(db: DbConnection): QuotaRequestRepository {
  const entscheider = alias(users, 'entscheider');

  const auswahl = {
    id: quotaRequests.id,
    userId: quotaRequests.userId,
    userDisplayName: users.displayName,
    requestedRamMb: quotaRequests.requestedRamMb,
    requestedMaxConcurrentServers: quotaRequests.requestedMaxConcurrentServers,
    reason: quotaRequests.reason,
    status: quotaRequests.status,
    decisionNote: quotaRequests.decisionNote,
    decidedByDisplayName: entscheider.displayName,
    decidedAt: quotaRequests.decidedAt,
    createdAt: quotaRequests.createdAt,
  };

  function basis() {
    return db
      .select(auswahl)
      .from(quotaRequests)
      .innerJoin(users, eq(users.id, quotaRequests.userId))
      .leftJoin(entscheider, eq(entscheider.id, quotaRequests.decidedById));
  }

  return {
    async create(input) {
      const [row] = await db
        .insert(quotaRequests)
        .values({
          userId: input.userId,
          requestedRamMb: input.requestedRamMb,
          requestedMaxConcurrentServers: input.requestedMaxConcurrentServers,
          reason: input.reason,
        })
        .returning({ id: quotaRequests.id });

      if (!row) {
        throw new Error('Die Kontingent-Anfrage konnte nicht angelegt werden.');
      }

      const angelegt = await this.findById(row.id);

      if (!angelegt) {
        throw new Error('Die Kontingent-Anfrage konnte nicht gelesen werden.');
      }

      return angelegt;
    },

    async findById(id) {
      const [row] = await basis().where(eq(quotaRequests.id, id)).limit(1);

      return row ?? null;
    },

    async listByUser(userId) {
      return basis().where(eq(quotaRequests.userId, userId)).orderBy(desc(quotaRequests.createdAt));
    },

    async list(query: QuotaRequestQuery) {
      const rows =
        query.status === undefined
          ? await basis().orderBy(desc(quotaRequests.createdAt))
          : await basis()
              .where(eq(quotaRequests.status, query.status))
              .orderBy(desc(quotaRequests.createdAt));

      return rows;
    },

    async findOpenByUser(userId) {
      const [row] = await basis()
        .where(and(eq(quotaRequests.userId, userId), eq(quotaRequests.status, 'pending')))
        .limit(1);

      return row ?? null;
    },

    async decide(
      id: string,
      status: Exclude<QuotaRequestStatus, 'pending'>,
      decidedById: string | null,
      note: string | null,
    ) {
      await db
        .update(quotaRequests)
        .set({ status, decidedById, decisionNote: note, decidedAt: new Date() })
        .where(eq(quotaRequests.id, id));

      const entschieden = await this.findById(id);

      if (!entschieden) {
        throw new Error('Die Kontingent-Anfrage konnte nicht gelesen werden.');
      }

      return entschieden;
    },

    async remove(id) {
      await db.delete(quotaRequests).where(eq(quotaRequests.id, id));
    },
  } satisfies QuotaRequestRepository & {
    findById(id: string): Promise<QuotaRequestRecord | null>;
  };
}
