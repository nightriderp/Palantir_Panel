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
 *
 * **Wohin die Abfrage geht (Fundpunkt 188):** an die Adresse des Containers im
 * Spielenetz, auf den Port, auf dem der Server IM Container lauscht
 * (`containerPort` des Ziels). Nicht an den Host-Port: Der ist an `127.0.0.1`
 * der Node gebunden (Pflichtenheft §18), und der Agent läuft im Compose-Netz –
 * sein Loopback ist nicht das der Node. Bis dahin fragte der Job
 * `127.0.0.1:<hostPort>` und bekam auf jeder Node `ECONNREFUSED`; frpc, das
 * denselben Port erreicht, läuft im Host-Netz. Die Adresse liefert die
 * Laufzeit (`ContainerRuntime.networkAddress`); sie wird je Server gemerkt und
 * nach einem Fehlschlag neu aufgelöst, denn ein neu gebauter Container bekommt
 * eine andere. Den Weg dorthin gibt das Egress-Regelwerk frei
 * (`deploy/gamenode/egress-firewall.sh`, Ausnahme für den Agent).
 *
 * `host` im Ziel oder `AGENT_QUERY_HOST` schalten auf den alten Weg
 * `<host>:<hostPort>` um – für Umgebungen, in denen der Agent auf dem
 * Docker-Host selbst läuft und die Host-Ports erreicht.
 */

import type {
  AgentServerQueryPayload,
  AgentServerQueryTarget,
  SetServerQueryCommandResult,
} from '@palantir/contracts';
import type { OutboundEvent } from '../../connection/ports.js';
import type { JobScheduler } from '../scheduler.js';
import { createServerProbe, type ServerProbe, type ServerProbeResult } from './probe.js';

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
  /**
   * Adresse eines Containers im Spielenetz – in der Regel
   * `runtime.networkAddress(containerId, AGENT_CONTAINER_NETWORK)`. `null`,
   * wenn der Container dort nicht hängt.
   */
  readonly resolveAddress: (containerId: string) => Promise<string | null>;
  /**
   * Gesetzt, wird statt des Spielenetzes `<hostOverride>:<hostPort>` gefragt
   * (`AGENT_QUERY_HOST`). Nur für Umgebungen, in denen der Agent die Host-Ports
   * der Spielcontainer erreicht.
   */
  readonly hostOverride?: string | undefined;
  readonly now?: () => Date;
}

interface AktivesZiel {
  readonly target: AgentServerQueryTarget;
  readonly intervalSeconds: number;
}

/** Wohin eine Abfrage geht – oder warum sie nirgendwohin gehen kann. */
type Zieladresse = { readonly host: string; readonly port: number } | { readonly grund: string };

/** Jobname im Scheduler – ein Server hat höchstens einen Abfrage-Job. */
export function queryJobName(serverId: string): string {
  return `serverQuery:${serverId}`;
}

const NICHT_ERREICHBAR = (grund: string): ServerProbeResult => ({
  reachable: false,
  pingMs: null,
  playersOnline: null,
  playersMax: null,
  players: [],
  reason: grund,
});

export class ServerQueryJob {
  readonly #scheduler: JobScheduler;
  readonly #probe: ServerProbe;
  readonly #emit: (event: OutboundEvent) => void;
  readonly #defaultIntervalSeconds: number;
  readonly #timeoutMs: number;
  readonly #resolveAddress: (containerId: string) => Promise<string | null>;
  readonly #hostOverride: string | undefined;
  readonly #now: () => Date;
  readonly #ziele = new Map<string, AktivesZiel>();
  /** Gemerkte Adresse im Spielenetz je Server – fällt nach einem Fehlschlag weg. */
  readonly #adressen = new Map<string, string>();

