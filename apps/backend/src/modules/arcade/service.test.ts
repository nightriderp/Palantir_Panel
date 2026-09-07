import { type ArcadeGameId } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import type { ArcadeQueries, ArcadeRepository } from './repository.js';
import { createArcadeService } from './service.js';

interface Zeile {
  id: string;
  userId: string;
  gameId: ArcadeGameId;
  score: number;
  createdAt: Date;
}

interface FakeOptions {
  /** Anzeigenamen je Konto-Id; ohne Eintrag steht die Id selbst dort. */
  readonly displayNames?: Record<string, string>;
  /** Konten, die gesperrt sind (Audit W3-5, `backend-community-16`). */
  readonly banned?: readonly string[];
}

type FakeRepository = ArcadeRepository & {
  rows: Zeile[];
  /** Schalter, um einen einzelnen Teilschritt gezielt scheitern zu lassen. */
  stoerungen: { rankForScore: boolean };
};

/**
 * In-Memory-Attrappe des Repositories – bildet die Aggregate (Bestwert je
 * Konto, Rang, Versuchszahl) genauso nach wie die SQL-Abfragen, damit die
 * Service-Logik ohne Datenbank prüfbar ist (CLAUDE.md §4).
 *
 * Zwei Eigenschaften des echten Repositories sind hier ausdrücklich
 * nachgebildet, weil die Service-Tests sie brauchen (Audit W3-5):
 *  - Gesperrte Konten kommen weder in `topByGame` noch in `rankForScore` vor;
 *    `personalStats` kennt den Filter dagegen nicht (eigene Daten).
 *  - `transaction()` verwirft alles im Rumpf Geschriebene, wenn der Rumpf wirft
 *    – die Klammer, auf die sich `submitScore` verlässt.
 */
