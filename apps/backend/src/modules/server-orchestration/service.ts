/**
 * Der Dienst der Server-Orchestrierung (B3).
 *
 * Führt zusammen, was in den Nachbardateien einzeln steht: State Machine,
 * Crash-Loop-Schutz, Health-Check, Agent-Befehle, Subdomain- und DNS-Vergabe,
 * Portzuweisung, Soll/Ist-Abgleich.
 *
 * Zwei Regeln gelten hier durchgehend:
 *
 * - **Jeder Zustandswechsel läuft über `applyLifecycleEvent()`.** Es gibt in
 *   dieser Datei kein `status: 'running'`, das an der State Machine vorbeigeht.
 * - **Kein Befehl geht an den Agent, bevor der Übergang geprüft ist.** Der
 *   Start eines bereits laufenden Servers soll gar nicht erst auf dem
 *   Homeserver ankommen.
 */

import {
  type AgentContainerStats,
  type AgentEventFrame,
  type AgentStateReportFrame,
  type ExecConsoleCommandResult,
  type FileListCommandResult,
  type FileReadCommandResult,
  type GetLogsCommandResult,
  type GameConfigValues,
  type ServerResourceLimits,
  buildServerHostname,
} from '@palantir/contracts';
import {
  type CloneServerInput,
  type CreateServerInput,
  type UpdateServerSettingsInput,
} from '@palantir/validation';
import { type AgentGatewayLogger, type AgentRegistry, type AgentSession } from './agent-gateway.js';
import { decideAutoShutdown } from './auto-shutdown.js';
import { type CrashLoopPolicy, evaluateCrashLoop } from './crash-loop.js';
import { buildServerDnsRecord } from './dns/cloudflare.js';
import { type DnsProvider } from './dns/types.js';
import { ServerOrchestrationError } from './errors.js';
import {
  type GameRegistry,
  buildContainerEnv,
  buildServerConfig,
  requiresRestartAfterChange,
} from './game-registry.js';
import { type HealthProbe, awaitHealthy } from './health-check.js';
import { type PortAllocator, visiblePortOf } from './ports.js';
import {
  type CapacityReservation,
  type ResourceGuard,
  createInlineCapacityReservation,
} from './resource-guard.js';
import { planReconciliation } from './reconciliation.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { type ServerAutoShutdown } from './types.js';
import {
  type ServerLifecycleEvent,
  type ServerLifecycleState,
  applyLifecycleEvent,
  assertTransitionAllowed,
} from './state-machine.js';
import { resolveAvailableSubdomain } from './subdomain.js';

/** Ereignisse, die der Dienst nach außen meldet (Pflichtenheft §14). */
export interface OrchestrationEventSink {
  /**
   * @param event Name aus `WEBSOCKET_EVENTS`
   *
   * Bewusst als schmale Schnittstelle: Die Notification-Engine (B6) und der
   * Live-Kanal des Frontends hängen sich hier ein, ohne dass B3 sie kennt.
   */
  emit(event: string, payload: Record<string, unknown>): void;
}

export interface OrchestrationConfig {
  readonly baseDomain: string;
  readonly publicIpv4: string;
  /** Ziel der `CNAME`-Einträge bei Hostname-Routing; `null`, wenn keiner läuft. */
  readonly routerHostname: string | null;
  readonly virtualHostPort: number;
  readonly crashLoopPolicy: CrashLoopPolicy;
  readonly healthCheckIntervalMs: number;
  readonly healthCheckAttemptTimeoutMs: number;
  readonly defaultAutoShutdown: ServerAutoShutdown;
}

export interface OrchestrationDependencies {
  readonly repository: ServerRepository;
  readonly agents: AgentRegistry;
  readonly registry: GameRegistry;
  readonly dns: DnsProvider;
  readonly ports: PortAllocator;
  readonly resources: ResourceGuard;
  /**
   * Serialisiert Kapazitätsprüfung und belegende Schreiboperation (Punkt 98).
   *
   * Ohne Angabe wird aus {@link resources} und {@link repository} eine
   * Reservierung ohne eigene Serialisierung gebildet – das bisherige Verhalten,
   * das für Tests und für den Betrieb ohne Transaktionen genügt. Der
   * Betriebszusammenbau reicht die Drizzle-Umsetzung herein (Advisory-Lock je
   * Node/Nutzer, `capacity-reservation.ts`).
   */
  readonly reservation?: CapacityReservation;
  readonly healthProbe: HealthProbe;
  readonly events: OrchestrationEventSink;
  readonly log: AgentGatewayLogger;
  readonly config: OrchestrationConfig;
  /** Nur für Tests: feste Zeit bzw. Wartezeit ohne echtes Warten. */
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Container-Name auf dem Homeserver – die Konvention aus A1/A2. */
export function containerNameFor(serverId: string): string {
  return `palantir-${serverId}`;
}

/**
 * Datenordner eines Servers auf dem Homeserver.
 *
 * Steht hier und nicht nur im `CREATE`-Befehl, weil die Backup-Verwaltung (B5)
 * denselben Pfad braucht (`BackupServerRecord.dataHostPath`). Zwei getrennt
 * gepflegte Ableitungen desselben Pfades wären die Sorte Fehler, die erst beim
 * Zurückspielen einer Sicherung auffällt.
 */
export function dataHostPathFor(serverId: string): string {
  return `/srv/palantir/servers/${serverId}`;
}

export class ServerOrchestrationService {
  private readonly deps: OrchestrationDependencies;
  private readonly now: () => Date;
  private readonly reservation: CapacityReservation;

