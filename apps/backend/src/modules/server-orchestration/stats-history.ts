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
 *
 * **Eine Uhr für den Verlauf** (W2-14, orchestration-features-03). Der
 * Zeitstempel einer Messung ist immer die Zeit des Backends beim Empfang, nie
 * die des Agents: Ein Homeserver ohne NTP kann Minuten oder Stunden daneben
 * liegen, und dessen Uhr würde sonst darüber entscheiden, ob eine Spielerzahl
 * als „aktuell" gilt. Das gemeldete `emittedAt` bleibt erhalten – aber als
 * Diagnosewert (Log), nicht als Maß. Was danach noch bleibt, fängt das
 * Toleranzfenster ab (siehe {@link ClockSkewMonitor} und
 * {@link LatestQueryCache}).
 */

import {
  type ServerLivePlayer,
  type ServerLiveStats,
  type ServerStatsHistoryDto,
} from '@palantir/contracts';
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
 * Toleranzfenster zwischen Agent- und Backend-Uhr (W2-14).
 *
 * Bis zu einer Minute Unterschied ist Alltag: Laufzeit der Meldung durch den
 * WireGuard-Tunnel, Warteschlange im Backend, ein Agent ohne NTP-Feinschliff.
 * Solange die Abweichung darunter liegt, ist sie kein Befund und wird nicht
 * protokolliert. Der Messwert selbst hängt ohnehin nicht daran – er trägt immer
 * die Backend-Zeit.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * Mindestabstand zwischen zwei Meldungen derselben Uhrabweichung.
 *
 * Ein `STATS_UPDATE` kommt je Server im Sekundentakt. Ohne Drosselung stünde
 * dieselbe Abweichung tausendfach im Protokoll und würde alles andere
 * verdecken; einmal je Stunde und Server genügt, um die Ursache zu finden.
 */
export const CLOCK_SKEW_LOG_INTERVAL_MS = 60 * 60 * 1000;

/** Ergebnis eines Uhrenabgleichs (siehe {@link ClockSkewMonitor}). */
export interface ClockSkewCheck {
  /**
   * Der maßgebliche Zeitstempel der Messung – immer die Empfangszeit des
   * Backends.
   */
  readonly recordedAt: Date;
  /**
   * Gemeldet minus empfangen in Millisekunden: positiv, wenn die Agent-Uhr
   * vorgeht, negativ, wenn sie nachgeht. `null`, wenn der Agent keinen oder
   * keinen lesbaren Zeitstempel mitschickt.
   */
  readonly skewMs: number | null;
  /** Liegt die Abweichung außerhalb des Toleranzfensters? */
  readonly outsideTolerance: boolean;
  /** Soll die Abweichung jetzt protokolliert werden (gedrosselt)? */
  readonly shouldLog: boolean;
}

/**
 * Wacht über den Unterschied zwischen Agent- und Backend-Uhr (W2-14,
 * orchestration-features-03).
 *
 * Der Monitor **verwirft nichts**: Ein Messwert mit abwegigem Zeitstempel ist
 * trotzdem ein Messwert, und ein Verlauf mit Löchern wäre schlechter als einer
 * mit einer Zeile Verspätung. Er liefert nur die maßgebliche Zeit (die des
 * Backends) und die Auskunft, ob die Abweichung meldenswert ist.
 *
 * Der Zustand – wann zuletzt gemeldet wurde – liegt je Quelle (Server) im
 * Speicher: Die Abweichung gehört zur laufenden Verbindung, nicht in die
 * Datenbank.
 */
export class ClockSkewMonitor {
  readonly #toleranzMs: number;
  readonly #meldeAbstandMs: number;
  /** Quelle → Zeitpunkt der letzten Meldung (Backend-Uhr, ms). */
  readonly #zuletztGemeldet = new Map<string, number>();

  constructor(
    toleranzMs: number = CLOCK_SKEW_TOLERANCE_MS,
    meldeAbstandMs: number = CLOCK_SKEW_LOG_INTERVAL_MS,
  ) {
    this.#toleranzMs = toleranzMs;
    this.#meldeAbstandMs = meldeAbstandMs;
  }

