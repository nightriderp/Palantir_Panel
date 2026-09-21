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
  /**
   * Platz in der Reihenfolge der Registrierungen; Vorgabe: weit hinten.
   *
   * Das echte Repository gibt dem Betreiber `Number.MAX_SAFE_INTEGER` – er
   * steht ausserhalb der Wertung (Betreiber, 21.09.2026). Ein Test, der das
   * nachstellt, setzt hier denselben Wert.
   */
  readonly registrationRank?: number;
  /** Abgesendete Arcade-Versuche je Spiel. */
  readonly arcadeRounds?: Partial<Record<ArcadeGameId, number>>;
  /** Bester Platz des Kontos über alle Bestenlisten; ohne Angabe: nie gespielt. */
  readonly bestRank?: number;
  /** Liegt ein Protokolleintrag im Nacht-Fenster? (Nachvergabe) */
  readonly nachtEintrag?: boolean;
  /** Konten der Instanz – Grundmenge der Nachvergabe. */
  readonly alleKonten?: readonly string[];
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
  const vergeben: AchievementId[] = [];
  const zugriffe: Record<string, number> = {};

  /*
   * Freigeschaltete Abzeichen **je Konto**, nicht global: Der Lauf über alle
   * Konten (`backfillAll`) prüft mehrere nacheinander, und ein gemeinsamer
   * Bestand ließe das zweite Konto die Abzeichen des ersten sehen.
   *
   * Die Vorgabe aus `options.unlocked` gilt für jedes Konto – die meisten
   * Tests kennen ohnehin nur eines.
   */
  const freiJeKonto = new Map<string, Map<AchievementId, Date>>();

  function freiFuer(userId: string): Map<AchievementId, Date> {
    const vorhanden = freiJeKonto.get(userId);

    if (vorhanden) return vorhanden;

    const angelegt = new Map<AchievementId, Date>(
      (options.unlocked ?? []).map(
        (id, index) => [id, new Date(1_700_000_000_000 + index * 1000)] as const,
      ),
    );

    freiJeKonto.set(userId, angelegt);

    return angelegt;
  }

  let titel: AchievementId | null = options.selectedTitle ?? null;

  function zaehle(name: string): void {
    zugriffe[name] = (zugriffe[name] ?? 0) + 1;
  }

  return {
    vergeben,
    zugriffe,

    unlocked(userId): Promise<UnlockedAchievement[]> {
      zaehle('unlocked');

      return Promise.resolve(
        [...freiFuer(userId).entries()].map(([achievementId, unlockedAt]) => ({
          achievementId,
          unlockedAt,
        })),
      );
    },

    award(userId, achievementIds): Promise<AchievementId[]> {
      zaehle('award');

      const frei = freiFuer(userId);
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

    bestArcadeRank(): Promise<number | null> {
      zaehle('bestArcadeRank');

      return Promise.resolve(options.bestRank ?? null);
    },

    hasAuditEntryAtHour(_userId, actions): Promise<boolean> {
      zaehle('hasAuditEntryAtHour');

      // Die Attrappe kennt keine Uhrzeiten – der Test sagt schlicht, ob es
      // einen solchen Eintrag gibt, und prüft daneben, dass nur nach den
      // richtigen Aktionen gefragt wird.
      return Promise.resolve(
        (options.nachtEintrag ?? false) && auditRows.some((row) => actions.includes(row.action)),
      );
    },

    allUserIds(): Promise<string[]> {
      zaehle('allUserIds');

      return Promise.resolve([...(options.alleKonten ?? [])]);
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