  constructor(deps: OrchestrationDependencies) {
    this.deps = deps;
    this.now = deps.now ?? ((): Date => new Date());
    this.reservation =
      deps.reservation ?? createInlineCapacityReservation(deps.resources, deps.repository);
  }

  // -------------------------------------------------------------------------
  // Lesen
  // -------------------------------------------------------------------------

  async requireServer(serverId: string): Promise<ServerRecord> {
    const server = await this.deps.repository.findById(serverId);

    if (server === null) {
      throw new ServerOrchestrationError('SERVER_NOT_FOUND', undefined, { serverId });
    }

    return server;
  }

  /** Abstürze im laufenden Fenster – für `GameServerDto.recentCrashCount`. */
  recentCrashCount(server: ServerRecord): number {
    return evaluateCrashLoop(server.crashTimestamps, this.now(), this.deps.config.crashLoopPolicy)
      .recentCrashCount;
  }

  hostnameFor(server: ServerRecord): string {
    return buildServerHostname(server.subdomain, this.deps.config.baseDomain);
  }

  // -------------------------------------------------------------------------
  // Anlegen
  // -------------------------------------------------------------------------

  /**
   * Legt einen Server an (Lastenheft §3.3).
   *
   * Reihenfolge ist bewusst gewählt: erst die Prüfungen, die ohne Nebenwirkung
   * scheitern können (Spiel-Typ, Subdomain, Ressourcen), dann der
   * Datenbankeintrag, dann die Nebenwirkungen nach außen (Ports, DNS,
   * Container). Scheitert eine Nebenwirkung, bleibt der Server als `error`
   * stehen statt zu verschwinden – ein halb angelegter Server mit sichtbarer
   * Fehlermeldung ist einem stillen Verschwinden vorzuziehen.
   */
  async createServer(input: CreateServerInput, ownerId: string): Promise<ServerRecord> {
    return this.createServerInternal(input, ownerId, null);
  }

  private async createServerInternal(
    input: CreateServerInput,
    ownerId: string,
    clonedFromServerId: string | null,
  ): Promise<ServerRecord> {
    const definition = this.deps.registry.requireSelectable(input.gameType);
    const subdomain = await resolveAvailableSubdomain(input.subdomain, this.deps.repository);
    const host = await this.resolveHost(input.hostId);

    const resourceLimits: ServerResourceLimits = input.resourceLimits;

    // Prüfung und Insert laufen in einer serialisierten Reservierung: Sonst
    // bestünden zwei gleichzeitige Creates beide die Prüfung und überbuchten die
    // Node (TOCTOU, WORK_STATUS.md Punkt 98, Pflichtenheft §10). Der Datensatz
    // entsteht zuerst – der Port-Pool aus B8 ordnet Ports einer Server-Id zu,
    // die es dafür schon geben muss – aber erst, wenn die Belegung reicht.
    const created = await this.reservation.reserve(
      {
        userId: ownerId,
        hostId: host.id,
        serverId: null,
        requested: resourceLimits,
        intent: 'create',
      },
      (repository) =>
        repository.create({
          ownerId,
          hostId: host.id,
          name: input.name,
          gameType: definition.id,
          subdomain,
          assignedPorts: [],
          resourceLimits,
          configJson: buildServerConfig(definition, input.config),
          startupParameters: input.startupParameters,
          autoShutdown: {
            ...this.deps.config.defaultAutoShutdown,
            enabled: input.autoShutdownEnabled,
          },
          clonedFromServerId,
        }),
    );

    const assignedPorts = await this.deps.ports.allocate(created.id, definition, {
      nodeId: host.id,
      virtualHostPort: definition.supportsVirtualHostRouting
        ? this.deps.config.virtualHostPort
        : null,
    });

    await this.deps.repository.update(created.id, { assignedPorts });

    await this.provision(await this.requireServer(created.id));

    return this.requireServer(created.id);
  }

