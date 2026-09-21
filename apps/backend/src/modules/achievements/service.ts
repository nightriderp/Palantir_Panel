/**
 * Fachliche Logik des Erfolgs-Moduls (Betreiber-Wunsch 21.09.2026).
 *
 * Zwei Aufgaben: die Übersicht eines Kontos zusammenstellen und – ausgelöst von
 * fremden Vorgängen – Abzeichen vergeben. Rechte spielen keine Rolle: Jedes
 * freigeschaltete Konto sammelt seine eigenen Abzeichen, fremde sieht hier
 * niemand.
 *
 * **Vergeben wirft nie.** {@link AchievementService.evaluate} hängt als
 * Nachgedanke an einem Vorgang, der gerade gelungen ist: Ein Server wurde
 * angelegt, eine Sicherung ist durchgelaufen. Scheitert danach die Zählung oder
 * der Schreibzugriff, ist das kein Grund, dem Nutzer den Vorgang als
 * fehlgeschlagen zu melden – er hat stattgefunden. Der Fehler wird protokolliert
 * und verschluckt; beim nächsten gleichartigen Ereignis greift die Regel erneut.
 * Das ist die bewusste Umkehrung dessen, was für das Audit-Log gilt (dort darf
 * ein Fehler den Vorgang zu Fall bringen, siehe `AuditService.record`): Ein
 * Protokoll ist ein Nachweis, ein Abzeichen ist ein Spaß.
 *
 * **Die Titel-Wahl wirft dagegen sehr wohl.** Sie ist eine Eingabe des Nutzers
 * mit einer Antwort, und ein Titel, den er nicht hat, gehört abgelehnt
 * (`ACHIEVEMENT_NOT_UNLOCKED`).
 */

import {
  ACHIEVEMENTS,
  type AchievementDto,
  type AchievementId,
  type AchievementOverviewDto,
  type AchievementTitleDto,
  type ArcadeGameId,
  type AuditAction,
  levelForUnlocked,
  nextLevelAfter,
  titleForAchievement,
} from '@palantir/contracts';
import { AchievementError } from './errors.js';
import type { AchievementRepository } from './repository.js';
import {
  ACHIEVEMENT_RULES,
  type AchievementTrigger,
  rulesForArcadeScore,
  rulesForAuditAction,
} from './rules.js';

export interface AchievementService {
  /** Abzeichen, Stufe und Titel eines Kontos. */
  overviewFor(userId: string): Promise<AchievementOverviewDto>;
  /**
   * Wählt den getragenen Titel; `null` legt ihn ab.
   *
   * Liefert die aktualisierte Übersicht zurück, damit die Seite nach dem
   * Wechsel nicht erneut laden muss.
   */
  chooseTitle(userId: string, achievementId: AchievementId | null): Promise<AchievementOverviewDto>;
  /**
   * Prüft nach einem protokollierten Vorgang, ob dadurch Abzeichen fällig sind.
   *
   * Wirft nie – siehe Kopf dieser Datei. Liefert die **neu** freigeschalteten
   * Abzeichen, vor allem für Tests und Protokoll.
   */
  evaluate(
    userId: string,
    action: AuditAction,
    options?: { readonly entryId?: string | null; readonly at?: Date },
  ): Promise<AchievementId[]>;
  /** Dasselbe nach einem abgeschickten Arcade-Ergebnis. Wirft ebenfalls nie. */
  evaluateArcade(userId: string, gameId: ArcadeGameId): Promise<AchievementId[]>;
}

/** Was der Service zum Protokollieren verschluckter Fehler braucht. */
export interface AchievementLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface AchievementServiceOptions {
  readonly repository: AchievementRepository;
  /**
   * Ziel für verschluckte Fehler beim Vergeben.
   *
   * Ohne Angabe bleiben sie stumm – das ist der richtige Vorgabewert für Tests,
   * aber nicht für den Betrieb: `registerAchievements()` reicht dort den Logger
   * von Fastify durch.
   */
  readonly logger?: AchievementLogger;
}

/** Baut die Titel-Angabe eines Abzeichens; `null`, wenn es keinen mitbringt. */
function titleDtoFor(achievementId: AchievementId): AchievementTitleDto | null {
  const title = titleForAchievement(achievementId);

  return title === null ? null : { achievementId, title };
}