function fakeRepository(options: FakeOptions = {}): FakeRepository {
  const displayNames = options.displayNames ?? {};
  const banned = new Set(options.banned ?? []);
  const rows: Zeile[] = [];
  const stoerungen = { rankForScore: false };
  let counter = 0;

  /** Bestwert je **wertbarem** Konto – gesperrte bleiben außen vor. */
  function bestPerUser(gameId: ArcadeGameId): Map<string, { score: number; at: Date }> {
    const byUser = new Map<string, { score: number; at: Date }>();
    for (const row of rows) {
      if (row.gameId !== gameId || banned.has(row.userId)) continue;
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

  const queries: ArcadeQueries = {
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
      if (stoerungen.rankForScore) {
        throw new Error('Rangzählung fehlgeschlagen (Testfall).');
      }
      let higher = 0;
      for (const best of bestPerUser(gameId).values()) {
        if (best.score > bestScore) higher += 1;
      }
      return higher + 1;
    },
  };

  return {
    rows,
    stoerungen,
    ...queries,
    async transaction(work) {
      const stand = rows.map((row) => ({ ...row }));

      try {
        return await work(queries);
      } catch (error) {
        // Rollback: der Stand vor der Transaktion.
        rows.splice(0, rows.length, ...stand);
        throw error;
      }
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

  /**
   * Audit W3-5, `backend-community-17`: Der Vorgang gehört in eine
   * Transaktionsklammer. Scheitert ein Schritt **nach** dem Einfügen, darf kein
   * halber Zustand zurückbleiben.
   */
  it('lässt keinen halben Zustand zurück, wenn ein Teilschritt scheitert', async () => {
    const repository = fakeRepository();
    const service = createArcadeService({ repository });

    await service.submitScore('user-1', { gameId: GAME, score: 120 });
    repository.stoerungen.rankForScore = true;

    await expect(service.submitScore('user-1', { gameId: GAME, score: 900 })).rejects.toThrow(
      'Rangzählung fehlgeschlagen (Testfall).',
    );

    // Der erste Versuch steht noch, der abgebrochene zweite nicht.
    expect(repository.rows.map((row) => row.score)).toEqual([120]);

    repository.stoerungen.rankForScore = false;
    const board = await service.getLeaderboard('user-1', GAME);

    expect(board.personal).toEqual({ bestScore: 120, rank: 1, gamesPlayed: 1 });
  });

  it('liest den gemeldeten Stand nach dem Einfügen frisch aus der Transaktion', async () => {
    const repository = fakeRepository();
    const service = createArcadeService({ repository });

    // Ein Versuch, der außerhalb des Service entstanden ist (paralleler
    // Aufruf): Er zählt im Ergebnis mit, weil der Nachher-Stand gelesen und
    // nicht aus dem Vorher-Stand hochgerechnet wird.
    await repository.insertScore({ userId: 'user-1', gameId: GAME, score: 500 });

    const result = await service.submitScore('user-1', { gameId: GAME, score: 100 });

    expect(result.personal).toEqual({ bestScore: 500, rank: 1, gamesPlayed: 2 });
    expect(result.isNewPersonalBest).toBe(false);
  });
});

describe('ArcadeService.getLeaderboard', () => {
  it('sortiert je Konto den Bestwert und markiert das eigene Konto', async () => {
    const repository = fakeRepository({ displayNames: { 'user-1': 'Ada', 'user-2': 'Grace' } });
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

/**
 * Audit W3-5, `backend-community-15`: Liste und eigene Statistik folgen
 * derselben Regel.
 *
 * Festgehaltene Regel (Wettkampf-Rangvergabe, „1, 1, 3"): Der Rang eines
 * Bestwerts ist die Anzahl der **echt größeren** Bestwerte plus eins. Zwei
 * Konten mit demselben Wert teilen sich also den Rang; der nächstkleinere Wert
 * springt auf seine Listenposition. Die Reihenfolge innerhalb eines Gleichstands
 * entscheidet der frühere Zeitpunkt – sie ändert den Rang aber nicht.
 */
describe('Arcade-Rangvergabe', () => {
  it('gibt zwei Konten mit gleichem Bestwert denselben Rang und lässt den nächsten aufspringen', async () => {
    const repository = fakeRepository();
    const service = createArcadeService({ repository });

    await service.submitScore('user-1', { gameId: GAME, score: 200 });
    await service.submitScore('user-2', { gameId: GAME, score: 200 });
    await service.submitScore('user-3', { gameId: GAME, score: 100 });

    const board = await service.getLeaderboard('user-1', GAME);

    // Reihenfolge bei Gleichstand: der frühere Zeitpunkt zuerst.
    expect(board.entries.map((entry) => entry.userId)).toEqual(['user-1', 'user-2', 'user-3']);
    expect(board.entries.map((entry) => entry.rank)).toEqual([1, 1, 3]);
  });

  it('meldet denselben Punktestand in Liste und Einzelabfrage mit demselben Rang', async () => {
    const repository = fakeRepository();
    const service = createArcadeService({ repository });

    await service.submitScore('user-1', { gameId: GAME, score: 200 });
    await service.submitScore('user-2', { gameId: GAME, score: 200 });
    await service.submitScore('user-3', { gameId: GAME, score: 100 });

    for (const konto of ['user-1', 'user-2', 'user-3']) {
      const board = await service.getLeaderboard(konto, GAME);
      const eigeneZeile = board.entries.find((entry) => entry.userId === konto);

      expect(board.personal?.rank).toBe(eigeneZeile?.rank);
    }

    // Und zwar konkret: das zweitgelistete Konto steht auf Rang 1, nicht auf 2.
    const zweiter = await service.getLeaderboard('user-2', GAME);

    expect(zweiter.personal?.rank).toBe(1);
    expect(zweiter.entries[1]).toMatchObject({ userId: 'user-2', rank: 1 });
  });

  it('vergibt auch beim Absenden denselben Rang wie die Bestenliste', async () => {
    const repository = fakeRepository();
    const service = createArcadeService({ repository });

    await service.submitScore('user-1', { gameId: GAME, score: 200 });
    const ergebnis = await service.submitScore('user-2', { gameId: GAME, score: 200 });

    const board = await service.getLeaderboard('user-2', GAME);

    expect(ergebnis.personal.rank).toBe(1);
    expect(board.entries.find((entry) => entry.userId === 'user-2')?.rank).toBe(1);
  });
});

/**
 * Audit W3-5, `backend-community-16`: Ein gesperrtes Konto ist aus der
 * Bestenliste verschwunden und verdrängt dort auch niemanden mehr.
 *
 * Seine **eigene** Statistik bleibt ihm erhalten: Es sind seine eigenen Daten,
 * kein Blick auf fremde. Praktisch erreicht diesen Weg ohnehin niemand – eine
 * Sperre verhindert schon die Anmeldung (`AUTH_ACCOUNT_BANNED`).
 */
describe('Arcade-Bestenliste und gesperrte Konten', () => {
  it('führt ein gesperrtes Konto nicht in der Liste', async () => {
    const repository = fakeRepository({
      displayNames: { 'user-1': 'Ada', 'user-2': 'Grace' },
      banned: ['user-1'],
    });
    const service = createArcadeService({ repository });

    await service.submitScore('user-1', { gameId: GAME, score: 900 });
    await service.submitScore('user-2', { gameId: GAME, score: 120 });

    const board = await service.getLeaderboard('user-2', GAME);

    expect(board.entries.map((entry) => entry.userId)).toEqual(['user-2']);
  });

  it('lässt einen gesperrten Bestwert niemanden verdrängen', async () => {
    const repository = fakeRepository({ banned: ['user-1'] });
    const service = createArcadeService({ repository });

    await service.submitScore('user-1', { gameId: GAME, score: 900 });
    const ergebnis = await service.submitScore('user-2', { gameId: GAME, score: 120 });
    const board = await service.getLeaderboard('user-2', GAME);

    // Ohne den Filter stünde hier Rang 2 – hinter einem Konto, das niemand sieht.
    expect(ergebnis.personal.rank).toBe(1);
    expect(board.personal?.rank).toBe(1);
    expect(board.entries[0]).toMatchObject({ userId: 'user-2', rank: 1 });
  });

  it('zeigt dem gesperrten Konto weiterhin die eigene Statistik', async () => {
    const repository = fakeRepository({ banned: ['user-1'] });
    const service = createArcadeService({ repository });

    await service.submitScore('user-1', { gameId: GAME, score: 900 });
    await service.submitScore('user-1', { gameId: GAME, score: 100 });

    const board = await service.getLeaderboard('user-1', GAME);

    expect(board.entries).toEqual([]);
    expect(board.personal).toEqual({ bestScore: 900, rank: 1, gamesPlayed: 2 });
  });
});
