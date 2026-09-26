import { type AchievementId, type ArcadeGameId, type ArcadeMetric } from '@palantir/contracts';
import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_UP,
  ArcadeRecorder,
  encodeArcadeReplay,
  replayToBase64,
} from '@palantir/arcade';
import { describe, expect, it, vi } from 'vitest';
import type { ArcadeQueries, ArcadeRepository } from './repository.js';
import { createArcadeService } from './service.js';
import { miniRegistry } from './test-support.js';
import { createArcadeVerifier } from './verifier.js';

interface Zeile {
  id: string;
  userId: string;
  gameId: ArcadeGameId;
  score: number;
  createdAt: Date;
  verified: boolean;
}

interface Startwert {
  id: string;
  userId: string;
  gameId: ArcadeGameId;
  seed: number;
  gameVersion: number;
  expiresAt: Date;
  usedAt: Date | null;
}

interface FakeOptions {
  readonly displayNames?: Record<string, string>;
  readonly banned?: readonly string[];
  readonly titel?: Record<string, AchievementId>;
}

type FakeRepository = ArcadeRepository & {
  rows: Zeile[];
  seeds: Startwert[];
  stoerungen: { rankForScore: boolean };
};

/**
 * In-Memory-Attrappe des Repositories – bildet die Aggregate (Bestwert bzw.
 * Siegsumme je Konto, Rang, Versuchszahl) und den atomaren Verbrauch eines
 * Startwerts nach, damit die Service-Logik ohne Datenbank prüfbar ist.
 */
function fakeRepository(options: FakeOptions = {}): FakeRepository {
  const displayNames = options.displayNames ?? {};
  const banned = new Set(options.banned ?? []);
  const titel: Record<string, AchievementId> = options.titel ?? {};
  const rows: Zeile[] = [];
  const seeds: Startwert[] = [];
  const stoerungen = { rankForScore: false };
  let counter = 0;

  function perUser(
    gameId: ArcadeGameId,
    metric: ArcadeMetric,
  ): Map<string, { score: number; at: Date }> {
    const byUser = new Map<string, { score: number; at: Date }>();
    for (const row of rows) {
      if (row.gameId !== gameId || banned.has(row.userId)) continue;
      const current = byUser.get(row.userId);
      if (metric === 'wins') {
        byUser.set(row.userId, {
          score: (current?.score ?? 0) + row.score,
          at: current && current.at > row.createdAt ? current.at : row.createdAt,
        });
      } else if (
        !current ||
        row.score > current.score ||
        (row.score === current.score && row.createdAt < current.at)
      ) {
        byUser.set(row.userId, { score: row.score, at: row.createdAt });
      }
    }
    return byUser;
  }

  const queries: ArcadeQueries = {
    async insertScore(input) {
      counter += 1;
      const id = `score-${counter}`;
      const createdAt = new Date(1_700_000_000_000 + counter * 1000);
      rows.push({
        id,
        userId: input.userId,
        gameId: input.gameId,
        score: input.score,
        createdAt,
        verified: input.verified ?? false,
      });
      return { id, createdAt };
    },
    async topByGame(gameId, metric, limit) {
      return [...perUser(gameId, metric).entries()]
        .map(([userId, best]) => ({
          userId,
          displayName: displayNames[userId] ?? userId,
          titleAchievementId: titel[userId] ?? null,
          avatarUpdatedAt: null,
          bestScore: best.score,
          achievedAt: best.at,
        }))
        .sort(
          (a, b) => b.bestScore - a.bestScore || a.achievedAt.getTime() - b.achievedAt.getTime(),
        )
        .slice(0, limit);
    },
    async personalStats(userId, gameId, metric) {
      const mine = rows.filter((row) => row.userId === userId && row.gameId === gameId);
      if (mine.length === 0) return null;
      const scores = mine.map((row) => row.score);
      return {
        bestScore: metric === 'wins' ? scores.reduce((a, b) => a + b, 0) : Math.max(...scores),
        gamesPlayed: mine.length,
      };
    },
    async rankForScore(gameId, metric, bestScore) {
      if (stoerungen.rankForScore) {
        throw new Error('Rangzählung fehlgeschlagen (Testfall).');
      }
      let higher = 0;
      for (const best of perUser(gameId, metric).values()) {
        if (best.score > bestScore) higher += 1;
      }
      return higher + 1;
    },
  };

  return {
    rows,
    seeds,
    stoerungen,
    ...queries,
    async transaction(work) {
      const stand = rows.map((row) => ({ ...row }));
      try {
        return await work(queries);
      } catch (error) {
        rows.splice(0, rows.length, ...stand);
        throw error;
      }
    },
    async insertSeed(input) {
      counter += 1;
      const id = `11111111-1111-4111-8111-${String(counter).padStart(12, '0')}`;
      seeds.push({ id, ...input, usedAt: null });
      return { id };
    },
    async consumeSeed({ seedId, userId, gameId, now }) {
      const seed = seeds.find(
        (s) =>
          s.id === seedId &&
          s.userId === userId &&
          s.gameId === gameId &&
          s.usedAt === null &&
          s.expiresAt > now,
      );
      if (!seed) return null;
      seed.usedAt = now;
      return { seed: seed.seed, gameVersion: seed.gameVersion };
    },
    async deleteExpiredSeeds(now) {
      const vorher = seeds.length;
      seeds.splice(0, seeds.length, ...seeds.filter((s) => s.expiresAt >= now));
      return vorher - seeds.length;
    },
  };
}

