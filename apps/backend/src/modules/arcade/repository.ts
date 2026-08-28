/**
 * Datenzugriffe des Arcade-Moduls (Arbeitspaket F8).
 *
 * Enthält ausschließlich Datenzugriff. Die fachliche Zusammenstellung der DTOs
 * (Rangvergabe, „neuer Bestwert", eigene Statistik) liegt in `service.ts`. Die
 * Schnittstelle {@link ArcadeRepository} macht den Service ohne Datenbank
 * testbar (CLAUDE.md §4).
 */

import { type ArcadeGameId } from '@palantir/contracts';
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { arcadeScores } from '../../db/schema/arcade.js';
import { users } from '../../db/schema/users.js';

/** Eine Zeile der Bestenliste: der Bestwert eines Kontos in einem Spiel. */
export interface ArcadeLeaderboardRow {
  userId: string;
  displayName: string;
  bestScore: number;
  /** Zeitpunkt, an dem dieser Bestwert erreicht wurde. */
  achievedAt: Date;
}

/** Eigene Statistik eines Kontos zu einem Spiel. */
export interface ArcadePersonalRow {
  bestScore: number;
  gamesPlayed: number;
}

/** Rumpf eines neu einzufügenden Punktestands. */
export interface InsertArcadeScore {
  userId: string;
  gameId: ArcadeGameId;
  score: number;
}

/** Datenzugriffe, die der Arcade-Service braucht. */
export interface ArcadeRepository {
  /** Speichert einen Versuch und liefert seine erzeugte Id samt Zeitstempel. */
  insertScore(input: InsertArcadeScore): Promise<{ id: string; createdAt: Date }>;
  /**
   * Bestwert je Konto für ein Spiel, absteigend sortiert, auf `limit` begrenzt.
   *
   * Bei Gleichstand entscheidet der frühere Zeitpunkt – wer den Wert zuerst
   * erreicht hat, steht oben.
   */
  topByGame(gameId: ArcadeGameId, limit: number): Promise<ArcadeLeaderboardRow[]>;
  /** Bestwert und Anzahl der Versuche eines Kontos; `null`, wenn nie gespielt. */
  personalStats(userId: string, gameId: ArcadeGameId): Promise<ArcadePersonalRow | null>;
  /**
   * Platz eines Bestwerts in der Gesamtwertung (1-basiert).
   *
   * Gezählt werden die Konten, deren Bestwert **echt größer** ist; der Rang ist
   * diese Zahl plus eins. Bei Gleichstand teilen sich Konten denselben Rang.
   */
  rankForScore(gameId: ArcadeGameId, bestScore: number): Promise<number>;
}

/** Drizzle-Umsetzung von {@link ArcadeRepository}. */
export function createDrizzleArcadeRepository(db: Database): ArcadeRepository {
  return {
    async insertScore(input) {
      const [row] = await db
        .insert(arcadeScores)
        .values({ userId: input.userId, gameId: input.gameId, score: input.score })
        .returning({ id: arcadeScores.id, createdAt: arcadeScores.createdAt });

      // `INSERT ... RETURNING` liefert immer genau die eingefügte Zeile.
      if (!row) {
        throw new Error('arcade_scores: INSERT lieferte keine Zeile zurück.');
      }

      return row;
    },

    async topByGame(gameId, limit) {
      /*
       * Pro Konto der beste Versuch – über DISTINCT ON auf `user_id`, sortiert
       * nach höchstem Punktestand und frühestem Zeitpunkt. Das äußere SELECT
       * bringt die Kontenbestwerte danach in die Reihenfolge der Bestenliste.
       */
      const bestPerUser = db
        .selectDistinctOn([arcadeScores.userId], {
          userId: arcadeScores.userId,
          bestScore: arcadeScores.score,
          achievedAt: arcadeScores.createdAt,
        })
        .from(arcadeScores)
        .where(eq(arcadeScores.gameId, gameId))
        .orderBy(arcadeScores.userId, desc(arcadeScores.score), asc(arcadeScores.createdAt))
        .as('best_per_user');

      return db
        .select({
          userId: bestPerUser.userId,
          displayName: users.displayName,
          bestScore: bestPerUser.bestScore,
          achievedAt: bestPerUser.achievedAt,
        })
        .from(bestPerUser)
        .innerJoin(users, eq(users.id, bestPerUser.userId))
        .orderBy(desc(bestPerUser.bestScore), asc(bestPerUser.achievedAt))
        .limit(limit);
    },

    async personalStats(userId, gameId) {
      const [row] = await db
        .select({
          bestScore: sql<number>`coalesce(max(${arcadeScores.score}), 0)`,
          gamesPlayed: count(),
        })
        .from(arcadeScores)
        .where(and(eq(arcadeScores.userId, userId), eq(arcadeScores.gameId, gameId)));

      if (!row || row.gamesPlayed === 0) {
        return null;
      }

      return { bestScore: Number(row.bestScore), gamesPlayed: Number(row.gamesPlayed) };
    },

    async rankForScore(gameId, bestScore) {
      const bestPerUser = db
        .select({
          userId: arcadeScores.userId,
          best: sql<number>`max(${arcadeScores.score})`.as('best'),
        })
        .from(arcadeScores)
        .where(eq(arcadeScores.gameId, gameId))
        .groupBy(arcadeScores.userId)
        .as('best_per_user');

      const [row] = await db
        .select({ higher: count() })
        .from(bestPerUser)
        .where(gt(bestPerUser.best, bestScore));

      return Number(row?.higher ?? 0) + 1;
    },
  };
}
