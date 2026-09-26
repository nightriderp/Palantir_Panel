/**
 * Datenzugriffe des Arcade-Moduls (Arbeitspaket F8, Neubau 26.09.2026).
 *
 * Enthält ausschließlich Datenzugriff. Die fachliche Zusammenstellung der DTOs
 * (Rangvergabe, „neuer Bestwert", eigene Statistik) liegt in `service.ts`. Die
 * Schnittstelle {@link ArcadeRepository} macht den Service ohne Datenbank
 * testbar (Entwicklungsregeln §4).
 *
 * Drei Zusicherungen dieser Schicht:
 *  - **Gesperrte Konten zählen nicht mit.** Weder in der Bestenliste noch in der
 *    Rangzählung – dieselbe Linie, die Chat und Notifications längst ziehen
 *    (`backend-community-16`).
 *  - **{@link ArcadeRepository.transaction} klammert zusammengehörige
 *    Schritte** (`backend-community-17`).
 *  - **Ein Startwert wird genau einmal verbraucht** – im selben `UPDATE`, das
 *    ihn prüft ({@link ArcadeRepository.consumeSeed}).
 *
 * **Zwei Wertungen** je nach `metric` des Spiels: `score` = bester Einzelstand
 * je Konto, `wins` = Summe der Siege (jede Zeile ein Sieg mit `score = 1`).
 */

import { type AchievementId, type ArcadeGameId, type ArcadeMetric } from '@palantir/contracts';
import { and, asc, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Database, DbConnection } from '../../db/index.js';
import { arcadeScores, arcadeSeeds } from '../../db/schema/arcade.js';
import { users } from '../../db/schema/users.js';
import { ArcadeError } from './errors.js';

/** Eine Zeile der Bestenliste: der Wert eines Kontos in einem Spiel. */
export interface ArcadeLeaderboardRow {
  userId: string;
  displayName: string;
  /**
   * Abzeichen, dessen Titel das Konto trägt; `null`, wenn es keinen trägt.
   *
   * Bewusst die **Kennung** und nicht der Text: Den Titel dazu kennt der
   * Katalog in `@palantir/contracts`, und er soll nur an einer Stelle stehen.
   */
  titleAchievementId: AchievementId | null;
  /** Zeitstempel des Profilbilds; `null`, wenn das Konto keines hat. */
  avatarUpdatedAt: Date | null;
  /** Bestwert (`score`) bzw. Anzahl Siege (`wins`). */
  bestScore: number;
  /** Zeitpunkt des Bestwerts bzw. des letzten Siegs. */
  achievedAt: Date;
}

/** Eigene Statistik eines Kontos zu einem Spiel. */
export interface ArcadePersonalRow {
  bestScore: number;
  gamesPlayed: number;
}

/** Rumpf eines neu einzufügenden Ergebnisses. */
export interface InsertArcadeScore {
  userId: string;
  gameId: ArcadeGameId;
  score: number;
  /** Startwert der nachgerechneten Partie; bei Online-Räumen leer. */
  seedId?: string | null;
  gameVersion?: number | null;
  /** Vom Backend selbst errechnet? Seit dem Neubau immer `true`. */
  verified?: boolean;
}

export interface InsertArcadeSeed {
  userId: string;
  gameId: ArcadeGameId;
  seed: number;
  gameVersion: number;
  expiresAt: Date;
}

export interface ConsumedArcadeSeed {
  seed: number;
  gameVersion: number;
}

/**
 * Die einzelnen Abfragen – gegen den Pool oder innerhalb einer Transaktion.
 */
export interface ArcadeQueries {
  /** Speichert ein Ergebnis und liefert seine erzeugte Id samt Zeitstempel. */
  insertScore(input: InsertArcadeScore): Promise<{ id: string; createdAt: Date }>;
  /**
   * Wert je Konto für ein Spiel, absteigend sortiert, auf `limit` begrenzt.
   *
   * Bei Gleichstand entscheidet der frühere Zeitpunkt. Gesperrte Konten kommen
   * nicht vor.
   */
  topByGame(
    gameId: ArcadeGameId,
    metric: ArcadeMetric,
    limit: number,
  ): Promise<ArcadeLeaderboardRow[]>;
  /**
   * Wert und Anzahl der Einträge eines Kontos; `null`, wenn nie gespielt.
   * Bewusst ohne Sperr-Filter: Es sind die eigenen Daten.
   */
  personalStats(
    userId: string,
    gameId: ArcadeGameId,
    metric: ArcadeMetric,
  ): Promise<ArcadePersonalRow | null>;
  /**
   * Platz eines Werts in der Gesamtwertung (1-basiert): Anzahl der Konten mit
   * **echt größerem** Wert plus eins – die **einzige** Rangvergabe des Bereichs
   * (`backend-community-15`). Gesperrte Konten zählen nicht mit.
   */
  rankForScore(gameId: ArcadeGameId, metric: ArcadeMetric, bestScore: number): Promise<number>;
}