const JETZT = new Date('2026-09-26T12:00:00Z');

function service(
  repository: FakeRepository,
  extra: Partial<Parameters<typeof createArcadeService>[0]> = {},
) {
  const registry = miniRegistry();

  return createArcadeService({
    repository,
    registry,
    verifier: createArcadeVerifier({ mode: 'inline', registry }),
    now: () => JETZT,
    randomSeed: () => 42,
    ...extra,
  });
}

/** Band des Zählers: `punkte` mal UP, dann ACTION. */
function zaehlerBand(punkte: number, beenden = true): string {
  const recorder = new ArcadeRecorder();
  let tick = 0;
  for (let i = 0; i < punkte; i += 1) {
    recorder.record(tick, ARCADE_INPUT_UP);
    tick += 2;
  }
  if (beenden) recorder.record(tick, ARCADE_INPUT_ACTION);
  return replayToBase64(encodeArcadeReplay(recorder.finish(tick + 1)));
}

/** Nimm gegen den Computer mit 7 Steinen: Mensch nimmt 1, 2, 2 und gewinnt. */
const NIMM_SIEG = {
  options: { stones: 7 },
  seats: [{ type: 'human' as const }, { type: 'bot' as const, level: 'mittel' as const }],
  moves: [
    { seat: 0, move: { take: 1 } },
    { seat: 0, move: { take: 2 } },
    { seat: 0, move: { take: 2 } },
  ],
};

async function einreichenZaehler(
  arcade: ReturnType<typeof service>,
  userId: string,
  punkte: number,
) {
  const seed = await arcade.issueSeed(userId, 'kriechpfad');
  return arcade.submitRun(userId, {
    gameId: 'kriechpfad',
    seedId: seed.seedId,
    replay: zaehlerBand(punkte),
  });
}

