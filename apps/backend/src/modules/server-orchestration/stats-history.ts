/**
 * Verlauf der Live-Messwerte (Lastenheft §3.3 „Verlaufsdarstellung";
 * Arbeitspaket P5).
 *
 * **Was fehlte.** Das Backend lieferte nur den Momentwert (`GET /stats`, direkt
 * vom Agent). Die Verlaufsdarstellung im Reiter „Übersicht" braucht dagegen
 * eine Reihe – und die entsteht nur, wenn jemand die Werte regelmäßig
 * festhält.
 *
 * **Woher die Werte kommen.** Aus zwei Quellen, die sich ergänzen und die keine
 * von beiden allein reicht:
 *
 * - `GET_STATS` (Container-Engine) – CPU, Arbeitsspeicher, Netzverkehr. Kennt
 *   keine Spielerzahl: Die Engine sieht einen Prozess, kein Spiel.
 * - `STATS_UPDATE` mit `AgentServerQueryPayload` (Server-Abfrage des Agents) –
 *   Spielerzahl und Antwortzeit. Kennt keine Ressourcen.
 *
 * Der Dienst hält die zuletzt gemeldete Abfrage je Server im Speicher und legt
 * sie beim Abtasten neben die Engine-Werte. Bewusst kein zusätzlicher
 * Agent-Befehl und keine zweite Tabelle für die Abfrage: Beide Quellen
 * beschreiben denselben Zeitpunkt desselben Servers.
 *
 * **Kein eigener Timer.** Abgetastet wird im Minuten-Takt aus `scheduler.ts`,
 * genau wie Auto-Shutdown und die Zeitpläne.
 */

import { type ServerLiveStats, type ServerStatsHistoryDto } from '@palantir/contracts';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { serverStatsSamples } from '../../db/schema.js';

/** Eine Stichprobe, wie Dienst und Repository sie austauschen. */
export interface StatsSample {
  readonly serverId: string;
  readonly recordedAt: Date;
  readonly cpuPercent: number | null;
  readonly ramUsedMb: number | null;
  readonly diskUsedMb: number | null;
  readonly pingMs: number | null;
  readonly playersOnline: number | null;
  readonly playersMax: number | null;
  readonly networkRxBytes: number | null;
  readonly networkTxBytes: number | null;
}

export interface ServerStatsRepository {
  /**
   * Legt eine Stichprobe ab.
   *
   * Ein zweiter Wert zum selben Zeitpunkt wird verworfen statt zu scheitern:
   * Der Schlüssel ist (Server, Zeitpunkt), und zwei Abtastungen in derselben
   * Millisekunde wären ohnehin dieselbe Messung.
   */
  insert(sample: StatsSample): Promise<void>;
  /** Stichproben eines Servers ab einem Zeitpunkt, älteste zuerst. */
  listSince(serverId: string, since: Date): Promise<readonly StatsSample[]>;
  /** Entfernt Stichproben vor `before`; liefert die Anzahl. */
  prune(before: Date): Promise<number>;
}

export function createDrizzleServerStatsRepository(db: DbConnection): ServerStatsRepository {
  return {
    async insert(sample) {
      await db
        .insert(serverStatsSamples)
        .values({
          serverId: sample.serverId,
          recordedAt: sample.recordedAt,
          cpuPercent: sample.cpuPercent,
          ramUsedMb: sample.ramUsedMb,
          diskUsedMb: sample.diskUsedMb,
          pingMs: sample.pingMs,
          playersOnline: sample.playersOnline,
          playersMax: sample.playersMax,
          networkRxBytes: sample.networkRxBytes,
          networkTxBytes: sample.networkTxBytes,
        })
        .onConflictDoNothing();
    },

    async listSince(serverId, since) {
      const rows = await db
        .select()
        .from(serverStatsSamples)
        .where(
          and(eq(serverStatsSamples.serverId, serverId), gte(serverStatsSamples.recordedAt, since)),
        )
        .orderBy(asc(serverStatsSamples.recordedAt));

      return rows.map((row) => ({ ...row }));
    },

    async prune(before) {
      const entfernt = await db
        .delete(serverStatsSamples)
        .where(lt(serverStatsSamples.recordedAt, before))
        .returning({ serverId: serverStatsSamples.serverId });

      return entfernt.length;
    },
  };
}

/** Eine Stichprobe in der Form, die das Diagramm im Frontend liest. */
export function toLiveStats(sample: StatsSample): ServerLiveStats {
  return {
    cpuPercent: sample.cpuPercent,
    ramUsedMb: sample.ramUsedMb,
    diskUsedMb: sample.diskUsedMb,
    pingMs: sample.pingMs,
    playersOnline: sample.playersOnline,
    playersMax: sample.playersMax,
    networkRxBytes: sample.networkRxBytes,
    networkTxBytes: sample.networkTxBytes,
    updatedAt: sample.recordedAt.toISOString(),
  };
}

export function toStatsHistoryDto(
  serverId: string,
  windowMinutes: number,
  intervalSeconds: number,
  samples: readonly StatsSample[],
): ServerStatsHistoryDto {
  return {
    serverId,
    windowMinutes,
    intervalSeconds,
    samples: samples.map(toLiveStats),
  };
}

/**
 * Zuletzt gemeldete Server-Abfrage je Server (Spielerzahl, Antwortzeit).
 *
 * Bewusst nur im Speicher und ohne eigene Tabelle: Der Wert ist genau bis zur
 * nächsten Abtastung interessant und darf einen Neustart des Backends nicht
 * überleben – eine Spielerzahl von vor dem Neustart wäre schlicht falsch.
 */
export class LatestQueryCache {
  readonly #werte = new Map<
    string,
    { playersOnline: number | null; playersMax: number | null; pingMs: number | null; at: number }
  >();

  /** Wie lange eine Abfrage als aktuell gilt. */
  readonly #maxAlterMs: number;

  constructor(maxAlterMs: number) {
    this.#maxAlterMs = maxAlterMs;
  }

  remember(
    serverId: string,
    werte: {
      playersOnline: number | null;
      playersMax: number | null;
      pingMs: number | null;
    },
    at: Date,
  ): void {
    this.#werte.set(serverId, { ...werte, at: at.getTime() });
  }

  /**
   * Die zuletzt gemeldeten Werte – oder lauter `null`, wenn sie zu alt sind.
   *
   * Veraltete Werte werden nicht fortgeschrieben: Eine Spielerzahl von vor einer
   * Stunde in einem Minutenverlauf wäre eine Zeile, die nie stimmt.
   */
  read(
    serverId: string,
    now: Date,
  ): { playersOnline: number | null; playersMax: number | null; pingMs: number | null } {
    const eintrag = this.#werte.get(serverId);

    if (eintrag === undefined || now.getTime() - eintrag.at > this.#maxAlterMs) {
      return { playersOnline: null, playersMax: null, pingMs: null };
    }

    return {
      playersOnline: eintrag.playersOnline,
      playersMax: eintrag.playersMax,
      pingMs: eintrag.pingMs,
    };
  }

  forget(serverId: string): void {
    this.#werte.delete(serverId);
  }
}