/** Datenzugriffe, die der Arcade-Service braucht. */
export interface ArcadeRepository extends ArcadeQueries {
  /** Führt `work` in einer Datenbank-Transaktion aus (`backend-community-17`). */
  transaction<T>(work: (tx: ArcadeQueries) => Promise<T>): Promise<T>;
  /** Legt einen Startwert an. */
  insertSeed(input: InsertArcadeSeed): Promise<{ id: string }>;
  /**
   * Verbraucht einen Startwert **atomar**: `used_at` wird nur gesetzt, wenn er
   * dem Konto gehört, zum Spiel passt, unbenutzt und nicht abgelaufen ist.
   * `null`, wenn eine dieser Bedingungen fehlt – welche, verrät die Antwort
   * bewusst nicht.
   */
  consumeSeed(input: {
    seedId: string;
    userId: string;
    gameId: ArcadeGameId;
    now: Date;
  }): Promise<ConsumedArcadeSeed | null>;
  /** Räumt abgelaufene Startwerte weg; liefert die Anzahl. */
  deleteExpiredSeeds(now: Date): Promise<number>;
}

/** Aggregat je Konto: bester Einzelstand oder Summe der Siege. */
function wertAggregat(metric: ArcadeMetric) {
  return metric === 'wins'
    ? sql<number>`cast(sum(${arcadeScores.score}) as integer)`
    : sql<number>`max(${arcadeScores.score})`;
}

/**
 * Grundmenge jeder Wertung: alle Einträge des Spiels.
 *
 * Bewusst **ohne** Filter auf `verified` (Betreiber-Wunsch 26.09.2026): Die
 * Einträge vor dem Neubau kamen ungeprüft aus dem Browser und entstanden mit
 * anderer Spiellogik, sollen aber in der Bestenliste bleiben. Neue Einträge
 * sind ohnehin nachgerechnet; `verified` hält nur fest, woher ein Eintrag stammt.
 */
function nurGewertet(gameId: ArcadeGameId) {
  return eq(arcadeScores.gameId, gameId);
}

