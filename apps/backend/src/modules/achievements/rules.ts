/**
 * Auslöser der Abzeichen (Betreiber-Wunsch 21.09.2026).
 *
 * Der Katalog in `@palantir/contracts` sagt, **was** ein Abzeichen ist – Name,
 * Beschreibung, Titel. Diese Tabelle sagt, **wann** es entsteht. Getrennt, weil
 * das Frontend das eine braucht und das andere nie: Eine Bedingung, die das
 * Audit-Log zählt, lässt sich im Browser weder prüfen noch sinnvoll anzeigen.
 *
 * `Record<AchievementId, AchievementRule>` ist Absicht: Ein neues Abzeichen im
 * Katalog lässt diese Datei nicht übersetzen, solange sein Auslöser fehlt. Ein
 * Abzeichen, das niemand bekommen kann, fällt damit beim Bauen auf und nicht
 * erst dem, der monatelang vergeblich darauf hinarbeitet.
 *
 * **Keine Regel zählt eine teure Wiederholung hoch.** Abzeichen für Anlegen,
 * Klonen und Löschen gibt es genau einmal; die einzigen Schwellen liegen bei
 * Vorgängen, die nichts kosten (Einstellungen ändern, Runden spielen,
 * Protokolleinträge hinterlassen) oder ohnehin erwünscht sind (Sicherungen).
 * Wer im Panel Punkte farmen wollte, hätte davon nichts – und der Homeserver
 * nichts zu tragen.
 */

import {
  ARCADE_GAME_IDS,
  type AchievementId,
  type ArcadeGameId,
  type AuditAction,
} from '@palantir/contracts';
import type { AchievementQueries } from './repository.js';

/**
 * Das Ereignis, das eine Prüfung ausgelöst hat.
 *
 * Genau eine der beiden Formen – ein Abzeichen hängt entweder am Audit-Log oder
 * an der Spielhalle, nie an beidem.
 */
export type AchievementTrigger =
  | {
      readonly kind: 'audit';
      readonly action: AuditAction;
      /**
       * Id des auslösenden Eintrags; `null`, wenn sie nicht bekannt ist.
       *
       * Die Zählungen schließen ihn aus und rechnen ihn selbst hinzu – warum,
       * steht bei `AchievementQueries.countAuditEntries`.
       */
      readonly entryId: string | null;
      /** Zeitpunkt des Eintrags – für zeitabhängige Abzeichen. */
      readonly at: Date;
    }
  | {
      readonly kind: 'arcade';
      /** Spiel, in dem gerade ein Ergebnis abgeschickt wurde. */
      readonly gameId: ArcadeGameId;
    };

/** Was eine Regel zur Prüfung in die Hand bekommt. */
export interface RuleContext {
  readonly userId: string;
  readonly trigger: AchievementTrigger;
  readonly queries: AchievementQueries;
}

/** Bedingung und Auslöser eines Abzeichens. */
export interface AchievementRule {
  /**
   * Audit-Aktionen, bei denen die Regel geprüft wird.
   *
   * `'jede'` steht für „bei jeder protokollierten Aktion" und ist genau einem
   * Abzeichen vorbehalten, das Handgriffe zählt statt bestimmter Vorgänge.
   * Eine leere Liste bedeutet „hängt nicht am Audit-Log" – dann ist
   * {@link AchievementRule.onArcadeScore} gesetzt. Eine Regel ohne beides
   * könnte nie auslösen; das prüft `rules.test.ts`.
   */
  readonly actions: readonly AuditAction[] | 'jede';
  /**
   * Nur bei `actions: 'jede'`: Aktionen, die trotzdem nicht auslösen.
   *
   * Die Ausnahmen stehen hier und nicht in der Bedingung der Regel, damit
   * `rulesForAuditAction` sie schon bei der Auswahl beachtet. Sonst liefe bei
   * jeder Fehlanmeldung erst eine Abfrage an, um dann festzustellen, dass sie
   * nicht zählt – und das ist genau die Sorte Ereignis, die sich beliebig oft
   * erzeugen lässt.
   */
  readonly exceptActions?: readonly AuditAction[];
  /** Zusätzlich nach jedem abgeschickten Arcade-Ergebnis prüfen. */
  readonly onArcadeScore?: true;
  /** Ist die Bedingung erfüllt? */
  check(ctx: RuleContext): Promise<boolean>;
}

