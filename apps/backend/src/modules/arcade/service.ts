/**
 * Fachliche Logik der Bestenliste (Arbeitspaket F8, Neubau 26.09.2026).
 *
 * **Seit dem Neubau rechnet das Backend nach.** Der Browser holt sich vor der
 * Partie einen Startwert (`issueSeed`) und schickt danach das Eingabeband bzw.
 * seine Züge zurück (`submitRun`). Der Service verbraucht den Startwert
 * atomar, spielt die Partie im Worker nach (`verifier.ts`) und speichert nur
 * den selbst errechneten Stand. Was der Browser als Stand behauptet
 * (`claimedScore`), landet höchstens im Log.
 *
 * **Eine Rangvergabe, nicht zwei** (Audit W3-5, `backend-community-15`): Ränge
 * entstehen ausschließlich nach der Regel von `ArcadeRepository.rankForScore` –
 * „Anzahl der echt größeren Werte plus eins".
 *
 * **Zwei Wertungen:** `metric: 'score'` zählt den besten Einzelstand je Konto,
 * `metric: 'wins'` die Summe der Siege (jede Zeile ein Sieg).
 */

import { randomInt } from 'node:crypto';
import {
  ARCADE_GAME_CATALOG,
  ARCADE_LEADERBOARD_LIMIT,
  ARCADE_SEED_TTL_HOURS,
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
  type ArcadeLeaderboardEntryDto,
  type ArcadeMetric,
  type ArcadeSeedDto,
  type ArcadeSubmitResultDto,
  titleForAchievement,
} from '@palantir/contracts';
import type { SubmitArcadeRunInputParsed } from '@palantir/validation';
import { ArcadeError } from './errors.js';
import type { ArcadeLeaderboardRow, ArcadeQueries, ArcadeRepository } from './repository.js';
import { type ArcadeVerifier } from './verifier.js';
import { type ArcadeRuleRegistry, defaultArcadeRegistry, rulesVersionOf } from './verify.js';

/** Ein serverseitig festgestelltes Ergebnis (Online-Raum). */
export interface ArcadeRoomResult {
  userId: string;
  gameId: ArcadeGameId;
  score: number;
}

export interface ArcadeService {
  /** Neuer, einmal verwendbarer Startwert für eine Partie. */
  issueSeed(userId: string, gameId: ArcadeGameId): Promise<ArcadeSeedDto>;
  /** Nimmt eine Partie entgegen, rechnet sie nach und speichert den errechneten Stand. */
  submitRun(userId: string, input: SubmitArcadeRunInputParsed): Promise<ArcadeSubmitResultDto>;
  /** Bestenliste eines Spiels aus Sicht des aufrufenden Kontos. */
  getLeaderboard(userId: string, gameId: ArcadeGameId): Promise<ArcadeLeaderboardDto>;
  /**
   * Ergebnisse einer Online-Partie eintragen (der Server war Schiedsrichter,
   * nachgerechnet werden muss nichts). Alle in einer Transaktion.
   */
  recordRoomResults(results: readonly ArcadeRoomResult[]): Promise<void>;
}

export interface ArcadeServiceLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface ArcadeServiceOptions {
  readonly repository: ArcadeRepository;
  readonly verifier: ArcadeVerifier;
  /** Regeln; Vorgabe ist das echte Register. Tests schleusen Mini-Spiele ein. */
  readonly registry?: ArcadeRuleRegistry;
  /** Länge der Bestenliste; Standard aus dem Contract. */
  readonly leaderboardLimit?: number;
  readonly logger?: ArcadeServiceLogger;
  /** Uhr – für Tests. */
  readonly now?: () => Date;
  /** Zufall für den Startwert – für Tests. */
  readonly randomSeed?: () => number;
  /**
   * Wird nach jedem gespeicherten Ergebnis gerufen – Anschluss an das
   * Erfolgs-Modul (Betreiber-Wunsch 21.09.2026). Nach der Transaktion, nicht
   * erwartet: Ein Fehler dort darf das Ergebnis nicht zurückrollen.
   */
  readonly onScoreSubmitted?: (userId: string, gameId: ArcadeGameId) => void;
}

