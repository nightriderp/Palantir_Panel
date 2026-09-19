/**
 * Drizzle-Umsetzung des {@link GameRequestRepository}.
 *
 * Aufbau wie `quota-requests/repository.ts`: dieselbe Auswahl über zwei
 * Verknüpfungen – der Antragsteller kommt aus `users`, der Entscheider aus
 * demselben Tisch unter anderem Namen (`alias`), sonst stünde in beiden
 * Spalten derselbe Name.
 */

import { type GameRequestQuery } from '@palantir/validation';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type DbConnection } from '../../db/client.js';
import { gameRequests, users } from '../../db/schema.js';
import { type GameRequestRepository } from './index.js';

export function createDrizzleGameRequestRepository(db: DbConnection): GameRequestRepository {
  const entscheider = alias(users, 'entscheider');

  const auswahl = {
    id: gameRequests.id,
    userId: gameRequests.userId,
    userDisplayName: users.displayName,
    game: gameRequests.game,
    reason: gameRequests.reason,
    status: gameRequests.status,
    decisionNote: gameRequests.decisionNote,
    decidedByDisplayName: entscheider.displayName,
    decidedAt: gameRequests.decidedAt,
    createdAt: gameRequests.createdAt,
  };

  function basis() {
    return db
      .select(auswahl)
      .from(gameRequests)
      .innerJoin(users, eq(users.id, gameRequests.userId))
      .leftJoin(entscheider, eq(entscheider.id, gameRequests.decidedById));
  }

  return {
    async create(input) {
      const [row] = await db
        .insert(gameRequests)
        .values({ userId: input.userId, game: input.game, reason: input.reason })
        .returning({ id: gameRequests.id });

      if (!row) {
        throw new Error('Der Spiel-Wunsch konnte nicht angelegt werden.');
      }

      const angelegt = await this.findById(row.id);

      if (!angelegt) {
        throw new Error('Der Spiel-Wunsch konnte nicht gelesen werden.');
      }

      return angelegt;
    },

    async findById(id) {
      const [row] = await basis().where(eq(gameRequests.id, id)).limit(1);

      return row ?? null;
    },

    async listByUser(userId) {
      return basis().where(eq(gameRequests.userId, userId)).orderBy(desc(gameRequests.createdAt));
    },

    async list(query: GameRequestQuery) {
      return query.status === undefined
        ? basis().orderBy(desc(gameRequests.createdAt))
        : basis()
            .where(eq(gameRequests.status, query.status))
            .orderBy(desc(gameRequests.createdAt));
    },

    async findOpenByUser(userId) {
      const [row] = await basis()
        .where(and(eq(gameRequests.userId, userId), eq(gameRequests.status, 'pending')))
        .limit(1);

      return row ?? null;
    },

    async decide(id, status, decidedById, note) {
      /*
       * Die Bedingung `status = 'pending'` gehört in das UPDATE, nicht nur in
       * die Prüfung davor: Zwei Administratoren, die gleichzeitig entscheiden,
       * kämen sonst beide durch – der zweite überschriebe den ersten Bescheid.
       * So trifft der zweite keine Zeile und bekommt `null`.
       */
      const [row] = await db
        .update(gameRequests)
        .set({ status, decidedById, decisionNote: note, decidedAt: new Date() })
        .where(and(eq(gameRequests.id, id), eq(gameRequests.status, 'pending')))
        .returning({ id: gameRequests.id });

      return row ? await this.findById(row.id) : null;
    },

    async withdraw(id) {
      const [row] = await db
        .update(gameRequests)
        .set({ status: 'withdrawn' })
        .where(and(eq(gameRequests.id, id), eq(gameRequests.status, 'pending')))
        .returning({ id: gameRequests.id });

      return row !== undefined;
    },
  };
}
