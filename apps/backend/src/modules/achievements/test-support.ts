/**
 * Attrappe des Erfolgs-Repositories (Betreiber-Wunsch 21.09.2026).
 *
 * Bildet die Zählungen im Arbeitsspeicher genauso nach wie die SQL-Abfragen,
 * damit Regeln und Service ohne Datenbank prüfbar sind (Entwicklungsregeln §4).
 * Genutzt von `rules.test.ts` und `service.test.ts`.
 */

import { type AchievementId, type ArcadeGameId, type AuditAction } from '@palantir/contracts';
import type { AchievementRepository, UnlockedAchievement } from './repository.js';

/** Ein Protokolleintrag, wie ihn die Attrappe zählt. */
export interface FakeAuditRow {
  readonly id: string;
  readonly action: AuditAction;
}

export interface FakeOptions {
  /** Protokolleinträge des Kontos – die Grundmenge aller Zählungen. */
  readonly auditRows?: readonly FakeAuditRow[];
  /** Platz in der Reihenfolge der Registrierungen; Vorgabe: weit hinten. */
  readonly registrationRank?: number;
  /** Abgesendete Arcade-Versuche je Spiel. */
  readonly arcadeRounds?: Partial<Record<ArcadeGameId, number>>;
  /** Spiele, in denen das Konto auf Platz eins steht. */
  readonly topOf?: readonly ArcadeGameId[];
  /** Bereits freigeschaltete Abzeichen. */
  readonly unlocked?: readonly AchievementId[];
  /** Getragener Titel. */
  readonly selectedTitle?: AchievementId | null;
}

export type FakeAchievementRepository = AchievementRepository & {
  /** Abzeichen in Reihenfolge der Vergabe – für Zusicherungen im Test. */
  readonly vergeben: AchievementId[];
  /** Zählt die Datenbankzugriffe je Art – prüft, dass nicht zu viel läuft. */
  readonly zugriffe: Record<string, number>;
};

export function fakeAchievementRepository(options: FakeOptions = {}): FakeAchievementRepository {
  const auditRows = options.auditRows ?? [];
  const arcadeRounds = options.arcadeRounds ?? {};
  const topOf = new Set<ArcadeGameId>(options.topOf ?? []);
  const vergeben: AchievementId[] = [];
  const zugriffe: Record<string, number> = {};

  const frei = new Map<AchievementId, Date>(
    (options.unlocked ?? []).map(
      (id, index) => [id, new Date(1_700_000_000_000 + index * 1000)] as const,
    ),
  );

  let titel: AchievementId | null = options.selectedTitle ?? null;

  function zaehle(name: string): void {
    zugriffe[name] = (zugriffe[name] ?? 0) + 1;
  }

  return {
    vergeben,
    zugriffe,

    unlocked(): Promise<UnlockedAchievement[]> {
      zaehle('unlocked');

      return Promise.resolve(
        [...frei.entries()].map(([achievementId, unlockedAt]) => ({ achievementId, unlockedAt })),
      );
    },

    award(_userId, achievementIds): Promise<AchievementId[]> {
      zaehle('award');

      // Wie `ON CONFLICT DO NOTHING`: Bereits Vorhandenes fällt heraus, statt
      // zu scheitern.
      const neu = achievementIds.filter((id) => !frei.has(id));

      for (const id of neu) {
        frei.set(id, new Date(1_800_000_000_000));
        vergeben.push(id);
      }

      return Promise.resolve(neu);
    },

    countAuditEntries(_userId, filter, exceptEntryId): Promise<number> {
      zaehle('countAuditEntries');

      const passend = auditRows.filter((row) => {
        if (row.id === exceptEntryId) return false;

        return 'include' in filter
          ? filter.include.includes(row.action)
          : !filter.exclude.includes(row.action);
      });

      return Promise.resolve(passend.length);
    },

    registrationRank(): Promise<number> {
      zaehle('registrationRank');

      return Promise.resolve(options.registrationRank ?? 99);
    },

    arcadeRoundCount(): Promise<number> {
      zaehle('arcadeRoundCount');

      return Promise.resolve(
        Object.values(arcadeRounds).reduce<number>((summe, anzahl) => summe + (anzahl ?? 0), 0),
      );
    },

    arcadeDistinctGames(): Promise<number> {
      zaehle('arcadeDistinctGames');

      return Promise.resolve(
        Object.values(arcadeRounds).filter((anzahl) => (anzahl ?? 0) > 0).length,
      );
    },

    isTopOfLeaderboard(_userId, gameId): Promise<boolean> {
      zaehle('isTopOfLeaderboard');

      return Promise.resolve(topOf.has(gameId));
    },

    selectedTitle(): Promise<AchievementId | null> {
      zaehle('selectedTitle');

      return Promise.resolve(titel);
    },

    setSelectedTitle(_userId, achievementId): Promise<void> {
      zaehle('setSelectedTitle');
      titel = achievementId;

      return Promise.resolve();
    },
  };
}