  /**
   * Gleicht den gemeldeten Zeitstempel gegen die Empfangszeit ab.
   *
   * @param quelle Woran die Drosselung hängt – hier die Server-Id.
   * @param gemeldet `emittedAt` des Agents; fehlend oder unlesbar ist erlaubt.
   * @param empfangen Zeit des Backends beim Empfang.
   */
  check(quelle: string, gemeldet: string | undefined, empfangen: Date): ClockSkewCheck {
    const gemessen = gemeldet === undefined ? Number.NaN : Date.parse(gemeldet);

    if (Number.isNaN(gemessen)) {
      /*
       * Ohne lesbaren Zeitstempel gibt es keine Abweichung zu messen. Der
       * Messwert bleibt gültig – die Backend-Zeit stand nie zur Debatte.
       */
      return { recordedAt: empfangen, skewMs: null, outsideTolerance: false, shouldLog: false };
    }

    const skewMs = gemessen - empfangen.getTime();

    if (Math.abs(skewMs) <= this.#toleranzMs) {
      // Wieder im Rahmen: Die Drosselung wird zurückgesetzt, damit ein erneutes
      // Auseinanderlaufen sofort auffällt und nicht erst nach der Sperrfrist.
      this.#zuletztGemeldet.delete(quelle);

      return { recordedAt: empfangen, skewMs, outsideTolerance: false, shouldLog: false };
    }

    const zuletzt = this.#zuletztGemeldet.get(quelle);
    const faellig = zuletzt === undefined || empfangen.getTime() - zuletzt >= this.#meldeAbstandMs;

    if (faellig) {
      this.#zuletztGemeldet.set(quelle, empfangen.getTime());
    }

    return { recordedAt: empfangen, skewMs, outsideTolerance: true, shouldLog: faellig };
  }

  /** Vergisst eine Quelle (gelöschter Server, beendete Sitzung). */
  forget(quelle: string): void {
    this.#zuletztGemeldet.delete(quelle);
  }
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
    {
      playersOnline: number | null;
      playersMax: number | null;
      pingMs: number | null;
      players: readonly ServerLivePlayer[];
      at: number;
    }
  >();

  /** Wie lange eine Abfrage als aktuell gilt. */
  readonly #maxAlterMs: number;

  /**
   * Wie weit ein Eintrag in der Zukunft liegen darf, bevor er verfällt (W2-14).
   *
   * Der Dienst stempelt mit der Backend-Uhr, also kann das nur noch passieren,
   * wenn die Backend-Uhr selbst zurückspringt (NTP-Sprung) oder ein Aufrufer
   * doch eine Fremdzeit hereinreicht. Ohne diese Schranke altert ein Eintrag
   * aus der Zukunft nie: `jetzt − at` bliebe negativ und der Wert damit
   * dauerhaft „frisch" – veraltete Spielerzahlen als aktuelle Anzeige.
   */
  readonly #zukunftsToleranzMs: number;

  constructor(maxAlterMs: number, zukunftsToleranzMs: number = CLOCK_SKEW_TOLERANCE_MS) {
    this.#maxAlterMs = maxAlterMs;
    this.#zukunftsToleranzMs = zukunftsToleranzMs;
  }

  remember(
    serverId: string,
    werte: {
      playersOnline: number | null;
      playersMax: number | null;
      pingMs: number | null;
      /** Spielernamen, soweit die Abfrage sie liefert (Gefundener Punkt 51). */
      players?: readonly ServerLivePlayer[];
    },
    at: Date,
  ): void {
    this.#werte.set(serverId, { ...werte, players: werte.players ?? [], at: at.getTime() });
  }

  /**
   * Die zuletzt gemeldeten Werte – oder lauter `null`, wenn sie zu alt sind.
   *
   * Veraltete Werte werden nicht fortgeschrieben: Eine Spielerzahl von vor einer
   * Stunde in einem Minutenverlauf wäre eine Zeile, die nie stimmt.
   *
   * Das Fenster gilt in beide Richtungen (W2-14): zu alt **und** zu weit in der
   * Zukunft. Ein Eintrag aus der Zukunft würde sonst nie verfallen.
   */
  read(
    serverId: string,
    now: Date,
  ): {
    playersOnline: number | null;
    playersMax: number | null;
    pingMs: number | null;
    players: readonly ServerLivePlayer[];
  } {
    const eintrag = this.#werte.get(serverId);

    if (eintrag === undefined) {
      return { playersOnline: null, playersMax: null, pingMs: null, players: [] };
    }

    const alter = now.getTime() - eintrag.at;

    if (alter > this.#maxAlterMs || alter < -this.#zukunftsToleranzMs) {
      // Auch die Namensliste altert: Wer vor einer Stunde verbunden war, steht
      // heute nicht mehr in der Anzeige.
      return { playersOnline: null, playersMax: null, pingMs: null, players: [] };
    }

    return {
      playersOnline: eintrag.playersOnline,
      playersMax: eintrag.playersMax,
      pingMs: eintrag.pingMs,
      players: eintrag.players,
    };
  }

  forget(serverId: string): void {
    this.#werte.delete(serverId);
  }
}