/** `timestamptz` aus einem rohen `sql`-Ausdruck kommt je nach Treiber als Text. */
function alsDatum(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Die Abfragen, gebunden an eine Verbindung (Pool oder Transaktion). */
function arcadeQueries(db: DbConnection): ArcadeQueries {
  return {
    async insertScore(input) {
      const [row] = await db
        .insert(arcadeScores)
        .values({
          userId: input.userId,
          gameId: input.gameId,
          score: input.score,
          seedId: input.seedId ?? null,
          gameVersion: input.gameVersion ?? null,
          verified: input.verified ?? false,
        })
        .returning({ id: arcadeScores.id, createdAt: arcadeScores.createdAt });

      if (!row) {
        // `INSERT ... RETURNING` ohne Zeile ist ein Widerspruch und bleibt ein
        // Serverfehler – aber als benannter Code (Audit W2-9, Fundpunkt 146).
        throw new ArcadeError('INTERNAL_ERROR', 'Der Punktestand konnte nicht gespeichert werden.');
      }

      return row;
    },

    async topByGame(gameId, metric, limit) {
      if (metric === 'score') {
        /*
         * Pro Konto der beste Versuch – über DISTINCT ON auf `user_id`,
         * sortiert nach höchstem Punktestand und frühestem Zeitpunkt.
         */
        const bestPerUser = db
          .selectDistinctOn([arcadeScores.userId], {
            userId: arcadeScores.userId,
            bestScore: arcadeScores.score,
            achievedAt: arcadeScores.createdAt,
          })
          .from(arcadeScores)
          .where(nurGewertet(gameId))
          .orderBy(arcadeScores.userId, desc(arcadeScores.score), asc(arcadeScores.createdAt))
          .as('best_per_user');

        return db
          .select({
            userId: bestPerUser.userId,
            displayName: users.displayName,
            titleAchievementId: users.titleAchievementId,
            avatarUpdatedAt: users.avatarUpdatedAt,
            bestScore: bestPerUser.bestScore,
            achievedAt: bestPerUser.achievedAt,
          })
          .from(bestPerUser)
          .innerJoin(users, eq(users.id, bestPerUser.userId))
          .where(eq(users.banned, false))
          .orderBy(desc(bestPerUser.bestScore), asc(bestPerUser.achievedAt))
          .limit(limit);
      }

      // Siege: Summe je Konto, Zeitpunkt des letzten Siegs.
      const winsPerUser = db
        .select({
          userId: arcadeScores.userId,
          total: wertAggregat('wins').as('total'),
          achievedAt: sql<Date | string>`max(${arcadeScores.createdAt})`.as('achieved_at'),
        })
        .from(arcadeScores)
        .where(nurGewertet(gameId))
        .groupBy(arcadeScores.userId)
        .as('wins_per_user');

      const rows = await db
        .select({
          userId: winsPerUser.userId,
          displayName: users.displayName,
          titleAchievementId: users.titleAchievementId,
          avatarUpdatedAt: users.avatarUpdatedAt,
          bestScore: winsPerUser.total,
          achievedAt: winsPerUser.achievedAt,
        })
        .from(winsPerUser)
        .innerJoin(users, eq(users.id, winsPerUser.userId))
        .where(eq(users.banned, false))
        .orderBy(desc(winsPerUser.total), asc(winsPerUser.achievedAt))
        .limit(limit);

      return rows.map((row) => ({
        ...row,
        bestScore: Number(row.bestScore),
        achievedAt: alsDatum(row.achievedAt),
      }));
    },

    async personalStats(userId, gameId, metric) {
      const [row] = await db
        .select({
          bestScore: sql<number>`coalesce(${wertAggregat(metric)}, 0)`,
          gamesPlayed: count(),
        })
        .from(arcadeScores)
        .where(and(eq(arcadeScores.userId, userId), nurGewertet(gameId)));

      if (!row || Number(row.gamesPlayed) === 0) {
        return null;
      }

      return { bestScore: Number(row.bestScore), gamesPlayed: Number(row.gamesPlayed) };
    },

    async rankForScore(gameId, metric, bestScore) {
      const perUser = db
        .select({
          userId: arcadeScores.userId,
          best: wertAggregat(metric).as('best'),
        })
        .from(arcadeScores)
        // Dieselbe Grundmenge wie `topByGame`: Wer nicht in der Liste steht,
        // darf auch niemanden aus ihr verdrängen.
        .innerJoin(users, eq(users.id, arcadeScores.userId))
        .where(and(nurGewertet(gameId), eq(users.banned, false)))
        .groupBy(arcadeScores.userId)
        .as('best_per_user');

      const [row] = await db
        .select({ higher: count() })
        .from(perUser)
        .where(gt(perUser.best, bestScore));

      return Number(row?.higher ?? 0) + 1;
    },
  };
}

/** Drizzle-Umsetzung von {@link ArcadeRepository}. */
export function createDrizzleArcadeRepository(db: Database): ArcadeRepository {
  return {
    ...arcadeQueries(db),

    transaction<T>(work: (tx: ArcadeQueries) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => work(arcadeQueries(tx)));
    },

    async insertSeed(input) {
      const [row] = await db
        .insert(arcadeSeeds)
        .values({
          userId: input.userId,
          gameId: input.gameId,
          seed: input.seed,
          gameVersion: input.gameVersion,
          expiresAt: input.expiresAt,
        })
        .returning({ id: arcadeSeeds.id });

      if (!row) {
        throw new ArcadeError('INTERNAL_ERROR', 'Der Startwert konnte nicht gespeichert werden.');
      }

      return row;
    },

    async consumeSeed({ seedId, userId, gameId, now }) {
      const [row] = await db
        .update(arcadeSeeds)
        .set({ usedAt: now })
        .where(
          and(
            eq(arcadeSeeds.id, seedId),
            eq(arcadeSeeds.userId, userId),
            eq(arcadeSeeds.gameId, gameId),
            isNull(arcadeSeeds.usedAt),
            gt(arcadeSeeds.expiresAt, now),
          ),
        )
        .returning({ seed: arcadeSeeds.seed, gameVersion: arcadeSeeds.gameVersion });

      return row ? { seed: Number(row.seed), gameVersion: row.gameVersion } : null;
    },

    async deleteExpiredSeeds(now) {
      const rows = await db
        .delete(arcadeSeeds)
        .where(lt(arcadeSeeds.expiresAt, now))
        .returning({ id: arcadeSeeds.id });

      return rows.length;
    },
  };
}