  constructor(options: ServerQueryJobOptions) {
    this.#scheduler = options.scheduler;
    this.#probe = options.probe ?? createServerProbe();
    this.#emit = options.emit;
    this.#defaultIntervalSeconds = options.defaultIntervalSeconds;
    this.#timeoutMs = options.timeoutMs;
    this.#resolveAddress = options.resolveAddress;
    this.#hostOverride = options.hostOverride;
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
    // Ein neues Ziel kann ein neuer Container sein – die gemerkte Adresse
    // gehört dann dem alten.
    this.#adressen.delete(serverId);

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
    this.#adressen.clear();
  }

  /**
   * Führt eine einzelne Abfrage aus und meldet das Ergebnis.
   *
   * Ein nicht erreichbarer Server ist hier **kein Fehler**: Das Ergebnis geht
   * mit `reachable: false` ans Backend, damit dort sichtbar ist, dass gemessen
   * wurde und was dabei herauskam. Ein stiller Abbruch würde für das Backend
   * genauso aussehen wie ein Agent, der gar nicht fragt. Dasselbe gilt, wenn
   * schon die Adresse fehlt – auch das ist ein Messergebnis mit Grund.
   */
  async queryOnce(serverId: string): Promise<void> {
    const eintrag = this.#ziele.get(serverId);
    if (eintrag === undefined) {
      return;
    }

    const { target } = eintrag;
    const ziel = await this.#zieladresse(serverId, target);

    const ergebnis =
      'grund' in ziel
        ? NICHT_ERREICHBAR(ziel.grund)
        : await this.#probe.check(
            { host: ziel.host, port: ziel.port, query: target.query },
            this.#timeoutMs,
          );

    if (!ergebnis.reachable) {
      // Nächste Runde neu auflösen: Vielleicht wurde der Container inzwischen
      // neu gebaut und hat eine andere Adresse.
      this.#adressen.delete(serverId);
    }

    const payload: AgentServerQueryPayload = {
      source: 'serverQuery',
      containerId: target.containerId,
      reachable: ergebnis.reachable,
      playersOnline: ergebnis.playersOnline,
      playersMax: ergebnis.playersMax,
      // Leere Liste heißt „keine Angabe" und wird deshalb weggelassen, statt
      // als „niemand da" gelesen zu werden (Gefundener Punkt 51).
      ...(ergebnis.players.length > 0 ? { players: ergebnis.players } : {}),
      pingMs: ergebnis.pingMs,
      reason: ergebnis.reason,
      at: this.#now().toISOString(),
    };

    this.#emit({ event: 'STATS_UPDATE', serverId, payload });
  }

  /**
   * Adresse und Port, an die diese Abfrage geht.
   *
   * Reihenfolge: ausdrückliche Adresse im Ziel, dann `AGENT_QUERY_HOST`
   * (beides zusammen mit dem Host-Port), sonst der Container im Spielenetz auf
   * seinem Container-Port.
   */
  async #zieladresse(serverId: string, target: AgentServerQueryTarget): Promise<Zieladresse> {
    const ausdruecklich = target.host ?? this.#hostOverride;

    if (ausdruecklich !== undefined) {
      return { host: ausdruecklich, port: target.hostPort };
    }

    if (target.containerPort === undefined) {
      return {
        grund: 'Das Abfrageziel nennt keinen Container-Port – das Backend ist älter als der Agent.',
      };
    }

    const gemerkt = this.#adressen.get(serverId);

    if (gemerkt !== undefined) {
      return { host: gemerkt, port: target.containerPort };
    }

    let adresse: string | null;

    try {
      adresse = await this.#resolveAddress(target.containerId);
    } catch (fehler: unknown) {
      return {
        grund: `Die Adresse des Containers im Spielenetz ließ sich nicht ermitteln: ${
          fehler instanceof Error ? fehler.message : String(fehler)
        }`,
      };
    }

    if (adresse === null) {
      return { grund: 'Der Container hat keine Adresse im Spielenetz – läuft er?' };
    }

    this.#adressen.set(serverId, adresse);

    return { host: adresse, port: target.containerPort };
  }
}