/**
 * Aktionen, die nicht als „Handgriff" zählen (`hausmeisterei`).
 *
 * `access.denied` hält einen **verhinderten** Vorgang fest, `auth.loginFailed`
 * einen misslungenen – beide entstehen, ohne dass jemand etwas bewirkt hat, und
 * beide ließen sich beliebig oft auslösen. Sie stünden einem Abzeichen für
 * geleistete Arbeit schlecht zu Gesicht und wären zugleich die einzige Stelle
 * im Katalog, an der sich etwas hochzählen ließe.
 */
export const KEINE_HANDGRIFFE: readonly AuditAction[] = ['access.denied', 'auth.loginFailed'];

/**
 * Zeitzone der Instanz für zeitabhängige Abzeichen.
 *
 * Fest eingetragen und nicht aus der Umgebung gelesen: Die Instanz steht in
 * Deutschland, und der Witz an `nachtschicht` ist die **örtliche** Uhrzeit.
 * Liefe die Prüfung in der Zeitzone des Prozesses, hinge das Abzeichen daran,
 * wie die VPS gerade eingestellt ist.
 */
const INSTANZ_ZEITZONE = 'Europe/Berlin';

const STUNDE_FORMAT = new Intl.DateTimeFormat('de-DE', {
  timeZone: INSTANZ_ZEITZONE,
  hour: 'numeric',
  hour12: false,
});

/** Stunde (0–23) eines Zeitpunkts in der Zeitzone der Instanz. */
export function stundeInInstanzZeit(at: Date): number {
  /*
   * `de-DE` formatiert Mitternacht als „00" – `parseInt` macht daraus 0, und
   * die Spanne 3 bis 5 liegt ohnehin weit davon entfernt. Die Absicherung
   * gegen `NaN` bleibt trotzdem: Eine ungültige Uhrzeit soll kein Abzeichen
   * auslösen, sondern keines.
   */
  const stunde = Number.parseInt(STUNDE_FORMAT.format(at), 10);

  return Number.isNaN(stunde) ? -1 : stunde;
}

/** Eine Regel, die schon beim ersten Vorkommen ihrer Aktion erfüllt ist. */
function beimErstenMal(...actions: readonly AuditAction[]): AchievementRule {
  return {
    actions,
    check: () => Promise.resolve(true),
  };
}

/**
 * Eine Regel, die `schwelle` Vorkommen ihrer Aktionen verlangt.
 *
 * Der auslösende Eintrag wird aus der Zählung ausgeschlossen und hier wieder
 * hinzugerechnet – siehe `AchievementQueries.countAuditEntries`.
 */
function abDerAnzahl(schwelle: number, ...actions: readonly AuditAction[]): AchievementRule {
  return {
    actions,
    async check({ userId, trigger, queries }) {
      const vorher = await queries.countAuditEntries(
        userId,
        { include: actions },
        trigger.kind === 'audit' ? trigger.entryId : null,
      );

      return vorher + 1 >= schwelle;
    },
  };
}

/** Eine Regel, die nach jedem Arcade-Ergebnis prüft und nie am Audit-Log hängt. */
function nachJedemSpiel(check: AchievementRule['check']): AchievementRule {
  return { actions: [], onArcadeScore: true, check };
}

/**
 * Regeln je Abzeichen – vollständig, der Typ erzwingt es.
 */
