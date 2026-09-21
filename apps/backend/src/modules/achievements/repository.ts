/**
 * Datenzugriffe des Erfolgs-Moduls (Betreiber-Wunsch 21.09.2026).
 *
 * Enthält ausschließlich Datenzugriff; welche Bedingung zu welchem Abzeichen
 * gehört, steht in `rules.ts`, die Zusammenstellung der Übersicht in
 * `service.ts`. Die Schnittstelle {@link AchievementRepository} macht beide
 * ohne Datenbank testbar (Entwicklungsregeln §4).
 *
 * **Alle Zählungen laufen über den Pool, nie über eine fremde Transaktion.**
 * Ein Abzeichen entsteht als Nachgedanke zu einem Vorgang, der gerade im Gang
 * ist (ein Server wird angelegt, eine Sicherung läuft). Liefe die Zählung in
 * dessen Transaktion mit, riss ein Fehler dort den ganzen Vorgang mit – ein
 * Serverstart, der an einem Abzeichen scheitert, wäre die Umkehrung dessen,
 * was hier wichtig ist. Die Folge dieser Trennung behandelt
 * {@link AchievementQueries.countAuditEntries}.
 */

import { type AchievementId, type ArcadeGameId, type AuditAction } from '@palantir/contracts';
import {
  and,
  asc,
  countDistinct,
  count,
  eq,
  gt,
  inArray,
  lt,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { userAchievements } from '../../db/schema/achievements.js';
import { arcadeScores } from '../../db/schema/arcade.js';
import { auditLog } from '../../db/schema/admin.js';
import { users } from '../../db/schema/users.js';

/** Ein freigeschaltetes Abzeichen, wie es in der Datenbank steht. */
export interface UnlockedAchievement {
  readonly achievementId: AchievementId;
  readonly unlockedAt: Date;
}

/**
 * Filter für {@link AchievementQueries.countAuditEntries}.
 *
 * Entweder eine Positivliste („nur diese Aktionen") oder eine Negativliste
 * („alles außer diesen"). Beides zugleich gibt es nicht – eine Zählung, die
 * ein- und ausschließt, wäre beim Lesen einer Regel nicht mehr zu überblicken.
 */
export type AuditCountFilter =
  { readonly include: readonly AuditAction[] } | { readonly exclude: readonly AuditAction[] };

/** Datenzugriffe, die die Regeln und der Service brauchen. */
export interface AchievementQueries {
  /** Alle freigeschalteten Abzeichen eines Kontos, älteste zuerst. */
  unlocked(userId: string): Promise<UnlockedAchievement[]>;
  /**
   * Trägt Abzeichen ein und liefert die, die dadurch **neu** entstanden sind.
   *
   * Bereits vorhandene werden übergangen (`ON CONFLICT DO NOTHING`), statt zu
   * scheitern: Zwei Ereignisse desselben Kontos können dieselbe Bedingung
   * gleichzeitig erfüllen, und dann soll der zweite Schreibversuch schlicht
   * nichts tun. Der Rückgabewert ist genau das, was die Oberfläche als
   * „frisch freigeschaltet" melden darf.
   */
  award(userId: string, achievementIds: readonly AchievementId[]): Promise<AchievementId[]>;
  /**
   * Zählt die Audit-Einträge eines Kontos.
   *
   * `exceptEntryId` ist der Eintrag, der die Prüfung gerade ausgelöst hat – er
   * wird ausgeschlossen, und die Regel zählt ihn selbst hinzu. Das klingt
   * umständlich, löst aber genau das Problem dieser Schicht: Der auslösende
   * Eintrag kann bereits festgeschrieben **oder** noch in einer offenen
   * Transaktion sein, und diese Abfrage läuft über den Pool. Ohne den
   * Ausschluss zählte er im ersten Fall mit und im zweiten nicht – die zehnte
   * Sicherung löste das Abzeichen mal aus und mal erst bei der elften.
   *
   * **Was diese Zählung nicht sieht:** archivierte Einträge (älter als
   * {@link AUDIT_RETENTION_MONTHS}). Ein bereits freigeschaltetes Abzeichen
   * verliert dadurch niemand – es steht in `user_achievements` und wird nie
   * entzogen. Nur ein Konto, das die Schwelle ausschließlich mit inzwischen
   * archivierten Einträgen erreicht hätte, bekommt sie nicht mehr gutgeschrieben.
   * Bei Schwellen von höchstens 50 und 24 Monaten Aufbewahrung ist das ein
   * theoretischer Fall.
   */
  countAuditEntries(
    userId: string,
    filter: AuditCountFilter,
    exceptEntryId: string | null,
  ): Promise<number>;
  /**
   * Platz eines Kontos in der Reihenfolge der Registrierungen (1-basiert).
   *
   * Gezählt über `users.createdAt` und nicht über das Audit-Log: Die
   * Registrierungen der ersten Konten liegen am weitesten zurück und sind damit
   * als Erste aus dem aktiven Log verschwunden – ausgerechnet die Einträge, auf
   * die es hier ankäme.
   */
  registrationRank(userId: string): Promise<number>;
  /** Anzahl aller abgesendeten Arcade-Versuche eines Kontos. */
  arcadeRoundCount(userId: string): Promise<number>;
  /** Anzahl der verschiedenen Minispiele, die ein Konto gespielt hat. */
  arcadeDistinctGames(userId: string): Promise<number>;
  /**
   * Steht das Konto in diesem Spiel auf Platz eins?
   *
   * Dieselbe Grundmenge wie die Bestenliste selbst: gesperrte Konten zählen
   * nicht mit (`backend-community-16`). „Platz eins" heißt hier, dass es kein
   * Konto mit einem **echt größeren** Bestwert gibt – bei Gleichstand teilen
   * sich beide den Platz und beide bekommen das Abzeichen.
   */
  isTopOfLeaderboard(userId: string, gameId: ArcadeGameId): Promise<boolean>;
  /**
   * Steht das Konto in **irgendeiner** Bestenliste auf Platz eins?
   *
   * Nur für die Nachvergabe: Dort gibt es kein auslösendes Spiel, und wer
   * irgendwo oben steht, hat das Abzeichen verdient. Im laufenden Betrieb
   * fragt `isTopOfLeaderboard` gezielt nach dem gerade gespielten Spiel.
   */
  isTopOfAnyLeaderboard(userId: string): Promise<boolean>;
  /**
   * Gibt es einen Protokolleintrag des Kontos in einem Stundenfenster?
   *
   * `fromHour` einschließlich, `toHour` ausschließlich, gerechnet in
   * `timeZone`. Die Umrechnung übernimmt Postgres (`AT TIME ZONE`) und nicht
   * der Anwendungscode: Sonst müssten alle Einträge eines Kontos in den
   * Arbeitsspeicher, nur um eine Stunde daraus abzulesen.
   *
   * Nur für die Nachvergabe – im laufenden Betrieb steht die Uhrzeit des
   * auslösenden Eintrags bereits im Auslöser.
   */
  hasAuditEntryAtHour(
    userId: string,
    actions: readonly AuditAction[],
    fromHour: number,
    toHour: number,
    timeZone: string,
  ): Promise<boolean>;
  /** Konto-Ids aller Konten – Grundmenge der Nachvergabe. */
  allUserIds(): Promise<string[]>;
  /** Getragener Titel eines Kontos; `null`, wenn es keinen trägt. */
  selectedTitle(userId: string): Promise<AchievementId | null>;
  /** Setzt den getragenen Titel; `null` legt ihn ab. */
  setSelectedTitle(userId: string, achievementId: AchievementId | null): Promise<void>;
}

/** Vollständige Schnittstelle des Moduls. */
export type AchievementRepository = AchievementQueries;

/** Drizzle-Umsetzung von {@link AchievementRepository}. */
export function createDrizzleAchievementRepository(db: Database): AchievementRepository {
  return {
    async unlocked(userId) {
      const rows = await db
        .select({
          achievementId: userAchievements.achievementId,
          unlockedAt: userAchievements.unlockedAt,
        })
        .from(userAchievements)
        .where(eq(userAchievements.userId, userId))
        .orderBy(asc(userAchievements.unlockedAt));

      return rows;
    },

    async award(userId, achievementIds) {
      if (achievementIds.length === 0) return [];

      const rows = await db
        .insert(userAchievements)
        .values(achievementIds.map((achievementId) => ({ userId, achievementId })))
        .onConflictDoNothing({
          target: [userAchievements.userId, userAchievements.achievementId],
        })
        .returning({ achievementId: userAchievements.achievementId });

      return rows.map((row) => row.achievementId);
    },

    async countAuditEntries(userId, filter, exceptEntryId) {
      const bedingungen = [eq(auditLog.actorId, userId)];

      if ('include' in filter) {
        if (filter.include.length === 0) return 0;
        bedingungen.push(inArray(auditLog.action, [...filter.include]));
      } else if (filter.exclude.length > 0) {
        bedingungen.push(notInArray(auditLog.action, [...filter.exclude]));
      }

      if (exceptEntryId !== null) bedingungen.push(ne(auditLog.id, exceptEntryId));

      const [row] = await db
        .select({ anzahl: count() })
        .from(auditLog)
        .where(and(...bedingungen));

      return Number(row?.anzahl ?? 0);
    },

    async registrationRank(userId) {
      /*
       * Der Platz ergibt sich aus der Zahl der früher angelegten Konten. Ein
       * Konto, das es nicht (mehr) gibt, liefert damit `1` – deshalb prüft der
       * Aufrufer gar nicht erst darauf: Die Regel läuft ohnehin nur für ein
       * Konto, das eben gerade etwas getan hat.
       */
      const [eigen] = await db
        .select({ createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, userId));

      if (!eigen) return Number.MAX_SAFE_INTEGER;

      const [row] = await db
        .select({ frueher: count() })
        .from(users)
        .where(lt(users.createdAt, eigen.createdAt));

      return Number(row?.frueher ?? 0) + 1;
    },

    async arcadeRoundCount(userId) {
      const [row] = await db
        .select({ anzahl: count() })
        .from(arcadeScores)
        .where(eq(arcadeScores.userId, userId));

      return Number(row?.anzahl ?? 0);
    },

    async arcadeDistinctGames(userId) {
      const [row] = await db
        .select({ anzahl: countDistinct(arcadeScores.gameId) })
        .from(arcadeScores)
        .where(eq(arcadeScores.userId, userId));

      return Number(row?.anzahl ?? 0);
    },

    async isTopOfLeaderboard(userId, gameId) {
      const [eigen] = await db
        .select({ best: sql<number>`max(${arcadeScores.score})` })
        .from(arcadeScores)
        .where(and(eq(arcadeScores.userId, userId), eq(arcadeScores.gameId, gameId)));

      const eigenerBestwert = Number(eigen?.best ?? 0);

      if (eigen?.best === null || eigen?.best === undefined) return false;

      const bestProKonto = db
        .select({
          userId: arcadeScores.userId,
          best: sql<number>`max(${arcadeScores.score})`.as('best'),
        })
        .from(arcadeScores)
        .innerJoin(users, eq(users.id, arcadeScores.userId))
        .where(and(eq(arcadeScores.gameId, gameId), eq(users.banned, false)))
        .groupBy(arcadeScores.userId)
        .as('best_per_user');

      const [row] = await db
        .select({ besser: count() })
        .from(bestProKonto)
        .where(gt(bestProKonto.best, eigenerBestwert));

      return Number(row?.besser ?? 0) === 0;
    },

    async isTopOfAnyLeaderboard(userId) {
      /*
       * Je Spiel der höchste Bestwert und der eigene Bestwert nebeneinander –
       * erfüllt ist die Bedingung, sobald irgendwo kein echt größerer Wert
       * steht. Dieselbe Grundmenge wie die Bestenliste: gesperrte Konten
       * zählen nicht mit (`backend-community-16`).
       */
      const bestProKontoUndSpiel = db
        .select({
          gameId: arcadeScores.gameId,
          userId: arcadeScores.userId,
          best: sql<number>`max(${arcadeScores.score})`.as('best'),
        })
        .from(arcadeScores)
        .innerJoin(users, eq(users.id, arcadeScores.userId))
        .where(eq(users.banned, false))
        .groupBy(arcadeScores.gameId, arcadeScores.userId)
        .as('best_per_user_game');

      const [row] = await db
        .select({
          spitzenplaetze: sql<number>`count(*) filter (
            where ${bestProKontoUndSpiel.userId} = ${userId}
              and ${bestProKontoUndSpiel.best} = ${sql`max(${bestProKontoUndSpiel.best}) over (partition by ${bestProKontoUndSpiel.gameId})`}
          )`,
        })
        .from(bestProKontoUndSpiel);

      return Number(row?.spitzenplaetze ?? 0) > 0;
    },

    async hasAuditEntryAtHour(userId, actions, fromHour, toHour, timeZone) {
      if (actions.length === 0) return false;

      const stunde = sql`extract(hour from (${auditLog.timestamp} at time zone ${timeZone}))`;

      const [row] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.actorId, userId),
            inArray(auditLog.action, [...actions]),
            sql`${stunde} >= ${fromHour}`,
            sql`${stunde} < ${toHour}`,
          ),
        )
        .limit(1);

      return row !== undefined;
    },

    async allUserIds() {
      const rows = await db.select({ id: users.id }).from(users).orderBy(asc(users.createdAt));

      return rows.map((row) => row.id);
    },

    async selectedTitle(userId) {
      const [row] = await db
        .select({ titleAchievementId: users.titleAchievementId })
        .from(users)
        .where(eq(users.id, userId));

      return row?.titleAchievementId ?? null;
    },

    async setSelectedTitle(userId, achievementId) {
      await db.update(users).set({ titleAchievementId: achievementId }).where(eq(users.id, userId));
    },
  };
}
