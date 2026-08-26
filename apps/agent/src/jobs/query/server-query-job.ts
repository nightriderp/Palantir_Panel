/**
 * Periodische Server-Abfrage (Arbeitspaket A3, Pflichtenheft §9).
 *
 * Der Job hält je Server ein Abfrageziel und fragt es im eingestellten Takt ab.
 * Jedes Ergebnis geht als `STATS_UPDATE` mit der Nutzlast
 * `AgentServerQueryPayload` ans Backend – dort zieht `handleStatsUpdate()` den
 * Aktivitätszeitpunkt nach, auf dem die Auto-Shutdown-Entscheidung beruht.
 *
 * **Bewusste Arbeitsteilung (CLAUDE.md §3/§4):** Dieser Job entscheidet nichts.
 * Ob ein Server wegen Inaktivität abgeschaltet wird, entscheidet allein
 * `decideAutoShutdown()` im Backend – samt Schonfrist nach dem Start, dem
 * konfigurierbaren Inaktivitäts-Timeout und der Abschaltbarkeit pro Server.
 * Auch der Crash-Loop-Schutz und der Übergang `starting → running` liegen dort.
 * Der Agent liefert die Messwerte, die das Backend dafür nicht selbst erheben
 * kann. Dieselbe Grenze zieht `auto-shutdown.ts` im Backend in seinem
 * Kopfkommentar von der anderen Seite.
 *
 * Die Ziele kommen über den Befehl `SET_SERVER_QUERY`; der Agent errät weder
 * Port noch Abfrageart, weil er keine Spiele kennt (Pflichtenheft §11).
 */

import type {
  AgentServerQueryPayload,
  AgentServerQueryTarget,
  SetServerQueryCommandResult,
} from '@palantir/contracts';
import type { OutboundEvent } from '../../connection/ports.js';
import type { JobScheduler } from '../scheduler.js';
import { createServerProbe, type ServerProbe } from './probe.js';

/** Vorgabe-Adresse: Die Portbindung liegt auf dem Homeserver selbst (Pflichtenheft §18). */
export const DEFAULT_QUERY_HOST = '127.0.0.1';

export interface ServerQueryJobOptions {
  readonly scheduler: JobScheduler;
  /** Ohne Angabe die Sonde aus `probe.ts` (Port-Connect; `gamedig` noch offen). */
  readonly probe?: ServerProbe;
  /** Senke für die Ereignisse – in der Regel `connection.sendEvent`. */
  readonly emit: (event: OutboundEvent) => void;
  /** Takt, wenn das Ziel keinen eigenen mitbringt (`AGENT_QUERY_INTERVAL_SECONDS`). */
  readonly defaultIntervalSeconds: number;
  /** Frist einer einzelnen Abfrage (`AGENT_QUERY_TIMEOUT_MS`). */
  readonly timeoutMs: number;
  readonly defaultHost?: string;
  readonly now?: () => Date;
}

interface AktivesZiel {
  readonly target: AgentServerQueryTarget;
  readonly intervalSeconds: number;
}

/** Jobname im Scheduler – ein Server hat höchstens einen Abfrage-Job. */
export function queryJobName(serverId: string): string {
  return `serverQuery:${serverId}`;
}

export class ServerQueryJob {
  readonly #scheduler: JobScheduler;
  readonly #probe: ServerProbe;
  readonly #emit: (event: OutboundEvent) => void;
  readonly #defaultIntervalSeconds: number;
  readonly #timeoutMs: number;
  readonly #defaultHost: string;
  readonly #now: () => Date;
  readonly #ziele = new Map<string, AktivesZiel>();

  constructor(options: ServerQueryJobOptions) {
    this.#scheduler = options.scheduler;
    this.#probe = options.probe ?? createServerProbe();
    this.#emit = options.emit;
    this.#defaultIntervalSeconds = options.defaultIntervalSeconds;
    this.#timeoutMs = options.timeoutMs;
    this.#defaultHost = options.defaultHost ?? DEFAULT_QUERY_HOST;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Setzt oder beendet die Abfrage eines Servers (`SET_SERVER_QUERY`).
   *
   * Idempotent: Ein erneuter Aufruf ersetzt das bestehende Ziel, statt ein
   * zweites anzulegen. Das Backend kann den Befehl deshalb nach jedem
   * Verbindungsaufbau für alle laufenden Server wiederholen.
   */
  setTarget(serverId: string, target: AgentServerQueryTarget | null): SetServerQueryCommandResult {
    if (target === null) {
      this.#scheduler.cancel(queryJobName(serverId));
      this.#ziele.delete(serverId);
      return { serverId, active: false, intervalSeconds: null };
    }

    const intervalSeconds = target.intervalSeconds ?? this.#defaultIntervalSeconds;
    this.#ziele.set(serverId, { target, intervalSeconds });
    this.#scheduler.every(queryJobName(serverId), intervalSeconds * 1_000, () =>
      this.queryOnce(serverId),
    );

    return { serverId, active: true, intervalSeconds };
  }

  /** Server, die aktuell abgefragt werden. */
  get activeServerIds(): readonly string[] {
    return [...this.#ziele.keys()];
  }

  /** Aktuelles Ziel eines Servers, oder `null`. */
  getTarget(serverId: string): AgentServerQueryTarget | null {
    return this.#ziele.get(serverId)?.target ?? null;
  }

  /** Beendet alle Abfragen – beim Herunterfahren des Agents. */
  stopAll(): void {
    for (const serverId of [...this.#ziele.keys()]) {
      this.#scheduler.cancel(queryJobName(serverId));
    }
    this.#ziele.clear();
  }

  /**
   * Führt eine einzelne Abfrage aus und meldet das Ergebnis.
   *
   * Ein nicht erreichbarer Server ist hier **kein Fehler**: Das Ergebnis geht
   * mit `reachable: false` ans Backend, damit dort sichtbar ist, dass gemessen
   * wurde und was dabei herauskam. Ein stiller Abbruch würde für das Backend
   * genauso aussehen wie ein Agent, der gar nicht fragt.
   */
  async queryOnce(serverId: string): Promise<void> {
    const eintrag = this.#ziele.get(serverId);
    if (eintrag === undefined) {
      return;
    }

    const { target } = eintrag;
    const ergebnis = await this.#probe.check(
      {
        host: target.host ?? this.#defaultHost,
        port: target.hostPort,
        query: target.query,
      },
      this.#timeoutMs,
    );

    const payload: AgentServerQueryPayload = {
      source: 'serverQuery',
      containerId: target.containerId,
      reachable: ergebnis.reachable,
      playersOnline: ergebnis.playersOnline,
      playersMax: ergebnis.playersMax,
      pingMs: ergebnis.pingMs,
      reason: ergebnis.reason,
      at: this.#now().toISOString(),
    };

    this.#emit({ event: 'STATS_UPDATE', serverId, payload });
  }
}