export function createAchievementService(options: AchievementServiceOptions): AchievementService {
  const { repository, logger } = options;

  /** Stellt die Übersicht aus dem freigeschalteten Stand zusammen. */
  async function buildOverview(userId: string): Promise<AchievementOverviewDto> {
    const [unlocked, selected] = await Promise.all([
      repository.unlocked(userId),
      repository.selectedTitle(userId),
    ]);

    /*
     * Zeitpunkte je Kennung. Gespeicherte Kennungen, die der Katalog nicht
     * (mehr) kennt, fallen beim Aufbau der Liste unten heraus: Die Liste läuft
     * über den Katalog, nicht über die Zeilen. Ein Abzeichen aus einer
     * künftigen Fassung, das nach einem Rückbau noch in der Tabelle steht,
     * lässt die Übersicht damit unberührt, statt sie zu sprengen.
     */
    const zeitpunkte = new Map(unlocked.map((row) => [row.achievementId, row.unlockedAt] as const));

    const entries: AchievementDto[] = ACHIEVEMENTS.map((definition) => {
      const unlockedAt = zeitpunkte.get(definition.id) ?? null;
      const verschlossenesGeheimnis = definition.secret === true && unlockedAt === null;

      return {
        id: definition.id,
        category: definition.category,
        // Ein verschlossenes Geheimnis verrät weder Namen noch Hinweis – die
        // Oberfläche zeigt dafür eine anonyme Kachel.
        name: verschlossenesGeheimnis ? '' : definition.name,
        description: verschlossenesGeheimnis
          ? ''
          : unlockedAt === null
            ? definition.hint
            : definition.description,
        title: verschlossenesGeheimnis ? null : definition.title,
        secret: verschlossenesGeheimnis,
        unlockedAt: unlockedAt === null ? null : unlockedAt.toISOString(),
      };
    });

    const unlockedCount = entries.filter((entry) => entry.unlockedAt !== null).length;

    const availableTitles = entries
      .filter((entry) => entry.unlockedAt !== null)
      .map((entry) => titleDtoFor(entry.id))
      .filter((titel): titel is AchievementTitleDto => titel !== null);

    /*
     * Ein getragener Titel wird nur gezeigt, wenn er auch freigeschaltet ist.
     * Das kann derzeit nicht auseinanderlaufen (Abzeichen werden nie entzogen),
     * die Übersicht hängt aber nicht an dieser Zusicherung: Sie liest, was
     * gilt, statt dem gespeicherten Wert zu glauben.
     */
    const selectedTitle =
      selected === null
        ? null
        : (availableTitles.find((titel) => titel.achievementId === selected) ?? null);

    return {
      entries,
      unlockedCount,
      totalCount: ACHIEVEMENTS.length,
      level: levelForUnlocked(unlockedCount),
      nextLevel: nextLevelAfter(unlockedCount),
      availableTitles,
      selectedTitle,
      permissions: { canChooseTitle: availableTitles.length > 0 },
    };
  }

  /**
   * Prüft die Regeln, die zu diesem Auslöser gehören, und trägt ein, was fällt.
   *
   * Bereits freigeschaltete Abzeichen werden vorher aussortiert: Sie könnten
   * nichts Neues ergeben, und jede übersprungene Regel spart eine Zählung über
   * dem Audit-Log.
   */
  async function evaluateTrigger(
    userId: string,
    kandidaten: readonly AchievementId[],
    trigger: AchievementTrigger,
  ): Promise<AchievementId[]> {
    if (kandidaten.length === 0) return [];

    const bereitsFrei = new Set(
      (await repository.unlocked(userId)).map((row) => row.achievementId),
    );
    const offen = kandidaten.filter((id) => !bereitsFrei.has(id));

    if (offen.length === 0) return [];

    const ergebnisse = await Promise.all(
      offen.map(async (id) => ({
        id,
        erfuellt: await ACHIEVEMENT_RULES[id].check({ userId, trigger, queries: repository }),
      })),
    );

    const faellig = ergebnisse.filter((eintrag) => eintrag.erfuellt).map((eintrag) => eintrag.id);

    // Kein Schreibaufruf, wenn nichts fällig ist – der Regelfall bei jedem
    // protokollierten Vorgang.
    return faellig.length === 0 ? [] : repository.award(userId, faellig);
  }

  /** Führt eine Vergabe aus und verschluckt dabei jeden Fehler. */
  async function evaluateQuiet(
    userId: string,
    kandidaten: readonly AchievementId[],
    trigger: AchievementTrigger,
  ): Promise<AchievementId[]> {
    try {
      return await evaluateTrigger(userId, kandidaten, trigger);
    } catch (error) {
      logger?.warn(
        { userId, trigger, err: error },
        'Abzeichen konnten nicht geprüft werden – der auslösende Vorgang bleibt davon unberührt.',
      );

      return [];
    }
  }

  return {
    overviewFor(userId) {
      return buildOverview(userId);
    },

    async chooseTitle(userId, achievementId) {
      if (achievementId !== null) {
        const freigeschaltet = await repository.unlocked(userId);

        if (!freigeschaltet.some((row) => row.achievementId === achievementId)) {
          throw new AchievementError('ACHIEVEMENT_NOT_UNLOCKED');
        }

        if (titleForAchievement(achievementId) === null) {
          throw new AchievementError('ACHIEVEMENT_WITHOUT_TITLE');
        }
      }

      await repository.setSelectedTitle(userId, achievementId);

      return buildOverview(userId);
    },

    evaluate(userId, action, opts) {
      return evaluateQuiet(userId, rulesForAuditAction(action), {
        kind: 'audit',
        action,
        entryId: opts?.entryId ?? null,
        at: opts?.at ?? new Date(),
      });
    },

    evaluateArcade(userId, gameId) {
      return evaluateQuiet(userId, rulesForArcadeScore(), { kind: 'arcade', gameId });
    },
  };
}
