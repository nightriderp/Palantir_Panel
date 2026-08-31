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

import path from 'node:path';
import {
  type AgentContainerStats,
  type ServerCloneJobDto,
  type ServerStatsHistoryDto,
  type AgentEventFrame,
  type AgentServerQueryTarget,
  type AgentStateReportFrame,
  type ExecConsoleCommandResult,
  type GetLogsCommandResult,
  type GameConfigValues,
  type ServerFileContentDto,
  type ServerFileListDto,
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
import { randomUUID } from 'node:crypto';
import { type DnsProvider } from './dns/types.js';
import { type CloneJobProgress, type CloneJobStore, createCloneJobStore } from './clone-jobs.js';
import { ServerOrchestrationError } from './errors.js';
import {
  LatestQueryCache,
  type ServerStatsRepository,
  type StatsSample,
  toStatsHistoryDto,
} from './stats-history.js';
import { type WorldArchiveStore } from './world-import.js';

/**
 * Verweis auf ein hochgeladenes Weltdaten-Archiv (P4).
 *
 * Aus `CreateServerInput` abgeleitet statt eigenständig deklariert – die
 * Eingabe ist der Vertrag, eine zweite Formulierung könnte davon abweichen.
 */
type WorldImportInput = NonNullable<CreateServerInput['worldImport']>;
import {
  AGENT_FILE_CHANNEL_MAX_BYTES,
  normalizeRelativePath,
  parentPathOf,
  toContainerPath,
  toServerFileContentDto,
  toServerFileListDto,
} from './files.js';
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
import {
  consoleLineFromAgentPayload,
  containerIdFromPayload,
  isServerQueryPayload,
  liveStatsFromAgentPayload,
  querySnapshotFromPayload,
} from './live-events.js';
import { planReconciliation } from './reconciliation.js';
import { type HostNodeRecord, type ServerRecord, type ServerRepository } from './repository.js';
import { type ServerAutoShutdown } from './types.js';
import {
  type ServerLifecycleEvent,
  type ServerLifecycleState,
  applyLifecycleEvent,
  assertTransitionAllowed,
} from './state-machine.js';
import { normalizeSubdomain, resolveAvailableSubdomain } from './subdomain.js';

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
  /**
   * Frist für das `CREATE` am Agent (Gefundener Punkt 111).
   *
   * Deutlich länger als die übliche Befehlsfrist: Fehlt das Image auf der Node,
   * holt der Agent es beim Anlegen selbst, und ein Spiel-Image bringt Hunderte
   * MB mit.
   */
  readonly createTimeoutMs: number;
  readonly defaultAutoShutdown: ServerAutoShutdown;
  /**
   * Maximale Upload-Größe pro Datei aus `MAX_UPLOAD_SIZE_BYTES` (Pflichtenheft
   * §12.1). Wirksam ist der kleinere Wert aus dieser Angabe und
   * `AGENT_FILE_CHANNEL_MAX_BYTES`.
   */
  readonly maxUploadBytes: number;
  /**
   * Maximale Größe eines Weltdaten-Archivs aus `MAX_WORLD_ARCHIVE_BYTES` (P4).
   * Wirksam ist der kleinere Wert aus dieser Angabe und
   * `AGENT_FILE_CHANNEL_MAX_BYTES`.
   */
  readonly maxWorldArchiveBytes: number;
  /** Aufbewahrungsfrist des Messwert-Verlaufs in Stunden (`STATS_HISTORY_RETENTION_HOURS`). */
  readonly statsHistoryRetentionHours: number;
  /**
   * Abstand zweier Stichproben in Millisekunden – der Takt des Zeitgebers
   * (`SCHEDULER_INTERVAL_MS`). Steht im DTO, damit das Diagramm Lücken erkennt.
   */
  readonly statsSampleIntervalMs: number;
}

/** Was die Datei-Routen aus dem `permissions`-Objekt des Servers mitgeben. */
export interface ServerFileAccessOptions {
  /** Darf der Aufrufer schreiben (`canManageFiles`)? Steht so im DTO. */
  readonly writable: boolean;
}

export interface ServerFileUploadOptions extends ServerFileAccessOptions {
  /** Vorhandene Datei am Zielpfad ersetzen; ohne Angabe lehnt der Agent ab. */
  readonly overwrite?: boolean;
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
  /**
   * Zwischenspeicher der hochgeladenen Weltdaten-Archive (P4).
   *
   * Ohne Angabe bleibt `worldImport` beim Anlegen wirkungslos – so bleiben die
   * bestehenden Tests unverändert, die das Anlegen ohne Import prüfen.
   */
  readonly worldArchives?: WorldArchiveStore;
  /**
   * Ablage des Messwert-Verlaufs (P5).
   *
   * Ohne Angabe wird nichts festgehalten – so bleiben die bestehenden Tests
   * unverändert, die den Lifecycle ohne Verlauf prüfen.
   */
  readonly statsHistory?: ServerStatsRepository;
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
  /**
   * Zuletzt gemeldete Server-Abfrage je Server (Spielerzahl, Antwortzeit).
   *
   * Als aktuell gilt eine Meldung, solange sie jünger ist als die doppelte
   * Aufbewahrungs-Abtastung – hier schlicht fünf Minuten: Danach ist eine
   * Spielerzahl im Minutenverlauf eine Zeile, die nie stimmt (siehe
   * `stats-history.ts`).
   */
  private readonly latestQuery = new LatestQueryCache(5 * 60 * 1000);
  /**
   * Laufende und kürzlich beendete Klon-Aufträge (P7).
   *
   * Im Dienst und nicht in den Abhängigkeiten: Ein Auftrag beschreibt einen
   * Vorgang **dieses** Prozesses; ein zweiter Speicher daneben wäre eine zweite
   * Wahrheit über denselben Lauf.
   */
  private readonly cloneJobs: CloneJobStore;

