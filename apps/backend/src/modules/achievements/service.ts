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
  ACHIEVEMENT_CATALOG,
  type AchievementDto,
  type AchievementId,
  type AchievementOverviewDto,
  type AchievementTitleDto,
  type ArcadeGameId,
  type AuditAction,
  type NotificationEventPayloads,
  isAchievementId,
  levelForUnlocked,
  nextLevelAfter,
  titleForAchievement,
} from '@palantir/contracts';
import { AchievementError } from './errors.js';
import type { AchievementRepository } from './repository.js';
import {
  ACHIEVEMENT_RULES,
  META_ACHIEVEMENTS,
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
  /**
   * Trägt nach, was ein Konto längst verdient hat (Betreiber-Wunsch
   * 21.09.2026).
   *
   * Geprüft werden alle noch offenen Abzeichen gegen den **gespeicherten
   * Bestand**, ohne auslösendes Ereignis. Wer fünf Server angelegt hat, bevor
   * es Abzeichen gab, bekommt „Flottenkommando" – er muss dafür keinen
   * sechsten anlegen.
   *
   * Wirft nie, wie die anderen beiden Wege auch.
   */
  backfillFor(userId: string): Promise<AchievementId[]>;
  /**
   * Nachvergabe für alle Konten – der einmalige Lauf beim Start und das
   * Kommando `erfolge:nachtragen`.
   *
   * Arbeitet Konto für Konto ab, nicht alle nebenläufig: Der Lauf hat es nicht
   * eilig, und ein Schwall paralleler Abfragen beim Hochfahren wäre genau zur
   * falschen Zeit. Liefert je Konto die neu vergebenen Abzeichen.
   */
  backfillAll(): Promise<Map<string, AchievementId[]>>;
}

/**
 * Senke für die Glückwunsch-Meldung (B6).
 *
 * Bewusst eine eigene, schmale Schnittstelle statt der ganzen
 * `NotificationService`: Das Erfolgs-Modul soll von den Benachrichtigungen
 * genauso wenig wissen wie das Audit-Log von den Abzeichen. Ohne Senke wird
 * schlicht nichts gemeldet – die Abzeichen entstehen trotzdem.
 */
export interface AchievementNotificationSink {
  emit(
    event: 'achievement.unlocked',
    payload: NotificationEventPayloads['achievement.unlocked'],
  ): void;
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
  /**
   * Ziel der Glückwunsch-Meldung; ohne Angabe wird nichts gemeldet.
   *
   * Fehler der Senke werden verschluckt – eine Meldung, die nicht hinausgeht,
   * ist kein Grund, das Abzeichen wieder einzukassieren.
   */
  readonly notifications?: AchievementNotificationSink;
}

/**
 * Alle Abzeichen als Kandidatenliste – die Grundmenge der Nachvergabe.
 *
 * Einmal gebaut, nicht je Konto: Bei einem Lauf über alle Konten wäre das
 * sonst eine Liste je Konto, für immer denselben Inhalt.
 */
const ALLE_ABZEICHEN: readonly AchievementId[] = ACHIEVEMENTS.map((eintrag) => eintrag.id);

/**
 * Obergrenze der Vergabe-Durchgänge je Auslöser.
 *
 * Mehr als einer wird nur wegen der Abzeichen gebraucht, die den eigenen
 * Bestand zählen; drei decken auch deren Staffel ab („zehn", „zwanzig",
 * „dreißig" nacheinander). Die Grenze ist eine Sicherung, nicht die erwartete
 * Zahl der Runden – im Regelfall endet die Schleife nach dem ersten Durchgang.
 */
const MAX_DURCHGAENGE = 3;

/** Baut die Titel-Angabe eines Abzeichens; `null`, wenn es keinen mitbringt. */
function titleDtoFor(achievementId: AchievementId): AchievementTitleDto | null {
  const title = titleForAchievement(achievementId);

  return title === null ? null : { achievementId, title };
}

