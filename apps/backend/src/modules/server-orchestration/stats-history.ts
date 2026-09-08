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
 * **Zweiter Abnehmer derselben Abtastung.** Die Ressourcen-Warnung auf
 * Server-Ebene (Lastenheft §3.3) braucht dieselben Zahlen. Sie liest sie aus
 * der {@link ServerLoadRegistry}, die beim Abtasten mitgeschrieben wird –
 * nicht aus der Tabelle: Sonst läge in jedem Takt eine zusätzliche Abfrage auf
 * Zahlen, die derselbe Durchlauf gerade selbst erzeugt hat.
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
import { type ServerLoadSnapshot } from '../resources/index.js';

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

/**
 * Zuletzt gemessener Plattenplatz je Server (Fundpunkt 175).
 *
 * **Warum es diesen Zwischenspeicher braucht.** Der belegte Plattenplatz ist
 * der einzige Messwert, der den Live-Kanal nicht auf demselben Weg erreicht wie
 * die übrigen. CPU, Arbeitsspeicher und Netzverkehr kommen aus dem
 * Statistik-Strom der Container-Engine; der Plattenplatz kommt aus einer
 * eigenen Messung des Agents am Datenordner und hängt deshalb an `GET_STATS` –
 * an der Abtastung ({@link ServerOrchestrationService.sampleServerStats}), nicht
 * am Strom. Der Live-Rahmen trug ihn bis hierher nie, und weil das Frontend die
 * Messwerte je Rahmen vollständig ersetzt, hätte ein Wert aus einer anderen
 * Quelle mit dem nächsten Rahmen ohnehin wieder auf „—" gestanden.
 *
 * Gemerkt wird deshalb hier – dieselbe Rolle, die {@link LatestQueryCache} für
 * Spielerzahl und Antwortzeit spielt, nur in die andere Richtung: Dort legt das
 * Backend den Abfragestand neben die Engine-Werte, hier den Plattenplatz neben
 * **beide** Nutzlasten von `STATS_UPDATE`.
 *
 * **Warum kein Wert je Live-Rahmen nachgemessen wird.** Der Agent misst den
 * Ordner ohnehin höchstens alle fünf Minuten neu (`DEFAULT_DISK_USAGE_TTL_MS`);
 * ein Baumdurchlauf im Sekundentakt des Statistik-Stroms wäre reine Last für
 * eine Zahl, die sich in dieser Zeit nicht ändert.
 *
 * Wie beim {@link LatestQueryCache}: nur im Speicher, ohne eigene Tabelle, und
 * ein Neustart des Backends vergisst alles – der nächste Abtast-Takt füllt es
 * wieder.
 */
export class LatestDiskUsageCache {
  readonly #werte = new Map<string, { usedMb: number; at: number }>();
  readonly #maxAlterMs: number;
  readonly #zukunftsToleranzMs: number;

  constructor(maxAlterMs: number, zukunftsToleranzMs: number = CLOCK_SKEW_TOLERANCE_MS) {
    this.#maxAlterMs = maxAlterMs;
    this.#zukunftsToleranzMs = zukunftsToleranzMs;
  }

  /**
   * Einen gemessenen Wert merken.
   *
   * `null` ist **kein** Wert und löscht deshalb nichts: Es heißt „nicht
   * gemessen" – der Agent kennt das Feld nicht, hat den Ordner noch nicht
   * durchlaufen oder konnte ihn nicht lesen. Würde `null` den bekannten Wert
   * verdrängen, spränge die Anzeige bei jedem misslungenen Durchlauf auf „—".
   * Veraltet der Wert wirklich, verfällt er über {@link read}.
   */
  remember(serverId: string, usedMb: number | null, at: Date): void {
    if (usedMb === null) {
      return;
    }

    this.#werte.set(serverId, { usedMb, at: at.getTime() });
  }

  /**
   * Der zuletzt gemessene Wert in MiB – oder `null`, wenn er zu alt ist.
   *
   * Dieselbe Frist-Logik wie im {@link LatestQueryCache}, in beide Richtungen:
   * zu alt **und** zu weit in der Zukunft. Ein Wert, den seit Minuten niemand
   * mehr geliefert hat, beschreibt keinen Ist-Zustand mehr, sondern nur noch,
   * was einmal war.
   */
  read(serverId: string, now: Date): number | null {
    const eintrag = this.#werte.get(serverId);

    if (eintrag === undefined) {
      return null;
    }

    const alter = now.getTime() - eintrag.at;

    if (alter > this.#maxAlterMs || alter < -this.#zukunftsToleranzMs) {
      return null;
    }

    return eintrag.usedMb;
  }

  /** Vergisst einen Server – gelöscht, also gibt es den Ordner nicht mehr. */
  forget(serverId: string): void {
    this.#werte.delete(serverId);
  }
}