  constructor(deps: OrchestrationDependencies) {
    this.deps = deps;
    this.now = deps.now ?? ((): Date => new Date());
    this.reservation =
      deps.reservation ?? createInlineCapacityReservation(deps.resources, deps.repository);
    this.cloneJobs = createCloneJobStore({ now: this.now });
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

    try {
      await this.provision(await this.requireServer(created.id), input.worldImport);
    } catch (error: unknown) {
      /*
       * Aufräumen, statt eine Leiche stehen zu lassen (WORK_STATUS.md,
       * Gefundener Punkt 112). Ohne das blieb nach einem gescheiterten Anlegen
       * ein Datensatz auf `error` zurück – samt belegter Subdomain und
       * belegten Ports. Der zweite Versuch mit derselben Adresse lief dann in
       * „Diese Subdomain ist bereits vergeben", und der Nutzer musste erst von
       * Hand löschen. Geräumt wird nur, solange nie ein Container entstand –
       * die Begründung steht an `rollbackFailedCreate()`.
       *
       * Der Fehler selbst geht weiter nach oben: Er ist die Antwort auf den
       * Anlegen-Versuch, und `server.failed` ist bereits gemeldet.
       */
      await this.rollbackFailedCreate(created.id);

      throw error;
    }

    return this.requireServer(created.id);
  }

  /**
   * Reste eines gescheiterten Anlegens entfernen.
   *
   * Jeder Schritt für sich abgesichert: Was hier scheitert, darf den
   * eigentlichen Fehler nicht verdecken. Ein Rest, der liegen bleibt, wird
   * protokolliert – der Speicher-Explorer (B8) findet ihn als verwaisten
   * Posten, und die Subdomain ist in jedem Fall wieder frei, sobald der
   * Datensatz weg ist.
   */
  private async rollbackFailedCreate(serverId: string): Promise<void> {
    const server = await this.deps.repository.findById(serverId);

    if (server === null) {
      return;
    }

    /*
     * Nur aufräumen, solange nie ein Container entstanden ist.
     *
     * Scheitert erst ein späterer Schritt – etwa die Weltdaten-Übernahme (P4) –,
     * liegt auf der Node bereits ein Container samt Datenordner. Den still
     * wegzuräumen hieße, einen halb übernommenen Spielstand ohne Rückfrage zu
     * löschen. Dann bleibt es beim bisherigen Verhalten: Der Server steht auf
     * `error` und wird im Panel bewusst entfernt.
     */
    if (server.dockerContainerId !== null) {
      return;
    }

    const aufraeumen = async (was: string, schritt: () => Promise<unknown>): Promise<void> => {
      try {
        await schritt();
      } catch (error: unknown) {
        this.deps.log.warn(
          { serverId, schritt: was, error: error instanceof Error ? error.message : String(error) },
          'Rest eines gescheiterten Anlegens konnte nicht entfernt werden',
        );
      }
    };

    await aufraeumen('dns', () => this.deps.dns.deleteRecord(this.hostnameFor(server)));
    await aufraeumen('ports', () => this.deps.ports.release(serverId));
    // Zuletzt der Datensatz: Solange er steht, sind Subdomain und Ports belegt.
    await aufraeumen('datensatz', () => this.deps.repository.delete(serverId));
  }

