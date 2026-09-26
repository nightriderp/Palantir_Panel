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

import {
  ARCADE_GAMES,
  type AchievementId,
  type ArcadeGameId,
  type AuditAction,
  isAchievementId,
} from '@palantir/contracts';
import { and, asc, countDistinct, count, eq, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { userAchievements } from '../../db/schema/achievements.js';
import { arcadeScores } from '../../db/schema/arcade.js';
import { auditLog } from '../../db/schema/admin.js';
import { users } from '../../db/schema/users.js';

/** Spiele, deren Bestenliste Siege zählt (`metric: 'wins'`). */
const WINS_GAME_IDS: readonly ArcadeGameId[] = ARCADE_GAMES.filter(
  (game) => game.metric === 'wins',
).map((game) => game.id);

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
  /**
   * Alle freigeschalteten Abzeichen eines Kontos, älteste zuerst.
   *
   * Nur solche, die der Katalog kennt – siehe die Umsetzung.
   */
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
  /**
   * Anzahl der verschiedenen Spiele aus `gameIds`, in denen das Konto einen
   * Eintrag hat.
   */
  arcadeDistinctGames(userId: string, gameIds: readonly ArcadeGameId[]): Promise<number>;
  /**
   * Bester (kleinster) Platz des Kontos über **alle** Bestenlisten; `null`,
   * wenn es nie gespielt hat.
   *
   * Eine Abfrage statt zweier Ja/Nein-Fragen: Die Platzierungs-Leiter fragt
   * dieselbe Zahl siebenmal mit verschiedenen Schwellen ab (Betreiber,
   * 21.09.2026), und ein Rang beantwortet jede davon.
   *
   * Gezählt wird nach derselben Regel wie in der Bestenliste selbst
   * (`ArcadeRepository.rankForScore`): „Anzahl der echt größeren Bestwerte plus
   * eins", Gleichstand teilt sich den Platz. Gesperrte Konten zählen nicht mit
   * (`backend-community-16`) – sonst schöbe ein unsichtbares Konto alle anderen
   * um einen Platz nach unten, und das Abzeichen hinge an jemandem, den
   * niemand sieht.
   *
   * Bewusst über alle Spiele und nicht je Spiel: Wer irgendwo vorne steht, soll
   * die Leiter hinaufkommen. Eine Stufe je Spiel wäre die ernsthafte Variante
   * und hätte den Katalog mit fünfunddreißig Einträgen geflutet.
   */
  bestArcadeRank(userId: string): Promise<number | null>;
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

/**
 * Verwirft Zeilen, deren Kennung der Katalog nicht (mehr) kennt.
 *
 * Die Spalte ist nur auf TypeScript-Ebene auf `AchievementId` verengt, die
 * Datenbank hält schlichten Text. Nimmt eine spätere Fassung ein Abzeichen aus
 * dem Katalog – so geschehen mit den Verwaltungs-Abzeichen am 21.09.2026 –,
 * bleiben die bereits vergebenen Zeilen stehen. Ohne diesen Filter zählte
 * `sammler*` sie weiter mit, während die Übersicht sie nicht mehr zeigt: Der
 * Bestand liefe zwischen Regel und Anzeige auseinander, und die Sammler-Staffel
 * fiele eine Stufe zu früh.
 *
 * Gelöscht wird die Zeile bewusst nicht. Kehrt das Abzeichen zurück, steht der
 * ursprüngliche Zeitpunkt wieder da, statt neu zu entstehen.
 */
export function nurBekannteAbzeichen(
  rows: readonly { readonly achievementId: string; readonly unlockedAt: Date }[],
): UnlockedAchievement[] {
  return rows.filter((row): row is UnlockedAchievement => isAchievementId(row.achievementId));
}

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

      return nurBekannteAbzeichen(rows);
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
       * Der Platz ergibt sich aus der Zahl der früher angelegten Konten.
       *
       * **Der Betreiber zählt nicht mit** (Betreiber, 21.09.2026) – weder als
       * Empfänger noch als besetzter Platz. Sein Konto ist zwangsläufig das
       * erste der Instanz; „einer der ersten fünf" wäre für ihn keine
       * Auszeichnung, sondern eine Selbstverständlichkeit, und es nähme den
       * fünf Leuten, die es betrifft, einen ihrer Plätze weg. Beides steckt in
       * dieser einen Abfrage: Der Owner bekommt `MAX_SAFE_INTEGER` und ist
       * damit aus der Wertung, und die Zählung der früheren Konten übergeht
       * ihn.
       */
      const [eigen] = await db
        .select({ createdAt: users.createdAt, isOwner: users.isOwner })
        .from(users)
        .where(eq(users.id, userId));

      // Kein Konto (mehr) oder der Betreiber: außerhalb der Wertung. Ein Wert
      // statt `null`, damit die Regel schlicht vergleichen kann.
      if (!eigen || eigen.isOwner) return Number.MAX_SAFE_INTEGER;

      const [row] = await db
        .select({ frueher: count() })
        .from(users)
        .where(and(lt(users.createdAt, eigen.createdAt), eq(users.isOwner, false)));

      return Number(row?.frueher ?? 0) + 1;
    },

    async arcadeRoundCount(userId) {
      const [row] = await db
        .select({ anzahl: count() })
        .from(arcadeScores)
        .where(eq(arcadeScores.userId, userId));

      return Number(row?.anzahl ?? 0);
    },

    async arcadeDistinctGames(userId, gameIds) {
      if (gameIds.length === 0) return 0;

      const [row] = await db
        .select({ anzahl: countDistinct(arcadeScores.gameId) })
        .from(arcadeScores)
        .where(and(eq(arcadeScores.userId, userId), inArray(arcadeScores.gameId, [...gameIds])));

      return Number(row?.anzahl ?? 0);
    },

    async bestArcadeRank(userId) {
      /*
       * Je Spiel und Konto der Bestwert, darüber ein `rank()` je Spiel – und
       * davon der kleinste Wert, der auf dieses Konto entfällt. `rank()` ist
       * die Wettkampf-Rangvergabe („1, 1, 3") und damit dieselbe Regel, nach
       * der die Bestenliste ihre Plätze vergibt.
       */
      const [row] = await db
        .select({ platz: sql<number | null>`min(r.rang)` })
        .from(
          sql`(
            select
              b.user_id,
              rank() over (partition by b.game_id order by b.best desc) as rang
            from (
              select ${arcadeScores.gameId} as game_id,
                     ${arcadeScores.userId} as user_id,
                     -- Siegspiele zählen die Summe der Siege, alle anderen
                     -- den besten Stand – dieselbe Regel wie die Bestenliste.
                     case when ${arcadeScores.gameId} in (${sql.join(
                       WINS_GAME_IDS.map((id) => sql`${id}`),
                       sql`, `,
                     )})
                       then sum(${arcadeScores.score})
                       else max(${arcadeScores.score})
                     end as best
              from ${arcadeScores}
              join ${users} on ${users.id} = ${arcadeScores.userId}
              where ${users.banned} = false
              group by ${arcadeScores.gameId}, ${arcadeScores.userId}
            ) b
          ) r`,
        )
        .where(sql`r.user_id = ${userId}`);

      return row?.platz === null || row?.platz === undefined ? null : Number(row.platz);
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
