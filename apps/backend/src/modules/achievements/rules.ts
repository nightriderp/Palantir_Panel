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
  ARCADE_GAMES,
  type AchievementId,
  type ArcadeGameId,
  type AuditAction,
} from '@palantir/contracts';
import type { AchievementQueries } from './repository.js';

/** Die Spiele der Kategorie „Arcade" – Grundlage für `alleskoenner`. */
export const ARCADE_ARCADE_GAME_IDS: readonly ArcadeGameId[] = ARCADE_GAMES.filter(
  (game) => game.category === 'arcade',
).map((game) => game.id);

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

/**
 * Was eine Regel zur Prüfung in die Hand bekommt.
 *
 * **`trigger: null` ist die Nachvergabe** (Betreiber-Wunsch 21.09.2026): Dann
 * gibt es kein auslösendes Ereignis, sondern nur den gespeicherten Bestand –
 * die Regel muss ihre Bedingung aus dem beantworten, was ohnehin in der
 * Datenbank steht.
 *
 * Bewusst dieselbe Funktion für beide Fälle statt einer zweiten daneben: Zwei
 * Bedingungen je Abzeichen könnten auseinanderlaufen, und dann bekäme ein
 * bestehendes Konto ein Abzeichen, das ein neues nie bekommt (oder umgekehrt).
 */
export interface RuleContext {
  readonly userId: string;
  readonly trigger: AchievementTrigger | null;
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
  /**
   * Hängt am **eigenen Abzeichen-Bestand** statt an einem Vorgang.
   *
   * Solche Regeln stehen in keiner Auswahl zu einem Ereignis: Ihr Auslöser ist
   * die Vergabe selbst. Der Service zieht sie nach, sobald ein Durchgang etwas
   * freigeschaltet hat (siehe `service.ts`) – und die Nachvergabe prüft sie
   * ohnehin, weil sie alle Abzeichen als Kandidaten nimmt.
   *
   * Ohne diese Kennzeichnung müssten sie `actions: 'jede'` tragen und liefen
   * dann bei jedem einzelnen Protokolleintrag mit, nur um fast immer „noch
   * nicht" zu sagen.
   */
  readonly meta?: true;
  /** Ist die Bedingung erfüllt? */
  check(ctx: RuleContext): Promise<boolean>;
}

/**
 * Aktionen, die nicht als „Handgriff" zählen (`vielbeschaeftigt`).
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

/** Beginn und Ende des Nacht-Fensters in Ortszeit (Stunde, Ende ausschließlich). */
const NACHTSCHICHT_VON = 3;
const NACHTSCHICHT_BIS = 5;

/**
 * Aktionen, bei denen `nachtschicht` geprüft wird.
 *
 * Bewusst nicht `'jede'`: Die Regel liefe dann bei jedem einzelnen
 * Protokolleintrag mit, ohne dass das Ergebnis ein anderes wäre. Wer nachts im
 * Panel ist, meldet sich an.
 */
const NACHTSCHICHT_AKTIONEN: readonly AuditAction[] = [
  'auth.loginSucceeded',
  'server.created',
  'backup.created',
];

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

/**
 * Eine Regel, die schon beim ersten Vorkommen ihrer Aktion erfüllt ist.
 *
 * Mit Auslöser braucht sie keine Abfrage – das Ereignis **ist** das erste Mal.
 * Ohne Auslöser (Nachvergabe) fragt sie, ob es im Protokoll schon einmal
 * vorkam.
 */
function beimErstenMal(...actions: readonly AuditAction[]): AchievementRule {
  return {
    actions,
    async check({ userId, trigger, queries }) {
      if (trigger !== null) return true;

      return (await queries.countAuditEntries(userId, { include: actions }, null)) >= 1;
    },
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
        trigger?.kind === 'audit' ? trigger.entryId : null,
      );

      // Ohne Auslöser (Nachvergabe) gibt es nichts hinzuzurechnen – dann ist
      // der gezählte Bestand bereits die vollständige Antwort.
      return vorher + (trigger === null ? 0 : 1) >= schwelle;
    },
  };
}

/** Eine Regel, die nach jedem Arcade-Ergebnis prüft und nie am Audit-Log hängt. */
function nachJedemSpiel(check: AchievementRule['check']): AchievementRule {
  return { actions: [], onArcadeScore: true, check };
}

/**
 * Eine Stufe der Platzierungs-Leiter: „Platz `hoechstens` oder besser".
 *
 * Gezählt wird der **beste** Platz über alle Bestenlisten, nicht der im gerade
 * gespielten Spiel. Wer irgendwo vorne steht, bekommt damit alle Stufen
 * darunter gleich mit – gewollt, das ist der Witz an der Leiter (Betreiber,
 * 21.09.2026). Eine Stufe je Spiel wäre die ernsthafte Variante und hätte den
 * Katalog mit 35 Einträgen geflutet.
 */