  /**
   * DNS-Eintrag und Container anlegen.
   *
   * Ausgelagert, weil das Klonen dieselbe Kette braucht.
   */
  private async provision(
    server: ServerRecord,
    worldImport: WorldImportInput | null = null,
  ): Promise<void> {
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

      const created = await session.sendCommand(
        'CREATE',
        server.id,
        {
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
        },
        /*
         * Eigene Frist: Fehlt das Image auf der Node, holt der Agent es beim
         * Anlegen selbst (Gefundener Punkt 111) – das dauert bei einem
         * Spiel-Image Minuten, nicht Sekunden.
         */
        { timeoutMs: this.deps.config.createTimeoutMs },
      );

      await this.deps.repository.update(server.id, {
        dnsRecordId,
        dockerContainerId: created.containerId,
      });

      // Weltdaten übernehmen, solange der Server noch als „wird angelegt" gilt
      // (P4). Bewusst hier und nicht danach: Scheitert der Import, ist der
      // Server nicht „fertig, nur ohne Welt", sondern fehlgeschlagen – ein
      // leerer Server unter dem Namen eines übernommenen wäre die schlechtere
      // Antwort. Der Container läuft dafür nicht; geschrieben wird über den
      // Archiv-Endpunkt der Engine, der auch bei gestopptem Container arbeitet.
      if (worldImport !== null) {
        await this.importWorldData(server, created.containerId, worldImport);
      }

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

    // Verfügbarkeit der Ziel-Node vor der Kapazitätsprüfung: Eine Node in
    // `maintenance` hat volle freie Kapazität und käme durch die Rechnung aus
    // B4 anstandslos durch (WORK_STATUS.md, Gefundener Punkt 24).
    await this.requireNodeAcceptsStarts(server.hostId);

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
   * Nimmt die Ziel-Node gerade neue Arbeit an? (`HostNode.status`,
   * Pflichtenheft §6 und §9, WORK_STATUS.md Gefundene Punkte 24 und 109.)
   *
   * Nur `online` nimmt an – beim Anlegen wie beim Starten. `maintenance` ist
   * eine bewusst stillgelegte Node: Sie hat volle freie Kapazität und würde die
   * Prüfung aus B4 (§10) deshalb immer bestehen; das ist eine
   * Verfügbarkeitsfrage des Lifecycles und keine Ressourcenrechnung. `offline`
   * fängt in der Praxis schon `agents.require()` ab, wird hier aber mit
   * abgedeckt, damit die Antwort nicht von der Reihenfolge der Prüfungen
   * abhängt.
   *
   * Bewusst **nicht** im automatischen Neustart nach einem Absturz
   * (`dispatchStart`): Dort geht es nicht darum, eine stillgelegte Node neu zu
   * belegen, sondern einen bereits dort laufenden Server wieder hochzubringen.
   */
  private assertNodeAcceptsWork(host: HostNodeRecord, intent: 'create' | 'start'): void {
    if (host.status === 'online') {
      return;
    }

    throw new ServerOrchestrationError(
      'NODE_UNAVAILABLE',
      host.status === 'maintenance'
        ? `„${host.name}" ist gerade in Wartung und nimmt ${
            intent === 'start' ? 'keine Serverstarts' : 'keine neuen Server'
          } an.`
        : `„${host.name}" ist gerade nicht erreichbar.`,
      { hostId: host.id, nodeStatus: host.status },
    );
  }

  private async requireNodeAcceptsStarts(hostId: string): Promise<void> {
    const host = await this.deps.repository.findHost(hostId);

    if (!host) {
      throw new ServerOrchestrationError('NODE_NOT_FOUND', undefined, { hostId });
    }

    this.assertNodeAcceptsWork(host, 'start');
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
  /**
   * Ziel für die periodische Server-Abfrage des Agents
   * (`SET_SERVER_QUERY`, WORK_STATUS.md Gefundener Punkt 74).
   *
   * Der Agent kennt keine Spiele und errät nichts: Abfrageart und Port kommen
   * aus der Spiele-Definition und der Portvergabe. `null`, solange der Server
   * keinen Container oder keinen primären Port hat – dann gibt es nichts
   * abzufragen.
   *
   * Als Adresse bleibt die Vorgabe des Agents (`127.0.0.1`): Die Portbindung
   * liegt auf dem Homeserver selbst, im LAN lauscht nichts (Pflichtenheft §18).
   */
  private queryTargetFor(server: ServerRecord): AgentServerQueryTarget | null {
    if (server.dockerContainerId === null) {
      return null;
    }

    const definition = this.deps.registry.require(server.gameType);
    // Der Agent prüft auf dem Host-Port, unter dem der Container veröffentlicht
    // ist – nicht auf dem Port im Container. Genau diesen Wert bekommt auch
    // `CREATE_CONTAINER` als `hostPort`.
    const hostPort = server.assignedPorts.find((zuweisung) => zuweisung.primary)?.publicPort;

    if (hostPort === undefined) {
      return null;
    }

    return {
      containerId: server.dockerContainerId,
      hostPort,
      query:
        definition.query.kind === 'gamedig'
          ? { kind: 'gamedig', protocol: definition.query.protocol }
          : { kind: 'portConnect' },
    };
  }

  /**
   * Periodische Abfrage für einen Server setzen oder beenden.
   *
   * `active: false` schickt `target: null` – der Agent stellt die Abfrage dann
   * ein. Beides ist idempotent und darf wiederholt werden.
   *
   * **Scheitert bewusst leise.** Die Abfrage liefert Spielerzahl und
   * Antwortzeit; sie ist eine Zutat zur Anzeige, kein Teil des Lifecycles. Ein
   * Serverstart darf nicht daran scheitern, dass der Agent den Zusatzbefehl
   * nicht annimmt – gemeldet wird er trotzdem, sonst sucht später niemand die
   * fehlenden Messwerte.
   */
  private async applyServerQuery(server: ServerRecord, active: boolean): Promise<void> {
    const session = this.deps.agents.get(server.hostId);

    if (session === null) {
      return;
    }

    const target = active ? this.queryTargetFor(server) : null;

    if (active && target === null) {
      return;
    }

    try {
      await session.sendCommand('SET_SERVER_QUERY', server.id, { serverId: server.id, target });
    } catch (error: unknown) {
      this.deps.log.warn(
        {
          serverId: server.id,
          aktiv: active,
          error: error instanceof Error ? error.message : String(error),
        },
        'Server-Abfrage konnte nicht gesetzt werden',
      );
    }
  }

  /**
   * Abfragen aller laufenden Server einer Node neu setzen.
   *
   * Der Aufruf gehört an jeden Verbindungsaufbau des Agents: Er hält seine
   * Ziele im Arbeitsspeicher und hat sie nach einem Neustart vergessen. Der
   * Befehl ist idempotent, ein zweites Setzen desselben Ziels also folgenlos.
   */
  async refreshServerQueries(hostId: string): Promise<readonly string[]> {
    const gesetzt: string[] = [];

    for (const server of await this.deps.repository.listByHost(hostId)) {
      if (server.status !== 'running' && server.status !== 'starting') {
        continue;
      }

      await this.applyServerQuery(server, true);
      gesetzt.push(server.id);
    }

    return gesetzt;
  }

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

    // Periodische Abfrage einsetzen (Gefundener Punkt 74). Ohne sie meldet der
    // Agent nie ein `STATS_UPDATE` aus der Server-Abfrage, und Spielerzahl,
    // Antwortzeit und der Spieler-Verlauf bleiben dauerhaft leer.
    await this.applyServerQuery({ ...server, ...started }, true);

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
      // Abfrage beenden, bevor der Zustand wechselt: Ein gestoppter Server
      // antwortet nicht mehr, und jede weitere Abfrage wäre nur ein Fehlschlag
      // im Log (Gefundener Punkt 74).
      await this.applyServerQuery(server, false);
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
      // Erst die Abfrage einstellen, dann den Container entfernen: Sonst fragt
      // der Agent weiter einen Port ab, hinter dem nichts mehr steht
      // (Gefundener Punkt 74).
      await this.applyServerQuery(server, false);
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
   * Übernimmt ein hochgeladenes Weltdaten-Archiv in den frischen Datenordner
   * (Lastenheft §3.3 „Migration von anderen Hosting-Anbietern", P4).
   *
   * Das Archiv liegt seit dem Wizard-Schritt auf der VPS (`world-import.ts`)
   * und wird hier **einmalig** abgeholt. Entpackt wird es auf dem Homeserver:
   * Der Agent liest es, prüft jeden Eintrag gegen den Datenordner und legt die
   * Dateien über den Archiv-Endpunkt der Engine ab (`FILE_EXTRACT`). Das
   * Backend fasst dabei kein Dateisystem an – der einzige Weg auf das
   * Datenvolume bleibt der Agent (CLAUDE.md §4).
   */
  private async importWorldData(
    server: ServerRecord,
    containerId: string,
    worldImport: WorldImportInput,
  ): Promise<void> {
    const store = this.deps.worldArchives;

    if (store === undefined) {
      throw new ServerOrchestrationError(
        'WORLD_ARCHIVE_NOT_FOUND',
        'Für Weltdaten-Übernahmen ist kein Zwischenspeicher eingerichtet.',
        { serverId: server.id },
      );
    }

    const archiv = await store.take(worldImport.uploadId);

    if (archiv === null) {
      throw new ServerOrchestrationError('WORLD_ARCHIVE_NOT_FOUND', undefined, {
        serverId: server.id,
        uploadId: worldImport.uploadId,
      });
    }

    const grenze = Math.min(this.deps.config.maxWorldArchiveBytes, AGENT_FILE_CHANNEL_MAX_BYTES);

    if (archiv.content.byteLength > grenze) {
      throw new ServerOrchestrationError(
        'FILE_TOO_LARGE',
        `Das Archiv überschreitet die zulässige Größe von ${String(grenze)} Byte.`,
        { serverId: server.id, sizeBytes: archiv.content.byteLength },
      );
    }

    const session = this.deps.agents.require(server.hostId);
    const ergebnis = await session.sendCommand('FILE_EXTRACT', server.id, {
      containerId,
      // Wurzel des Datenordners – ein Weltarchiv bringt seine eigene
      // Ordnerstruktur mit.
      path: '',
      contentBase64: archiv.content.toString('base64'),
      format: archiv.format,
    });

    this.deps.log.info(
      {
        serverId: server.id,
        fileName: worldImport.fileName,
        fileCount: ergebnis.fileCount,
        extractedBytes: ergebnis.extractedBytes,
        skipped: ergebnis.skipped,
      },
      'Weltdaten übernommen',
    );
  }

  /**
   * Klont einen Server (Pflichtenheft §9, Lastenheft §3.3).
   *
   * „Erzeugt einen neuen `GameServer`-Datensatz mit kopierter Konfiguration und
   * zwingend neuer, eigener Subdomain (gleiche Prüf-/Formatregeln wie bei
   * Neuerstellung); Weltdaten werden optional mitkopiert, Fortschritt wird im
   * Frontend angezeigt."
   *
   * **Auftrag statt langer Antwort (P7).** Der Aufruf liefert sofort den
   * `ServerCloneJobDto`; die eigentliche Arbeit läuft im Hintergrund weiter und
   * meldet sich über `serverClone.progressed`. Vorher gab dieselbe Methode erst
   * nach dem vollständigen Anlegen einen Serverdatensatz zurück – bei einer
   * mitkopierten Welt wären das Minuten mit offener Verbindung, und das
   * Frontend erwartete ohnehin schon den Auftrag.
   *
   * Die neue Subdomain ist Pflicht und durchläuft dieselbe Prüfkette –
   * `createServerInternal()` wird dafür bewusst wiederverwendet. Eine bereits
   * vergebene Subdomain fällt deshalb **vor** dem Auftrag auf und wird als
   * Fehler beantwortet, nicht als fehlgeschlagener Auftrag: Ein Auftrag, der
   * nie eine Chance hatte, wäre nur ein Umweg zur selben Meldung.
   */
  async cloneServer(
    sourceServerId: string,
    input: CloneServerInput,
    ownerId: string,
  ): Promise<ServerCloneJobDto> {
    const source = await this.requireServer(sourceServerId);

    // Vorab dieselbe Prüfung, die `createServerInternal()` gleich noch einmal
    // macht: Sie ist die einzige, die schon feststeht, bevor irgendetwas läuft.
    if (await this.deps.repository.isSubdomainTaken(normalizeSubdomain(input.subdomain))) {
      throw new ServerOrchestrationError('SUBDOMAIN_TAKEN', undefined, {
        subdomain: input.subdomain,
      });
    }

    const job = this.cloneJobs.create({
      sourceServerId,
      targetName: input.name,
      targetSubdomain: input.subdomain,
      includeWorldData: input.includeWorldData,
    });

    this.publishCloneJob(job);

    // Bewusst nicht abgewartet: Der Aufrufer bekommt den Auftrag sofort. Der
    // Hintergrundlauf fängt jeden Fehler selbst ab und schreibt ihn in den
    // Auftrag – eine unbehandelte Ablehnung würde nur im Log landen.
    void this.runCloneJob(job.id, source, input, ownerId);

    return job;
  }

  /** Stand eines Klon-Auftrags (Route `GET /api/servers/:id/clone/:jobId`). */
  findCloneJob(sourceServerId: string, jobId: string): ServerCloneJobDto | null {
    const job = this.cloneJobs.find(jobId);

    // Ein Auftrag an einem anderen Server wird wie ein fehlender gemeldet – die
    // Antwort soll nicht verraten, was an fremden Servern läuft.
    return job !== null && job.serverId === sourceServerId ? job : null;
  }

  /** Meldet den Auftragsstand an den Live-Kanal (Contract `serverClone.progressed`). */
  private publishCloneJob(job: ServerCloneJobDto): void {
    this.deps.events.emit('serverClone.progressed', { serverId: job.serverId, job });
  }

  private advanceCloneJob(jobId: string, progress: CloneJobProgress): void {
    const job = this.cloneJobs.update(jobId, progress);

    if (job !== null) {
      this.publishCloneJob(job);
    }
  }

  /**
   * Der eigentliche Klon-Lauf.
   *
   * Fehler beenden den Auftrag mit `failed` und einem Text, statt zu werfen:
   * Auf diesen Aufruf wartet niemand mehr.
   */
  private async runCloneJob(
    jobId: string,
    source: ServerRecord,
    input: CloneServerInput,
    ownerId: string,
  ): Promise<void> {
    try {
      this.advanceCloneJob(jobId, {
        status: 'running',
        progressPercent: 5,
        step: 'Server wird angelegt',
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

      this.advanceCloneJob(jobId, {
        targetServerId: clone.id,
        progressPercent: input.includeWorldData ? 30 : 90,
        step: input.includeWorldData ? 'Weltdaten werden gesichert' : 'Klon wird abgeschlossen',
      });

      if (input.includeWorldData) {
        await this.copyWorldData(
          jobId,
          source,
          await this.requireServer(clone.id),
          input.stopSourceServer === true,
        );
      }

      this.deps.events.emit('server.cloned', {
        sourceServerId: source.id,
        serverId: clone.id,
        copiedWorldData: input.includeWorldData,
      });

      const fertig = this.cloneJobs.finish(jobId, 'completed');

      if (fertig !== null) {
        this.publishCloneJob(fertig);
      }
    } catch (error: unknown) {
      const grund = error instanceof Error ? error.message : 'Unbekannter Fehler.';
      const gescheitert = this.cloneJobs.finish(jobId, 'failed', grund);

      this.deps.log.error(
        { jobId, sourceServerId: source.id, error: grund },
        'Klon fehlgeschlagen',
      );

      if (gescheitert !== null) {
        this.publishCloneJob(gescheitert);
      }
    }
  }

  /**
   * Kopiert die Weltdaten in den Klon (Lastenheft §3.3, Arbeitspaket P7).
   *
   * **Über die vorhandene Backup-Mechanik, nicht über einen neuen Befehl.** Der
   * Datenordner wird auf dem Homeserver gepackt (`CREATE_BACKUP`), in den
   * Datenordner des Klons entpackt (`RESTORE_BACKUP`) und das Zwischenarchiv
   * wieder entfernt (`DELETE_BACKUP`). Alle drei Befehle sind seit A3 umgesetzt;
   * ein eigener Kopier-Befehl wäre eine vierte Art, dieselbe Dateisystemarbeit
   * zu beschreiben (CLAUDE.md §3). Der Umweg über das Archiv bringt außerdem die
   * Prüfsumme mit: `RESTORE_BACKUP` vergleicht sie, bevor es etwas schreibt
   * (Fundpunkt 99).
   *
   * **Der Quellserver wird nicht angehalten.** Er gehört dem Nutzer und läuft
   * womöglich mit Spielern darauf; ihn für einen Klon abzuschalten wäre ein
   * Eingriff, um den niemand gebeten hat. Die Kopie entspricht damit einer
   * Sicherung im laufenden Betrieb – dieselbe Einschränkung, die
   * `BackupDto.containerStopped` beschreibt.
   *
   * Das Zwischenarchiv wird auch dann entfernt, wenn das Zurückspielen
   * scheitert: Sonst bliebe eine vollständige Kopie der Welt ohne Besitzer auf
   * der Platte liegen.
   */
  private async copyWorldData(
    jobId: string,
    source: ServerRecord,
    clone: ServerRecord,
    stopSource: boolean,
  ): Promise<void> {
    const session = this.deps.agents.require(source.hostId);
    const archivId = randomUUID();

    /*
     * `stopContainer` kommt aus der Anfrage (`stopSourceServer`, Gefundener
     * Punkt 107): Ein laufender Spielserver schreibt weiter in die Dateien, die
     * gerade gepackt werden, und die Kopie enthielte dann einen halb
     * geschriebenen Spielstand. Angehalten wird nur auf ausdrücklichen Wunsch –
     * den Server eines Nutzers ungefragt abzuschalten wäre ein Eingriff, um den
     * niemand gebeten hat. Der Agent versetzt den Container danach in seinen
     * vorherigen Zustand zurück (`backup-job.ts`).
     */
    const gesichert = await session.sendCommand('CREATE_BACKUP', source.id, {
      backupId: archivId,
      serverId: source.id,
      sourcePath: dataHostPathFor(source.id),
      ...(source.dockerContainerId === null ? {} : { containerId: source.dockerContainerId }),
      stopContainer: stopSource,
    });

    this.advanceCloneJob(jobId, {
      progressPercent: 60,
      step: gesichert.containerStopped
        ? 'Weltdaten werden übertragen (Quellserver angehalten)'
        : 'Weltdaten werden übertragen',
      totalBytes: gesichert.sizeBytes,
    });

    try {
      await session.sendCommand('RESTORE_BACKUP', clone.id, {
        backupId: archivId,
        serverId: clone.id,
        storagePath: gesichert.storagePath,
        targetPath: dataHostPathFor(clone.id),
        expectedChecksum: gesichert.checksumSha256,
        ...(clone.dockerContainerId === null ? {} : { containerId: clone.dockerContainerId }),
      });
    } finally {
      try {
        await session.sendCommand('DELETE_BACKUP', source.id, {
          backupId: archivId,
          storagePath: gesichert.storagePath,
        });
      } catch (error: unknown) {
        // Ein liegengebliebenes Zwischenarchiv ist ärgerlich, aber kein Grund,
        // einen sonst gelungenen Klon als gescheitert zu melden. Der
        // Speicher-Explorer (B8) findet es als verwaisten Posten.
        this.deps.log.warn(
          {
            sourceServerId: source.id,
            storagePath: gesichert.storagePath,
            error: error instanceof Error ? error.message : String(error),
          },
          'Zwischenarchiv des Klons konnte nicht entfernt werden',
        );
      }
    }

    this.advanceCloneJob(jobId, {
      progressPercent: 90,
      step: 'Klon wird abgeschlossen',
      copiedBytes: gesichert.sizeBytes,
    });
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

  // -------------------------------------------------------------------------
  // Datei-Manager (Arbeitspaket P2, Lastenheft §3.3)
  // -------------------------------------------------------------------------
  //
  // Alle Methoden hier nehmen Pfade **relativ zum Datenordner** entgegen – so,
  // wie das Frontend sie kennt – und übersetzen sie in `files.ts` in absolute
  // Container-Pfade. Ein Ausbruch aus dem Datenordner scheitert damit schon im
  // Backend; der Agent prüft dieselbe Grenze noch einmal (`resolveWithinRoot`).

  /** Verzeichnisinhalt als DTO, samt der geltenden Grenzen. */
  async listFiles(
    serverId: string,
    relativePath: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileListDto> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = normalizeRelativePath(relativePath);

    const result = await session.sendCommand('FILE_LIST', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
    });

    return toServerFileListDto(server.id, dataRoot, relativ, result.entries, {
      writable: options.writable,
      maxUploadBytes: this.maxUploadBytes(),
    });
  }

  /** Dateiinhalt für den eingebauten Editor. */
  async readFile(
    serverId: string,
    relativePath: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileContentDto> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = this.requireFilePath(relativePath);

    const result = await session.sendCommand('FILE_READ', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
    });
    const content = Buffer.from(result.contentBase64, 'base64');

    return toServerFileContentDto(
      server.id,
      relativ,
      content,
      await this.fileModifiedAt(server.id, relativ),
      options.writable,
    );
  }

  /**
   * Datei aus dem Editor zurückschreiben.
   *
   * Überschreibt still – anders als {@link uploadFile}. Das ist gewollt: Hier
   * wird genau die Datei gespeichert, die der Nutzer vorher geöffnet hat.
   */
  async writeFile(
    serverId: string,
    relativePath: string,
    content: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileContentDto> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = this.requireFilePath(relativePath);
    const inhalt = Buffer.from(content, 'utf8');

    this.assertWithinTransferLimit(inhalt.byteLength);

    await session.sendCommand('FILE_WRITE', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
      contentBase64: inhalt.toString('base64'),
    });

    return toServerFileContentDto(
      server.id,
      relativ,
      inhalt,
      await this.fileModifiedAt(server.id, relativ),
      options.writable,
    );
  }

  /**
   * Hochgeladene Datei im Zielordner ablegen.
   *
   * Einziger Unterschied zu {@link writeFile}: Der Agent prüft den Zielpfad vor
   * dem Schreiben und lehnt einen belegten Pfad ohne `overwrite` mit
   * `AGENT_FILE_EXISTS` (409) ab. Ein Upload legt eine neue Datei an – dass
   * dabei unbemerkt eine gleichnamige verschwindet, wäre Datenverlust ohne
   * Rückfrage.
   *
   * @returns Der Inhalt des Zielordners nach dem Upload.
   */
  async uploadFile(
    serverId: string,
    directoryPath: string,
    fileName: string,
    content: Buffer,
    options: ServerFileUploadOptions,
  ): Promise<ServerFileListDto> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const verzeichnis = normalizeRelativePath(directoryPath);
    const ziel = this.requireFilePath(path.posix.join(verzeichnis, fileName));

    this.assertWithinTransferLimit(content.byteLength);

    await session.sendCommand('FILE_UPLOAD', server.id, {
      containerId,
      path: toContainerPath(dataRoot, ziel),
      contentBase64: content.toString('base64'),
      ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    });

    return this.listFiles(server.id, verzeichnis, { writable: options.writable });
  }

  /** Datei oder Verzeichnis entfernen; ein bereits fehlender Pfad ist kein Fehler. */
  async deleteFile(serverId: string, relativePath: string, recursive = true): Promise<void> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = this.requireFilePath(relativePath);

    await session.sendCommand('FILE_DELETE', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
      recursive,
    });
  }