/** Abgelaufene Startwerte höchstens so oft wegräumen. */
const SEED_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Baut die Zeilen der Bestenliste und vergibt dabei die Ränge
 * (Wettkampf-Rangvergabe „1, 1, 3" – dieselbe Regel wie `rankForScore`).
 */
function toRankedEntries(
  rows: readonly ArcadeLeaderboardRow[],
  userId: string,
): ArcadeLeaderboardEntryDto[] {
  let vorherigerWert: number | null = null;
  let vorherigerRang = 0;

  return rows.map((row, position) => {
    const rank = row.bestScore === vorherigerWert ? vorherigerRang : position + 1;

    vorherigerWert = row.bestScore;
    vorherigerRang = rank;

    return {
      rank,
      userId: row.userId,
      displayName: row.displayName,
      title: row.titleAchievementId === null ? null : titleForAchievement(row.titleAchievementId),
      avatarUpdatedAt: row.avatarUpdatedAt?.toISOString() ?? null,
      bestScore: row.bestScore,
      achievedAt: row.achievedAt.toISOString(),
      isCurrentUser: row.userId === userId,
    };
  });
}

function metricOf(gameId: ArcadeGameId): ArcadeMetric {
  return ARCADE_GAME_CATALOG[gameId].metric;
}

/** Wird dieses Spiel über eingereichte Partien gewertet (und nicht nur online)? */
function isSubmittable(gameId: ArcadeGameId): boolean {
  const definition = ARCADE_GAME_CATALOG[gameId];

  return definition.engine === 'realtime' || definition.modes.solo || definition.modes.bots;
}

export function createArcadeService(options: ArcadeServiceOptions): ArcadeService {
  const { repository, verifier } = options;
  const registry = options.registry ?? defaultArcadeRegistry;
  const limit = options.leaderboardLimit ?? ARCADE_LEADERBOARD_LIMIT;
  const now = options.now ?? (() => new Date());
  const randomSeed = options.randomSeed ?? (() => randomInt(0, 2 ** 32));
  let letztesAufraeumen = 0;

  /** Meldet das Ergebnis weiter, ohne dafür geradezustehen. */
  function melden(userId: string, gameId: ArcadeGameId): void {
    if (!options.onScoreSubmitted) return;

    try {
      options.onScoreSubmitted(userId, gameId);
    } catch {
      // Bewusst still – der Empfänger meldet seine Fehler selbst.
    }
  }

  function aufraeumen(zeit: Date): void {
    if (zeit.getTime() - letztesAufraeumen < SEED_SWEEP_INTERVAL_MS) return;
    letztesAufraeumen = zeit.getTime();

    void repository.deleteExpiredSeeds(zeit).catch((error: unknown) => {
      options.logger?.warn({ err: error }, 'Abgelaufene Startwerte ließen sich nicht löschen.');
    });
  }

  /**
   * Schreibt ein Ergebnis und stellt die Antwort zusammen – in **einer**
   * Transaktion (`backend-community-17`). Der Nachher-Stand wird frisch
   * gelesen, nicht hochgerechnet.
   */
  async function speichern(
    tx: ArcadeQueries,
    userId: string,
    gameId: ArcadeGameId,
    score: number,
    herkunft: { seedId: string | null; gameVersion: number | null },
  ): Promise<ArcadeSubmitResultDto> {
    const metric = metricOf(gameId);
    const before = await tx.personalStats(userId, gameId, metric);
    const inserted = await tx.insertScore({
      userId,
      gameId,
      score,
      seedId: herkunft.seedId,
      gameVersion: herkunft.gameVersion,
      verified: true,
    });
    const after = await tx.personalStats(userId, gameId, metric);
    const stats = after ?? {
      bestScore:
        metric === 'wins'
          ? (before?.bestScore ?? 0) + score
          : Math.max(before?.bestScore ?? score, score),
      gamesPlayed: (before?.gamesPlayed ?? 0) + 1,
    };
    const isNewPersonalBest = before === null || stats.bestScore > before.bestScore;
    const rank = await tx.rankForScore(gameId, metric, stats.bestScore);

    return {
      score: { id: inserted.id, gameId, score, createdAt: inserted.createdAt.toISOString() },
      personal: { bestScore: stats.bestScore, rank, gamesPlayed: stats.gamesPlayed },
      isNewPersonalBest,
    };
  }

  return {
    async issueSeed(userId, gameId) {
      if (!isSubmittable(gameId)) {
        throw new ArcadeError(
          'VALIDATION_FAILED',
          'Dieses Spiel wird nur in Online-Räumen gewertet.',
        );
      }

      const gameVersion = rulesVersionOf(registry, gameId);

      if (gameVersion === null) {
        throw new ArcadeError('VALIDATION_FAILED', 'Für dieses Spiel gibt es noch keine Regeln.');
      }

      const zeit = now();
      aufraeumen(zeit);

      const seed = randomSeed() >>> 0;
      const expiresAt = new Date(zeit.getTime() + ARCADE_SEED_TTL_HOURS * 60 * 60 * 1000);
      const { id } = await repository.insertSeed({ userId, gameId, seed, gameVersion, expiresAt });

      return { seedId: id, seed, gameId, gameVersion, expiresAt: expiresAt.toISOString() };
    },

    async submitRun(userId, input) {
      const gameId = input.gameId;
      const zeit = now();
      const verbraucht = await repository.consumeSeed({
        seedId: input.seedId,
        userId,
        gameId,
        now: zeit,
      });

      if (verbraucht === null) {
        throw new ArcadeError('ARCADE_SEED_INVALID');
      }

      if (rulesVersionOf(registry, gameId) !== verbraucht.gameVersion) {
        throw new ArcadeError(
          'ARCADE_REPLAY_INVALID',
          'Die Spielregeln wurden inzwischen aktualisiert. Diese Partie wird nicht gewertet – lade die Seite neu.',
        );
      }

      const ergebnis = await verifier.verify({
        gameId,
        seed: verbraucht.seed,
        gameVersion: verbraucht.gameVersion,
        ...(input.replay === undefined ? {} : { replay: input.replay }),
        ...(input.match === undefined
          ? {}
          : {
              match: {
                options: input.match.options,
                seats: input.match.seats,
                moves: input.match.moves.map((zug) => ({ seat: zug.seat, move: zug.move })),
              },
            }),
      });

      if (!ergebnis.ok) {
        throw new ArcadeError(
          'ARCADE_REPLAY_INVALID',
          `Die Partie wird nicht gewertet: ${ergebnis.reason}`,
        );
      }

      if (input.claimedScore !== undefined && input.claimedScore !== ergebnis.score) {
        // Nur ein Hinweis: Ein anderer Stand im Browser ist meist ein
        // Anzeigefehler, kann aber auch ein Manipulationsversuch sein.
        options.logger?.warn(
          { userId, gameId, claimed: input.claimedScore, computed: ergebnis.score },
          'Arcade: behaupteter und nachgerechneter Stand weichen ab.',
        );
      }

      const antwort = await repository.transaction((tx) =>
        speichern(tx, userId, gameId, ergebnis.score, {
          seedId: input.seedId,
          gameVersion: verbraucht.gameVersion,
        }),
      );

      // Erst nach dem Commit: Ein Abzeichen für eine zurückgerollte Runde wäre eines zu viel.
      melden(userId, gameId);

      return antwort;
    },

    async recordRoomResults(results) {
      if (results.length === 0) return;

      await repository.transaction(async (tx) => {
        for (const result of results) {
          await tx.insertScore({
            userId: result.userId,
            gameId: result.gameId,
            score: result.score,
            verified: true,
          });
        }
      });

      for (const result of results) {
        melden(result.userId, result.gameId);
      }
    },

    async getLeaderboard(userId, gameId) {
      const metric = metricOf(gameId);
      const [top, stats] = await Promise.all([
        repository.topByGame(gameId, metric, limit),
        repository.personalStats(userId, gameId, metric),
      ]);

      const personal =
        stats === null
          ? null
          : {
              bestScore: stats.bestScore,
              rank: await repository.rankForScore(gameId, metric, stats.bestScore),
              gamesPlayed: stats.gamesPlayed,
            };

      return {
        gameId,
        metric,
        entries: toRankedEntries(top, userId),
        personal,
        // Freigeschaltet und angemeldet ist, wer diese Route erreicht.
        permissions: { canSubmit: isSubmittable(gameId) },
      };
    },
  };
}