describe('Startwerte', () => {
  it('gibt einen Startwert mit der Regelfassung aus dem Register aus', async () => {
    const repository = fakeRepository();
    const seed = await service(repository).issueSeed('user-1', 'kriechpfad');

    expect(seed).toMatchObject({ seed: 42, gameId: 'kriechpfad', gameVersion: 3 });
    expect(new Date(seed.expiresAt).getTime() - JETZT.getTime()).toBe(6 * 60 * 60 * 1000);
    expect(repository.seeds).toHaveLength(1);
  });

  it('lehnt Spiele ohne Regeln im Register ab', async () => {
    await expect(
      service(fakeRepository()).issueSeed('user-1', 'blockstapel'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('gibt für reine Online-Spiele keinen Startwert aus', async () => {
    await expect(service(fakeRepository()).issueSeed('user-1', 'codenames')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('verbraucht einen Startwert genau einmal', async () => {
    const arcade = service(fakeRepository());
    const seed = await arcade.issueSeed('user-1', 'kriechpfad');
    const input = { gameId: 'kriechpfad' as const, seedId: seed.seedId, replay: zaehlerBand(3) };

    await expect(arcade.submitRun('user-1', input)).resolves.toMatchObject({ score: { score: 3 } });
    await expect(arcade.submitRun('user-1', input)).rejects.toMatchObject({
      code: 'ARCADE_SEED_INVALID',
    });
  });

  it('nimmt keinen fremden, falschen oder abgelaufenen Startwert an', async () => {
    const repository = fakeRepository();
    const arcade = service(repository);
    const seed = await arcade.issueSeed('user-1', 'kriechpfad');

    await expect(
      arcade.submitRun('user-2', {
        gameId: 'kriechpfad',
        seedId: seed.seedId,
        replay: zaehlerBand(1),
      }),
    ).rejects.toMatchObject({ code: 'ARCADE_SEED_INVALID' });

    const spaeter = service(repository, { now: () => new Date(JETZT.getTime() + 7 * 3600_000) });
    await expect(
      spaeter.submitRun('user-1', {
        gameId: 'kriechpfad',
        seedId: seed.seedId,
        replay: zaehlerBand(1),
      }),
    ).rejects.toMatchObject({ code: 'ARCADE_SEED_INVALID' });
  });

  it('lehnt ab, wenn sich die Regelfassung seit der Ausgabe geändert hat', async () => {
    const repository = fakeRepository();
    const seed = await service(repository).issueSeed('user-1', 'kriechpfad');
    const neueRegeln = miniRegistry(
      {},
      { kriechpfad: { ...miniRegistry().realtime('kriechpfad')!, version: 4 } },
    );
    const arcade = service(repository, {
      registry: neueRegeln,
      verifier: createArcadeVerifier({ mode: 'inline', registry: neueRegeln }),
    });

    await expect(
      arcade.submitRun('user-1', {
        gameId: 'kriechpfad',
        seedId: seed.seedId,
        replay: zaehlerBand(1),
      }),
    ).rejects.toMatchObject({ code: 'ARCADE_REPLAY_INVALID' });
  });
});

describe('Nachgerechnete Einsendung', () => {
  it('speichert nur den errechneten Stand und loggt eine Abweichung', async () => {
    const repository = fakeRepository();
    const warn = vi.fn();
    const arcade = service(repository, { logger: { warn } });
    const seed = await arcade.issueSeed('user-1', 'kriechpfad');

    const result = await arcade.submitRun('user-1', {
      gameId: 'kriechpfad',
      seedId: seed.seedId,
      replay: zaehlerBand(5),
      claimedScore: 9999,
    });

    expect(result.score.score).toBe(5);
    expect(repository.rows).toEqual([expect.objectContaining({ score: 5, verified: true })]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ claimed: 9999, computed: 5 }),
      expect.any(String),
    );
  });

  it('wertet ein unbeendetes Band nicht', async () => {
    const arcade = service(fakeRepository());
    const seed = await arcade.issueSeed('user-1', 'kriechpfad');

    await expect(
      arcade.submitRun('user-1', {
        gameId: 'kriechpfad',
        seedId: seed.seedId,
        replay: zaehlerBand(5, false),
      }),
    ).rejects.toMatchObject({ code: 'ARCADE_REPLAY_INVALID' });
  });

  it('wertet einen nachgerechneten Sieg gegen den Computer als einen Sieg', async () => {
    const repository = fakeRepository();
    const arcade = service(repository);
    const seed = await arcade.issueSeed('user-1', 'vier-gewinnt');

    const result = await arcade.submitRun('user-1', {
      gameId: 'vier-gewinnt',
      seedId: seed.seedId,
      match: NIMM_SIEG,
    });

    expect(result.score.score).toBe(1);
    expect(result.personal).toEqual({ bestScore: 1, rank: 1, gamesPlayed: 1 });
  });

  it('wertet eine Niederlage nicht („nur Siege")', async () => {
    const arcade = service(fakeRepository());
    const seed = await arcade.issueSeed('user-1', 'vier-gewinnt');

    // 7 → Mensch 2 → 5 → Bot 2 → 3 → Mensch 2 → 1 → Bot 1: Bot gewinnt.
    await expect(
      arcade.submitRun('user-1', {
        gameId: 'vier-gewinnt',
        seedId: seed.seedId,
        match: {
          ...NIMM_SIEG,
          moves: [
            { seat: 0, move: { take: 2 } },
            { seat: 0, move: { take: 2 } },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: 'ARCADE_REPLAY_INVALID',
      message: expect.stringContaining('Siege'),
    });
  });

  it('verlangt genau einen menschlichen Sitz', async () => {
    const arcade = service(fakeRepository());
    const seed = await arcade.issueSeed('user-1', 'vier-gewinnt');

    await expect(
      arcade.submitRun('user-1', {
        gameId: 'vier-gewinnt',
        seedId: seed.seedId,
        match: { ...NIMM_SIEG, seats: [{ type: 'human' }, { type: 'human' }] },
      }),
    ).rejects.toMatchObject({ code: 'ARCADE_REPLAY_INVALID' });
  });

  it('lehnt einen illegalen Zug in der Aufzeichnung ab', async () => {
    const arcade = service(fakeRepository());
    const seed = await arcade.issueSeed('user-1', 'vier-gewinnt');

    await expect(
      arcade.submitRun('user-1', {
        gameId: 'vier-gewinnt',
        seedId: seed.seedId,
        match: { ...NIMM_SIEG, moves: [{ seat: 0, move: { take: 3 } }] },
      }),
    ).rejects.toMatchObject({ code: 'ARCADE_REPLAY_INVALID' });
  });

  it('übernimmt bei Punktespielen den Stand des menschlichen Sitzes', async () => {
    const arcade = service(fakeRepository());
    const seed = await arcade.issueSeed('user-1', 'kniffel');

    const result = await arcade.submitRun('user-1', {
      gameId: 'kniffel',
      seedId: seed.seedId,
      match: {
        options: { stones: 4 },
        seats: [{ type: 'human' }],
        moves: [
          { seat: 0, move: { take: 2 } },
          { seat: 0, move: { take: 2 } },
        ],
      },
    });

    expect(result.score.score).toBe(4);
  });

  it('meldet jedes gespeicherte Ergebnis an die Erfolge – nach dem Speichern', async () => {
    const gemeldet: string[] = [];
    const arcade = service(fakeRepository(), {
      onScoreSubmitted: (userId, gameId) => gemeldet.push(`${userId}:${gameId}`),
    });

    await einreichenZaehler(arcade, 'user-1', 2);

    expect(gemeldet).toEqual(['user-1:kriechpfad']);
  });
});

describe('Bestenliste', () => {
  it('zählt bei `score` den besten Einzelstand und liefert die Wertung mit', async () => {
    const repository = fakeRepository({ displayNames: { 'user-1': 'Ada', 'user-2': 'Grace' } });
    const arcade = service(repository);

    await einreichenZaehler(arcade, 'user-1', 12);
    await einreichenZaehler(arcade, 'user-1', 9);
    await einreichenZaehler(arcade, 'user-2', 30);

    const board = await arcade.getLeaderboard('user-1', 'kriechpfad');

    expect(board.metric).toBe('score');
    expect(board.entries.map((entry) => [entry.displayName, entry.bestScore, entry.rank])).toEqual([
      ['Grace', 30, 1],
      ['Ada', 12, 2],
    ]);
    expect(board.personal).toEqual({ bestScore: 12, rank: 2, gamesPlayed: 2 });
  });

  it('summiert bei `wins` die Siege je Konto', async () => {
    const repository = fakeRepository();
    const arcade = service(repository);

    await arcade.recordRoomResults([
      { userId: 'user-1', gameId: 'vier-gewinnt', score: 1 },
      { userId: 'user-1', gameId: 'vier-gewinnt', score: 1 },
      { userId: 'user-2', gameId: 'vier-gewinnt', score: 1 },
    ]);

    const board = await arcade.getLeaderboard('user-2', 'vier-gewinnt');

    expect(board.metric).toBe('wins');
    expect(board.entries.map((entry) => [entry.userId, entry.bestScore, entry.rank])).toEqual([
      ['user-1', 2, 1],
      ['user-2', 1, 2],
    ]);
    expect(board.personal).toEqual({ bestScore: 1, rank: 2, gamesPlayed: 1 });
  });

  it('lässt keinen halben Zustand zurück, wenn ein Teilschritt scheitert', async () => {
    const repository = fakeRepository();
    const arcade = service(repository);

    await einreichenZaehler(arcade, 'user-1', 5);
    repository.stoerungen.rankForScore = true;

    await expect(einreichenZaehler(arcade, 'user-1', 50)).rejects.toThrow(
      'Rangzählung fehlgeschlagen (Testfall).',
    );
    expect(repository.rows.map((row) => row.score)).toEqual([5]);
  });

  it('gibt Gleichstand denselben Rang („1, 1, 3")', async () => {
    const arcade = service(fakeRepository());

    await einreichenZaehler(arcade, 'user-1', 20);
    await einreichenZaehler(arcade, 'user-2', 20);
    await einreichenZaehler(arcade, 'user-3', 10);

    const board = await arcade.getLeaderboard('user-2', 'kriechpfad');

    expect(board.entries.map((entry) => entry.rank)).toEqual([1, 1, 3]);
    expect(board.personal?.rank).toBe(1);
  });

  it('führt ein gesperrtes Konto nicht in der Liste und lässt es niemanden verdrängen', async () => {
    const arcade = service(fakeRepository({ banned: ['user-1'] }));

    await einreichenZaehler(arcade, 'user-1', 90);
    const ergebnis = await einreichenZaehler(arcade, 'user-2', 12);
    const board = await arcade.getLeaderboard('user-2', 'kriechpfad');

    expect(ergebnis.personal.rank).toBe(1);
    expect(board.entries.map((entry) => entry.userId)).toEqual(['user-2']);
  });
});