// ---------------------------------------------------------------------------
// Last je Server – Quelle der Warnungen auf Server-Ebene (Lastenheft §3.3)
// ---------------------------------------------------------------------------

/**
 * `cpuPercent` in absolute Kerne.
 *
 * `ServerLiveStats.cpuPercent` und `AgentContainerStats.cpuPercent` messen
 * Prozent **eines Kerns**: `250` heißt 2,5 ausgelastete Kerne – ausdrücklich
 * nicht 250 % irgendeines Kontingents. Die Schwellwertprüfung rechnet dagegen
 * in Kernen gegen `resourceLimits.cpuCores`.
 *
 * Die Umrechnung steht deshalb hier, an der Messstelle, und nicht im
 * Schwellwert-Modul: Wer dort einen Prozentwert entgegennähme, müsste dessen
 * Bezugsgröße raten. Ein Fehler an dieser Stelle fällt lange nicht auf – er
 * erzeugt entweder Dauerwarnungen (Faktor 100 zu hoch) oder gar keine.
 *
 * `null` bleibt `null`: „kein Messwert" ist keine 0.
 */
export function cpuCoresFromPercent(cpuPercent: number | null): number | null {
  return cpuPercent === null ? null : cpuPercent / 100;
}

/**
 * Zuletzt gemessene Last der laufenden Server, je Node.
 *
 * **Warum im Speicher und nicht aus der Datenbank.** Die Werte entstehen
 * ohnehin in jedem Takt beim Abtasten des Verlaufs (`sampleServerStats()`) –
 * dort liegen Messwert, Limit und Besitzer bereits zusammen vor. Sie für die
 * Warnungen ein zweites Mal aus `server_stats_samples` zu lesen wäre je Takt
 * eine zusätzliche Abfrage für Zahlen, die der Prozess gerade selbst
 * geschrieben hat. Wie beim {@link LatestQueryCache} gilt: Ein Messwert ist
 * genau bis zur nächsten Abtastung interessant und darf einen Neustart des
 * Backends nicht überleben.
 *
 * **Warum der Stand je Node vollständig ersetzt wird.** Ein Server, der
 * gestoppt oder gelöscht wurde, taucht in der nächsten Abtastung schlicht nicht
 * mehr auf – und fällt damit von selbst heraus. Ein Zwischenspeicher, aus dem
 * einzelne Einträge entfernt werden müssten, bräuchte an jedem Lebenszyklus-Weg
 * einen Aufruf; genau einer davon wird beim nächsten Umbau vergessen, und dann
 * warnt ein längst gestoppter Server weiter.
 */
export class ServerLoadRegistry {
  readonly #maxAlterMs: number;
  readonly #zukunftsToleranzMs: number;
  /** Node → zuletzt gemessene Last ihrer laufenden Server. */
  readonly #proNode = new Map<string, { at: number; loads: readonly ServerLoadSnapshot[] }>();

  constructor(maxAlterMs: number, zukunftsToleranzMs: number = CLOCK_SKEW_TOLERANCE_MS) {
    this.#maxAlterMs = maxAlterMs;
    this.#zukunftsToleranzMs = zukunftsToleranzMs;
  }

  /** Ersetzt den Stand einer Node vollständig. */
  replace(nodeId: string, loads: readonly ServerLoadSnapshot[], at: Date): void {
    this.#proNode.set(nodeId, { at: at.getTime(), loads });
  }

  /**
   * Alle Messwerte, die noch zählen.
   *
   * Zu alt heißt: Seit der letzten Abtastung dieser Node ist mehr als ein
   * Takt vergangen – der Agent hängt, ist abgemeldet oder die Node ist weg. Auf
   * so einen Wert hin zu warnen hieße, einen Zustand zu melden, den niemand
   * mehr misst. Das Fenster gilt wie beim {@link LatestQueryCache} in beide
   * Richtungen: Ein Eintrag aus der Zukunft (zurückspringende Backend-Uhr)
   * würde sonst nie verfallen.
   */
  list(now: Date): readonly ServerLoadSnapshot[] {
    const aktuell: ServerLoadSnapshot[] = [];

    for (const [nodeId, eintrag] of this.#proNode) {
      const alter = now.getTime() - eintrag.at;

      if (alter > this.#maxAlterMs || alter < -this.#zukunftsToleranzMs) {
        // Nicht nur überspringen, sondern vergessen: Eine abgemeldete Node
        // bekommt sonst nie wieder jemand aus der Tabelle.
        this.#proNode.delete(nodeId);
        continue;
      }

      aktuell.push(...eintrag.loads);
    }

    return aktuell;
  }

  /** Vergisst eine Node (Verbindung beendet, Node gelöscht). */
  forget(nodeId: string): void {
    this.#proNode.delete(nodeId);
  }
}
