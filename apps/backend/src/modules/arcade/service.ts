/**
 * Fachliche Logik des Arcade-Moduls (Arbeitspaket F8, Pflichtenheft §17).
 *
 * Der Service ist die Instanz, die Punktestände speichert und die
 * nutzerbezogene Bestenliste je Spiel zusammenstellt (Lastenheft §3.9). Die
 * Spiele selbst laufen im Browser; das Backend prüft und persistiert nur das
 * Ergebnis. Rechte spielen hier keine Rolle: spielen darf jedes angemeldete
 * Konto – die Zuordnung geschieht über die Konto-Id, nicht über den Katalog.
 */

import {
  ARCADE_LEADERBOARD_LIMIT,
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
  type ArcadeSubmitResultDto,
} from '@palantir/contracts';
import type { SubmitArcadeScoreInput } from '@palantir/validation';
import type { ArcadePersonalRow, ArcadeRepository } from './repository.js';

export interface ArcadeService {
  /**
   * Speichert einen Versuch und liefert das Ergebnis samt aktualisierter
   * eigener Statistik.
   */
  submitScore(userId: string, input: SubmitArcadeScoreInput): Promise<ArcadeSubmitResultDto>;
  /** Bestenliste eines Spiels aus Sicht des aufrufenden Kontos. */
  getLeaderboard(userId: string, gameId: ArcadeGameId): Promise<ArcadeLeaderboardDto>;
}

export interface ArcadeServiceOptions {
  readonly repository: ArcadeRepository;
  /** Länge der Bestenliste; Standard aus dem Contract. */
  readonly leaderboardLimit?: number;
}

export function createArcadeService(options: ArcadeServiceOptions): ArcadeService {
  const { repository } = options;
  const limit = options.leaderboardLimit ?? ARCADE_LEADERBOARD_LIMIT;

  async function personalDto(
    gameId: ArcadeGameId,
    stats: ArcadePersonalRow,
  ): Promise<{ bestScore: number; rank: number; gamesPlayed: number }> {
    const rank = await repository.rankForScore(gameId, stats.bestScore);

    return { bestScore: stats.bestScore, rank, gamesPlayed: stats.gamesPlayed };
  }

  return {
    async submitScore(userId, input) {
      // Vorher-Stand, um „neuer Bestwert" ohne Rateei zu bestimmen.
      const before = await repository.personalStats(userId, input.gameId);
      const inserted = await repository.insertScore({
        userId,
        gameId: input.gameId,
        score: input.score,
      });

      const isNewPersonalBest = before === null || input.score > before.bestScore;
      const bestScore = before === null ? input.score : Math.max(before.bestScore, input.score);
      const gamesPlayed = (before?.gamesPlayed ?? 0) + 1;
      const rank = await repository.rankForScore(input.gameId, bestScore);

      return {
        score: {
          id: inserted.id,
          gameId: input.gameId,
          score: input.score,
          createdAt: inserted.createdAt.toISOString(),
        },
        personal: { bestScore, rank, gamesPlayed },
        isNewPersonalBest,
      };
    },

    async getLeaderboard(userId, gameId) {
      const [top, stats] = await Promise.all([
        repository.topByGame(gameId, limit),
        repository.personalStats(userId, gameId),
      ]);

      const entries = top.map((row, position) => ({
        rank: position + 1,
        userId: row.userId,
        displayName: row.displayName,
        bestScore: row.bestScore,
        achievedAt: row.achievedAt.toISOString(),
        isCurrentUser: row.userId === userId,
      }));

      const personal = stats === null ? null : await personalDto(gameId, stats);

      return {
        gameId,
        entries,
        personal,
        // Angemeldet ist, wer diese Route erreicht (die Route erzwingt es).
        permissions: { canSubmit: true },
      };
    },
  };
}
