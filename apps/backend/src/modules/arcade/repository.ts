/**
 * Datenzugriffe des Arcade-Moduls (Arbeitspaket F8).
 *
 * Enthält ausschließlich Datenzugriff. Die fachliche Zusammenstellung der DTOs
 * (Rangvergabe, „neuer Bestwert", eigene Statistik) liegt in `service.ts`. Die
 * Schnittstelle {@link ArcadeRepository} macht den Service ohne Datenbank
 * testbar (CLAUDE.md §4).
 *
 * Zwei Zusicherungen dieser Schicht (Audit W3-5):
 *  - **Gesperrte Konten zählen nicht mit.** Weder in der Bestenliste noch in der
 *    Rangzählung – dieselbe Linie, die Chat und Notifications längst ziehen
 *    (`backend-community-16`).
 *  - **{@link ArcadeRepository.transaction} klammert zusammengehörige
 *    Schritte.** Der Service liest den Vorher-Stand, schreibt den Versuch und
 *    liest den Nachher-Stand innerhalb einer Transaktion, statt drei
 *    unabhängige Abfragen aneinanderzureihen (`backend-community-17`).
 */

import { type ArcadeGameId } from '@palantir/contracts';
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database, DbConnection } from '../../db/index.js';
import { arcadeScores } from '../../db/schema/arcade.js';
import { users } from '../../db/schema/users.js';
import { ArcadeError } from './errors.js';

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

/**
 * Die einzelnen Abfragen – gegen den Pool oder innerhalb einer Transaktion.
 *
 * Getrennt von {@link ArcadeRepository}, damit derselbe Satz Abfragen in beiden
 * Zusammenhängen läuft: `transaction()` reicht genau dieses Bündel an den
 * Rumpf weiter, gebunden an den Transaktions-Handle.
 */
export interface ArcadeQueries {
  /** Speichert einen Versuch und liefert seine erzeugte Id samt Zeitstempel. */
  insertScore(input: InsertArcadeScore): Promise<{ id: string; createdAt: Date }>;
  /**
   * Bestwert je Konto für ein Spiel, absteigend sortiert, auf `limit` begrenzt.
   *
   * Bei Gleichstand entscheidet der frühere Zeitpunkt – wer den Wert zuerst
   * erreicht hat, steht oben. Gesperrte Konten kommen nicht vor.
   */
  topByGame(gameId: ArcadeGameId, limit: number): Promise<ArcadeLeaderboardRow[]>;
  /**
   * Bestwert und Anzahl der Versuche eines Kontos; `null`, wenn nie gespielt.
   *
   * Bewusst ohne Sperr-Filter: Es sind die eigenen Daten des aufrufenden Kontos,
   * kein Blick auf fremde.
   */
  personalStats(userId: string, gameId: ArcadeGameId): Promise<ArcadePersonalRow | null>;
  /**
   * Platz eines Bestwerts in der Gesamtwertung (1-basiert).
   *
   * Gezählt werden die Konten, deren Bestwert **echt größer** ist; der Rang ist
   * diese Zahl plus eins. Bei Gleichstand teilen sich Konten denselben Rang.
   *
   * Diese Regel ist die **einzige** Rangvergabe des Bereichs – die Bestenliste
   * leitet ihre Ränge daraus ab, statt schlicht durchzuzählen (`service.ts`,
   * `backend-community-15`). Gesperrte Konten zählen nicht mit, sonst schöbe ein
   * unsichtbares Konto alle anderen um einen Platz nach unten.
   */
  rankForScore(gameId: ArcadeGameId, bestScore: number): Promise<number>;
}

/** Datenzugriffe, die der Arcade-Service braucht. */
export interface ArcadeRepository extends ArcadeQueries {
  /**
   * Führt `work` in einer Datenbank-Transaktion aus.
   *
   * Wirft der Rumpf, wird alles darin Geschriebene verworfen – ein halb
   * abgesendeter Punktestand (Zeile geschrieben, Ergebnis nie zurückgemeldet)
   * kann nicht zurückbleiben (`backend-community-17`).
   */
  transaction<T>(work: (tx: ArcadeQueries) => Promise<T>): Promise<T>;
}

/** Die Abfragen, gebunden an eine Verbindung (Pool oder Transaktion). */
function arcadeQueries(db: DbConnection): ArcadeQueries {
  return {
    async insertScore(input) {
      const [row] = await db
        .insert(arcadeScores)
        .values({ userId: input.userId, gameId: input.gameId, score: input.score })
        .returning({ id: arcadeScores.id, createdAt: arcadeScores.createdAt });

      if (!row) {
        /*
         * `INSERT ... RETURNING` ohne Zeile ist ein Widerspruch und bleibt
         * deshalb ein Serverfehler – aber als benannter Code statt als rohem
         * `Error` (Audit W2-9, Fundpunkt 146; CLAUDE.md §5). Ein arcade-eigener
         * Katalog-Code existiert nicht und wäre für einen Fall, der nie
         * eintreten darf, auch nicht sinnvoll: Die Antwort ist dieselbe 500 wie
         * beim gleichgelagerten Fall in `schedule-repository.ts`.
         */
        throw new ArcadeError('INTERNAL_ERROR', 'Der Punktestand konnte nicht gespeichert werden.');
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

      return (
        db
          .select({
            userId: bestPerUser.userId,
            displayName: users.displayName,
            bestScore: bestPerUser.bestScore,
            achievedAt: bestPerUser.achievedAt,
          })
          .from(bestPerUser)
          .innerJoin(users, eq(users.id, bestPerUser.userId))
          // Gesperrte Konten erscheinen nicht: Ein wegen Fehlverhaltens
          // gesperrtes Konto soll nicht mit Namen an der Spitze stehen
          // (`backend-community-16`).
          .where(eq(users.banned, false))
          .orderBy(desc(bestPerUser.bestScore), asc(bestPerUser.achievedAt))
          .limit(limit)
      );
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
        // Dieselbe Grundmenge wie `topByGame`: Wer nicht in der Liste steht,
        // darf auch niemanden aus ihr verdrängen.
        .innerJoin(users, eq(users.id, arcadeScores.userId))
        .where(and(eq(arcadeScores.gameId, gameId), eq(users.banned, false)))
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

/** Drizzle-Umsetzung von {@link ArcadeRepository}. */
export function createDrizzleArcadeRepository(db: Database): ArcadeRepository {
  return {
    ...arcadeQueries(db),

    transaction<T>(work: (tx: ArcadeQueries) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => work(arcadeQueries(tx)));
    },
  };
}