export const ACHIEVEMENT_RULES: Record<AchievementId, AchievementRule> = {
  // --- Server ---------------------------------------------------------------
  grundsteinleger: beimErstenMal('server.created'),
  flottenkommando: abDerAnzahl(5, 'server.created'),
  doppelgaenger: beimErstenMal('server.cloned'),
  gastgeber: beimErstenMal('server.memberAdded'),
  schraubergeist: abDerAnzahl(25, 'server.settingsChanged'),
  aufraeumer: beimErstenMal('server.deleted'),

  // --- Sicherungen ----------------------------------------------------------
  guertelUndHosentraeger: beimErstenMal('backup.created'),
  vorsorglich: abDerAnzahl(10, 'backup.created'),
  esLiefDochGestern: beimErstenMal('backup.restored'),

  // --- Spielhalle -----------------------------------------------------------
  eingeworfen: nachJedemSpiel(() => Promise.resolve(true)),
  alleskoenner: nachJedemSpiel(
    async ({ userId, queries }) =>
      (await queries.arcadeDistinctGames(userId)) >= ARCADE_GAME_IDS.length,
  ),
  hartnaeckig: nachJedemSpiel(
    async ({ userId, queries }) => (await queries.arcadeRoundCount(userId)) >= 25,
  ),
  spielhallenlegende: nachJedemSpiel(async ({ userId, trigger, queries }) =>
    trigger.kind === 'arcade' ? queries.isTopOfLeaderboard(userId, trigger.gameId) : false,
  ),

  // --- Konto ----------------------------------------------------------------
  ersteStunde: {
    /*
     * Hängt an keinem bestimmten Vorgang, sondern am Konto selbst – geprüft
     * beim Anmelden und beim Registrieren. Das Anmelden ist dabei der Weg, über
     * den bestehende Konten das Abzeichen nachträglich bekommen: Sie haben sich
     * längst registriert, melden sich aber weiter an.
     */
    actions: ['auth.loginSucceeded', 'user.registered'],
    check: async ({ userId, queries }) => (await queries.registrationRank(userId)) <= 5,
  },
  doppeltHaeltBesser: beimErstenMal('auth.twoFactorEnabled'),
  zutrittVerweigert: beimErstenMal('access.denied'),
  nachtschicht: {
    /*
     * Es geht um die Uhrzeit, nicht um die Tat – aber bewusst nicht um `'jede'`
     * Aktion: Die Regel liefe dann bei jedem einzelnen Protokolleintrag mit,
     * ohne dass das Ergebnis ein anderes wäre. Wer nachts im Panel ist, meldet
     * sich an.
     */
    actions: ['auth.loginSucceeded', 'server.created', 'backup.created'],
    check: ({ trigger }) => {
      if (trigger.kind !== 'audit') return Promise.resolve(false);

      const stunde = stundeInInstanzZeit(trigger.at);

      return Promise.resolve(stunde >= 3 && stunde < 5);
    },
  },

  // --- Betrieb --------------------------------------------------------------
  tuersteher: beimErstenMal('user.approved'),
  schriftsetzer: beimErstenMal('font.uploaded'),
  hausmeisterei: {
    /*
     * Das einzige Abzeichen mit `'jede'`: Es zählt Handgriffe, nicht bestimmte
     * Vorgänge. Deshalb auch kein `abDerAnzahl` – dessen Positivliste ist
     * zugleich die Liste der auslösenden Aktionen, hier braucht es eine
     * Negativliste.
     */
    actions: 'jede',
    exceptActions: KEINE_HANDGRIFFE,
    async check({ userId, trigger, queries }) {
      if (trigger.kind !== 'audit') return false;

      const vorher = await queries.countAuditEntries(
        userId,
        { exclude: KEINE_HANDGRIFFE },
        trigger.entryId,
      );

      return vorher + 1 >= 50;
    },
  },
};

/** Alle Regeln als Paare – eine Stelle für die beiden Auswahlfunktionen. */
const REGEL_PAARE = Object.entries(ACHIEVEMENT_RULES) as [AchievementId, AchievementRule][];

/**
 * Abzeichen, deren Regel bei dieser Audit-Aktion geprüft werden muss.
 *
 * Eine leere Liste ist ein gültiges Ergebnis und der billigste Fall: Der
 * Service rührt dann die Datenbank gar nicht erst an.
 */
export function rulesForAuditAction(action: AuditAction): AchievementId[] {
  return REGEL_PAARE.filter(([, regel]) =>
    regel.actions === 'jede'
      ? !(regel.exceptActions ?? []).includes(action)
      : regel.actions.includes(action),
  ).map(([id]) => id);
}

/** Abzeichen, deren Regel nach einem Arcade-Ergebnis geprüft werden muss. */
export function rulesForArcadeScore(): AchievementId[] {
  return REGEL_PAARE.filter(([, regel]) => regel.onArcadeScore === true).map(([id]) => id);
}