  /** Eine einzelne Datei zum Herunterladen laden (Grenze: {@link AGENT_FILE_CHANNEL_MAX_BYTES}). */
  async downloadFile(
    serverId: string,
    relativePath: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = this.requireFilePath(relativePath);

    const result = await session.sendCommand('FILE_READ', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
    });

    return {
      fileName: path.posix.basename(relativ),
      content: Buffer.from(result.contentBase64, 'base64'),
    };
  }

  /** Tatsächlich zulässige Upload-Größe: der kleinere der beiden Werte. */
  private maxUploadBytes(): number {
    return Math.min(this.deps.config.maxUploadBytes, AGENT_FILE_CHANNEL_MAX_BYTES);
  }

  private assertWithinTransferLimit(sizeBytes: number): void {
    if (sizeBytes > this.maxUploadBytes()) {
      throw new ServerOrchestrationError(
        'FILE_TOO_LARGE',
        'Die Datei überschreitet die zulässige Upload-Größe.',
        { sizeBytes, maxBytes: this.maxUploadBytes() },
      );
    }
  }

  /** Wie {@link normalizeRelativePath}, lehnt aber zusätzlich die Wurzel ab. */
  private requireFilePath(relativePath: string): string {
    const relativ = normalizeRelativePath(relativePath);

    if (relativ === '') {
      throw new ServerOrchestrationError(
        'AGENT_INVALID_PATH',
        'Für diesen Vorgang wird eine Datei benötigt, nicht der Datenordner selbst.',
      );
    }

    return relativ;
  }

  /**
   * Änderungszeitpunkt einer Datei – aus dem Verzeichnis, in dem sie liegt.
   *
   * `FILE_READ` liefert keinen Zeitstempel; der DTO braucht ihn (Anzeige und
   * Konflikterkennung im Editor). Statt ihn zu erfinden, wird das Verzeichnis
   * gelistet und der Eintrag herausgesucht. Findet sich keiner – etwa weil die
   * Datei zwischen beiden Aufrufen verschwindet – bleibt es beim Lesezeitpunkt.
   */
  private async fileModifiedAt(serverId: string, relativePath: string): Promise<string> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const elternPfad = parentPathOf(relativePath) ?? '';

    const result = await session.sendCommand('FILE_LIST', server.id, {
      containerId,
      path: toContainerPath(dataRoot, elternPfad),
    });
    const name = path.posix.basename(relativePath);

    return (
      result.entries.find((entry) => entry.name === name)?.modifiedAt ?? this.now().toISOString()
    );
  }

  /** Wie {@link requireLiveTarget}, zusätzlich mit dem Datenordner des Spiels. */
  private async requireFileTarget(serverId: string): Promise<{
    server: ServerRecord;
    session: AgentSession;
    containerId: string;
    dataRoot: string;
  }> {
    const ziel = await this.requireLiveTarget(serverId);

    return {
      ...ziel,
      dataRoot: this.deps.registry.require(ziel.server.gameType).dataVolumeContainerPath,
    };
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
    /*
     * Die Ereignisse der Container-Runtime tragen keine `serverId`: Die Runtime
     * kennt nur ihre Container, und der Adapter des Agents meldet deshalb
     * `null` (`runtime-adapter.ts`). Ohne die Zuordnung über die Container-Id
     * wären Konsolenzeilen und Messwerte allesamt verworfen worden – die Id
     * steht am Server-Datensatz, also wird sie hier nachgeschlagen
     * (WORK_STATUS.md, Gefundener Punkt 101).
     */
    const server =
      frame.serverId === null
        ? await this.serverForContainerEvent(hostId, frame)
        : await this.deps.repository.findById(frame.serverId);

    if (server === null) {
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
        this.handleLogLine(server, frame);

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
  /**
   * Server zu einem Ereignis ohne `serverId` über die Container-Id finden.
   *
   * Bleibt die Zuordnung offen, wird das Ereignis verworfen und einmal
   * protokolliert – geraten wird nicht.
   */
  private async serverForContainerEvent(
    hostId: string,
    frame: AgentEventFrame,
  ): Promise<ServerRecord | null> {
    const containerId = containerIdFromPayload(frame.payload);

    if (containerId === null) {
      this.deps.log.warn({ hostId, event: frame.event }, 'Agent-Ereignis ohne Server verworfen');

      return null;
    }

    const server = await this.deps.repository.findByContainerId(containerId);

    if (server === null) {
      this.deps.log.warn(
        { hostId, event: frame.event, containerId },
        'Agent-Ereignis für unbekannten Container verworfen',
      );
    }

    return server;
  }

  /**
   * Eine Konsolenzeile des Agents an den Live-Kanal geben
   * (`server.consoleLineAppended`, Gefundener Punkt 101).
   *
   * Bis hierher wurde die Nutzlast als `server.statusChanged` mit einem Feld
   * `logLine` gemeldet – ein Ereignis, dessen Vertrag das Feld nicht kennt. Der
   * Hub setzt `server.consoleLineAppended` bereits um; gefehlt hat nur die
   * richtige Meldung samt Übersetzung in eine `ServerConsoleLine`.
   */
  private handleLogLine(server: ServerRecord, frame: AgentEventFrame): void {
    const line = consoleLineFromAgentPayload(
      server.id,
      frame.payload,
      randomUUID(),
      frame.emittedAt,
    );

    if (line === null) {
      return;
    }

    this.deps.events.emit('server.consoleLineAppended', { serverId: server.id, line });
  }

  private async handleStatsUpdate(server: ServerRecord, frame: AgentEventFrame): Promise<void> {
    /*
     * Unter dem Namen `STATS_UPDATE` fließen zwei verschiedene Nutzlasten: die
     * Messwerte der Container-Runtime und das Ergebnis der Server-Abfrage. Nur
     * Letztere kennt Spielerzahl und Antwortzeit – die Container-Engine liefert
     * beides nicht. Der zuletzt gemeldete Abfragestand wird deshalb gemerkt und
     * sowohl hier als auch beim Abtasten für den Verlauf (P5) neben die
     * Engine-Werte gelegt.
     */
    if (isServerQueryPayload(frame.payload)) {
      this.latestQuery.remember(
        server.id,
        querySnapshotFromPayload(frame.payload),
        new Date(frame.emittedAt),
      );
    }

    const stats = liveStatsFromAgentPayload(
      frame.payload,
      this.latestQuery.read(server.id, new Date(frame.emittedAt)),
      frame.emittedAt,
    );

    if (stats.playersOnline !== null && stats.playersOnline > 0) {
      await this.deps.repository.update(server.id, {
        lastActivityAt: frame.emittedAt,
      });
    }

    this.deps.events.emit('server.statsUpdated', { serverId: server.id, stats });
  }

  // -------------------------------------------------------------------------
  // Auto-Shutdown
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Verlauf der Messwerte (Lastenheft §3.3, Arbeitspaket P5)
  // -------------------------------------------------------------------------

  /**
   * Hält die Messwerte aller laufenden Server einer Node fest.
   *
   * Wird periodisch aufgerufen (`scheduler.ts`) – kein eigener Timer. Ein
   * Server, dessen Messung scheitert, hält die übrigen nicht auf: Eine Lücke im
   * Verlauf ist hinnehmbar, ein abgebrochener Durchlauf wäre eine Lücke für
   * alle.
   */
  async sampleServerStats(hostId: string): Promise<readonly string[]> {
    const ablage = this.deps.statsHistory;

    if (ablage === undefined) {
      return [];
    }

    const moment = this.now();
    const abgetastet: string[] = [];

    for (const server of await this.deps.repository.listByHost(hostId)) {
      if (server.status !== 'running') {
        continue;
      }

      try {
        const stats = await this.getStats(server.id);
        const abfrage = this.latestQuery.read(server.id, moment);

        const probe: StatsSample = {
          serverId: server.id,
          recordedAt: moment,
          cpuPercent: stats.cpuPercent,
          ramUsedMb: Math.round(stats.memoryUsedBytes / (1024 * 1024)),
          // Belegter Plattenplatz je Container liefert das Agent-Protokoll
          // nicht; die Speicherübersicht (B8) misst node-weit.
          diskUsedMb: null,
          pingMs: abfrage.pingMs,
          playersOnline: abfrage.playersOnline,
          playersMax: abfrage.playersMax,
          networkRxBytes: stats.networkRxBytes,
          networkTxBytes: stats.networkTxBytes,
        };

        await ablage.insert(probe);
        abgetastet.push(server.id);
      } catch (error: unknown) {
        this.deps.log.warn(
          { serverId: server.id, error: error instanceof Error ? error.message : String(error) },
          'Messwerte konnten nicht festgehalten werden',
        );
      }
    }

    return abgetastet;
  }

  /** Entfernt Stichproben jenseits der Aufbewahrungsfrist (`STATS_HISTORY_RETENTION_HOURS`). */
  async pruneServerStats(): Promise<number> {
    const ablage = this.deps.statsHistory;

    if (ablage === undefined) {
      return 0;
    }

    const grenze = new Date(
      this.now().getTime() - this.deps.config.statsHistoryRetentionHours * 60 * 60 * 1000,
    );

    return ablage.prune(grenze);
  }

  /**
   * Verlauf der Messwerte eines Servers (Lastenheft §3.3).
   *
   * `windowMinutes` wird an der Aufbewahrungsfrist gekappt: Ein größeres
   * Fenster brächte nur eine Reihe, die vorne bei der Frist abbricht, und würde
   * Lücken vortäuschen, die in Wirklichkeit weggeräumte Zeilen sind.
   */
  async getStatsHistory(serverId: string, windowMinutes: number): Promise<ServerStatsHistoryDto> {
    const fenster = Math.min(windowMinutes, this.deps.config.statsHistoryRetentionHours * 60);
    const ablage = this.deps.statsHistory;
    const seit = new Date(this.now().getTime() - fenster * 60 * 1000);
    const proben = ablage === undefined ? [] : await ablage.listSince(serverId, seit);

    return toStatsHistoryDto(
      serverId,
      fenster,
      Math.round(this.deps.config.statsSampleIntervalMs / 1000),
      proben,
    );
  }

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

      // Eine stillgelegte Node nimmt auch keinen neuen Server auf: Sonst
      // entstünde ein Server, den niemand starten kann (Gefundener Punkt 109).
      this.assertNodeAcceptsWork(host, 'create');

      return host;
    }

    const host = await this.deps.repository.defaultHost();

    if (host === null) {
      throw new ServerOrchestrationError(
        'AGENT_NOT_CONNECTED',
        'Es ist keine Node eingerichtet. Bitte zuerst die Ersteinrichtung ausführen (pnpm --filter @palantir/backend db:seed).',
      );
    }

    // Auch die vorgegebene Node muss annehmen: Ist die einzige Node der
    // Installation stillgelegt, entsteht hier kein Server (Punkt 109).
    this.assertNodeAcceptsWork(host, 'create');

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
