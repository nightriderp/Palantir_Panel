/**
 * Fachliche Logik des Arcade-Moduls (Arbeitspaket F8, Pflichtenheft §17).
 *
 * Der Service ist die Instanz, die Punktestände speichert und die
 * nutzerbezogene Bestenliste je Spiel zusammenstellt (Lastenheft §3.9). Die
 * Spiele selbst laufen im Browser; das Backend prüft und persistiert nur das
 * Ergebnis. Rechte spielen hier keine Rolle: spielen darf jedes freigeschaltete
 * Konto – die Zuordnung geschieht über die Konto-Id, nicht über den Katalog.
 *
 * **Eine Rangvergabe, nicht zwei** (Audit W3-5, `backend-community-15`): Ränge
 * entstehen ausschließlich nach der Regel von `ArcadeRepository.rankForScore` –
 * „Anzahl der echt größeren Bestwerte plus eins". Die Bestenliste zählt ihre
 * Plätze nicht mehr eigenständig durch; sonst sah ein Konto bei Gleichstand in
 * derselben Antwort „Listenplatz 2" und „dein Rang: 1".
 */

import {
  ARCADE_LEADERBOARD_LIMIT,
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
  type ArcadeLeaderboardEntryDto,
  type ArcadeSubmitResultDto,
} from '@palantir/contracts';
import type { SubmitArcadeScoreInput } from '@palantir/validation';
import type { ArcadeLeaderboardRow, ArcadeRepository } from './repository.js';

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

/**
 * Baut die Zeilen der Bestenliste und vergibt dabei die Ränge.
 *
 * Angewandt wird die Wettkampf-Rangvergabe („1, 1, 3"): Konten mit demselben
 * Bestwert teilen sich den Rang, der nächstkleinere Wert springt auf seine
 * Listenposition. Das ist genau „Anzahl der echt größeren Bestwerte plus eins"
 * und damit dieselbe Regel, nach der `rankForScore` den eigenen Platz bestimmt –
 * die eine Rangvergabe des Bereichs (`backend-community-15`).
 *
 * Erwartet die Zeilen bereits absteigend sortiert; genau so liefert sie
 * `topByGame` (Gleichstand: der frühere Zeitpunkt steht oben).
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
      bestScore: row.bestScore,
      achievedAt: row.achievedAt.toISOString(),
      isCurrentUser: row.userId === userId,
    };
  });
}

export function createArcadeService(options: ArcadeServiceOptions): ArcadeService {
  const { repository } = options;
  const limit = options.leaderboardLimit ?? ARCADE_LEADERBOARD_LIMIT;

  return {
    async submitScore(userId, input) {
      /*
       * Schreiben und Auswerten in einer Transaktion (`backend-community-17`):
       * Vorher-Stand, Einfügen, Nachher-Stand und Rang gehören zu **einem**
       * Vorgang. Bricht ein Schritt danach ab, verschwindet auch die eben
       * geschriebene Zeile – kein Punktestand ohne Antwort und keine Antwort
       * ohne Punktestand.
       *
       * Der Nachher-Stand wird bewusst frisch gelesen, statt ihn aus dem
       * Vorher-Stand hochzurechnen: Nur so entsprechen `bestScore` und
       * `gamesPlayed` dem, was tatsächlich in der Datenbank steht.
       *
       * Rest-Risiko, bewusst nicht weiter abgesichert: Zwei zeitgleiche
       * Submissions desselben Kontos serialisiert auch diese Transaktion unter
       * `READ COMMITTED` nicht vollständig – beide können denselben
       * `gamesPlayed`-Wert melden. Es bliebe eine reine Anzeigeabweichung; eine
       * Sperrzeile dafür wäre unverhältnismäßig (die Route begrenzt die Rate
       * ohnehin je Konto).
       */
      return repository.transaction(async (tx) => {
        const before = await tx.personalStats(userId, input.gameId);
        const inserted = await tx.insertScore({
          userId,
          gameId: input.gameId,
          score: input.score,
        });
        const after = await tx.personalStats(userId, input.gameId);

        const isNewPersonalBest = before === null || input.score > before.bestScore;
        // Nach dem eigenen Insert kann `after` nicht leer sein; der Zweig ist
        // nur die typsichere Absicherung und rechnet dann wie zuvor hoch.
        const stats = after ?? {
          bestScore: before === null ? input.score : Math.max(before.bestScore, input.score),
          gamesPlayed: (before?.gamesPlayed ?? 0) + 1,
        };
        const rank = await tx.rankForScore(input.gameId, stats.bestScore);

        return {
          score: {
            id: inserted.id,
            gameId: input.gameId,
            score: input.score,
            createdAt: inserted.createdAt.toISOString(),
          },
          personal: { bestScore: stats.bestScore, rank, gamesPlayed: stats.gamesPlayed },
          isNewPersonalBest,
        };
      });
    },

    async getLeaderboard(userId, gameId) {
      const [top, stats] = await Promise.all([
        repository.topByGame(gameId, limit),
        repository.personalStats(userId, gameId),
      ]);

      /*
       * Der eigene Rang kommt aus `rankForScore` und die Listenränge aus
       * derselben Regel – beide Angaben derselben Antwort stimmen damit
       * überein. Für ein gesperrtes Konto, das seine eigene Statistik abruft,
       * bleibt der Bestwert sichtbar (es sind seine eigenen Daten); gezählt wird
       * sein Rang gegen die wertbare Bestenliste, in der es selbst nicht
       * auftaucht. Praktisch erreicht diesen Weg ohnehin niemand: Eine Sperre
       * verhindert bereits die Anmeldung (`AUTH_ACCOUNT_BANNED`).
       */
      const personal =
        stats === null
          ? null
          : {
              bestScore: stats.bestScore,
              rank: await repository.rankForScore(gameId, stats.bestScore),
              gamesPlayed: stats.gamesPlayed,
            };

      return {
        gameId,
        entries: toRankedEntries(top, userId),
        personal,
        // Freigeschaltet und angemeldet ist, wer diese Route erreicht (die Route
        // erzwingt beides über `requireApproved()`).
        permissions: { canSubmit: true },
      };
    },
  };
}