export function createAchievementService(options: AchievementServiceOptions): AchievementService {
  const { repository, logger, notifications } = options;

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
    trigger: AchievementTrigger | null,
  ): Promise<AchievementId[]> {
    if (kandidaten.length === 0) return [];

    const bereitsFrei = new Set(
      (await repository.unlocked(userId)).map((row) => row.achievementId),
    );
    const offen = kandidaten.filter((id) => !bereitsFrei.has(id));

    if (offen.length === 0) return [];

    /*
     * Mehrere Durchgänge, weil manche Abzeichen den eigenen Bestand zählen
     * („Zehn Abzeichen", Betreiber 21.09.2026). Wer mit einem Schlag zehn
     * bekommt, soll das zehnte im selben Vorgang gutgeschrieben bekommen und
     * nicht erst beim nächsten Serverstart.
     *
     * Ein weiterer Durchgang läuft nur, wenn der vorige etwas vergeben hat,
     * und sieht nur die dann noch offenen Regeln an. Die Schleife endet damit
     * von allein; `MAX_DURCHGAENGE` ist die Sicherung gegen eine künftige
     * Regel, die sich selbst erfüllt, ohne je vergeben zu werden.
     */
    const vergeben: AchievementId[] = [];
    let uebrig = offen;

    for (let durchgang = 0; durchgang < MAX_DURCHGAENGE && uebrig.length > 0; durchgang += 1) {
      const ergebnisse = await Promise.all(
        uebrig.map(async (id) => ({
          id,
          erfuellt: await ACHIEVEMENT_RULES[id].check({ userId, trigger, queries: repository }),
        })),
      );

      const faellig = ergebnisse.filter((eintrag) => eintrag.erfuellt).map((eintrag) => eintrag.id);

      // Kein Schreibaufruf, wenn nichts fällig ist – der Regelfall bei jedem
      // protokollierten Vorgang, und zugleich das Ende der Schleife.
      if (faellig.length === 0) break;

      vergeben.push(...(await repository.award(userId, faellig)));

      for (const id of faellig) bereitsFrei.add(id);
      uebrig = uebrig.filter((id) => !faellig.includes(id));

      /*
       * Die Bestands-Abzeichen jetzt dazunehmen: Ihr Auslöser ist genau das,
       * was dieser Durchgang eben verändert hat. Sie stehen deshalb in keiner
       * Ereignis-Auswahl und kämen sonst gar nicht vor.
       */
      for (const id of META_ACHIEVEMENTS) {
        if (!bereitsFrei.has(id) && !uebrig.includes(id)) uebrig.push(id);
      }
    }

    return vergeben;
  }

  /**
   * Meldet frisch freigeschaltete Abzeichen – **eine** Meldung, auch wenn es
   * mehrere sind.
   *
   * Bei der Nachvergabe kommen leicht acht auf einmal zusammen; acht Meldungen
   * für einen Vorgang wären keine Freude, sondern eine Flut. Der Zählstand
   * wird dafür frisch gelesen, statt ihn hochzurechnen: Nur so stimmt
   * „x von y" mit dem überein, was die Seite gleich zeigt.
   */
  async function melden(userId: string, neu: readonly AchievementId[]): Promise<void> {
    if (notifications === undefined || neu.length === 0) return;

    const uebersicht = await buildOverview(userId);
    const vorher = levelForUnlocked(uebersicht.unlockedCount - neu.length);

    notifications.emit('achievement.unlocked', {
      at: new Date().toISOString(),
      // Das Konto hat sich das Abzeichen selbst verdient – es ist Auslöser und
      // Empfänger in einem.
      actorId: userId,
      userId,
      achievementIds: [...neu],
      achievementNames: neu.map((id) => (isAchievementId(id) ? ACHIEVEMENT_CATALOG[id].name : id)),
      levelLabel: uebersicht.level.label,
      levelUp: uebersicht.level.level > vorher.level,
      unlockedCount: uebersicht.unlockedCount,
      totalCount: uebersicht.totalCount,
    });
  }

  /** Führt eine Vergabe aus und verschluckt dabei jeden Fehler. */
  async function evaluateQuiet(
    userId: string,
    kandidaten: readonly AchievementId[],
    trigger: AchievementTrigger | null,
  ): Promise<AchievementId[]> {
    try {
      const neu = await evaluateTrigger(userId, kandidaten, trigger);

      await melden(userId, neu);

      return neu;
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

    backfillFor(userId) {
      // Alle Abzeichen als Kandidaten: Ohne auslösendes Ereignis gibt es
      // nichts vorzusortieren. `evaluateTrigger` wirft die bereits
      // freigeschalteten heraus, bevor es rechnet.
      return evaluateQuiet(userId, ALLE_ABZEICHEN, null);
    },

    async backfillAll() {
      const ergebnis = new Map<string, AchievementId[]>();

      let konten: string[];

      try {
        konten = await repository.allUserIds();
      } catch (error) {
        logger?.warn(
          { err: error },
          'Nachvergabe der Abzeichen konnte nicht beginnen – die Kontenliste war nicht lesbar.',
        );

        return ergebnis;
      }

      /*
       * Nacheinander, nicht nebenläufig: Der Lauf hat es nicht eilig, und ein
       * Schwall paralleler Abfragen beim Hochfahren wäre genau zur falschen
       * Zeit. Ein Konto, bei dem etwas schiefgeht, hält die übrigen nicht auf –
       * `evaluateQuiet` verschluckt seine Fehler.
       */
      for (const userId of konten) {
        const neu = await evaluateQuiet(userId, ALLE_ABZEICHEN, null);

        if (neu.length > 0) ergebnis.set(userId, neu);
      }

      return ergebnis;
    },
  };
}