  /**
   * DNS-Eintrag und Container anlegen.
   *
   * Ausgelagert, weil das Klonen dieselbe Kette braucht.
   */
  private async provision(server: ServerRecord): Promise<void> {
    const definition = this.deps.registry.require(server.gameType);

    try {
      const record = buildServerDnsRecord({
        hostname: this.hostnameFor(server),
        supportsVirtualHostRouting: definition.supportsVirtualHostRouting,
        publicIpv4: this.deps.config.publicIpv4,
        virtualHostProxyHostname: this.deps.config.routerHostname,
      });

      const dnsRecordId = await this.deps.dns.upsertRecord(record);

      const session = this.deps.agents.require(server.hostId);

      const created = await session.sendCommand('CREATE', server.id, {
        name: containerNameFor(server.id),
        image: definition.dockerImage,
        env: buildContainerEnv(definition, server.configJson),
        command: definition.defaultCommand,
        ports: server.assignedPorts.map((assignment) => ({
          containerPort: assignment.containerPort,
          hostPort: assignment.publicPort,
          protocol: assignment.protocol,
        })),
        resources: {
          memoryMb: server.resourceLimits.ramMb,
          cpuCores: server.resourceLimits.cpuCores,
        },
        dataVolume: {
          hostPath: dataHostPathFor(server.id),
          containerPath: definition.dataVolumeContainerPath,
        },
        readOnlyRootFilesystem: definition.readOnlyRootFilesystem,
        tmpfsPaths: definition.tmpfsPaths,
        labels: { 'palantir.serverId': server.id },
        stopTimeoutSeconds: definition.stopTimeoutSeconds,
      });

      await this.deps.repository.update(server.id, {
        dnsRecordId,
        dockerContainerId: created.containerId,
      });

      await this.transition(server, { type: 'createSucceeded' });
      this.deps.events.emit('server.created', { serverId: server.id, ownerId: server.ownerId });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unbekannter Fehler.';

      await this.transition(server, { type: 'createFailed', reason });
      this.deps.events.emit('server.failed', { serverId: server.id, reason });

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle-Befehle
  // -------------------------------------------------------------------------

  /**
   * Startet einen Server.
   *
   * Der Rückgabewert kommt, sobald der Startbefehl abgesetzt ist – der Server
   * steht dann auf `starting`. Der Übergang nach `running` passiert erst nach
   * bestandenem Health-Check und wird über `server.statusChanged` gemeldet
   * (Pflichtenheft §9).
   */
  async startServer(serverId: string, actorUserId: string): Promise<ServerRecord> {
    const server = await this.requireServer(serverId);

    assertTransitionAllowed(server.status, 'starting');

    // Vor der Reservierung, damit ein fehlender Container ohne offene
    // Transaktion scheitert.
    const containerId = this.requireContainerId(server);
    const session = this.deps.agents.require(server.hostId);

    // Kapazitätsprüfung und Wechsel auf `starting` als eine serialisierte
    // Einheit: Sonst bestünden zwei gleichzeitige Starts beide die Prüfung, ehe
    // einer die Belegung schreibt, und überbuchten die Node (TOCTOU,
    // WORK_STATUS.md Punkt 98, Pflichtenheft §10). Der Agent-Befehl und der
    // Health-Check laufen bewusst **außerhalb** der Sperre.
    const started = await this.reservation.reserve(
      {
        userId: actorUserId,
        hostId: server.hostId,
        serverId: server.id,
        requested: server.resourceLimits,
        intent: 'start',
      },
      (repository) => this.transition(server, { type: 'startRequested' }, repository),
    );

    await this.finishStart(server, started, session, containerId);

    return this.requireServer(serverId);
  }

  /**
   * Setzt den Server auf `starting`, schickt `START` und wartet danach im
   * Hintergrund auf den Health-Check.
   *
   * Der Weg für den automatischen Neustart nach einem Absturz: Er läuft
   * **ohne** Kapazitätsreservierung, weil der Server bereits angelegt und in der
   * Belegung berücksichtigt ist. Der reguläre Start (`startServer`) reserviert
   * dagegen zuerst.
   */
  private async dispatchStart(
    server: ServerRecord,
    event: ServerLifecycleEvent & { type: 'startRequested' | 'automaticRestartRequested' },
  ): Promise<void> {
    const containerId = this.requireContainerId(server);
    const session = this.deps.agents.require(server.hostId);

    const started = await this.transition(server, event);

    await this.finishStart(server, started, session, containerId);
  }

  /**
   * Schickt `START` an den Agent und stößt den Health-Check an – der Teil des
   * Starts, der **nach** dem Zustandswechsel kommt und ohne Kapazitätssperre
   * läuft (der Agent-Befehl ist ein Netz-Roundtrip, der keine Sperre halten soll).
   */
  private async finishStart(
    server: ServerRecord,
    started: ServerLifecycleState,
    session: AgentSession,
    containerId: string,
  ): Promise<void> {
    try {
      await session.sendCommand('START', server.id, { containerId });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Der Start ist fehlgeschlagen.';

      await this.transition({ ...server, ...started }, { type: 'failed', reason });
      this.deps.events.emit('server.failed', { serverId: server.id, reason });

      throw error;
    }

    // Der Health-Check läuft bewusst neben dem Request: Ein Spiel darf beim
    // Hochlauf Minuten brauchen, so lange soll niemand auf eine HTTP-Antwort
    // warten. Der Zustandswechsel wird über `server.statusChanged` gemeldet.
    void this.awaitStartupHealth(server.id);
  }

  /**
   * Wartet auf den Health-Check und schließt den Start ab.
   *
   * Öffentlich, damit der Soll/Ist-Abgleich denselben Weg nimmt und nicht eine
   * zweite Auslegung von „läuft" mitbringt.
   */
  async awaitStartupHealth(serverId: string): Promise<void> {
    const server = await this.requireServer(serverId);
    const definition = this.deps.registry.require(server.gameType);
    const host = await this.deps.repository.findHost(server.hostId);

    const primary = server.assignedPorts.find((assignment) => assignment.primary);

    if (host === null || primary === undefined) {
      await this.transition(server, {
        type: 'healthCheckFailed',
        reason: 'Die Node oder die Portzuweisung des Servers ist unvollständig.',
      });
      this.deps.events.emit('server.failed', { serverId, reason: 'Portzuweisung unvollständig' });

      return;
    }

    const result = await awaitHealthy({
      target: {
        host: host.wireguardIp,
        port: primary.publicPort,
        query: definition.query,
      },
      startupTimeoutMs: definition.startupTimeoutSeconds * 1_000,
      attemptTimeoutMs: this.deps.config.healthCheckAttemptTimeoutMs,
      intervalMs: this.deps.config.healthCheckIntervalMs,
      probe: this.deps.healthProbe,
      sleep: this.deps.sleep,
      // Dieselbe Uhr wie der Rest des Dienstes – sonst könnte ein Test die Zeit
      // stellen und die Startfrist liefe trotzdem gegen die echte Uhr.
      now: () => this.now().getTime(),
    });

    // Zwischenzeitlich kann der Server abgestürzt oder gestoppt worden sein.
    const current = await this.requireServer(serverId);

    if (current.status !== 'starting') {
      this.deps.log.warn(
        { serverId, status: current.status },
        'Health-Check-Ergebnis verworfen – der Server ist nicht mehr im Startvorgang',
      );

      return;
    }

    if (result.healthy) {
      await this.transition(current, { type: 'healthCheckPassed' });
      this.deps.events.emit('server.started', { serverId, pingMs: result.pingMs });

      return;
    }

    await this.transition(current, {
      type: 'healthCheckFailed',
      reason: result.reason ?? 'Der Server war nach dem Start nicht erreichbar.',
    });
    this.deps.events.emit('server.failed', { serverId, reason: result.reason });
  }

  async stopServer(serverId: string): Promise<ServerRecord> {
    const server = await this.requireServer(serverId);

    assertTransitionAllowed(server.status, 'stopping');

    const containerId = this.requireContainerId(server);
    const session = this.deps.agents.require(server.hostId);
    const stopping = await this.transition(server, { type: 'stopRequested' });

    try {
      await session.sendCommand('STOP', server.id, { containerId });
      await this.transition({ ...server, ...stopping }, { type: 'stopSucceeded' });
      this.deps.events.emit('server.stopped', { serverId });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Das Stoppen ist fehlgeschlagen.';

      await this.transition({ ...server, ...stopping }, { type: 'stopFailed', reason });
      this.deps.events.emit('server.failed', { serverId, reason });

      throw error;
    }

    return this.requireServer(serverId);
  }

  /**
   * Startet einen Server neu.
   *
   * Bewusst als Stopp + Start und nicht als `RESTART`-Befehl an den Agent: Nur
   * so läuft der Neustart durch dieselbe Kette wie ein regulärer Start – mit
   * Ressourcenprüfung und, vor allem, mit Health-Check. Ein `RESTART` am
   * Lifecycle vorbei würde einen Server als „läuft" zurücklassen, ohne dass je
   * geprüft wurde, ob er antwortet (Pflichtenheft §9).
   */
  async restartServer(serverId: string, actorUserId: string): Promise<ServerRecord> {
    const server = await this.requireServer(serverId);

    if (server.status === 'running' || server.status === 'starting') {
      await this.stopServer(serverId);
    }

    const restarted = await this.startServer(serverId, actorUserId);
    this.deps.events.emit('server.restarted', { serverId });

    return restarted;
  }

  /**
   * Löscht einen Server samt Container, DNS-Eintrag und Portzuweisung.
   *
   * Der Container wird zuerst entfernt, der Datensatz zuletzt: Bricht es
   * dazwischen ab, bleibt ein Server ohne Container übrig – den kann man erneut
   * löschen. Andersherum bliebe ein Container ohne Server übrig, den niemand
   * mehr zuordnen kann (der Soll/Ist-Abgleich meldet ihn dann als verwaist).
   */
  async deleteServer(serverId: string): Promise<void> {
    const server = await this.requireServer(serverId);
    const session = this.deps.agents.get(server.hostId);

    if (server.dockerContainerId !== null && session !== null) {
      await session.sendCommand('DELETE', server.id, {
        containerId: server.dockerContainerId,
        force: true,
      });
    } else if (server.dockerContainerId !== null) {
      throw new ServerOrchestrationError('AGENT_NOT_CONNECTED', undefined, {
        hostId: server.hostId,
        serverId,
      });
    }

    await this.deps.dns.deleteRecord(this.hostnameFor(server));
    // Ports zurück in den Pool (B8) – vor dem Löschen des Datensatzes, damit
    // eine Zuordnung nicht ohne Server zurückbleibt (Pflichtenheft §2.4).
    await this.deps.ports.release(serverId);
    await this.deps.repository.delete(serverId);

    this.deps.events.emit('server.deleted', { serverId, ownerId: server.ownerId });
  }

  // -------------------------------------------------------------------------
  // Ändern und Klonen
  // -------------------------------------------------------------------------

  async updateServer(serverId: string, input: UpdateServerSettingsInput): Promise<ServerRecord> {
    const server = await this.requireServer(serverId);
    const definition = this.deps.registry.require(server.gameType);

    const configJson: GameConfigValues = buildServerConfig(definition, input.config);

    // Die Subdomain ändert `UpdateServerSettingsInput` bewusst nicht (F3): Ein
    // Umzug zöge einen neuen DNS-Eintrag nach sich und ist damit ein eigener
    // Vorgang, kein Feld im Einstellungsformular.
    const restartRequired =
      (server.status === 'running' || server.status === 'starting') &&
      (requiresRestartAfterChange(definition, server.configJson, configJson) ||
        input.startupParameters !== server.startupParameters);

    await this.deps.repository.update(serverId, {
      name: input.name,
      resourceLimits: input.resourceLimits,
      configJson,
      startupParameters: input.startupParameters,
      autoShutdown: {
        enabled: input.autoShutdownEnabled,
        idleTimeoutMinutes:
          input.autoShutdownTimeoutMinutes ?? server.autoShutdown.idleTimeoutMinutes,
        graceMinutes: server.autoShutdown.graceMinutes,
      },
      restartRequired: restartRequired ? true : undefined,
    });

    return this.requireServer(serverId);
  }

  /**
   * Klont einen Server (Pflichtenheft §9).
   *
   * „Erzeugt einen neuen `GameServer`-Datensatz mit kopierter Konfiguration und
   * zwingend neuer, eigener Subdomain (gleiche Prüf-/Formatregeln wie bei
   * Neuerstellung); Weltdaten werden optional synchron mitkopiert, Fortschritt
   * wird im Frontend angezeigt."
   *
   * Die neue Subdomain ist Pflicht und durchläuft dieselbe Prüfkette –
   * `createServer()` wird dafür bewusst wiederverwendet, statt die Kette hier
   * ein zweites Mal zu schreiben.
   */
  async cloneServer(
    sourceServerId: string,
    input: CloneServerInput,
    ownerId: string,
  ): Promise<ServerRecord> {
    const source = await this.requireServer(sourceServerId);

    this.deps.events.emit('serverClone.progressed', {
      sourceServerId,
      step: 'preparing',
      percent: 0,
    });

    const clone = await this.createServerInternal(
      {
        name: input.name,
        gameType: source.gameType,
        subdomain: input.subdomain,
        hostId: source.hostId,
        resourceLimits: source.resourceLimits,
        config: { ...source.configJson },
        startupParameters: source.startupParameters,
        autoShutdownEnabled: source.autoShutdown.enabled,
        worldImport: null,
      },
      ownerId,
      source.id,
    );

    if (input.includeWorldData) {
      await this.copyWorldData(source, clone);
    }

    this.deps.events.emit('server.cloned', {
      sourceServerId,
      serverId: clone.id,
      copiedWorldData: input.includeWorldData,
    });

    return this.requireServer(clone.id);
  }

  /**
   * Kopiert die Weltdaten in den Klon.
   *
   * **Noch nicht umgesetzt.** Das Kopieren eines Datenverzeichnisses auf dem
   * Homeserver ist eine Dateisystem-Aufgabe und gehört damit zu A3 (Jobs &
   * Scheduler) – im Agent-Protokoll gibt es dafür bislang keinen Befehl
   * (`AgentCommandPayloads` kennt nur Datei-Einzelzugriffe, und `CREATE_BACKUP`
   * bzw. `RESTORE_BACKUP` sind ausdrücklich A3 vorbehalten). Einen eigenen
   * Befehl dafür hätte B3 nicht am Vertrag vorbei erfinden dürfen (CLAUDE.md §3).
   *
   * Der Klon entsteht deshalb mit kopierter **Konfiguration** – das ist der
   * Teil, den Pflichtenheft §9 verpflichtend nennt; die Weltdaten sind dort
   * ausdrücklich „optional". Der Aufruf scheitert sichtbar mit einem benannten
   * Code, statt einen leeren Server als vollständigen Klon auszugeben.
   * Vermerkt in WORK_STATUS.md unter „Gefundene Punkte".
   */
  private copyWorldData(source: ServerRecord, clone: ServerRecord): Promise<void> {
    this.deps.events.emit('serverClone.progressed', {
      sourceServerId: source.id,
      serverId: clone.id,
      step: 'worldData',
      percent: 0,
    });

    return Promise.reject(
      new ServerOrchestrationError(
        'AGENT_COMMAND_NOT_IMPLEMENTED',
        'Das Mitkopieren der Weltdaten setzt einen Kopier-Befehl im Agent voraus (Arbeitspaket A3). Der Klon wurde mit kopierter Konfiguration angelegt.',
        { sourceServerId: source.id, serverId: clone.id },
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Durchgereichte Agent-Befehle
  // -------------------------------------------------------------------------

  async getStats(serverId: string): Promise<AgentContainerStats> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);

    return session.sendCommand('GET_STATS', server.id, { containerId });
  }

  async getLogs(serverId: string, tail?: number): Promise<GetLogsCommandResult> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);

    return session.sendCommand('GET_LOGS', server.id, { containerId, tail });
  }

  /**
   * Führt eine Konsolenzeile im Container aus (Lastenheft §3.3).
   *
   * Die Zeile wird an Leerzeichen zerlegt und als Argumentliste übergeben – es
   * steht keine Shell dazwischen, damit aus einer Konsoleneingabe keine
   * Shell-Injection werden kann (siehe `ExecConsoleCommandPayload`).
   */
  async execConsole(serverId: string, commandLine: string): Promise<ExecConsoleCommandResult> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);
    const argv = commandLine
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0);