function abPlatz(hoechstens: number): AchievementRule {
  return nachJedemSpiel(async ({ userId, queries }) => {
    const platz = await queries.bestArcadeRank(userId);

    return platz !== null && platz <= hoechstens;
  });
}

/** Eine Stufe der Runden-Leiter. Kostet nichts und darf deshalb gestaffelt sein. */
function abRunden(schwelle: number): AchievementRule {
  return nachJedemSpiel(
    async ({ userId, queries }) => (await queries.arcadeRoundCount(userId)) >= schwelle,
  );
}

/**
 * Eine Stufe der Sammler-Leiter: „`schwelle` Abzeichen freigeschaltet".
 *
 * Zählt den eigenen Bestand und hängt deshalb an **jeder** Aktion – anders
 * käme sie nie an, denn ihr Auslöser ist die Vergabe selbst. Dass sie im
 * selben Durchgang greift, in dem die gezählten Abzeichen entstehen, besorgt
 * der Nachschlag in `service.ts`.
 */
function abAbzeichen(schwelle: number): AchievementRule {
  return {
    actions: [],
    meta: true,
    check: async ({ userId, queries }) => (await queries.unlocked(userId)).length >= schwelle,
  };
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
  eingeworfen: abRunden(1),
  /*
   * Seit dem Neubau der Spielhalle (26.09.2026) zählen nur die Spiele der
   * Kategorie „Arcade". Mit allen 26 Spielen wäre das Abzeichen unerreichbar:
   * Siege in Codenames oder Black Stories gibt es nur online, und nur Siege
   * landen dort in der Bestenliste.
   */
  alleskoenner: nachJedemSpiel(
    async ({ userId, queries }) =>
      (await queries.arcadeDistinctGames(userId, ARCADE_ARCADE_GAME_IDS)) >=
      ARCADE_ARCADE_GAME_IDS.length,
  ),

  // --- Platzierungen --------------------------------------------------------
  platz50: abPlatz(50),
  platz20: abPlatz(20),
  platz10: abPlatz(10),
  platz5: abPlatz(5),
  platz3: abPlatz(3),
  platz2: abPlatz(2),
  spielhallenlegende: abPlatz(1),

  // --- Ausdauer -------------------------------------------------------------
  runden10: abRunden(10),
  hartnaeckig: abRunden(25),
  runden50: abRunden(50),
  runden100: abRunden(100),
  runden250: abRunden(250),
  runden500: abRunden(500),
  runden1000: abRunden(1000),
  anmeldung10: abDerAnzahl(10, 'auth.loginSucceeded'),
  anmeldung50: abDerAnzahl(50, 'auth.loginSucceeded'),
  anmeldung100: abDerAnzahl(100, 'auth.loginSucceeded'),
  sammler10: abAbzeichen(10),
  sammler20: abAbzeichen(20),
  sammler30: abAbzeichen(30),

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
    actions: NACHTSCHICHT_AKTIONEN,
    async check({ userId, trigger, queries }) {
      if (trigger === null) {
        // Nachvergabe: Liegt im Protokoll schon ein Eintrag im Fenster?
        return queries.hasAuditEntryAtHour(
          userId,
          NACHTSCHICHT_AKTIONEN,
          NACHTSCHICHT_VON,
          NACHTSCHICHT_BIS,
          INSTANZ_ZEITZONE,
        );
      }

      if (trigger.kind !== 'audit') return false;

      const stunde = stundeInInstanzZeit(trigger.at);

      return stunde >= NACHTSCHICHT_VON && stunde < NACHTSCHICHT_BIS;
    },
  },

  vielbeschaeftigt: {
    /*
     * Das einzige Abzeichen mit `'jede'`: Es zählt Handgriffe, nicht bestimmte
     * Vorgänge. Deshalb auch kein `abDerAnzahl` – dessen Positivliste ist
     * zugleich die Liste der auslösenden Aktionen, hier braucht es eine
     * Negativliste.
     */
    actions: 'jede',
    exceptActions: KEINE_HANDGRIFFE,
    async check({ userId, trigger, queries }) {
      if (trigger !== null && trigger.kind !== 'audit') return false;

      const vorher = await queries.countAuditEntries(
        userId,
        { exclude: KEINE_HANDGRIFFE },
        trigger === null ? null : trigger.entryId,
      );

      return vorher + (trigger === null ? 0 : 1) >= 50;
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

/**
 * Abzeichen, die am eigenen Bestand hängen – nachzuziehen, sobald etwas
 * vergeben wurde.
 */
export const META_ACHIEVEMENTS: readonly AchievementId[] = REGEL_PAARE.filter(
  ([, regel]) => regel.meta === true,
).map(([id]) => id);
