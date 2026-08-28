import { type ArcadeGameId } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import type { ArcadeRepository } from './repository.js';
import { createArcadeService } from './service.js';

/**
 * In-Memory-Attrappe des Repositories – bildet die Aggregate (Bestwert je
 * Konto, Rang, Versuchszahl) genauso nach wie die SQL-Abfragen, damit die
 * Service-Logik ohne Datenbank prüfbar ist (CLAUDE.md §4).
 */
function fakeRepository(displayNames: Record<string, string> = {}): ArcadeRepository & {
  rows: Array<{ id: string; userId: string; gameId: ArcadeGameId; score: number; createdAt: Date }>;
} {
  const rows: Array<{
    id: string;
    userId: string;
    gameId: ArcadeGameId;
    score: number;
    createdAt: Date;
  }> = [];
  let counter = 0;

  function bestPerUser(gameId: ArcadeGameId): Map<string, { score: number; at: Date }> {
    const byUser = new Map<string, { score: number; at: Date }>();
    for (const row of rows) {
      if (row.gameId !== gameId) continue;
      const current = byUser.get(row.userId);
      if (
        !current ||
        row.score > current.score ||
        (row.score === current.score && row.createdAt < current.at)
      ) {
        byUser.set(row.userId, { score: row.score, at: row.createdAt });
      }
    }
    return byUser;
  }

  return {
    rows,
    async insertScore(input) {
      counter += 1;
      const id = `score-${counter}`;
      const createdAt = new Date(1_700_000_000_000 + counter * 1000);
      rows.push({ id, ...input, createdAt });
      return { id, createdAt };
    },
    async topByGame(gameId, limit) {
      return [...bestPerUser(gameId).entries()]
        .map(([userId, best]) => ({
          userId,
          displayName: displayNames[userId] ?? userId,
          bestScore: best.score,
          achievedAt: best.at,
        }))
        .sort(
          (a, b) => b.bestScore - a.bestScore || a.achievedAt.getTime() - b.achievedAt.getTime(),
        )
        .slice(0, limit);
    },
    async personalStats(userId, gameId) {
      const mine = rows.filter((row) => row.userId === userId && row.gameId === gameId);
      if (mine.length === 0) return null;
      return {
        bestScore: Math.max(...mine.map((row) => row.score)),
        gamesPlayed: mine.length,
      };
    },
    async rankForScore(gameId, bestScore) {
      let higher = 0;
      for (const best of bestPerUser(gameId).values()) {
        if (best.score > bestScore) higher += 1;
      }
      return higher + 1;
    },
  };
}

const GAME: ArcadeGameId = 'kriechpfad';

describe('ArcadeService.submitScore', () => {
  it('meldet den ersten Versuch als neuen Bestwert', async () => {
    const service = createArcadeService({ repository: fakeRepository() });

    const result = await service.submitScore('user-1', { gameId: GAME, score: 120 });

    expect(result.isNewPersonalBest).toBe(true);
    expect(result.personal).toEqual({ bestScore: 120, rank: 1, gamesPlayed: 1 });
    expect(result.score.score).toBe(120);
    expect(result.score.gameId).toBe(GAME);
  });

  it('behält den Bestwert bei einem schwächeren Versuch, zählt ihn aber mit', async () => {
    const service = createArcadeService({ repository: fakeRepository() });

    await service.submitScore('user-1', { gameId: GAME, score: 120 });
    const result = await service.submitScore('user-1', { gameId: GAME, score: 80 });

    expect(result.isNewPersonalBest).toBe(false);
    expect(result.personal.bestScore).toBe(120);
    expect(result.personal.gamesPlayed).toBe(2);
  });

  it('erkennt einen echten neuen Bestwert', async () => {
    const service = createArcadeService({ repository: fakeRepository() });

    await service.submitScore('user-1', { gameId: GAME, score: 120 });
    const result = await service.submitScore('user-1', { gameId: GAME, score: 200 });

    expect(result.isNewPersonalBest).toBe(true);
    expect(result.personal.bestScore).toBe(200);
  });
});

describe('ArcadeService.getLeaderboard', () => {
  it('sortiert je Konto den Bestwert und markiert das eigene Konto', async () => {
    const repository = fakeRepository({ 'user-1': 'Ada', 'user-2': 'Grace' });
    const service = createArcadeService({ repository });

    await service.submitScore('user-1', { gameId: GAME, score: 120 });
    await service.submitScore('user-1', { gameId: GAME, score: 90 });
    await service.submitScore('user-2', { gameId: GAME, score: 300 });

    const board = await service.getLeaderboard('user-1', GAME);

    expect(board.entries.map((entry) => entry.displayName)).toEqual(['Grace', 'Ada']);
    expect(board.entries[0]).toMatchObject({ rank: 1, bestScore: 300, isCurrentUser: false });
    expect(board.entries[1]).toMatchObject({ rank: 2, bestScore: 120, isCurrentUser: true });
    expect(board.personal).toEqual({ bestScore: 120, rank: 2, gamesPlayed: 2 });
    expect(board.permissions.canSubmit).toBe(true);
  });

  it('liefert leere Liste und keine eigene Statistik, wenn noch nie gespielt', async () => {
    const service = createArcadeService({ repository: fakeRepository() });

    const board = await service.getLeaderboard('user-1', GAME);

    expect(board.entries).toEqual([]);
    expect(board.personal).toBeNull();
  });
});