    if (argv.length === 0) {
      throw new ServerOrchestrationError(
        'AGENT_COMMAND_INVALID',
        'Der Konsolenbefehl darf nicht leer sein.',
        { serverId },
      );
    }

    return session.sendCommand('EXEC_CONSOLE', server.id, { containerId, command: argv });
  }

  async listFiles(serverId: string, path: string): Promise<FileListCommandResult> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);

    return session.sendCommand('FILE_LIST', server.id, { containerId, path });
  }

  async readFile(serverId: string, path: string): Promise<FileReadCommandResult> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);

    return session.sendCommand('FILE_READ', server.id, { containerId, path });
  }

  async writeFile(serverId: string, path: string, contentBase64: string): Promise<void> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);

    await session.sendCommand('FILE_WRITE', server.id, { containerId, path, contentBase64 });
  }

  // -------------------------------------------------------------------------
  // Ereignisse des Agents
  // -------------------------------------------------------------------------

  /**
   * Verarbeitet ein Ereignis des Agents (Pflichtenheft §5.3).
   *
   * `STATUS_CHANGED` und `STATS_UPDATE` sind Beobachtungen, keine Anweisungen:
   * Sie ändern den Lifecycle-Zustand **nicht** direkt. Ein Container, der
   * plötzlich läuft, macht aus einem Server noch keinen `running` – dafür
   * braucht es den Health-Check (Pflichtenheft §9).
   */
  async handleAgentEvent(hostId: string, frame: AgentEventFrame): Promise<void> {
    if (frame.serverId === null) {
      this.deps.log.warn({ hostId, event: frame.event }, 'Agent-Ereignis ohne Server verworfen');

      return;
    }

    const server = await this.deps.repository.findById(frame.serverId);

    if (server === null) {
      this.deps.log.warn(
        { hostId, event: frame.event, serverId: frame.serverId },
        'Agent-Ereignis für unbekannten Server verworfen',
      );

      return;
    }

    switch (frame.event) {
      case 'CRASHED':
        await this.handleCrash(server, frame);

        return;
      case 'STATS_UPDATE':
        await this.handleStatsUpdate(server, frame);

        return;
      case 'LOG_LINE':
        this.deps.events.emit('server.statusChanged', {
          serverId: server.id,
          logLine: frame.payload,
        });

        return;
      case 'STATUS_CHANGED':
        // Nur weiterreichen: Der maßgebliche Zustand steht in der Datenbank,
        // und der Container-Zustand allein entscheidet ihn nicht.
        this.deps.log.info(
          { serverId: server.id, payload: frame.payload },
          'Container-Zustand gemeldet',
        );

        return;
    }
  }

  /**
   * Absturz eines Servers (Pflichtenheft §9).
   *
   * Der Crash-Loop-Schutz entscheidet, ob automatisch neu gestartet wird. Löst
   * er aus, geht der Server nach `error` und es wird benachrichtigt.
   */
  private async handleCrash(server: ServerRecord, frame: AgentEventFrame): Promise<void> {
    const payload = frame.payload as { readonly exitCode?: number } | undefined;

    const result = await this.transitionFull(server, {
      type: 'crashed',
      reason: 'Der Server ist unerwartet beendet worden.',
      exitCode: payload?.exitCode ?? null,
    });

    this.deps.events.emit('server.crashed', {
      serverId: server.id,
      exitCode: payload?.exitCode ?? null,
      recentCrashCount: result.state.crashTimestamps.length,
    });

    if (result.crashLoopTripped) {
      await this.transition(
        { ...server, ...result.state },
        {
          type: 'failed',
          reason:
            'Der Server ist zu oft hintereinander abgestürzt. Der automatische Neustart wurde abgeschaltet.',
        },
      );
      this.deps.events.emit('server.failed', {
        serverId: server.id,
        reason: 'crashLoop',
        recentCrashCount: result.state.crashTimestamps.length,
      });

      return;
    }

    const crashed = await this.requireServer(server.id);

    await this.dispatchStart(crashed, {
      type: 'automaticRestartRequested',
      attempt: result.nextRestartAttempt,
    });
  }

  /**
   * Live-Messwerte (Pflichtenheft §5.3).
   *
   * Neben dem Weiterreichen an den Live-Kanal dient das Ereignis als
   * Aktivitätsnachweis für den Auto-Shutdown: Sind Spieler verbunden, wird der
   * Bezugspunkt des Inaktivitäts-Timeouts nachgezogen.
   */
  private async handleStatsUpdate(server: ServerRecord, frame: AgentEventFrame): Promise<void> {
    const payload = frame.payload as { readonly playersOnline?: number | null } | undefined;
    const playersOnline = payload?.playersOnline ?? null;

    if (playersOnline !== null && playersOnline > 0) {
      await this.deps.repository.update(server.id, {
        lastActivityAt: frame.emittedAt,
      });
    }

    this.deps.events.emit('server.statsUpdated', {
      serverId: server.id,
      stats: frame.payload,
    });
  }

  // -------------------------------------------------------------------------
  // Auto-Shutdown
  // -------------------------------------------------------------------------

  /**
   * Prüft alle laufenden Server einer Node auf Inaktivität (Pflichtenheft §9).
   *
   * Wird periodisch aufgerufen. Die Entscheidung selbst steht in
   * `auto-shutdown.ts`; hier wird sie nur ausgeführt.
   */
  async runAutoShutdownSweep(hostId: string): Promise<readonly string[]> {
    const servers = await this.deps.repository.listByHost(hostId);
    const shutdown: string[] = [];

    for (const server of servers) {
      const decision = decideAutoShutdown({
        settings: server.autoShutdown,
        status: server.status,
        lastStartedAt: server.lastStartedAt,
        lastActivityAt: server.lastActivityAt,
        // Ohne frische Messung wird die Spielerzahl nicht geraten: Der
        // Aktivitätszeitpunkt aus `STATS_UPDATE` ist der Bezugspunkt.
        playersOnline: null,
        now: this.now(),
      });

      if (decision.action !== 'shutdown') {
        continue;
      }

      try {
        await this.stopServer(server.id);
        this.deps.events.emit('autoShutdown.triggered', {
          serverId: server.id,
          idleMinutes: Math.round(decision.idleMinutes),
        });
        shutdown.push(server.id);
      } catch (error: unknown) {
        this.deps.log.error(
          { serverId: server.id, error: error instanceof Error ? error.message : String(error) },
          'Automatisches Abschalten fehlgeschlagen',
        );
      }
    }

    return shutdown;
  }

  // -------------------------------------------------------------------------
  // Soll/Ist-Abgleich (Pflichtenheft §2.2)
  // -------------------------------------------------------------------------

  /**
   * Gleicht den gemeldeten Ist-Zustand mit dem Soll-Zustand ab.
   *
   * Die Planung steht in `reconciliation.ts` und ist dort einzeln geprüft; hier
   * wird der Plan ausgeführt – jede Korrektur über die State Machine.
   */
  async reconcile(hostId: string, frame: AgentStateReportFrame): Promise<void> {
    // Gemessene Node-Ressourcen übernehmen (Pflichtenheft §11), falls der Agent
    // sie mitschickt. In eigenem try/catch: Ein Schreibfehler darf den
    // Soll/Ist-Abgleich nicht verhindern – der ist der eigentliche Zweck.
    if (frame.nodeStats) {
      try {
        await this.deps.repository.updateMeasuredResources(hostId, {
          ramMb: frame.nodeStats.ramTotalMb,
          cpuCores: frame.nodeStats.cpuCores,
          diskMb: frame.nodeStats.diskTotalMb,
        });
      } catch (error) {
        this.deps.log.error(
          { hostId, error: error instanceof Error ? error.message : String(error) },
          'Gemessene Node-Ressourcen konnten nicht übernommen werden',
        );
      }
    }

    const servers = await this.deps.repository.listByHost(hostId);
    const plan = planReconciliation(
      servers.map((server) => ({
        id: server.id,
        status: server.status,
        dockerContainerId: server.dockerContainerId,
      })),
      frame.containers,
    );

    this.deps.log.info(
      {
        hostId,
        reason: frame.reason,
        actions: plan.actions.length,
        unchanged: plan.unchangedServerIds.length,
      },
      'Soll/Ist-Abgleich',
    );

    for (const action of plan.actions) {
      if (action.kind === 'reportOrphan') {
        // Bewusst nur melden, nie automatisch entfernen: Ein verwaister
        // Container kann die letzte Kopie von Weltdaten enthalten.
        this.deps.log.warn(
          { hostId, containerId: action.containerId, serverId: action.serverId },
          action.reason,
        );
        continue;
      }

      const server = servers.find((candidate) => candidate.id === action.serverId);

      if (server === undefined) {
        continue;
      }

      await this.applyReconciliationAction(server, action);
    }
  }

  private async applyReconciliationAction(
    server: ServerRecord,
    action: Exclude<
      ReturnType<typeof planReconciliation>['actions'][number],
      { kind: 'reportOrphan' }
    >,
  ): Promise<void> {
    try {
      switch (action.kind) {
        case 'markCrashed':
          await this.handleCrash(server, {
            kind: 'event',
            event: 'CRASHED',
            serverId: server.id,
            payload: { exitCode: action.exitCode },
            emittedAt: this.now().toISOString(),
          });

          return;
        case 'markStopped':
          await this.transition(server, { type: 'observedStopped', reason: action.reason });
          this.deps.events.emit('server.stopped', { serverId: server.id, reason: action.reason });

          return;
        case 'markMissing':
        case 'markCreateInterrupted':
          await this.transition(server, { type: 'failed', reason: action.reason });
          this.deps.events.emit('server.failed', {
            serverId: server.id,
            reason: action.reason,
          });

          return;
        case 'verifyHealth':
          // Der Container läuft – ob der Server auch antwortet, entscheidet der
          // Health-Check, nicht der Abgleich (Pflichtenheft §9).
          if (server.status !== 'starting') {
            await this.transition(server, { type: 'startRequested' });
          }

          await this.awaitStartupHealth(server.id);

          return;
      }
    } catch (error: unknown) {
      this.deps.log.error(
        {
          serverId: server.id,
          action: action.kind,
          error: error instanceof Error ? error.message : String(error),
        },
        'Korrektur aus dem Soll/Ist-Abgleich fehlgeschlagen',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Hilfsmittel
  // -------------------------------------------------------------------------

  /**
   * Wendet ein Ereignis an und schreibt den neuen Zustand fort.
   *
   * `repository` erlaubt es, den Schreibvorgang gegen ein transaktionsgebundenes
   * Repository laufen zu lassen – gebraucht für den Wechsel auf `starting`
   * innerhalb der Kapazitätsreservierung (Punkt 98). Ohne Angabe schreibt der
   * Dienst wie bisher gegen sein Standard-Repository.
   */
  private async transition(
    server: ServerRecord,
    event: ServerLifecycleEvent,
    repository: ServerRepository = this.deps.repository,
  ): Promise<ServerLifecycleState> {
    const result = await this.transitionFull(server, event, repository);

    return result.state;
  }

  private async transitionFull(
    server: ServerRecord,
    event: ServerLifecycleEvent,
    repository: ServerRepository = this.deps.repository,
  ): Promise<ReturnType<typeof applyLifecycleEvent>> {
    const result = applyLifecycleEvent(
      {
        status: server.status,
        statusMessage: server.statusMessage,
        statusChangedAt: server.statusChangedAt,
        lastStartedAt: server.lastStartedAt,
        crashTimestamps: server.crashTimestamps,
      },
      event,
      { now: this.now(), crashLoopPolicy: this.deps.config.crashLoopPolicy },
    );

    await repository.persistLifecycle(server.id, result.state);

    this.deps.events.emit('server.statusChanged', {
      serverId: server.id,
      from: server.status,
      to: result.state.status,
      statusMessage: result.state.statusMessage,
    });

    return result;
  }

  private requireContainerId(server: ServerRecord): string {
    if (server.dockerContainerId === null) {
      throw new ServerOrchestrationError(
        'SERVER_STATE_CONFLICT',
        'Für diesen Server existiert auf dem Homeserver kein Container.',
        { serverId: server.id },
      );
    }

    return server.dockerContainerId;
  }

  private async requireLiveTarget(serverId: string): Promise<{
    server: ServerRecord;
    session: AgentSession;
    containerId: string;
  }> {
    const server = await this.requireServer(serverId);

    return {
      server,
      session: this.deps.agents.require(server.hostId),
      containerId: this.requireContainerId(server),
    };
  }

  private async resolveHost(hostId?: string): Promise<{ id: string }> {
    if (hostId !== undefined) {
      const host = await this.deps.repository.findHost(hostId);

      if (host === null) {
        throw new ServerOrchestrationError(
          'SERVER_NOT_FOUND',
          'Die angegebene Node existiert nicht.',
          { hostId },
        );
      }

      return host;
    }

    const host = await this.deps.repository.defaultHost();

    if (host === null) {
      throw new ServerOrchestrationError(
        'AGENT_NOT_CONNECTED',
        'Es ist keine Node eingerichtet. Bitte zuerst die Ersteinrichtung ausführen (pnpm --filter @palantir/backend db:seed).',
      );
    }

    return host;
  }

  /** Verbindungsadresse eines Servers (Pflichtenheft §13). */
  addressFor(server: ServerRecord): { hostname: string; port: number | null } {
    const definition = this.deps.registry.require(server.gameType);

    return {
      hostname: this.hostnameFor(server),
      port: visiblePortOf(server.assignedPorts, definition.supportsVirtualHostRouting),
    };
  }
}
