/**
 * Zusammenspiel des Dienstes (B3).
 *
 * Geprüft wird die Kette, die die Einzelbausteine verbindet: anlegen, starten
 * mit Health-Check, Absturz mit Crash-Loop-Schutz, Auto-Shutdown, Klonen,
 * Soll/Ist-Abgleich.
 *
 * Der Agent hängt dabei am **echten** Protokoll-Gegenstück (`AgentSession`) mit
 * einem Socket, der die Befehle beantwortet – nicht an einer Attrappe des
 * Dienstes. So läuft der Test durch dieselbe Korrelations-ID-Logik wie der
 * Betrieb. Datenbank, DNS und Health-Check sind Attrappen.
 */

import {
  type ArchiveFormat,
  type AgentCommandName,
  type ApiResponse,
  type GameTypeDefinition,
  type NodeResourceUsage,
  type ServerCloneJobDto,
  type ServerMemberLevel,
  type ServerStatus,
  type UserResourceUsage,
  NO_USER_RESOURCE_LIMITS,
} from '@palantir/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type HostNodeRepository,
  type ServerUsageRepository,
  type UserResourceLimitRepository,
  createResourceService,
} from '../resources/index.js';
import { AgentRegistry, AgentSession, type AgentSocket } from './agent-gateway.js';
import { decideAutoShutdown } from './auto-shutdown.js';
import { ServerOrchestrationError } from './errors.js';
import {
  type InstallationPhase,
  TEST_GAME_TYPE,
  TEST_MINECRAFT_GAME_TYPE,
  createGameRegistry,
} from './game-registry.js';
import { type HealthCheckResult, type HealthProbe } from './health-check.js';
import { type PortAllocator, createPortAllocator } from './ports.js';
import {
  type CreateServerData,
  type HostNodeRecord,
  type PersistLifecycleData,
  type ServerMemberRecord,
  type ServerRecord,
  type ServerRepository,
  type UpdateServerData,
} from './repository.js';
import {
  type CapacityReservation,
  createInlineCapacityReservation,
  createPermissiveResourceGuard,
  createResourceGuardFromService,
} from './resource-guard.js';
import {
  type OrchestrationEventSink,
  ServerOrchestrationService,
  WORLD_IMPORT_CHUNK_BYTES,
} from './service.js';
import { type DnsProvider, type DnsRecord } from './dns/types.js';
import {
  ClockSkewMonitor,
  LatestDiskUsageCache,
  LatestQueryCache,
  type ServerStatsRepository,
  type StatsSample,
} from './stats-history.js';
import { type StoredWorldArchive, type WorldArchiveStore } from './world-import.js';

const HOST: HostNodeRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online',
};

const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-26T12:00:00.000Z');

/**
 * Spiel-Typ mit Hostname-Routing (Pflichtenheft §2.4, §13).
 *
 * In der echten Registry trägt heute keine Definition dieses Merkmal – der
 * Router dafür läuft noch nicht. Genau deshalb steht der Typ hier: Der
 * Start-Refuse aus Pflichtenheft §19 wäre sonst nicht prüfbar, und die Lücke
 * fiele erst dem Ersten auf, der das Merkmal setzt.
 *
 * Bis auf das Merkmal und die Kennung derselbe wie der Echo-Testtyp: Geprüft
 * wird die Weiche, nicht das Spiel.
 */
const ROUTED_GAME_TYPE: GameTypeDefinition = {
  ...TEST_GAME_TYPE,
  id: 'test-routed',
  name: 'Test-Server (Hostname-Routing)',
  supportsVirtualHostRouting: true,
};

/** Registry für die Routing-Tests: der gewöhnliche Typ und der geroutete. */
const ROUTING_GAME_TYPES: readonly GameTypeDefinition[] = [TEST_GAME_TYPE, ROUTED_GAME_TYPE];

let idCounter = 0;

const nextId = (): string => `44444444-4444-4444-8444-${String(++idCounter).padStart(12, '0')}`;

/** In-Memory-Ausprägung des Repositories – die Abläufe sollen ohne Datenbank prüfbar sein. */
class FakeRepository implements ServerRepository {
  readonly servers = new Map<string, ServerRecord>();
  readonly members = new Map<string, Map<string, ServerMemberLevel>>();
  /** Angeheftete Server je Konto (Gefundener Punkt 50). */
  readonly pins = new Map<string, Set<string>>();

  countByOwners(userIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const anzahl = new Map<string, number>();

    for (const server of this.servers.values()) {
      if (userIds.includes(server.ownerId)) {
        anzahl.set(server.ownerId, (anzahl.get(server.ownerId) ?? 0) + 1);
      }
    }

    return Promise.resolve(anzahl);
  }

  listPinnedServerIds(userId: string): Promise<ReadonlySet<string>> {
    return Promise.resolve(this.pins.get(userId) ?? new Set<string>());
  }

  pinServer(userId: string, serverId: string): Promise<void> {
    const vorhanden = this.pins.get(userId) ?? new Set<string>();
    vorhanden.add(serverId);
    this.pins.set(userId, vorhanden);

    return Promise.resolve();
  }

  unpinServer(userId: string, serverId: string): Promise<void> {
    this.pins.get(userId)?.delete(serverId);

    return Promise.resolve();
  }

  findById(id: string): Promise<ServerRecord | null> {
    return Promise.resolve(this.servers.get(id) ?? null);
  }

  findByContainerId(containerId: string): Promise<ServerRecord | null> {
    return Promise.resolve(
      [...this.servers.values()].find((s) => s.dockerContainerId === containerId) ?? null,
    );
  }

  listByHost(hostId: string): Promise<readonly ServerRecord[]> {
    return Promise.resolve([...this.servers.values()].filter((s) => s.hostId === hostId));
  }

  listAll(): Promise<readonly ServerRecord[]> {
    return Promise.resolve([...this.servers.values()]);
  }

  listByOwnerOrMembership(userId: string): Promise<readonly ServerRecord[]> {
    return Promise.resolve([...this.servers.values()].filter((s) => s.ownerId === userId));
  }

  isSubdomainTaken(subdomain: string, excludeServerId?: string): Promise<boolean> {
    return Promise.resolve(
      [...this.servers.values()].some((s) => s.subdomain === subdomain && s.id !== excludeServerId),
    );
  }

  takenPublicPorts(hostId: string): Promise<ReadonlySet<number>> {
    const taken = new Set<number>();

    for (const server of this.servers.values()) {
      if (server.hostId !== hostId) {
        continue;
      }

      for (const assignment of server.assignedPorts) {
        taken.add(assignment.publicPort);
      }
    }

    return Promise.resolve(taken);
  }

  create(data: CreateServerData): Promise<ServerRecord> {
    const record: ServerRecord = {
      id: nextId(),
      ownerId: data.ownerId,
      ownerDisplayName: 'Besitzer',
      hostId: data.hostId,
      hostName: HOST.name,
      name: data.name,
      gameType: data.gameType,
      status: 'creating',
      statusMessage: null,
      statusChangedAt: NOW.toISOString(),
      lastStartedAt: null,
      lastActivityAt: null,
      crashTimestamps: [],
      dockerContainerId: null,
      imageRef: null,
      containerSpecHash: null,
      subdomain: data.subdomain,
      dnsRecordId: null,
      assignedPorts: data.assignedPorts,
      resourceLimits: data.resourceLimits,
      configJson: data.configJson,
      startupParameters: data.startupParameters,
      autoShutdown: data.autoShutdown,
      restartRequired: false,
      clonedFromServerId: data.clonedFromServerId,
      createdAt: NOW.toISOString(),
    };

    this.servers.set(record.id, record);

    return Promise.resolve(record);
  }

  update(id: string, data: UpdateServerData): Promise<void> {
    const current = this.servers.get(id);

    if (current !== undefined) {
      this.servers.set(id, {
        ...current,
        ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
      } as ServerRecord);
    }

    return Promise.resolve();
  }

  /**
   * Wie die Drizzle-Umsetzung: schreibt nur, solange der Server noch in
   * `expectedStatus` steht (Compare-and-Swap, orchestration-core-07). Sonst
   * `SERVER_STATE_CONFLICT` – ohne diese Bedingung ließe sich der
   * Nebenläufigkeitsschutz nicht ohne Datenbank prüfen.
   */
  persistLifecycle(
    id: string,
    data: PersistLifecycleData,
    expectedStatus: ServerStatus,
  ): Promise<void> {
    const current = this.servers.get(id);

    if (current === undefined || current.status !== expectedStatus) {
      return Promise.reject(
        new ServerOrchestrationError(
          'SERVER_STATE_CONFLICT',
          'Der Zustand des Servers hat sich zwischenzeitlich geändert.',
          { serverId: id, expected: expectedStatus, to: data.status },
        ),
      );
    }

    this.servers.set(id, { ...current, ...data });

    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.servers.delete(id);

    return Promise.resolve();
  }

  listMembers(serverId: string): Promise<readonly ServerMemberRecord[]> {
    return Promise.resolve(
      [...(this.members.get(serverId) ?? new Map()).entries()].map(([userId, level]) => ({
        userId,
        displayName: 'Mitglied',
        level: level as ServerMemberLevel,
        addedAt: NOW.toISOString(),
      })),
    );
  }

  memberLevel(serverId: string, userId: string): Promise<ServerMemberLevel | null> {
    return Promise.resolve(this.members.get(serverId)?.get(userId) ?? null);
  }

  upsertMember(serverId: string, userId: string, level: ServerMemberLevel): Promise<void> {
    const forServer = this.members.get(serverId) ?? new Map<string, ServerMemberLevel>();

    forServer.set(userId, level);
    this.members.set(serverId, forServer);

    return Promise.resolve();
  }

  removeMember(serverId: string, userId: string): Promise<void> {
    this.members.get(serverId)?.delete(userId);

    return Promise.resolve();
  }

  /**
   * Zustand der einen Node (`HostNode.status`) – umstellbar, damit sich eine
   * stillgelegte Node prüfen lässt (Gefundener Punkt 24).
   */
  hostStatus: HostNodeRecord['status'] = HOST.status;

  private host(): HostNodeRecord {
    return { ...HOST, status: this.hostStatus };
  }

  defaultHost(): Promise<HostNodeRecord | null> {
    return Promise.resolve(this.host());
  }

  countHosts(): Promise<number> {
    return Promise.resolve(1);
  }

  findHost(hostId: string): Promise<HostNodeRecord | null> {
    return Promise.resolve(hostId === HOST.id ? this.host() : null);
  }

  markHostConnected(): Promise<void> {
    return Promise.resolve();
  }

  markHostDisconnected(): Promise<void> {
    return Promise.resolve();
  }

  readonly measuredUpdates: ({ hostId: string } & Parameters<
    ServerRepository['updateMeasuredResources']
  >[1])[] = [];

  updateMeasuredResources(
    hostId: string,
    resources: Parameters<ServerRepository['updateMeasuredResources']>[1],
  ): Promise<void> {
    this.measuredUpdates.push({ hostId, ...resources });
    return Promise.resolve();
  }
}

/** Socket, der jeden Befehl sofort beantwortet – wie ein sehr schneller Agent. */
class AnsweringSocket implements AgentSocket {
  readonly commands: { command: AgentCommandName; payload: unknown }[] = [];
  session: AgentSession | null = null;
  /** Antwort je Befehl; ohne Eintrag wird Erfolg mit `null` gemeldet. */
  readonly answers = new Map<AgentCommandName, ApiResponse<unknown>>();

  send(data: string): void {
    const frame = JSON.parse(data) as {
      kind: string;
      command?: AgentCommandName;
      correlationId?: string;
      payload?: unknown;
    };

    if (frame.kind !== 'command' || frame.command === undefined) {
      return;
    }

    this.commands.push({ command: frame.command, payload: frame.payload });

    const result =
      this.answers.get(frame.command) ?? this.defaultAnswerFor(frame.command, frame.payload);

    // Der Agent antwortet nie synchron innerhalb von `send` – der Aufrufer hat
    // sonst noch keinen offenen Befehl eingetragen.
    queueMicrotask(() => {
      this.session?.handleMessage(
        JSON.stringify({
          kind: 'commandResult',
          correlationId: frame.correlationId,
          command: frame.command,
          result,
          duplicate: false,
          completedAt: NOW.toISOString(),
        }),
      );
    });
  }

  close(): void {
    // Der Test schließt nichts.
  }

  /** Erfolgsantwort mit der Nutzlast, die der jeweilige Befehl zurückgibt. */
  private defaultAnswerFor(command: AgentCommandName, payload?: unknown): ApiResponse<unknown> {
    if (command === 'CREATE') {
      const containerId = `container-${String(this.commands.length)}`;

      return {
        success: true,
        data: { containerId, name: containerId, warnings: [] },
        error: null,
      };
    }

    if (command === 'CREATE_BACKUP') {
      return {
        success: true,
        data: {
          backupId: 'archiv-1',
          storagePath: '/srv/palantir/backups/quelle/archiv-1.tar.gz',
          sizeBytes: 4_096,
          checksumSha256: 'abc123',
          containerStopped: false,
          startedAt: NOW.toISOString(),
          completedAt: NOW.toISOString(),
        },
        error: null,
      };
    }

    if (command === 'RESTORE_BACKUP') {
      return {
        success: true,
        data: {
          backupId: 'archiv-1',
          restoredBytes: 4_096,
          containerStopped: true,
          startedAt: NOW.toISOString(),
          completedAt: NOW.toISOString(),
        },
        error: null,
      };
    }

    if (command === 'DELETE_BACKUP') {
      return {
        success: true,
        data: { backupId: 'archiv-1', removed: true, freedBytes: 4_096 },
        error: null,
      };
    }

    if (command === 'GET_STATS') {
      return {
        success: true,
        data: {
          containerId: 'container-1',
          cpuPercent: 42.5,
          memoryUsedBytes: 1024 * 1024 * 512,
          memoryLimitBytes: 1024 * 1024 * 2048,
          networkRxBytes: 5_000,
          networkTxBytes: 6_000,
          blockReadBytes: 0,
          blockWriteBytes: 0,
          pids: 12,
          sampledAt: NOW.toISOString(),
        },
        error: null,
      };
    }

    if (command === 'FILE_EXTRACT') {
      return {
        success: true,
        data: { fileCount: 2, extractedBytes: 42, skipped: [] },
        error: null,
      };
    }

    if (command === 'UPLOAD_ARCHIVE_BLOCK') {
      // Wie der Agent: Erst der letzte Block liefert ein Entpack-Ergebnis.
      const nutzlast = payload as { offset: number; contentBase64: string; last: boolean };
      const empfangen = nutzlast.offset + Buffer.from(nutzlast.contentBase64, 'base64').byteLength;

      return {
        success: true,
        data: {
          transferId: 'transfer',
          receivedBytes: empfangen,
          extract: nutzlast.last ? { fileCount: 2, extractedBytes: 42, skipped: [] } : null,
        },
        error: null,
      };
    }

    return { success: true, data: null, error: null };
  }
}

/**
 * Sonde für den Test.
 *
 * `'pending'` antwortet nie – damit bleibt ein Server dauerhaft im Zustand
 * `starting`. Das wird gebraucht, um Abstürze **während** des Hochlaufs zu
 * prüfen; ein erfolgreicher Start würde die Absturzhistorie zurücksetzen.
 */
function healthyProbe(healthy: boolean | 'pending'): HealthProbe {
  return {
    check: (): Promise<HealthCheckResult> => {
      if (healthy === 'pending') {
        return new Promise<HealthCheckResult>(() => undefined);
      }

      return Promise.resolve({
        healthy,
        pingMs: healthy ? 5 : null,
        playersOnline: null,
        playersMax: null,
        reason: healthy ? null : 'nicht erreichbar',
      });
    },
  };
}

/** Health-Probe, deren Antworten der Test einzeln gibt. */
interface HaltendeProbe {
  readonly probe: HealthProbe;
  /** Beantwortet die älteste noch offene Prüfung. */
  antworte(healthy: boolean): void;
  /** Wie viele Prüfungen bisher gestellt wurden. */
  readonly gestellt: number;
}

/**
 * Eine Probe, die von sich aus nichts beantwortet.
 *
 * Gebraucht, wo geprüft wird, was **während** eines laufenden Health-Checks
 * gilt – etwa dass der Neustart erst danach gemeldet wird (Audit
 * event-flow-09). Mit einer sofort antwortenden Probe gäbe es dieses Fenster im
 * Test gar nicht.
 */
function haltendeProbe(): HaltendeProbe {
  const offen: Array<(result: HealthCheckResult) => void> = [];
  let gestellt = 0;

  return {
    probe: {
      check: (): Promise<HealthCheckResult> => {
        gestellt += 1;

        return new Promise<HealthCheckResult>((resolve) => {
          offen.push(resolve);
        });
      },
    },
    antworte(healthy: boolean): void {
      offen.shift()?.({
        healthy,
        pingMs: healthy ? 5 : null,
        playersOnline: null,
        playersMax: null,
        reason: healthy ? null : 'nicht erreichbar',
      });
    },
    get gestellt(): number {
      return gestellt;
    },
  };
}

/** Wartet, bis der Health-Check die erwartete Zahl an Prüfungen gestellt hat. */
async function warteAufPruefungen(probe: HaltendeProbe, anzahl: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (probe.gestellt >= anzahl) {
      return;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error('Der Health-Check wurde nicht angestoßen.');
}

/** Eine Log-Zeile des Dienstes bzw. der Agent-Sitzung. */
interface LoggedLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly details: Record<string, unknown>;
  readonly message: string;
}

interface Harness {
  readonly service: ServerOrchestrationService;
  readonly repository: FakeRepository;
  readonly socket: AnsweringSocket;
  readonly emitted: { event: string; payload: Record<string, unknown> }[];
  readonly dnsRecords: DnsRecord[];
  readonly deletedDnsNames: string[];
  readonly releasedPorts: string[];
  /** Alles, was Dienst und Agent-Sitzung protokolliert haben (Audit W0-5). */
  readonly logged: LoggedLine[];
  /** Stellt die Uhr des Dienstes vor – ohne echte Wartezeit. */
  advance(ms: number): void;
  /**
   * Aktueller Stand der virtuellen Uhr (Audit W2-14).
   *
   * Wer gegen die Backend-Zeit prüft, braucht sie: `NOW` gilt nur bis zum
   * ersten `sleep()` des Health-Checks.
   */
  now(): Date;
}

function makeHarness(
  options: {
    healthy?: boolean | 'pending';
    /** Eigene Probe, wenn ein Test den Health-Check von Hand beantworten will (Audit W0-5). */
    probe?: HealthProbe;
    /** Eigene, serialisierende Reservierung – für den TOCTOU-Test (Punkt 98). */
    buildReservation?: (repository: FakeRepository, ports: PortAllocator) => CapacityReservation;
    /** Upload-Grenze, um sie im Test ohne 64-MiB-Puffer zu erreichen (P2). */
    maxUploadBytes?: number;
    /**
     * Lässt das Entfernen des DNS-Eintrags **einmal** scheitern – für den
     * Abbruch mitten in der Löschkette (orchestration-core-03).
     */
    failNextDnsDelete?: boolean;
    /** Zwischenspeicher der Weltdaten-Archive; ohne Angabe keiner (P4). */
    worldArchives?: WorldArchiveStore;
    /** Grenze für Weltarchive, um sie im Test ohne 64 MiB zu erreichen (P4). */
    maxWorldArchiveBytes?: number;
    /** Ablage des Messwert-Verlaufs; ohne Angabe wird nichts festgehalten (P5). */
    statsHistory?: ServerStatsRepository;
    /** Aufbewahrungsfrist des Verlaufs in Stunden (P5). */
    statsHistoryRetentionHours?: number;
    /** Gruppen-Chat beim Anlegen (Gefundener Punkt 70); ohne Angabe passiert nichts. */
    ensureServerChat?: (serverId: string) => Promise<unknown>;
    /**
     * Lässt die Portvergabe scheitern – für den Rollback-Test
     * (orchestration-core-05): Der Pool ist erschöpft, der eben angelegte
     * Datensatz darf nicht als Leiche stehen bleiben.
     */
    failPortAllocation?: boolean;
    /**
     * Wird bei jedem gemeldeten Ereignis aufgerufen – für den Test der
     * Reihenfolge „erst Commit, dann melden" (event-flow-11).
     */
    onEmit?: (event: string, payload: Record<string, unknown>) => void;
    /**
     * Ausbaustufe der Spiele-Registry; Vorgabe 1 (nur der Echo-Testtyp).
     *
     * Stufe 2 gibt den Minecraft-Testtyp frei – das einzige Spiel mit
     * `gamedig`-Abfrage und damit mit einer messbaren Spielerzahl. Gebraucht
     * für den Auto-Shutdown (Audit event-flow-08): Ohne Spielerzahl entscheidet
     * er auf „nicht messbar" und schaltet gar nicht mehr ab.
     */
    gamePhase?: InstallationPhase;
    /**
     * Eigene Spiele-Definitionen statt der echten Registry.
     *
     * Gebraucht für das Hostname-Routing (Pflichtenheft §19): Heute trägt
     * keine echte Definition `supportsVirtualHostRouting`, der Fall wäre sonst
     * nicht prüfbar.
     */
    gameTypes?: readonly GameTypeDefinition[];
    /** `GAME_ROUTER_HOSTNAME`; ohne Angabe läuft kein Hostname-Router. */
    routerHostname?: string | null;
  } = {},
): Harness {
  const repository = new FakeRepository();
  const agents = new AgentRegistry();
  const socket = new AnsweringSocket();
  const emitted: { event: string; payload: Record<string, unknown> }[] = [];
  const dnsRecords: DnsRecord[] = [];
  const deletedDnsNames: string[] = [];

  // Protokoll mitschreiben statt verschlucken: Die Tests zum Prozess-Schutz
  // (Audit W0-5) prüfen, dass eine Dublette als Warnung endet und nicht als Wurf.
  const logged: LoggedLine[] = [];
  const record =
    (level: LoggedLine['level']) =>
    (details: Record<string, unknown>, message: string): void => {
      logged.push({ level, details, message });
    };
  const log = { info: record('info'), warn: record('warn'), error: record('error') };

  const session = new AgentSession({
    hostId: HOST.id,
    socket,
    handlers: { onStateReport: () => undefined, onEvent: () => undefined },
    log,
    commandTimeoutMs: 1_000,
  });

  socket.session = session;
  session.handleMessage(
    JSON.stringify({
      kind: 'hello',
      protocolVersion: 1,
      agentVersion: 'test',
      sentAt: NOW.toISOString(),
    }),
  );
  agents.register(session);

  let dnsLoeschenScheitert = options.failNextDnsDelete === true;
  const dns: DnsProvider = {
    upsertRecord: (record) => {
      dnsRecords.push(record);

      return Promise.resolve(`rec-${String(dnsRecords.length)}`);
    },
    deleteRecord: (name) => {
      if (dnsLoeschenScheitert) {
        dnsLoeschenScheitert = false;

        return Promise.reject(new Error('Der DNS-Eintrag ließ sich nicht entfernen.'));
      }

      deletedDnsNames.push(name);

      return Promise.resolve();
    },
  };

  const events: OrchestrationEventSink = {
    emit: (event, payload) => {
      emitted.push({ event, payload });
      options.onEmit?.(event, payload);
    },
  };

  // Port-Pool wie in B8: vergibt fortlaufend ab 27000 und merkt sich Freigaben.
  let nextPort = 27_000;
  const releasedPorts: string[] = [];
  const portPool = {
    allocateForServer: (
      _serverId: string,
      requests: readonly { protocol: 'tcp' | 'udp'; count: number }[],
    ) =>
      options.failPortAllocation === true
        ? Promise.reject(new ServerOrchestrationError('PORT_POOL_EXHAUSTED'))
        : Promise.resolve(
            requests.flatMap((request) =>
              Array.from({ length: request.count }, () => ({
                port: nextPort++,
                protocol: request.protocol,
              })),
            ),
          ),
    releaseForServer: (serverId: string) => {
      releasedPorts.push(serverId);

      return Promise.resolve(1);
    },
  };

  // Eine Instanz für beide Wege: Der Dienst benutzt sie zum Freigeben, die
  // Reservierung zum Vergeben innerhalb der Transaktion (Fundpunkt 135).
  const portAllocator = createPortAllocator(portPool);

  // Virtuelle Uhr: `sleep()` stellt sie vor, statt echte Zeit zu verbrauchen.
  // Die Startfrist des Health-Checks läuft dadurch gegen dieselbe Uhr.
  let clock = NOW.getTime();

  const service = new ServerOrchestrationService({
    repository,
    agents,
    registry:
      options.gameTypes === undefined
        ? createGameRegistry(options.gamePhase ?? 1)
        : createGameRegistry(options.gamePhase ?? 1, options.gameTypes),
    dns,
    ports: portAllocator,
    resources: createPermissiveResourceGuard(() => undefined),
    reservation: options.buildReservation?.(repository, portAllocator),
    healthProbe: options.probe ?? healthyProbe(options.healthy ?? true),
    ...(options.worldArchives === undefined ? {} : { worldArchives: options.worldArchives }),
    ...(options.statsHistory === undefined ? {} : { statsHistory: options.statsHistory }),
    ...(options.ensureServerChat === undefined
      ? {}
      : { ensureServerChat: options.ensureServerChat }),
    events,
    log,
    config: {
      baseDomain: 'example.tld',
      publicIpv4: '203.0.113.10',
      routerHostname: options.routerHostname ?? null,
      virtualHostPort: 25_565,
      crashLoopPolicy: { maxRestarts: 2, windowMinutes: 10 },
      healthCheckIntervalMs: 5_000,
      healthCheckAttemptTimeoutMs: 1_000,
      createTimeoutMs: 900_000,
      maxUploadBytes: options.maxUploadBytes ?? 2 * 1024 * 1024 * 1024,
      maxWorldArchiveBytes: options.maxWorldArchiveBytes ?? 64 * 1024 * 1024,
      statsHistoryRetentionHours: options.statsHistoryRetentionHours ?? 48,
      statsSampleIntervalMs: 60_000,
      defaultAutoShutdown: { enabled: true, idleTimeoutMinutes: 30, graceMinutes: 15 },
    },
    now: (): Date => new Date(clock),
    sleep: (ms) => {
      clock += ms;

      return Promise.resolve();
    },
  });

  return {
    service,
    repository,
    socket,
    emitted,
    dnsRecords,
    deletedDnsNames,
    releasedPorts,
    logged,
    advance: (ms: number): void => {
      clock += ms;
    },
    now: (): Date => new Date(clock),
  };
}

const createInput = (subdomain = 'mein-server', gameType = TEST_GAME_TYPE) => ({
  name: 'Mein Server',
  gameType: gameType.id,
  subdomain,
  hostId: HOST.id,
  resourceLimits: gameType.resourceDefaults,
  config: {},
  startupParameters: '',
  autoShutdownEnabled: true,
  worldImport: null,
});

/** Wartet, bis der Server einen der genannten Zustände erreicht hat. */
async function settle(
  harness: Harness,
  serverId: string,
  until: ServerStatus[],
): Promise<ServerRecord> {
  for (let i = 0; i < 200; i += 1) {
    const server = await harness.service.requireServer(serverId);

    if (until.includes(server.status)) {
      return server;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error('Der Server hat keinen der erwarteten Zustände erreicht.');
}

/** Wartet, bis ein Klon-Auftrag abgeschlossen ist (`completed` oder `failed`). */
async function settleCloneJob(
  harness: Harness,
  sourceServerId: string,
  jobId: string,
): Promise<ServerCloneJobDto> {
  for (let i = 0; i < 500; i += 1) {
    const job = harness.service.findCloneJob(sourceServerId, jobId);

    if (job !== null && job.finishedAt !== null) {
      return job;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error('Der Klon-Auftrag ist nicht fertig geworden.');
}

beforeEach(() => {
  idCounter = 0;
});

describe('Server anlegen (Lastenheft §3.3)', () => {
  it('legt DNS-Eintrag und Container an und endet bei stopped', async () => {
    const harness = makeHarness();
    const server = await harness.service.createServer(createInput(), OWNER_ID);

    expect(server.status).toBe('stopped');
    expect(server.dockerContainerId).not.toBeNull();
    expect(harness.dnsRecords[0]).toMatchObject({
      name: 'mein-server.example.tld',
      type: 'A',
      proxied: false,
    });
    expect(harness.socket.commands.map((c) => c.command)).toEqual(['CREATE']);
  });

  it('merkt sich das benutzte Image (Grundlage fuer "Update verfuegbar")', async () => {
    const harness = makeHarness();
    const server = await harness.service.createServer(createInput(), OWNER_ID);

    const gespeichert = harness.repository.servers.get(server.id);

    // Der Vergleich mit der Definition passiert im DTO (siehe
    // update-available.test.ts); hier zaehlt, dass ueberhaupt festgehalten
    // wird, womit der Container angelegt wurde.
    expect(gespeichert?.imageRef).toBe(TEST_GAME_TYPE.dockerImage);
  });

  it('weist einen öffentlichen Port zu und meldet server.created', async () => {
    const harness = makeHarness();
    const server = await harness.service.createServer(createInput(), OWNER_ID);

    expect(server.assignedPorts[0]?.publicPort).toBe(27_000);
    expect(harness.emitted.map((e) => e.event)).toContain('server.created');
  });

  it('lehnt eine belegte Subdomain ab', async () => {
    const harness = makeHarness();

    await harness.service.createServer(createInput(), OWNER_ID);

    try {
      await harness.service.createServer(createInput(), OWNER_ID);
      expect.unreachable('Die Subdomain hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('SUBDOMAIN_TAKEN');
    }
  });

  it('räumt einen gescheiterten Versuch weg und gibt die Subdomain frei (Punkt 112)', async () => {
    const harness = makeHarness();

    // So sah der Fehler im Betrieb aus: Das Image fehlte auf der Node.
    harness.socket.answers.set('CREATE', {
      success: false,
      data: null,
      error: {
        code: 'AGENT_IMAGE_NOT_FOUND',
        message: 'Das Container-Image ist auf dem Homeserver nicht vorhanden.',
      },
    });

    await expect(
      harness.service.createServer(createInput('mein-server'), OWNER_ID),
    ).rejects.toBeDefined();

    // Kein Datensatz auf `error`, der die Adresse belegt hält.
    expect(harness.repository.servers.size).toBe(0);
    // Der Fake merkt Löschungen getrennt, statt aus der Liste zu entfernen.
    expect(harness.deletedDnsNames).toHaveLength(1);
    expect(harness.releasedPorts).toHaveLength(1);

    // Und der zweite Versuch mit derselben Subdomain geht wieder – vorher kam
    // hier „Diese Subdomain ist bereits vergeben".
    harness.socket.answers.delete('CREATE');
    const zweiter = await harness.service.createServer(createInput('mein-server'), OWNER_ID);

    expect(zweiter.subdomain).toBe('mein-server');
  });

  it('räumt auch eine gescheiterte Portvergabe weg (orchestration-core-05)', async () => {
    /*
     * Bis W2-10 lagen Portvergabe und das Nachtragen der Zuweisung **vor** dem
     * try-Block: Ein erschöpfter Port-Pool hinterließ den eben angelegten
     * Datensatz auf `creating` – Subdomain belegt, Ports womöglich schon
     * vergeben. Genau die Leiche, die der Rollback beseitigen sollte.
     */
    const harness = makeHarness({ failPortAllocation: true });

    await expect(
      harness.service.createServer(createInput('mein-server'), OWNER_ID),
    ).rejects.toMatchObject({ code: 'PORT_POOL_EXHAUSTED' });

    // Kein Datensatz, keine belegte Subdomain, die Reservierung ist zurückgegeben.
    expect(harness.repository.servers.size).toBe(0);
    expect(harness.releasedPorts).toHaveLength(1);
    expect(harness.deletedDnsNames).toHaveLength(1);
    // Und es ging kein CREATE an den Homeserver – die Kette bricht vorher ab.
    expect(harness.socket.commands.map((befehl) => befehl.command)).not.toContain('CREATE');

    // Die Subdomain ist wieder frei – der zweite Versuch lief vorher in
    // „Diese Subdomain ist bereits vergeben".
    await expect(harness.repository.isSubdomainTaken('mein-server')).resolves.toBe(false);
  });

  it('lehnt einen gesperrten Systemnamen ab', async () => {
    const harness = makeHarness();

    try {
      await harness.service.createServer(createInput('admin'), OWNER_ID);
      expect.unreachable('Der Name hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('SUBDOMAIN_INVALID');
    }
  });

  it('lehnt einen unbekannten Spiel-Typ ab, bevor irgendetwas angelegt wird', async () => {
    const harness = makeHarness();

    try {
      await harness.service.createServer({ ...createInput(), gameType: 'gibt-es-nicht' }, OWNER_ID);
      expect.unreachable('Der Spiel-Typ hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('GAME_TYPE_NOT_FOUND');
    }

    expect(harness.dnsRecords).toEqual([]);
    expect(harness.repository.servers.size).toBe(0);
  });

  /*
   * Fundpunkt 185: `POST /servers` kam erst zurück, wenn der Agent das Image
   * gezogen und den Container gebaut hatte – Minuten, in denen der Wizard nur
   * einen drehenden Knopf zeigte. `beginCreateServer()` antwortet nach der
   * Reservierung im Zustand `creating`; der Rest läuft im Hintergrund.
   */
  describe('beginCreateServer – Anlegen antwortet sofort (Fundpunkt 185)', () => {
    const IMAGE_FEHLT: ApiResponse<unknown> = {
      success: false,
      data: null,
      error: {
        code: 'AGENT_IMAGE_NOT_FOUND',
        message: 'Das Container-Image ist auf dem Homeserver nicht vorhanden.',
      },
    };

    it('antwortet mit creating und stellt den Container im Hintergrund fertig', async () => {
      const harness = makeHarness();

      const sofort = await harness.service.beginCreateServer(createInput('sofort'), OWNER_ID);

      // Datensatz und Ports stehen, der Container noch nicht.
      expect(sofort.status).toBe('creating');
      expect(sofort.assignedPorts.length).toBeGreaterThan(0);

      const fertig = await settle(harness, sofort.id, ['stopped', 'error']);

      expect(fertig.status).toBe('stopped');
      expect(fertig.dockerContainerId).not.toBeNull();
      expect(harness.emitted.map((e) => e.event)).toContain('server.created');
    });

    it('lässt einen gescheiterten Server als error mit Grund stehen, statt ihn wegzuräumen', async () => {
      const harness = makeHarness();
      harness.socket.answers.set('CREATE', IMAGE_FEHLT);

      const sofort = await harness.service.beginCreateServer(createInput('kaputt'), OWNER_ID);
      const fertig = await settle(harness, sofort.id, ['stopped', 'error']);

      expect(fertig.status).toBe('error');
      expect(fertig.statusMessage).toContain('nicht vorhanden');
      // Anders als beim wartenden Weg bleibt der Datensatz: Der Nutzer sieht
      // die Detailseite und soll dort lesen, woran es lag.
      expect(harness.repository.servers.size).toBe(1);
      expect(harness.releasedPorts).toHaveLength(0);
      expect(harness.emitted.map((e) => e.event)).toContain('server.failed');
    });

    it('legt beim nächsten Start den fehlenden Container an – „Starten" ist der zweite Versuch', async () => {
      const harness = makeHarness();
      harness.socket.answers.set('CREATE', IMAGE_FEHLT);

      const sofort = await harness.service.beginCreateServer(createInput('nochmal'), OWNER_ID);
      await settle(harness, sofort.id, ['error']);

      // Das Image ist inzwischen da.
      harness.socket.answers.delete('CREATE');
      await harness.service.startServer(sofort.id, OWNER_ID);
      const laeuft = await settle(harness, sofort.id, ['running', 'error']);

      expect(laeuft.status).toBe('running');
      expect(laeuft.dockerContainerId).not.toBeNull();
    });
  });

  it('füllt die Konfiguration aus den Vorgabewerten der Spiele-Definition', async () => {
    const harness = makeHarness();
    const server = await harness.service.createServer(createInput(), OWNER_ID);

    expect(server.configJson).toEqual({
      greeting: 'Palantir Test-Server',
      motdEnabled: true,
    });
  });
});

describe('Starten mit Health-Check (Pflichtenheft §9)', () => {
  it('erreicht running erst nach bestandenem Health-Check', async () => {
    const harness = makeHarness({ healthy: true });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    const starting = await harness.service.startServer(created.id, OWNER_ID);

    // Der Startbefehl allein macht noch keinen laufenden Server.
    expect(starting.status).toBe('starting');

    const running = await settle(harness, created.id, ['running', 'error']);

    expect(running.status).toBe('running');
    expect(running.lastStartedAt).not.toBeNull();
    expect(harness.emitted.map((e) => e.event)).toContain('server.started');
  });

  it('prüft den Weg der Spieler: öffentliche VPS-Adresse und öffentlicher Port (Fundpunkt 183)', async () => {
    /*
     * Bis Fundpunkt 183 zielte die Sonde auf die Node im Tunnel – und das
     * konnte nie antworten: Spielports sind dort nur an 127.0.0.1 gebunden,
     * und die WireGuard-Firewall der Node nimmt nichts Neues an. Jeder Start
     * lief in `error`, während Spieler längst drauf waren. In der CI blieb das
     * unsichtbar, weil die Sonde gemockt ist – deshalb hält dieser Test das
     * Ziel fest, nicht nur das Ergebnis.
     */
    const ziele: Array<{ host: string; port: number }> = [];
    const probe: HealthProbe = {
      check: (target) => {
        ziele.push({ host: target.host, port: target.port });

        return Promise.resolve({
          healthy: true,
          pingMs: 5,
          playersOnline: null,
          playersMax: null,
          reason: null,
        });
      },
    };
    const harness = makeHarness({ probe });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    const running = await settle(harness, created.id, ['running', 'error']);

    const primary = running.assignedPorts.find((zuweisung) => zuweisung.primary);

    expect(running.status).toBe('running');
    expect(ziele).toHaveLength(1);
    expect(ziele[0]).toEqual({ host: '203.0.113.10', port: primary?.publicPort });
    expect(ziele[0]?.host).not.toBe(HOST.wireguardIp);
  });

  it('geht bei gescheitertem Health-Check nach error statt nach running', async () => {
    const harness = makeHarness({ healthy: false });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);

    const failed = await settle(harness, created.id, ['running', 'error']);

    expect(failed.status).toBe('error');
    expect(failed.statusMessage).toContain('nicht erreichbar');
    expect(harness.emitted.map((e) => e.event)).toContain('server.failed');
  });

  it('lehnt den Start eines laufenden Servers ab, ohne den Agent zu behelligen', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    const before = harness.socket.commands.length;

    try {
      await harness.service.startServer(created.id, OWNER_ID);
      expect.unreachable('Der Start hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('SERVER_STATE_CONFLICT');
    }

    expect(harness.socket.commands).toHaveLength(before);
  });
});

describe('Hostname-Routing ohne Router (Pflichtenheft §19)', () => {
  const routedInput = (): ReturnType<typeof createInput> =>
    createInput('mit-routing', ROUTED_GAME_TYPE);

  it('lässt ein Spiel ohne Hostname-Routing unverändert starten', async () => {
    const harness = makeHarness({ healthy: true, gameTypes: ROUTING_GAME_TYPES });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    const starting = await harness.service.startServer(created.id, OWNER_ID);

    expect(starting.status).toBe('starting');
    // Der gewöhnliche Weg: A-Eintrag auf die VPS, eigener Port aus dem Pool.
    expect(harness.dnsRecords.at(-1)?.type).toBe('A');
  });

  it('lehnt den Start mit GAME_TYPE_NOT_AVAILABLE ab, solange kein Router eingetragen ist', async () => {
    const harness = makeHarness({ gameTypes: ROUTING_GAME_TYPES });

    // Anlegen bleibt erlaubt: Ein Server ohne laufenden Router richtet keinen
    // Schaden an, der Betreiber kann den Router nachliefern.
    const created = await harness.service.createServer(routedInput(), OWNER_ID);
    const before = harness.socket.commands.length;

    try {
      await harness.service.startServer(created.id, OWNER_ID);
      expect.unreachable('Der Start hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      const fehler = error as ServerOrchestrationError;

      expect(fehler.code).toBe('GAME_TYPE_NOT_AVAILABLE');
      // Die Meldung nennt den Weg heraus, nicht nur „nicht verfügbar".
      expect(fehler.message).toContain('GAME_ROUTER_HOSTNAME');
      expect(fehler.message).toContain('/opt/palantir/.env');
    }

    // Kein Zustandswechsel, kein Agent-Befehl – die Ablehnung greift davor.
    expect((await harness.service.requireServer(created.id)).status).toBe('stopped');
    expect(harness.socket.commands).toHaveLength(before);
    // Und vor allem: kein CNAME, der ins Leere zeigt.
    expect(harness.dnsRecords.at(-1)?.type).toBe('A');
  });

  it('startet denselben Server, sobald der Router eingetragen ist', async () => {
    const harness = makeHarness({
      healthy: true,
      gameTypes: ROUTING_GAME_TYPES,
      routerHostname: 'router.example.tld',
    });
    const created = await harness.service.createServer(routedInput(), OWNER_ID);

    const starting = await harness.service.startServer(created.id, OWNER_ID);

    // Die Sperre hängt allein an der Konfiguration – ohne Codeänderung weg.
    expect(starting.status).toBe('starting');
    expect(harness.dnsRecords.at(-1)).toMatchObject({
      type: 'CNAME',
      content: 'router.example.tld',
    });
  });
});

describe('Periodische Server-Abfrage (Gefundener Punkt 74)', () => {
  function abfragen(harness: Harness) {
    return harness.socket.commands.filter((c) => c.command === 'SET_SERVER_QUERY');
  }

  it('setzt die Abfrage nach dem Start mit Host-Port und Abfrageart', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);

    const gesetzt = abfragen(harness);
    const server = await harness.service.requireServer(created.id);
    const primaer = server.assignedPorts.find((zuweisung) => zuweisung.primary);

    expect(gesetzt).toHaveLength(1);
    expect(gesetzt[0]?.payload).toMatchObject({
      serverId: created.id,
      target: {
        containerId: server.dockerContainerId,
        // Der Host-Port, unter dem der Container veröffentlicht ist – nicht der
        // Port im Container.
        hostPort: primaer?.publicPort,
        query: { kind: 'portConnect' },
      },
    });
  });

  it('beendet die Abfrage beim Stoppen', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);
    harness.socket.commands.length = 0;

    await harness.service.stopServer(created.id);

    expect(abfragen(harness)).toHaveLength(1);
    expect(abfragen(harness)[0]?.payload).toMatchObject({ serverId: created.id, target: null });
  });

  it('beendet die Abfrage beim Löschen, bevor der Container entfernt wird', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);
    await harness.service.stopServer(created.id);
    harness.socket.commands.length = 0;

    await harness.service.deleteServer(created.id);

    const reihenfolge = harness.socket.commands
      .map((c) => c.command)
      .filter((name) => name === 'SET_SERVER_QUERY' || name === 'DELETE');

    // Sonst fragte der Agent weiter einen Port ab, hinter dem nichts steht.
    expect(reihenfolge).toEqual(['SET_SERVER_QUERY', 'DELETE']);
  });

  it('setzt die Abfragen aller laufenden Server nach einem Verbindungsaufbau neu', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);
    harness.socket.commands.length = 0;

    // Der Agent hält seine Ziele im Arbeitsspeicher; nach einem Neustart sind
    // sie weg. Der Befehl ist idempotent, das Wiederholen also folgenlos.
    const gesetzt = await harness.service.refreshServerQueries(HOST.id);

    expect(gesetzt).toEqual([created.id]);
    expect(abfragen(harness)).toHaveLength(1);
  });

  it('beendet die Abfrage, wenn der Crash-Loop-Schutz abschaltet (Audit event-flow-10)', async () => {
    /*
     * Abgemeldet wurde die Abfrage bisher nur beim Stoppen und beim Löschen.
     * Ein Server, den der Crash-Loop-Schutz auf `error` gesetzt hat, wurde
     * dagegen weiter im 30-Sekunden-Takt abgefragt – der Agent schrieb
     * Fehlschläge ins Log, das Backend beantwortete jeden mit einem
     * Datenbankzugriff und einem Live-Frame für einen Server, der nicht läuft.
     */
    const harness = makeHarness({ healthy: 'pending' });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.servers.set(created.id, {
      ...(await harness.service.requireServer(created.id)),
      status: 'running',
    });
    harness.socket.commands.length = 0;

    // maxRestarts = 2: der dritte Absturz schaltet ab (`error`).
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      harness.advance(30_000);
      await harness.service.handleAgentEvent(HOST.id, {
        kind: 'event',
        event: 'CRASHED',
        serverId: created.id,
        payload: { exitCode: 137 },
        emittedAt: NOW.toISOString(),
      });

      for (let i = 0; i < 5; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    expect((await harness.service.requireServer(created.id)).status).toBe('error');
    expect(abfragen(harness).at(-1)?.payload).toMatchObject({
      serverId: created.id,
      target: null,
    });
  });

  it('beendet die Abfrage, wenn die Gesundheitsprüfung scheitert (Audit event-flow-10)', async () => {
    const harness = makeHarness({ healthy: false });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['error']);

    expect(abfragen(harness).at(-1)?.payload).toMatchObject({
      serverId: created.id,
      target: null,
    });
  });

  it('räumt das Ziel eines nicht laufenden Servers dabei ab', async () => {
    const harness = makeHarness();
    await harness.service.createServer(createInput(), OWNER_ID);
    harness.socket.commands.length = 0;

    /*
     * Überlebt der Agent einen Neustart des Backends, behält er seine Ziele
     * (Audit event-flow-10). Ein Server, der in dieser Zeit stehen geblieben
     * ist, würde sonst bis zum nächsten Agent-Neustart weiter abgefragt. Der
     * Abgleich schickt deshalb `null` – gesetzt wird trotzdem nichts.
     */
    expect(await harness.service.refreshServerQueries(HOST.id)).toEqual([]);

    const abgeraeumt = abfragen(harness);

    expect(abgeraeumt).toHaveLength(1);
    expect(abgeraeumt[0]?.payload).toMatchObject({ target: null });
  });
});

describe('Gruppen-Chat beim Anlegen (Gefundener Punkt 70)', () => {
  it('legt den Chat an, sobald der Server steht', async () => {
    const angelegt: string[] = [];
    const harness = makeHarness({
      ensureServerChat: (serverId) => {
        angelegt.push(serverId);

        return Promise.resolve('konversation-1');
      },
    });

    const created = await harness.service.createServer(createInput(), OWNER_ID);

    // Vorher entstand der Chat erst beim ersten Öffnen und fehlte bis dahin in
    // der Übersicht.
    expect(angelegt).toEqual([created.id]);
  });

  it('lässt den Server nicht scheitern, wenn der Chat nicht angelegt werden kann', async () => {
    const harness = makeHarness({
      ensureServerChat: () => Promise.reject(new Error('Chat gerade nicht erreichbar')),
    });

    const created = await harness.service.createServer(createInput(), OWNER_ID);

    // Der Chat ist Beiwerk zum Server; ein Server, der daran scheitert, wäre
    // die schlechtere Antwort.
    expect(created.status).toBe('stopped');
  });
});

describe('Verfügbarkeit der Ziel-Node (Gefundene Punkte 24 und 109)', () => {
  it('legt auf einer stillgelegten Node gar keinen Server an', async () => {
    const harness = makeHarness();
    harness.repository.hostStatus = 'maintenance';

    try {
      await harness.service.createServer(createInput(), OWNER_ID);
      expect.unreachable('Das Anlegen hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('NODE_UNAVAILABLE');
      expect((error as ServerOrchestrationError).message).toContain('keine neuen Server');
    }

    // Sonst bliebe ein Server übrig, den niemand starten kann.
    expect(harness.repository.servers.size).toBe(0);
    expect(harness.socket.commands).toHaveLength(0);
    expect(harness.dnsRecords).toEqual([]);
  });

  it('lässt einen Klon auf eine stillgelegte Node scheitern, statt ihn anzulegen', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    harness.repository.hostStatus = 'maintenance';

    // Der Klon läuft als Auftrag: Die Ablehnung landet deshalb nicht als
    // Ausnahme beim Aufrufer, sondern im Ergebnis des Auftrags.
    const job = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon', includeWorldData: false },
      OWNER_ID,
    );

    const ergebnis = await settleCloneJob(harness, source.id, job.id);

    expect(ergebnis.status).toBe('failed');
    expect(ergebnis.statusMessage).toContain('Wartung');

    // Nur die Vorlage steht noch da, kein halber Klon.
    expect(harness.repository.servers.size).toBe(1);
  });

  it('lehnt den Start auf einer stillgelegten Node mit NODE_UNAVAILABLE ab', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);
    const before = harness.socket.commands.length;

    harness.repository.hostStatus = 'maintenance';

    try {
      await harness.service.startServer(created.id, OWNER_ID);
      expect.unreachable('Der Start hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('NODE_UNAVAILABLE');
      expect((error as ServerOrchestrationError).message).toContain('Wartung');
    }

    // Weder Zustandswechsel noch Agent-Befehl: Die Ablehnung greift, bevor
    // irgendetwas reserviert oder abgeschickt wird.
    expect((await harness.service.requireServer(created.id)).status).toBe('stopped');
    expect(harness.socket.commands).toHaveLength(before);
  });

  it('lehnt den Start auf einer nicht verbundenen Node ebenfalls ab', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.hostStatus = 'offline';

    await expect(harness.service.startServer(created.id, OWNER_ID)).rejects.toMatchObject({
      code: 'NODE_UNAVAILABLE',
    });
  });

  it('lässt den Start zu, sobald die Node wieder online ist', async () => {
    const harness = makeHarness({ healthy: true });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.hostStatus = 'maintenance';
    await expect(harness.service.startServer(created.id, OWNER_ID)).rejects.toMatchObject({
      code: 'NODE_UNAVAILABLE',
    });

    harness.repository.hostStatus = 'online';
    const starting = await harness.service.startServer(created.id, OWNER_ID);

    expect(starting.status).toBe('starting');
  });
});

describe('Stoppen', () => {
  it('stoppt einen laufenden Server und meldet server.stopped', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    const stopped = await harness.service.stopServer(created.id);

    expect(stopped.status).toBe('stopped');
    expect(harness.socket.commands.map((c) => c.command)).toContain('STOP');
    expect(harness.emitted.map((e) => e.event)).toContain('server.stopped');
  });

  it('lehnt das Stoppen eines gestoppten Servers ab', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    try {
      await harness.service.stopServer(created.id);
      expect.unreachable('Das Stoppen hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('SERVER_STATE_CONFLICT');
    }
  });
});

describe('Neustart', () => {
  it('läuft über Stopp und Start – und damit über den Health-Check', async () => {
    // Ein `RESTART` am Lifecycle vorbei würde einen Server als „läuft"
    // zurücklassen, ohne dass je geprüft wurde, ob er antwortet.
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    harness.socket.commands.length = 0;

    await harness.service.restartServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    // Nur die Lifecycle-Befehle: Dazwischen steht seit Punkt 74 das Setzen und
    // Beenden der periodischen Abfrage, das mit dem Neustartweg nichts zu tun
    // hat.
    expect(
      harness.socket.commands
        .map((c) => c.command)
        .filter((name) => name === 'STOP' || name === 'START'),
    ).toEqual(['STOP', 'START']);
    expect(harness.emitted.map((e) => e.event)).toContain('server.restarted');
  });

  it('meldet server.restarted erst nach bestandener Gesundheitsprüfung (Audit event-flow-09)', async () => {
    /*
     * Der Vertrag sagt zu `server.restarted`: „Neustart abgeschlossen – der
     * Server ist wieder erreichbar". Gemeldet wurde es bisher, sobald der
     * START-Befehl heraus war – also bevor irgendjemand das geprüft hatte, und
     * es blieb auch dann stehen, wenn der Health-Check eine Minute später
     * scheiterte.
     */
    const pruefung = haltendeProbe();
    const harness = makeHarness({ probe: pruefung.probe });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await warteAufPruefungen(pruefung, 1);
    pruefung.antworte(true);
    await settle(harness, created.id, ['running']);

    harness.emitted.length = 0;

    await harness.service.restartServer(created.id, OWNER_ID);
    await warteAufPruefungen(pruefung, 2);

    // Der Health-Check läuft noch: Noch ist nichts „wieder erreichbar".
    expect((await harness.service.requireServer(created.id)).status).toBe('starting');
    expect(harness.emitted.map((e) => e.event)).not.toContain('server.restarted');

    pruefung.antworte(true);
    await settle(harness, created.id, ['running']);

    const ereignisse = harness.emitted.map((e) => e.event);

    // Genau eine Meldung für den ganzen Vorgang – und die richtige: kein
    // „Server gestoppt" für den Zwischenschritt, kein zusätzliches
    // „Server gestartet" neben dem Neustart.
    expect(ereignisse.filter((name) => name === 'server.restarted')).toEqual(['server.restarted']);
    expect(ereignisse).not.toContain('server.stopped');
    expect(ereignisse).not.toContain('server.started');
  });

  it('meldet keinen Neustart, wenn die Gesundheitsprüfung scheitert (Audit event-flow-09)', async () => {
    let gesund = true;
    const harness = makeHarness({
      probe: {
        check: (): Promise<HealthCheckResult> =>
          Promise.resolve({
            healthy: gesund,
            pingMs: gesund ? 5 : null,
            playersOnline: null,
            playersMax: null,
            reason: gesund ? null : 'nicht erreichbar',
          }),
      },
    });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    harness.emitted.length = 0;
    gesund = false;

    await harness.service.restartServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['error']);

    const ereignisse = harness.emitted.map((e) => e.event);

    expect(ereignisse).toContain('server.failed');
    expect(ereignisse).not.toContain('server.restarted');
  });
});

describe('Container neu bauen, wenn er veraltet ist (Punkt 114)', () => {
  it('baut vor dem Start neu, wenn die Konfiguration sich geändert hat', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);
    const ersterContainer = created.dockerContainerId;

    await harness.service.updateServer(created.id, {
      name: created.name,
      resourceLimits: created.resourceLimits,
      config: { greeting: 'Neuer Text', motdEnabled: true },
      startupParameters: created.startupParameters,
      autoShutdownEnabled: created.autoShutdown.enabled,
      autoShutdownTimeoutMinutes: created.autoShutdown.idleTimeoutMinutes,
    });

    harness.socket.commands.length = 0;

    await harness.service.startServer(created.id, OWNER_ID);
    const gestartet = await settle(harness, created.id, ['running']);

    // Erst weg, dann neu, dann starten: Umgebungsvariablen bekommt ein
    // Container nur beim Anlegen.
    expect(
      harness.socket.commands
        .map((c) => c.command)
        .filter((name) => name === 'DELETE' || name === 'CREATE' || name === 'START'),
    ).toEqual(['DELETE', 'CREATE', 'START']);
    expect(gestartet.dockerContainerId).not.toBe(ersterContainer);
    expect(gestartet.restartRequired).toBe(false);
  });

  it('baut vor dem Start neu, wenn die Definition ein neueres Image nennt', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    // So sieht ein Deployment mit neuer Spiel-Fassung aus.
    harness.repository.servers.set(created.id, {
      ...harness.repository.servers.get(created.id)!,
      imageRef: 'ghcr.io/test/echo:alt',
      containerSpecHash: 'veraltet',
    });

    harness.socket.commands.length = 0;

    await harness.service.startServer(created.id, OWNER_ID);
    const gestartet = await settle(harness, created.id, ['running']);

    expect(harness.socket.commands.map((c) => c.command)).toContain('CREATE');
    expect(gestartet.imageRef).toBe(TEST_GAME_TYPE.dockerImage);
  });

  /**
   * Konfiguration ändern, damit der nächste Start den Container neu baut –
   * derselbe Weg wie in der Oberfläche.
   */
  async function konfigurationAendern(harness: Harness, server: ServerRecord): Promise<void> {
    await harness.service.updateServer(server.id, {
      name: server.name,
      resourceLimits: server.resourceLimits,
      config: { greeting: 'Neuer Text', motdEnabled: true },
      startupParameters: server.startupParameters,
      autoShutdownEnabled: server.autoShutdown.enabled,
      autoShutdownTimeoutMinutes: server.autoShutdown.idleTimeoutMinutes,
    });
  }

  /** Antwort des Agents, wenn das CREATE auf der Node scheitert. */
  const createScheitert = {
    success: false,
    data: null,
    error: {
      code: 'AGENT_IMAGE_NOT_FOUND',
      message: 'Das Container-Image ist auf dem Homeserver nicht vorhanden.',
    },
  } as const;

  it('vergisst die Container-Id, sobald das DELETE durch ist (orchestration-core-03)', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await konfigurationAendern(harness, created);
    harness.socket.answers.set('CREATE', createScheitert);

    await expect(harness.service.startServer(created.id, OWNER_ID)).rejects.toMatchObject({
      code: 'AGENT_IMAGE_NOT_FOUND',
    });

    // Der Datensatz zeigt den Ist-Zustand der Node: Der alte Container ist weg,
    // ein neuer ist nie entstanden.
    const stehengeblieben = await harness.service.requireServer(created.id);

    expect(stehengeblieben.dockerContainerId).toBeNull();
    expect(stehengeblieben.containerSpecHash).toBeNull();
  });

  it('legt beim nächsten Start direkt neu an, ohne zweites DELETE (orchestration-core-03)', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await konfigurationAendern(harness, created);
    harness.socket.answers.set('CREATE', createScheitert);

    await expect(harness.service.startServer(created.id, OWNER_ID)).rejects.toBeDefined();

    harness.socket.answers.delete('CREATE');
    harness.socket.commands.length = 0;

    await harness.service.startServer(created.id, OWNER_ID);
    const gestartet = await settle(harness, created.id, ['running']);

    // Früher lief hier erneut ein DELETE auf die tote Id, das der Agent mit
    // AGENT_CONTAINER_NOT_FOUND beantwortete – der Server war nie wieder
    // startbar.
    expect(
      harness.socket.commands
        .map((c) => c.command)
        .filter((name) => name === 'DELETE' || name === 'CREATE' || name === 'START'),
    ).toEqual(['CREATE', 'START']);
    expect(gestartet.dockerContainerId).not.toBeNull();
  });

  it('bleibt nach einem gescheiterten Neuaufbau löschbar (orchestration-core-03)', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await konfigurationAendern(harness, created);
    harness.socket.answers.set('CREATE', createScheitert);

    await expect(harness.service.startServer(created.id, OWNER_ID)).rejects.toBeDefined();

    harness.socket.commands.length = 0;

    await expect(harness.service.deleteServer(created.id)).resolves.toBeUndefined();

    // Ohne Container gibt es nichts mehr zu löschen – und nichts, woran das
    // Löschen scheitern könnte.
    expect(harness.socket.commands.map((c) => c.command)).not.toContain('DELETE');
    expect(harness.repository.servers.size).toBe(0);
  });

  it('lässt einen unveränderten Container in Ruhe', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.socket.commands.length = 0;

    await harness.service.startServer(created.id, OWNER_ID);
    const gestartet = await settle(harness, created.id, ['running']);

    // Ein Neuaufbau bei jedem Start würde bei einem Spiel-Image Minuten kosten.
    expect(harness.socket.commands.map((c) => c.command)).not.toContain('CREATE');
    expect(gestartet.dockerContainerId).toBe(created.dockerContainerId);
  });
});

describe('Absturz und Crash-Loop-Schutz (Pflichtenheft §9)', () => {
  async function crash(harness: Harness, serverId: string): Promise<void> {
    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'CRASHED',
      serverId,
      payload: { exitCode: 137 },
      emittedAt: NOW.toISOString(),
    });
  }

  it('startet nach einem Absturz automatisch neu', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    harness.socket.commands.length = 0;
    await crash(harness, created.id);

    const restarted = await settle(harness, created.id, ['running', 'error']);

    expect(restarted.status).toBe('running');
    expect(harness.socket.commands.map((c) => c.command)).toContain('START');
    expect(harness.emitted.map((e) => e.event)).toContain('server.crashed');
  });

  it('behandelt den automatischen Neustart als regulären Serverstart', async () => {
    // Sonst würde ein gerade wiederhergestellter Server sofort fälschlich als
    // inaktiv erkannt und vom Auto-Shutdown erneut abgeschaltet.
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    const running = await settle(harness, created.id, ['running']);
    const firstStart = running.lastStartedAt;

    harness.advance(60_000);
    await crash(harness, created.id);

    const restarted = await settle(harness, created.id, ['running', 'error']);

    expect(restarted.lastStartedAt).not.toBe(firstStart);
    expect(Date.parse(restarted.lastStartedAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(firstStart ?? '') + 60_000,
    );
  });

  it('meldet Server-Ereignisse mit vollstaendiger Nutzlast (Gefundener Punkt 118)', async () => {
    // Ohne `ownerId`/`memberUserIds` findet die Empfaengeraufloesung niemanden,
    // ohne `serverName` steht kein Name in der Meldung, und ein fehlendes
    // `detail` liess das Rendern abstuerzen.
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    const angelegt = harness.emitted.find((e) => e.event === 'server.created');

    expect(angelegt?.payload).toMatchObject({
      serverId: created.id,
      serverName: created.name,
      ownerId: OWNER_ID,
      memberUserIds: [],
      detail: null,
    });
  });

  it('schaltet nach zu vielen Abstürzen im Zeitfenster nach error ab', async () => {
    // Der Server stürzt jedes Mal ab, während er noch hochfährt – genau der
    // Fall, für den es den Schutz gibt. Der Health-Check bleibt deshalb offen
    // (`healthy: 'pending'`), sonst würde ein erfolgreicher Start die
    // Absturzhistorie zurücksetzen.
    const harness = makeHarness({ healthy: 'pending' });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.servers.set(created.id, {
      ...(await harness.service.requireServer(created.id)),
      status: 'running',
    });

    // maxRestarts = 2: die ersten beiden Abstürze führen zu einem automatischen
    // Neustart, der dritte schaltet ab.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      harness.advance(30_000);
      await crash(harness, created.id);
      await new Promise((resolve) => setImmediate(resolve));
    }

    const final = await harness.service.requireServer(created.id);

    expect(final.status).toBe('error');
    expect(final.statusMessage).toContain('zu oft');
    // Die Nutzlast traegt den Grund jetzt als `detail` (Gefundener Punkt 118) -
    // `reason` gab es im Vertrag nie.
    const abgeschaltet = harness.emitted.filter(
      (e) =>
        e.event === 'server.failed' &&
        typeof e.payload.detail === 'string' &&
        e.payload.detail.includes('zu oft'),
    );

    expect(abgeschaltet).toHaveLength(1);
    // Und sie ist vollstaendig: ohne Besitzer faende die Empfaengeraufloesung niemanden.
    expect(abgeschaltet[0]?.payload).toMatchObject({
      serverId: created.id,
      ownerId: OWNER_ID,
      serverName: created.name,
    });
  });

  it('startet vor dem Auslösen des Schutzes jedes Mal automatisch neu', async () => {
    const harness = makeHarness({ healthy: 'pending' });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.servers.set(created.id, {
      ...(await harness.service.requireServer(created.id)),
      status: 'running',
    });

    harness.socket.commands.length = 0;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      harness.advance(30_000);
      await crash(harness, created.id);
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(harness.socket.commands.filter((c) => c.command === 'START')).toHaveLength(2);
    expect((await harness.service.requireServer(created.id)).status).toBe('starting');
  });
});

describe('Auto-Shutdown (Pflichtenheft §9)', () => {
  /**
   * Ein Server eines Spiels, dessen Abfrage tatsächlich eine Spielerzahl
   * liefert (`gamedig`) – die Voraussetzung dafür, dass „leer" überhaupt
   * messbar ist (Audit event-flow-08).
   */
  async function laufenderMinecraftServer(): Promise<{
    harness: Harness;
    serverId: string;
  }> {
    const harness = makeHarness({ gamePhase: 2 });
    const created = await harness.service.createServer(
      createInput('mein-server', TEST_MINECRAFT_GAME_TYPE),
      OWNER_ID,
    );

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    return { harness, serverId: created.id };
  }

  it('schaltet einen lange leeren Server ab', async () => {
    const { harness, serverId } = await laufenderMinecraftServer();

    harness.advance(60 * 60_000);

    const stopped = await harness.service.runAutoShutdownSweep(HOST.id);

    expect(stopped).toEqual([serverId]);
    expect(harness.emitted.map((e) => e.event)).toContain('autoShutdown.triggered');
  });

  it('meldet den Vorgang nur einmal (Audit event-flow-09)', async () => {
    const { harness } = await laufenderMinecraftServer();

    harness.advance(60 * 60_000);
    harness.emitted.length = 0;

    await harness.service.runAutoShutdownSweep(HOST.id);

    const ereignisse = harness.emitted.map((e) => e.event);

    /*
     * „Server gestoppt" **und** „automatisch abgeschaltet" wären zwei Meldungen
     * für einen Vorgang – bei einer Discord-Regel je Ereignis auch zwei Posts.
     * Bleibt die genauere: Sie nennt den Grund und die Inaktivitätsdauer.
     */
    expect(ereignisse).toContain('autoShutdown.triggered');
    expect(ereignisse).not.toContain('server.stopped');
  });

  it('lässt einen Server innerhalb der Schonfrist laufen', async () => {
    const { harness } = await laufenderMinecraftServer();

    harness.advance(5 * 60_000);

    expect(await harness.service.runAutoShutdownSweep(HOST.id)).toEqual([]);
  });

  it('lässt ein Spiel ohne Spielerzahl laufen (Audit event-flow-08)', async () => {
    /*
     * Der Echo-Testtyp kennt nur den Port-Connect-Test. Ohne gemessene
     * Spielerzahl bleibt `lastActivityAt` leer, und die Rechnung fiele auf den
     * Startzeitpunkt zurück: Der Server ginge 30 Minuten nach dem Start aus,
     * ganz gleich, wie viele Spieler verbunden sind. „Nicht messbar" ist nicht
     * „leer" – der Auto-Shutdown greift hier deshalb nicht.
     */
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    harness.advance(6 * 60 * 60_000);

    expect(await harness.service.runAutoShutdownSweep(HOST.id)).toEqual([]);
    expect((await harness.service.requireServer(created.id)).status).toBe('running');
    expect(harness.emitted.map((e) => e.event)).not.toContain('autoShutdown.triggered');
  });

  it('meldet den unbekannten Zustand als activityUnknown', async () => {
    // Die Entscheidung selbst – damit im Test sichtbar ist, *warum* der Server
    // läuft, und nicht nur, *dass* er läuft.
    expect(
      decideAutoShutdown({
        settings: { enabled: true, idleTimeoutMinutes: 30, graceMinutes: 15 },
        status: 'running',
        lastStartedAt: new Date(NOW.getTime() - 6 * 60 * 60_000).toISOString(),
        lastActivityAt: null,
        playersOnline: null,
        playerCountAvailable: false,
        now: NOW,
      }),
    ).toEqual({ action: 'keepRunning', reason: 'activityUnknown' });
  });

  it('lässt einen gestoppten Server in Ruhe', async () => {
    const harness = makeHarness();

    await harness.service.createServer(createInput(), OWNER_ID);

    expect(await harness.service.runAutoShutdownSweep(HOST.id)).toEqual([]);
  });
});

describe('Klonen (Pflichtenheft §9)', () => {
  it('übernimmt die Konfiguration und vergibt eine eigene, neue Subdomain', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    await harness.service.updateServer(source.id, {
      name: source.name,
      resourceLimits: source.resourceLimits,
      config: { greeting: 'Hallo Klon' },
      startupParameters: source.startupParameters,
      autoShutdownEnabled: source.autoShutdown.enabled,
      autoShutdownTimeoutMinutes: source.autoShutdown.idleTimeoutMinutes,
    });

    const job = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon-eins', includeWorldData: false },
      OWNER_ID,
    );

    // Der Aufruf liefert den Auftrag; der Server entsteht im Hintergrund.
    expect(job).toMatchObject({
      serverId: source.id,
      targetName: 'Klon',
      targetSubdomain: 'klon-eins',
      includeWorldData: false,
      status: 'queued',
    });

    const fertig = await settleCloneJob(harness, source.id, job.id);

    expect(fertig.status).toBe('completed');
    expect(fertig.progressPercent).toBe(100);
    expect(fertig.targetServerId).not.toBeNull();

    const clone = await harness.service.requireServer(fertig.targetServerId as string);

    expect(clone.subdomain).toBe('klon-eins');
    expect(clone.configJson.greeting).toBe('Hallo Klon');
    expect(clone.clonedFromServerId).toBe(source.id);
    expect(harness.emitted.map((e) => e.event)).toContain('server.cloned');
  });

  it('meldet einen Klon nur als server.cloned, nicht zusätzlich als server.created (Audit event-flow-09)', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    // Nur die Ereignisse des Klon-Laufs betrachten – die Quelle hat ihr
    // eigenes `server.created` beim Anlegen bekommen, und das gehört ihr.
    harness.emitted.length = 0;

    const job = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon-zwei', includeWorldData: false },
      OWNER_ID,
    );
    const fertig = await settleCloneJob(harness, source.id, job.id);

    expect(fertig.status).toBe('completed');

    const ereignisse = harness.emitted.map((e) => e.event);

    expect(ereignisse).toContain('server.cloned');
    expect(ereignisse).not.toContain('server.created');
  });

  it('lehnt eine bereits vergebene Subdomain für den Klon ab, bevor ein Auftrag entsteht', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    try {
      await harness.service.cloneServer(
        source.id,
        { name: 'Klon', subdomain: 'vorlage', includeWorldData: false },
        OWNER_ID,
      );
      expect.unreachable('Die Subdomain hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('SUBDOMAIN_TAKEN');
    }

    expect(harness.emitted.map((e) => e.event)).not.toContain('serverClone.progressed');
  });

  it('kopiert die Weltdaten über die Backup-Mechanik mit', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    const job = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon-welt', includeWorldData: true },
      OWNER_ID,
    );
    const fertig = await settleCloneJob(harness, source.id, job.id);

    expect(fertig.status).toBe('completed');
    expect(fertig.copiedBytes).toBe(4_096);
    expect(fertig.totalBytes).toBe(4_096);

    const befehle = harness.socket.commands.map((eintrag) => eintrag.command);

    // Packen, Zurückspielen, Zwischenarchiv wegräumen – in dieser Reihenfolge.
    expect(befehle.filter((name) => name.endsWith('_BACKUP'))).toEqual([
      'CREATE_BACKUP',
      'RESTORE_BACKUP',
      'DELETE_BACKUP',
    ]);

    const restore = harness.socket.commands.find((eintrag) => eintrag.command === 'RESTORE_BACKUP');

    expect(restore?.payload).toMatchObject({
      targetPath: `/srv/palantir/servers/${String(fertig.targetServerId)}`,
      expectedChecksum: 'abc123',
    });
  });

  it('hält den Quellserver nur auf ausdrücklichen Wunsch an (Gefundener Punkt 107)', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    const ohne = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon-ohne-stopp', includeWorldData: true },
      OWNER_ID,
    );
    await settleCloneJob(harness, source.id, ohne.id);

    const ersterBackupBefehl = harness.socket.commands.find(
      (eintrag) => eintrag.command === 'CREATE_BACKUP',
    );

    // Voreinstellung bleibt der laufende Betrieb – niemand hat um ein
    // Abschalten gebeten.
    expect(ersterBackupBefehl?.payload).toMatchObject({ stopContainer: false });
  });

  it('reicht stopSourceServer als stopContainer an den Agent durch', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    const job = await harness.service.cloneServer(
      source.id,
      {
        name: 'Klon',
        subdomain: 'klon-mit-stopp',
        includeWorldData: true,
        stopSourceServer: true,
      },
      OWNER_ID,
    );
    const fertig = await settleCloneJob(harness, source.id, job.id);

    expect(fertig.status).toBe('completed');

    const backupBefehl = harness.socket.commands.find(
      (eintrag) => eintrag.command === 'CREATE_BACKUP',
    );

    expect(backupBefehl?.payload).toMatchObject({ stopContainer: true });
  });

  it('ignoriert stopSourceServer ohne Weltdaten-Kopie', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    const job = await harness.service.cloneServer(
      source.id,
      {
        name: 'Klon',
        subdomain: 'klon-ohne-welt',
        includeWorldData: false,
        stopSourceServer: true,
      },
      OWNER_ID,
    );
    await settleCloneJob(harness, source.id, job.id);

    // Ohne Weltdaten wird nichts gepackt – und deshalb auch nichts angehalten.
    expect(harness.socket.commands.map((eintrag) => eintrag.command)).not.toContain(
      'CREATE_BACKUP',
    );
  });

  it('meldet einen gescheiterten Klon im Auftrag statt zu werfen', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    harness.socket.answers.set('CREATE_BACKUP', {
      success: false,
      data: null,
      error: { code: 'AGENT_COMMAND_FAILED', message: 'Platte voll.' },
    });

    const job = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon-kaputt', includeWorldData: true },
      OWNER_ID,
    );
    const fertig = await settleCloneJob(harness, source.id, job.id);

    expect(fertig.status).toBe('failed');
    expect(fertig.statusMessage).toBeTruthy();
  });

  it('setzt den Zielserver auf error, wenn die Weltdaten-Kopie scheitert (orchestration-features-04)', async () => {
    /*
     * Der Klon ist angelegt (Server, DNS, Ports, Container), das Zurückspielen
     * der Welt scheitert. Bis W2-10 endete nur der Auftrag auf `failed` – der
     * Zielserver stand unauffällig da, und nach 15 Minuten (Aufbewahrung des
     * Auftrags) deutete nichts mehr darauf hin, dass ihm die Welt fehlt.
     */
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    harness.socket.answers.set('RESTORE_BACKUP', {
      success: false,
      data: null,
      error: { code: 'AGENT_COMMAND_FAILED', message: 'Die Prüfsumme passt nicht.' },
    });

    const job = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon-ohne-welt', includeWorldData: true },
      OWNER_ID,
    );
    const fertig = await settleCloneJob(harness, source.id, job.id);

    expect(fertig.status).toBe('failed');
    expect(fertig.targetServerId).toBeTruthy();

    const ziel = await harness.service.requireServer(String(fertig.targetServerId));

    expect(ziel.status).toBe('error');
    expect(ziel.statusMessage).toContain('Weltdaten');
    expect(ziel.statusMessage).toContain('Welt aber leer');

    // Der Fehlerzustand wird auch gemeldet, nicht nur in die Zeile geschrieben.
    expect(
      harness.emitted.some(
        (eintrag) => eintrag.event === 'server.failed' && eintrag.payload.serverId === ziel.id,
      ),
    ).toBe(true);
  });

  it('meldet einen Auftrag an einem fremden Server als unbekannt', async () => {
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);
    const job = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon-fremd', includeWorldData: false },
      OWNER_ID,
    );

    expect(harness.service.findCloneJob(source.id, job.id)).not.toBeNull();
    expect(harness.service.findCloneJob('99999999-9999-4999-8999-999999999999', job.id)).toBeNull();
  });
});

describe('Löschen', () => {
  it('entfernt Container, DNS-Eintrag und Datensatz', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.deleteServer(created.id);

    expect(harness.socket.commands.map((c) => c.command)).toContain('DELETE');
    expect(harness.deletedDnsNames).toEqual(['mein-server.example.tld']);
    expect(harness.repository.servers.size).toBe(0);
    expect(harness.emitted.map((e) => e.event)).toContain('server.deleted');
  });

  it('vergisst die fluechtigen Speicherstaende des Servers (orchestration-features-13)', async () => {
    /*
     * `LatestQueryCache` und `ClockSkewMonitor` liegen nur im Prozess und
     * hingen bisher bis zum Neustart am geloeschten Server - `forget()` hatte
     * ueberhaupt keinen Aufrufer ausser dem eigenen Test (Fundpunkt 137). Der
     * Spion haengt an der Prototyp-Methode, weil beide Speicher dienstintern
     * angelegt werden.
     */
    const vergessenQuery = vi.spyOn(LatestQueryCache.prototype, 'forget');
    const vergessenUhr = vi.spyOn(ClockSkewMonitor.prototype, 'forget');
    // Seit Fundpunkt 175 haengt auch der zuletzt gemessene Plattenplatz am
    // Server - er muss denselben Weg gehen.
    const vergessenPlatte = vi.spyOn(LatestDiskUsageCache.prototype, 'forget');

    try {
      const harness = makeHarness();
      const created = await harness.service.createServer(createInput(), OWNER_ID);

      await harness.service.deleteServer(created.id);

      expect(vergessenQuery).toHaveBeenCalledWith(created.id);
      expect(vergessenUhr).toHaveBeenCalledWith(created.id);
      expect(vergessenPlatte).toHaveBeenCalledWith(created.id);
    } finally {
      vergessenQuery.mockRestore();
      vergessenUhr.mockRestore();
      vergessenPlatte.mockRestore();
    }
  });

  it('gibt die oeffentlichen Ports wieder an den Pool zurueck', async () => {
    // Sonst bliebe eine Portzuordnung ohne Server zurueck (Pflichtenheft §2.4).
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.deleteServer(created.id);

    expect(harness.releasedPorts).toEqual([created.id]);
  });

  it('löscht auch, wenn der Container auf der Node schon fehlt (orchestration-core-03)', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    // Container von Hand entfernt oder Rest eines abgebrochenen Neuaufbaus:
    // Das Ziel „Container weg" ist erreicht, also ist der Befehl erledigt.
    harness.socket.answers.set('DELETE', {
      success: false,
      data: null,
      error: {
        code: 'AGENT_CONTAINER_NOT_FOUND',
        message: 'Der Container ist auf dem Homeserver nicht vorhanden.',
      },
    });

    await expect(harness.service.deleteServer(created.id)).resolves.toBeUndefined();

    expect(harness.repository.servers.size).toBe(0);
    expect(harness.deletedDnsNames).toEqual(['mein-server.example.tld']);
    expect(harness.releasedPorts).toEqual([created.id]);
  });

  it('nimmt einen Abbruch hinter dem Container-DELETE beim zweiten Anlauf auf (orchestration-core-03)', async () => {
    const harness = makeHarness({ failNextDnsDelete: true });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await expect(harness.service.deleteServer(created.id)).rejects.toBeDefined();

    // Container weg, Datensatz noch da – und er weiß, dass es keinen mehr gibt.
    expect(harness.repository.servers.get(created.id)?.dockerContainerId).toBeNull();

    harness.socket.commands.length = 0;

    await expect(harness.service.deleteServer(created.id)).resolves.toBeUndefined();

    expect(harness.socket.commands.map((c) => c.command)).not.toContain('DELETE');
    expect(harness.repository.servers.size).toBe(0);
    expect(harness.releasedPorts).toEqual([created.id]);
  });
});

describe('Prozess-Schutz: Zwischenzustände und Dubletten (Audit W0-5, Fundpunkte 126/127)', () => {
  /*
   * Der Spion an `unhandledRejection` ist die eigentliche Prüfung: Ein
   * Hintergrundlauf, der wirft, ohne dass jemand ihn fängt, beendete bisher
   * das ganze Backend.
   */
  const rejections: unknown[] = [];
  const spion = (reason: unknown): void => {
    rejections.push(reason);
  };

  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', spion);
  });

  afterEach(() => {
    process.off('unhandledRejection', spion);
  });

  async function tick(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  function crashedFrame(serverId: string): string {
    return JSON.stringify({
      kind: 'event',
      event: 'CRASHED',
      serverId,
      payload: { exitCode: 137 },
      emittedAt: NOW.toISOString(),
    });
  }

  it('lehnt das Löschen während des Startvorgangs mit SERVER_STATE_CONFLICT ab', async () => {
    const harness = makeHarness({ healthy: 'pending' });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    const before = harness.socket.commands.length;

    await expect(harness.service.deleteServer(created.id)).rejects.toMatchObject({
      code: 'SERVER_STATE_CONFLICT',
      details: { status: 'starting' },
    });

    // Nichts ist passiert: kein DELETE am Agent, Datensatz und DNS bleiben.
    expect(harness.socket.commands).toHaveLength(before);
    expect(harness.repository.servers.has(created.id)).toBe(true);
    expect(harness.deletedDnsNames).toEqual([]);
  });

  it('lässt das Löschen in `stopping` zu – der Ausweg aus einem hängenden Stoppvorgang', async () => {
    // Ein Server kann nach einem Backend-Neustart dauerhaft in `stopping`
    // hängen (orchestration-core-04); Löschen muss dann weiter möglich sein.
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.servers.set(created.id, {
      ...(await harness.service.requireServer(created.id)),
      status: 'stopping',
    });

    await expect(harness.service.deleteServer(created.id)).resolves.toBeUndefined();
    expect(harness.repository.servers.has(created.id)).toBe(false);
  });

  it('lässt das Löschen zu, sobald der Start abgeschlossen ist', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    await expect(harness.service.deleteServer(created.id)).resolves.toBeUndefined();
    expect(harness.repository.servers.has(created.id)).toBe(false);
  });

  it('beendet den Health-Check ohne Ablehnung, wenn der Server währenddessen verschwindet', async () => {
    // Der Datensatz kann auch am Guard vorbei verschwinden (Kaskade in der
    // Datenbank, Abgleich). Der Health-Lauf darf dann nicht werfen.
    let antworten: ((result: HealthCheckResult) => void) | undefined;
    const probe: HealthProbe = {
      check: () =>
        new Promise<HealthCheckResult>((resolve) => {
          antworten = resolve;
        }),
    };
    const harness = makeHarness({ probe });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await tick();
    expect(antworten).toBeDefined();

    harness.repository.servers.delete(created.id);
    antworten?.({ healthy: true, pingMs: 5, playersOnline: null, playersMax: null, reason: null });
    await tick();

    expect(rejections).toEqual([]);
    expect(harness.emitted.map((e) => e.event)).not.toContain('server.started');
    expect(
      harness.logged.some(
        (line) => line.level === 'warn' && line.message.includes('Health-Check abgebrochen'),
      ),
    ).toBe(true);
    // Und nicht als Fehlschlag des Hintergrundlaufs geführt.
    expect(harness.logged.some((line) => line.level === 'error')).toBe(false);
  });

  it('behandelt awaitStartupHealth für einen unbekannten Server als abgebrochenen Start', async () => {
    const harness = makeHarness();

    await expect(harness.service.awaitStartupHealth('gibt-es-nicht')).resolves.toBeUndefined();
    expect(rejections).toEqual([]);
  });

  it('verwirft ein CRASHED, das im aktuellen Zustand nicht anwendbar ist, mit einer Warnung', async () => {
    // Ein Server, der nie gestartet wurde, kann nicht abstürzen – die
    // Übergangstabelle verbietet `stopped → crashed`. Bisher warf das.
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await expect(
      harness.service.handleAgentEvent(HOST.id, {
        kind: 'event',
        event: 'CRASHED',
        serverId: created.id,
        payload: { exitCode: 1 },
        emittedAt: NOW.toISOString(),
      }),
    ).resolves.toBeUndefined();

    expect((await harness.service.requireServer(created.id)).status).toBe('stopped');
    expect(
      harness.logged.some(
        (line) => line.level === 'warn' && line.message.includes('Absturzmeldung verworfen'),
      ),
    ).toBe(true);
    expect(harness.logged.some((line) => line.level === 'error')).toBe(false);
  });

  it('meldet ein doppeltes CRASHED nach ausgelöstem Crash-Loop-Schutz nur im Log', async () => {
    const harness = makeHarness({ healthy: 'pending' });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.servers.set(created.id, {
      ...(await harness.service.requireServer(created.id)),
      status: 'running',
    });

    // maxRestarts = 2: der dritte Absturz schaltet ab (`error`).
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      harness.advance(30_000);
      await harness.service.handleAgentEvent(HOST.id, {
        kind: 'event',
        event: 'CRASHED',
        serverId: created.id,
        payload: { exitCode: 137 },
        emittedAt: NOW.toISOString(),
      });
      await tick();
    }

    expect((await harness.service.requireServer(created.id)).status).toBe('error');
    harness.logged.length = 0;

    // Die Wiederholung derselben Meldung (Reconnect) – `error → crashed` ist verboten.
    await expect(
      harness.service.handleAgentEvent(HOST.id, {
        kind: 'event',
        event: 'CRASHED',
        serverId: created.id,
        payload: { exitCode: 137 },
        emittedAt: NOW.toISOString(),
      }),
    ).resolves.toBeUndefined();

    expect((await harness.service.requireServer(created.id)).status).toBe('error');
    expect(harness.logged.map((line) => line.level)).toEqual(['warn']);
    expect(harness.logged[0]?.details).toMatchObject({ serverId: created.id, status: 'error' });
  });

  it('lässt ein doppeltes CRASHED über den Agent-Kanal nicht zur unbehandelten Ablehnung werden', async () => {
    // Derselbe Weg wie im Betrieb: Frame → AgentSession → handleAgentEvent.
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    const socket = new AnsweringSocket();
    const session = new AgentSession({
      hostId: HOST.id,
      socket,
      handlers: {
        onStateReport: () => undefined,
        onEvent: (hostId, frame) => harness.service.handleAgentEvent(hostId, frame),
      },
      log: {
        info: (): void => undefined,
        warn: (details, message): void => {
          harness.logged.push({ level: 'warn', details, message });
        },
        error: (details, message): void => {
          harness.logged.push({ level: 'error', details, message });
        },
      },
    });
    session.handleMessage(
      JSON.stringify({
        kind: 'hello',
        protocolVersion: 1,
        agentVersion: 'test',
        sentAt: NOW.toISOString(),
      }),
    );
    harness.logged.length = 0;

    session.handleMessage(crashedFrame(created.id));
    session.handleMessage(crashedFrame(created.id));
    await tick();

    expect(rejections).toEqual([]);
    expect(harness.logged.filter((line) => line.level === 'error')).toEqual([]);
    expect(harness.logged.filter((line) => line.level === 'warn')).toHaveLength(2);
    expect((await harness.service.requireServer(created.id)).status).toBe('stopped');
  });

  it('schickt den verlorenen Stopp-Befehl erneut, statt einen verbotenen Übergang zu planen', async () => {
    /*
     * Ein Server steht laut Datenbank auf `stopping`, der Container läuft aber
     * noch (orchestration-core-04). Bis W2-10 plante der Abgleich hier
     * `verifyHealth`; die Tabelle verbietet `stopping → starting`, der Server
     * blieb dauerhaft in `stopping` hängen (weder Start noch Stopp erlaubt).
     * Jetzt geht der verlorene `STOP` erneut hinaus – der Wunsch des Nutzers
     * steht ja schon in der Datenbank.
     */
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);
    const server = await harness.service.requireServer(created.id);

    harness.repository.servers.set(created.id, { ...server, status: 'stopping' });
    harness.logged.length = 0;
    harness.socket.commands.length = 0;

    await harness.service.reconcile(HOST.id, {
      kind: 'stateReport',
      reason: 'connected',
      containers: [
        {
          serverId: created.id,
          containerId: server.dockerContainerId ?? 'c1',
          status: 'running',
          exitCode: null,
          startedAt: NOW.toISOString(),
          observedAt: NOW.toISOString(),
        },
      ],
      reportedAt: NOW.toISOString(),
    });

    expect(rejections).toEqual([]);
    expect(harness.logged.filter((line) => line.level === 'error')).toEqual([]);
    expect(harness.socket.commands.map((befehl) => befehl.command)).toContain('STOP');
    expect((await harness.service.requireServer(created.id)).status).toBe('stopped');
  });
});

describe('Gemessene Node-Ressourcen (Pflichtenheft §11)', () => {
  it('übernimmt nodeStats aus dem Bericht in die Node-Totals', async () => {
    const harness = makeHarness();

    await harness.service.reconcile(HOST.id, {
      kind: 'stateReport',
      reason: 'connected',
      containers: [],
      nodeStats: {
        cpuCores: 8,
        cpuLoad1m: 0.5,
        ramTotalMb: 28_672,
        ramAvailableMb: 20_000,
        diskTotalMb: 1_500_000,
        diskAvailableMb: 1_400_000,
        observedAt: NOW.toISOString(),
      },
      reportedAt: NOW.toISOString(),
    });

    expect(harness.repository.measuredUpdates).toEqual([
      {
        hostId: HOST.id,
        ramMb: 28_672,
        cpuCores: 8,
        diskMb: 1_500_000,
        // Auch die Momentaufnahme wird festgehalten (Gefundener Punkt 96).
        usage: {
          ramAvailableMb: 20_000,
          diskAvailableMb: 1_400_000,
          cpuLoad1m: 0.5,
          observedAt: NOW,
        },
      },
    ]);
  });

  it('lässt die Totals unangetastet, wenn der Bericht kein nodeStats trägt', async () => {
    const harness = makeHarness();

    await harness.service.reconcile(HOST.id, {
      kind: 'stateReport',
      reason: 'connected',
      containers: [],
      reportedAt: NOW.toISOString(),
    });

    expect(harness.repository.measuredUpdates).toHaveLength(0);
  });
});

describe('Soll/Ist-Abgleich (Pflichtenheft §2.2)', () => {
  it('markiert einen während der Trennung abgestürzten Server', async () => {
    const harness = makeHarness({ healthy: false });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.servers.set(created.id, {
      ...(await harness.service.requireServer(created.id)),
      status: 'running',
    });

    await harness.service.reconcile(HOST.id, {
      kind: 'stateReport',
      reason: 'connected',
      containers: [
        {
          serverId: created.id,
          containerId: created.dockerContainerId ?? 'c1',
          status: 'exited',
          exitCode: 137,
          startedAt: null,
          observedAt: NOW.toISOString(),
        },
      ],
      reportedAt: NOW.toISOString(),
    });

    const after = await settle(harness, created.id, ['crashed', 'starting', 'error']);

    expect(['crashed', 'starting', 'error']).toContain(after.status);
    expect(harness.emitted.map((e) => e.event)).toContain('server.crashed');
  });

  it('zieht einen sauber beendeten Server auf stopped nach', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.repository.servers.set(created.id, {
      ...(await harness.service.requireServer(created.id)),
      status: 'stopping',
    });

    await harness.service.reconcile(HOST.id, {
      kind: 'stateReport',
      reason: 'connected',
      containers: [
        {
          serverId: created.id,
          containerId: created.dockerContainerId ?? 'c1',
          status: 'exited',
          exitCode: 0,
          startedAt: null,
          observedAt: NOW.toISOString(),
        },
      ],
      reportedAt: NOW.toISOString(),
    });

    expect((await harness.service.requireServer(created.id)).status).toBe('stopped');
  });

  it('prüft einen unerwartet laufenden Container über den Health-Check', async () => {
    // `running` setzt einen bestandenen Health-Check voraus – auch im Abgleich.
    const harness = makeHarness({ healthy: true });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.reconcile(HOST.id, {
      kind: 'stateReport',
      reason: 'connected',
      containers: [
        {
          serverId: created.id,
          containerId: created.dockerContainerId ?? 'c1',
          status: 'running',
          exitCode: null,
          startedAt: NOW.toISOString(),
          observedAt: NOW.toISOString(),
        },
      ],
      reportedAt: NOW.toISOString(),
    });

    expect((await harness.service.requireServer(created.id)).status).toBe('running');
  });

  it('markiert einen Server, dessen Container verschwunden ist, als error', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.reconcile(HOST.id, {
      kind: 'stateReport',
      reason: 'connected',
      containers: [],
      reportedAt: NOW.toISOString(),
    });

    const after = await harness.service.requireServer(created.id);

    expect(after.status).toBe('error');
    expect(after.statusMessage).toContain('nicht mehr');
  });
});

describe('Ereignisse des Agents', () => {
  it('zieht bei verbundenen Spielern den Aktivitätszeitpunkt nach – mit der Backend-Uhr (W2-14)', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);
    // Der Agent meldet zwei Minuten zu früh. Bis W2-14 landete genau dieser
    // Wert als `lastActivityAt` in der Datenbank – die Inaktivitätsfrist des
    // Auto-Shutdown hing damit an einer fremden Uhr.
    const agentZeit = new Date(harness.now().getTime() + 120_000).toISOString();
    const backendZeit = harness.now().toISOString();

    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'STATS_UPDATE',
      serverId: created.id,
      payload: { source: 'serverQuery', playersOnline: 2 },
      emittedAt: agentZeit,
    });

    expect((await harness.service.requireServer(created.id)).lastActivityAt).toBe(backendZeit);
  });

  it('zieht ohne Spieler nichts nach', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'STATS_UPDATE',
      serverId: created.id,
      payload: { source: 'serverQuery', playersOnline: 0 },
      emittedAt: new Date(NOW.getTime() + 120_000).toISOString(),
    });

    expect((await harness.service.requireServer(created.id)).lastActivityAt).toBeNull();
  });

  it('meldet eine Konsolenzeile als server.consoleLineAppended (Gefundener Punkt 101)', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'LOG_LINE',
      serverId: created.id,
      payload: {
        containerId: 'container-1',
        stream: 'stdout',
        message: 'Server gestartet',
        timestamp: '2026-08-26T12:00:01.000Z',
        at: NOW.toISOString(),
      },
      emittedAt: NOW.toISOString(),
    });

    const gemeldet = harness.emitted.filter((e) => e.event === 'server.consoleLineAppended');

    expect(gemeldet).toHaveLength(1);
    expect(gemeldet[0]?.payload).toMatchObject({
      serverId: created.id,
      line: {
        serverId: created.id,
        source: 'stdout',
        text: 'Server gestartet',
        timestamp: '2026-08-26T12:00:01.000Z',
      },
    });

    // Die Zeile lief bisher fälschlich als Zustandswechsel mit einem Feld
    // `logLine` – ein Feld, das der Vertrag dieses Ereignisses nicht kennt.
    expect(
      harness.emitted.filter((e) => e.event === 'server.statusChanged' && 'logLine' in e.payload),
    ).toEqual([]);
  });

  it('bringt die Messwerte der Container-Runtime in die Form von ServerLiveStats', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);
    const backendZeit = harness.now().toISOString();

    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'STATS_UPDATE',
      serverId: created.id,
      payload: {
        containerId: 'container-1',
        cpuPercent: 12.5,
        memoryUsedBytes: 1024 * 1024 * 1024,
        networkRxBytes: 10,
        networkTxBytes: 20,
        sampledAt: '2026-08-26T12:00:02.000Z',
      },
      emittedAt: NOW.toISOString(),
    });

    const gemeldet = harness.emitted.find((e) => e.event === 'server.statsUpdated');

    // Der Agent zählt Bytes, `ServerLiveStats` zählt MiB – bis hierher wurde die
    // Nutzlast unverändert durchgereicht. `updatedAt` trägt seit W2-14 die
    // Empfangszeit des Backends und nicht mehr `sampledAt` aus der Agent-Uhr.
    expect(gemeldet?.payload).toEqual({
      serverId: created.id,
      stats: {
        cpuPercent: 12.5,
        ramUsedMb: 1_024,
        diskUsedMb: null,
        pingMs: null,
        playersOnline: null,
        playersMax: null,
        networkRxBytes: 10,
        networkTxBytes: 20,
        updatedAt: backendZeit,
      },
    });
  });

  it('ordnet ein Ereignis ohne serverId über die Container-Id zu', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);
    const containerId = (await harness.service.requireServer(created.id)).dockerContainerId;

    expect(containerId).not.toBeNull();

    // So meldet die Container-Runtime: Sie kennt nur ihre Container, nicht die
    // Server – ohne die Zuordnung wären die Zeilen bisher verworfen worden.
    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'LOG_LINE',
      serverId: null,
      payload: { containerId, stream: 'stderr', message: 'Warnung', at: NOW.toISOString() },
      emittedAt: NOW.toISOString(),
    });

    expect(harness.emitted.filter((e) => e.event === 'server.consoleLineAppended')).toHaveLength(1);
  });

  it('verwirft ein Ereignis für einen unbekannten Server', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.handleAgentEvent(HOST.id, {
        kind: 'event',
        event: 'CRASHED',
        serverId: '55555555-5555-4555-8555-555555555555',
        payload: {},
        emittedAt: NOW.toISOString(),
      }),
    ).resolves.toBeUndefined();
  });

  it('verwirft ein Ereignis, das eine fremde Node für diesen Server meldet (Audit security-matrix-07)', async () => {
    /*
     * Multi-Node: Der Agent von Node B meldet ein Ereignis mit der `serverId`
     * eines Servers, der auf Node A liegt. Ohne Node-Bindung löste ein
     * `CRASHED` dort einen Zustandswechsel samt automatischem Neustart aus –
     * ein Agent konnte also fremde Server abschießen. Der Soll/Ist-Abgleich
     * zieht die Grenze über `listByHost` längst richtig; am Ereignisweg fehlte
     * sie.
     */
    const FREMDE_NODE = '44444444-4444-4444-8444-444444444444';
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    harness.socket.commands.length = 0;
    harness.emitted.length = 0;

    await harness.service.handleAgentEvent(FREMDE_NODE, {
      kind: 'event',
      event: 'CRASHED',
      serverId: created.id,
      payload: { exitCode: 137 },
      emittedAt: NOW.toISOString(),
    });

    // Kein Zustandswechsel, kein Neustart, kein Live-Ereignis …
    expect((await harness.service.requireServer(created.id)).status).toBe('running');
    expect(harness.socket.commands).toEqual([]);
    expect(harness.emitted).toEqual([]);
    // … aber eine Zeile im Protokoll: Ein regulärer Agent erzeugt das nicht.
    expect(
      harness.logged.some(
        (zeile) => zeile.level === 'warn' && zeile.message.includes('anderen Node'),
      ),
    ).toBe(true);
  });

  it('verwirft auch eine Konsolenzeile, die eine fremde Node über die Container-Id meldet', async () => {
    const FREMDE_NODE = '44444444-4444-4444-8444-444444444444';
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);
    const containerId = (await harness.service.requireServer(created.id)).dockerContainerId;

    harness.emitted.length = 0;

    await harness.service.handleAgentEvent(FREMDE_NODE, {
      kind: 'event',
      event: 'LOG_LINE',
      serverId: null,
      payload: { containerId, stream: 'stdout', message: 'fremd', at: NOW.toISOString() },
      emittedAt: NOW.toISOString(),
    });

    expect(harness.emitted.filter((e) => e.event === 'server.consoleLineAppended')).toEqual([]);
  });
});

describe('Lifecycle-Konsistenz (Audit W2-10)', () => {
  it('lässt von zwei gleichzeitigen Starts genau einen gewinnen (orchestration-core-07)', async () => {
    /*
     * Beide Aufrufe laden den Server als `stopped` und bestehen die
     * Übergangsprüfung – bis W2-10 schrieben auch beide `starting`, schickten
     * `START` und starteten je einen Health-Lauf. Das bedingte Fortschreiben
     * (`UPDATE … WHERE status = $erwartet`) lässt nur den ersten durch; der
     * zweite endet mit `SERVER_STATE_CONFLICT`, also mit 409 statt 500.
     */
    const harness = makeHarness({ healthy: 'pending' });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.socket.commands.length = 0;

    const ergebnisse = await Promise.allSettled([
      harness.service.startServer(created.id, OWNER_ID),
      harness.service.startServer(created.id, OWNER_ID),
    ]);

    expect(ergebnisse.filter((e) => e.status === 'fulfilled')).toHaveLength(1);

    const abgelehnt = ergebnisse.find((e) => e.status === 'rejected');

    expect(abgelehnt?.status === 'rejected' ? abgelehnt.reason : null).toMatchObject({
      code: 'SERVER_STATE_CONFLICT',
    });

    // Genau ein START ging an den Homeserver, nicht zwei.
    expect(harness.socket.commands.filter((befehl) => befehl.command === 'START')).toHaveLength(1);
    expect((await harness.service.requireServer(created.id)).status).toBe('starting');
  });

  it('verwirft ein zweites gleichzeitiges CRASHED, ohne den Vorgang zu stören', async () => {
    // Zwei Meldungen desselben Absturzes, echt nebenläufig: Der zweite
    // Schreibvorgang findet den erwarteten Zustand nicht mehr vor.
    const harness = makeHarness({ healthy: true });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);
    harness.logged.length = 0;

    const laufend = await harness.service.requireServer(created.id);
    const frame = {
      kind: 'event' as const,
      event: 'CRASHED' as const,
      serverId: laufend.id,
      payload: { exitCode: 137 },
      emittedAt: NOW.toISOString(),
    };

    await expect(
      Promise.all([
        harness.service.handleAgentEvent(HOST.id, frame),
        harness.service.handleAgentEvent(HOST.id, frame),
      ]),
    ).resolves.toBeDefined();

    // Genau ein `server.crashed` – die Dublette endet als Warnung im Log.
    expect(harness.emitted.filter((e) => e.event === 'server.crashed')).toHaveLength(1);
    expect(harness.logged.filter((line) => line.level === 'error')).toEqual([]);
    expect(
      harness.logged.some(
        (line) => line.level === 'warn' && line.message.includes('Absturzmeldung verworfen'),
      ),
    ).toBe(true);
  });

  it('meldet server.statusChanged erst nach dem Commit der Reservierung (event-flow-11)', async () => {
    /*
     * Innerhalb der Reservierung ist die Zeile noch ungeschrieben. Ging das
     * Frame dort hinaus, zeigte jeder Browser `starting`, während ein Abbruch
     * beim Commit die Datenbank auf `stopped` zurückfallen ließ – und kein
     * weiteres Frame korrigierte das.
     */
    const reihenfolge: string[] = [];
    const harness = makeHarness({
      healthy: 'pending',
      buildReservation: (repository, ports) => ({
        async reserve(_request, write) {
          reihenfolge.push('transaktion-offen');

          const ergebnis = await write({ servers: repository, ports });

          reihenfolge.push('commit');

          return ergebnis;
        },
      }),
      onEmit: (event) => {
        if (event === 'server.statusChanged') {
          reihenfolge.push('server.statusChanged');
        }
      },
    });

    const created = await harness.service.createServer(createInput(), OWNER_ID);

    reihenfolge.length = 0;

    await harness.service.startServer(created.id, OWNER_ID);

    expect(reihenfolge.slice(0, 3)).toEqual([
      'transaktion-offen',
      'commit',
      'server.statusChanged',
    ]);
  });

  it('zieht einen laufenden Server mit beendetem Container über stopping auf stopped (orchestration-core-04)', async () => {
    /*
     * `running → stopped` verbietet die Übergangstabelle; der Weg führt über
     * `stopping`. Bis W2-10 plante der Abgleich den direkten Sprung, die
     * Ausführung scheiterte still im Log und der Server blieb auf `running`
     * stehen, obwohl sein Container längst beendet war.
     */
    const harness = makeHarness({ healthy: true });
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);

    const laufend = await settle(harness, created.id, ['running']);
    const wechsel: { from: unknown; to: unknown }[] = [];

    harness.logged.length = 0;
    harness.emitted.length = 0;

    await harness.service.reconcile(HOST.id, {
      kind: 'stateReport',
      reason: 'connected',
      containers: [
        {
          serverId: laufend.id,
          containerId: laufend.dockerContainerId ?? 'c1',
          status: 'exited',
          exitCode: 0,
          startedAt: null,
          observedAt: NOW.toISOString(),
        },
      ],
      reportedAt: NOW.toISOString(),
    });

    for (const eintrag of harness.emitted) {
      if (eintrag.event === 'server.statusChanged') {
        wechsel.push({ from: eintrag.payload.from, to: eintrag.payload.to });
      }
    }

    expect((await harness.service.requireServer(laufend.id)).status).toBe('stopped');
    expect(wechsel).toEqual([
      { from: 'running', to: 'stopping' },
      { from: 'stopping', to: 'stopped' },
    ]);
    expect(harness.logged.filter((line) => line.level === 'error')).toEqual([]);
  });
});

describe('Kapazität serialisiert (TOCTOU, WORK_STATUS.md Punkt 98)', () => {
  const NODE_RAM_MB = 256; // Genau ein Test-Server (256 MB) passt, zwei nicht.

  /** Belegung aus den Attrappen-Servern – gezählt wie `usage-repository.ts`. */
  function summarize(servers: readonly ServerRecord[]): UserResourceUsage & NodeResourceUsage {
    let runningRamMb = 0;
    let runningCpuCores = 0;
    let allocatedDiskMb = 0;
    let runningServers = 0;

    for (const server of servers) {
      allocatedDiskMb += server.resourceLimits.diskMb;

      if (server.status === 'running' || server.status === 'starting') {
        runningRamMb += server.resourceLimits.ramMb;
        runningCpuCores += server.resourceLimits.cpuCores;
        runningServers += 1;
      }
    }

    return {
      runningRamMb,
      runningCpuCores,
      allocatedDiskMb,
      runningServers,
      totalServers: servers.length,
    };
  }

  /**
   * Reservierung wie im Betrieb: die echte Kapazitätsentscheidung aus B4
   * (`createResourceService` / `checkCapacity`) gegen die Attrappen-Belegung,
   * dazu ein Promise-Ketten-Mutex als Nachbildung des Advisory-Locks. Damit ist
   * genau das geprüft, was der Betrieb serialisiert – ohne echte Datenbank.
   */
  function buildReservation(repository: FakeRepository, ports: PortAllocator): CapacityReservation {
    const only = (servers: readonly ServerRecord[], excludeServerId?: string): ServerRecord[] =>
      servers.filter((server) => server.id !== excludeServerId);

    const usage: ServerUsageRepository = {
      usageForUsers: () => Promise.resolve(new Map()),
      usageForUser: (userId, options) =>
        Promise.resolve(
          summarize(
            only(
              [...repository.servers.values()].filter((s) => s.ownerId === userId),
              options?.excludeServerId,
            ),
          ),
        ),
      usageForNode: (nodeId, options) =>
        Promise.resolve(
          summarize(
            only(
              [...repository.servers.values()].filter((s) => s.hostId === nodeId),
              options?.excludeServerId,
            ),
          ),
        ),
    };

    const nodes: HostNodeRepository = {
      findById: (nodeId) =>
        Promise.resolve(
          nodeId === HOST.id
            ? {
                id: HOST.id,
                name: HOST.name,
                wireguardIp: HOST.wireguardIp,
                status: 'online',
                totalResources: { ramMb: NODE_RAM_MB, cpuCores: 64, diskMb: 1_000_000 },
                measuredUsage: null,
              }
            : null,
        ),
      listAll: () => Promise.resolve([]),
    };

    const limits: UserResourceLimitRepository = {
      findByUserId: (userId) =>
        Promise.resolve({
          userId,
          userDisplayName: 'Besitzer',
          limits: NO_USER_RESOURCE_LIMITS,
          updatedAt: null,
        }),
      findManyByUserId: () => Promise.resolve(new Map()),
      upsert: () => Promise.resolve(null),
      remove: () => Promise.resolve(),
    };

    const guard = createResourceGuardFromService(
      createResourceService({
        limits,
        nodes,
        usage,
        thresholds: { nodePercent: 90, serverPercent: 90 },
      }),
    );
    const inner = createInlineCapacityReservation(guard, repository, ports);

    // Serialisiert reserve() vollständig – die zweite Prüfung sieht damit die
    // Schreiboperation der ersten (wie der Advisory-Lock im Betrieb).
    let chain: Promise<unknown> = Promise.resolve();

    return {
      reserve(request, write) {
        const run = chain.then(() => inner.reserve(request, write));

        chain = run.then(
          () => undefined,
          () => undefined,
        );

        return run;
      },
    };
  }

  it('lässt von zwei gleichzeitigen Starts nur einen zu – der andere scheitert deterministisch', async () => {
    const harness = makeHarness({ buildReservation });

    // Zwei gestoppte Server; einzeln würde jeder starten (256 MB ≤ 256 MB frei).
    const first = await harness.service.createServer(createInput('server-eins'), OWNER_ID);
    const second = await harness.service.createServer(createInput('server-zwei'), OWNER_ID);

    const outcomes = await Promise.allSettled([
      harness.service.startServer(first.id, OWNER_ID),
      harness.service.startServer(second.id, OWNER_ID),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Die Ablehnung kommt aus B4 (`ResourceError`) und trägt den Katalog-Code
    // RESOURCE_LIMIT_EXCEEDED – derselbe Code wie im Betrieb.
    const error = (rejected[0] as PromiseRejectedResult).reason as { readonly code: string };
    expect(error.code).toBe('RESOURCE_LIMIT_EXCEEDED');

    // Genau ein Server belegt jetzt RAM (starting/running) – die Node ist nicht
    // überbucht.
    const consuming = [...harness.repository.servers.values()].filter(
      (s) => s.status === 'starting' || s.status === 'running',
    );
    expect(consuming).toHaveLength(1);
  });

  it('lässt einen einzelnen Start bei derselben Kapazität zu', async () => {
    const harness = makeHarness({ buildReservation });
    const only = await harness.service.createServer(createInput('server-solo'), OWNER_ID);

    const started = await harness.service.startServer(only.id, OWNER_ID);

    expect(started.status).toBe('starting');
  });
});

describe('Konsole', () => {
  it('übergibt eine Argumentliste, damit keine Shell dazwischensteht', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    harness.socket.answers.set('EXEC_CONSOLE', {
      success: true,
      data: { exitCode: 0, stdout: 'ok', stderr: '' },
      error: null,
    });

    await harness.service.execConsole(created.id, '  say hallo welt  ');
    const exec = harness.socket.commands.find((c) => c.command === 'EXEC_CONSOLE');
    expect((exec?.payload as { command: string[] }).command).toEqual(['say', 'hallo', 'welt']);
    // Der Prüfstand hat keinen RCON-Anschluss – das Feld fehlt dann ganz.
    expect(exec?.payload).not.toHaveProperty('rcon');
  });

  it('nennt dem Agent den RCON-Anschluss aus der Spiele-Definition (P2-9)', async () => {
    const rconTyp: GameTypeDefinition = {
      ...TEST_GAME_TYPE,
      id: 'rcon-spiel',
      console: { kind: 'rcon', port: 25_575, passwordFile: '.palantir/rcon.password' },
    };
    const harness = makeHarness({ gameTypes: [TEST_GAME_TYPE, rconTyp] });
    const created = await harness.service.createServer(
      createInput('rcon-server', rconTyp),
      OWNER_ID,
    );
    harness.socket.answers.set('EXEC_CONSOLE', {
      success: true,
      data: { exitCode: 0, stdout: 'There are 0 of a max of 20 players online', stderr: '' },
      error: null,
    });

    const ergebnis = await harness.service.execConsole(created.id, 'list');

    const exec = harness.socket.commands.find((c) => c.command === 'EXEC_CONSOLE');
    expect(exec?.payload).toMatchObject({
      command: ['list'],
      rcon: { port: 25_575, passwordFile: '.palantir/rcon.password' },
    });
    // Die Antwort kommt zurück statt nur im Log zu stehen.
    expect(ergebnis.stdout).toBe('There are 0 of a max of 20 players online');
  });
});

/**
 * Datei-Manager (Arbeitspaket P2, Lastenheft §3.3).
 *
 * Zwei Dinge stehen im Mittelpunkt: dass Pfade **relativ zum Datenordner**
 * hinein- und hinausgehen (und der Agent den absoluten Pfad des jeweiligen
 * Spiels bekommt), und dass ein Ausbruch aus dem Datenordner den Agent gar
 * nicht erst erreicht.
 */
describe('Datei-Manager (Arbeitspaket P2)', () => {
  const DATEN_ORDNER = '/usr/share/nginx/html';

  /** Antwort des Agents auf `FILE_LIST` für ein Verzeichnis. */
  function listenAntwort(containerPath: string, namen: readonly string[]) {
    return {
      success: true as const,
      data: {
        containerId: 'container-1',
        path: containerPath,
        entries: namen.map((name) => ({
          name,
          path: `${containerPath}/${name}`,
          type: 'file' as const,
          sizeBytes: 12,
          modifiedAt: '2026-08-30T10:00:00.000Z',
          mode: '644',
        })),
      },
      error: null,
    };
  }

  async function angelegterServer(harness: Harness): Promise<string> {
    return (await harness.service.createServer(createInput(), OWNER_ID)).id;
  }

  function befehle(harness: Harness, command: string) {
    return harness.socket.commands.filter((eintrag) => eintrag.command === command);
  }

  it('listet relativ zum Datenordner und schickt dem Agent den absoluten Pfad', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);
    harness.socket.answers.set(
      'FILE_LIST',
      listenAntwort(`${DATEN_ORDNER}/welt`, ['level.dat', 'session.lock']),
    );

    const dto = await harness.service.listFiles(id, 'welt', { writable: true });

    expect(befehle(harness, 'FILE_LIST').at(-1)?.payload).toMatchObject({
      path: `${DATEN_ORDNER}/welt`,
    });
    expect(dto).toMatchObject({ serverId: id, path: 'welt', parentPath: '', writable: true });
    expect(dto.entries.map((eintrag) => eintrag.path)).toEqual([
      'welt/level.dat',
      'welt/session.lock',
    ]);
    // Die Upload-Grenze kommt aus der Konfiguration, gedeckelt auf die Kanal-Grenze.
    expect(dto.maxUploadBytes).toBe(64 * 1024 * 1024);
  });

  it('lehnt jeden Ausbruch ab, ohne den Agent zu behelligen', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);

    for (const pfad of ['../etc/passwd', '/etc/passwd', 'welt/../../../etc/shadow']) {
      await expect(harness.service.listFiles(id, pfad, { writable: true })).rejects.toMatchObject({
        code: 'AGENT_INVALID_PATH',
      });
    }

    expect(befehle(harness, 'FILE_LIST')).toEqual([]);
  });

  it('liest eine Datei samt Änderungszeitpunkt aus dem Verzeichnis', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);
    harness.socket.answers.set('FILE_LIST', listenAntwort(DATEN_ORDNER, ['index.html']));
    harness.socket.answers.set('FILE_READ', {
      success: true,
      data: {
        containerId: 'container-1',
        path: `${DATEN_ORDNER}/index.html`,
        contentBase64: Buffer.from('<h1>hallo</h1>').toString('base64'),
        sizeBytes: 14,
      },
      error: null,
    });

    const dto = await harness.service.readFile(id, 'index.html', { writable: true });

    expect(dto).toMatchObject({
      serverId: id,
      path: 'index.html',
      content: '<h1>hallo</h1>',
      modifiedAt: '2026-08-30T10:00:00.000Z',
      writable: true,
    });
  });

  it('schreibt den Editor-Inhalt Base64-kodiert zurück', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);
    harness.socket.answers.set('FILE_LIST', listenAntwort(DATEN_ORDNER, ['index.html']));

    await harness.service.writeFile(id, 'index.html', 'neu', { writable: true });

    expect(befehle(harness, 'FILE_WRITE').at(-1)?.payload).toMatchObject({
      path: `${DATEN_ORDNER}/index.html`,
      contentBase64: Buffer.from('neu').toString('base64'),
    });
  });

  it('lädt ohne overwrite hoch – über den belegten Pfad entscheidet der Agent', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);
    harness.socket.answers.set('FILE_LIST', listenAntwort(DATEN_ORDNER, ['welt.zip']));

    await harness.service.uploadFile(id, '', 'welt.zip', Buffer.from('PK'), { writable: true });

    const nutzlast = befehle(harness, 'FILE_UPLOAD').at(-1)?.payload as Record<string, unknown>;
    expect(nutzlast).toMatchObject({ path: `${DATEN_ORDNER}/welt.zip` });
    // Ohne ausdrückliches Überschreiben fehlt das Feld – der Agent lehnt dann ab.
    expect('overwrite' in nutzlast).toBe(false);
  });

  it('reicht ein ausdrückliches overwrite an den Agent durch', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);
    harness.socket.answers.set('FILE_LIST', listenAntwort(`${DATEN_ORDNER}/welt`, ['welt.zip']));

    await harness.service.uploadFile(id, 'welt', 'welt.zip', Buffer.from('PK'), {
      writable: true,
      overwrite: true,
    });

    expect(befehle(harness, 'FILE_UPLOAD').at(-1)?.payload).toMatchObject({
      path: `${DATEN_ORDNER}/welt/welt.zip`,
      overwrite: true,
    });
  });

  it('meldet den belegten Zielpfad des Agents als AGENT_FILE_EXISTS weiter', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);
    harness.socket.answers.set('FILE_UPLOAD', {
      success: false,
      data: null,
      error: { code: 'AGENT_FILE_EXISTS', message: 'Am Zielpfad existiert bereits eine Datei.' },
    });

    await expect(
      harness.service.uploadFile(id, '', 'welt.zip', Buffer.from('PK'), { writable: true }),
    ).rejects.toMatchObject({ code: 'AGENT_FILE_EXISTS' });
  });

  it('puffert keinen Upload über der zulässigen Größe', async () => {
    const harness = makeHarness({ maxUploadBytes: 8 });
    const id = await angelegterServer(harness);

    await expect(
      harness.service.uploadFile(id, '', 'welt.zip', Buffer.alloc(9), { writable: true }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(befehle(harness, 'FILE_UPLOAD')).toEqual([]);
  });

  it('löscht ohne ausdrückliche Ansage nicht rekursiv und sperrt den Datenordner selbst', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);

    /*
     * Vorgabe `false` (Audit contract-drift-03): So steht die Schranke im
     * Vertrag des Agent-Befehls – ein nicht-leeres Verzeichnis bleibt stehen,
     * bis jemand das Mitnehmen des Inhalts ausdrücklich verlangt.
     */
    await harness.service.deleteFile(id, 'welt');

    expect(befehle(harness, 'FILE_DELETE').at(-1)?.payload).toMatchObject({
      path: `${DATEN_ORDNER}/welt`,
      recursive: false,
    });

    await harness.service.deleteFile(id, 'welt', true);

    expect(befehle(harness, 'FILE_DELETE').at(-1)?.payload).toMatchObject({
      path: `${DATEN_ORDNER}/welt`,
      recursive: true,
    });

    await expect(harness.service.deleteFile(id, '')).rejects.toMatchObject({
      code: 'AGENT_INVALID_PATH',
    });
    expect(befehle(harness, 'FILE_DELETE')).toHaveLength(2);
  });

  it('liefert für den Download Dateiname und Inhalt', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);
    harness.socket.answers.set('FILE_READ', {
      success: true,
      data: {
        containerId: 'container-1',
        path: `${DATEN_ORDNER}/welt/level.dat`,
        contentBase64: Buffer.from('rohdaten').toString('base64'),
        sizeBytes: 8,
      },
      error: null,
    });

    const datei = await harness.service.downloadFile(id, 'welt/level.dat');

    expect(datei.fileName).toBe('level.dat');
    expect(datei.content.toString('utf8')).toBe('rohdaten');
  });
});

describe('Weltdaten-Übernahme beim Anlegen (Arbeitspaket P4)', () => {
  const UPLOAD_ID = '77777777-7777-4777-8777-777777777777';

  /**
   * Zwischenspeicher im Speicher – dieselbe Schnittstelle wie die Platte.
   *
   * Seit Gefundenem Punkt 106 wird blockweise gelesen; der Fake schneidet dafür
   * aus einem Puffer und merkt sich, ob er freigegeben wurde.
   */
  function fakeStore(
    inhalt: {
      uploadId: string;
      content: Buffer;
      format: ArchiveFormat;
      /** Konto, dem das Archiv gehört; ohne Angabe gehört es dem Abholenden. */
      ownerId?: string;
    } | null,
  ): WorldArchiveStore & {
    readonly abgeholt: string[];
    readonly besitzer: string[];
    readonly freigegeben: string[];
  } {
    const abgeholt: string[] = [];
    const besitzer: string[] = [];
    const freigegeben: string[] = [];

    const archiv: StoredWorldArchive | null =
      inhalt === null
        ? null
        : {
            uploadId: inhalt.uploadId,
            format: inhalt.format,
            sizeBytes: inhalt.content.byteLength,
            read: (offset, maxBytes) =>
              Promise.resolve(inhalt.content.subarray(offset, offset + maxBytes)),
            release: () => {
              freigegeben.push(inhalt.uploadId);

              return Promise.resolve();
            },
          };

    return {
      abgeholt,
      besitzer,
      freigegeben,
      save: () => Promise.reject(new Error('nicht benutzt')),
      // Wie die Umsetzung auf der Platte: Ein fremdes Archiv verhält sich wie
      // ein unbekanntes (orchestration-features-09).
      take: (uploadId, ownerId) => {
        abgeholt.push(uploadId);
        besitzer.push(ownerId);

        if (inhalt?.ownerId !== undefined && inhalt.ownerId !== ownerId) {
          return Promise.resolve(null);
        }

        return Promise.resolve(archiv);
      },
      sweep: () => Promise.resolve(0),
    };
  }

  const mitImport = () => ({
    ...createInput(),
    worldImport: { uploadId: UPLOAD_ID, fileName: 'welt.zip' },
  });

  it('schickt das Archiv blockweise an den Agent', async () => {
    const store = fakeStore({
      uploadId: UPLOAD_ID,
      content: Buffer.from('PK-Archiv'),
      format: 'zip',
    });
    const harness = makeHarness({ worldArchives: store });

    const server = await harness.service.createServer(mitImport(), OWNER_ID);

    expect(store.abgeholt).toEqual([UPLOAD_ID]);

    const bloecke = harness.socket.commands.filter(
      (eintrag) => eintrag.command === 'UPLOAD_ARCHIVE_BLOCK',
    );

    // Klein genug für einen Block – der ist dann zugleich der letzte.
    expect(bloecke).toHaveLength(1);
    expect(bloecke[0]?.payload).toMatchObject({
      path: '',
      format: 'zip',
      transferId: UPLOAD_ID,
      offset: 0,
      last: true,
      contentBase64: Buffer.from('PK-Archiv').toString('base64'),
    });
    // Der Import läuft, während der Server angelegt wird – danach ist er fertig.
    expect(server.status).not.toBe('error');
    expect(store.freigegeben).toEqual([UPLOAD_ID]);
  });

  it('holt das Archiv im Namen des anlegenden Kontos ab', async () => {
    const store = fakeStore({
      uploadId: UPLOAD_ID,
      content: Buffer.from('PK-Archiv'),
      format: 'zip',
    });
    const harness = makeHarness({ worldArchives: store });

    await harness.service.createServer(mitImport(), OWNER_ID);

    expect(store.besitzer).toEqual([OWNER_ID]);
  });

  it('lässt das Anlegen mit einer fremden uploadId scheitern', async () => {
    // Audit orchestration-features-09: Der Verweis gehört einem anderen Konto.
    // Antwort ist derselbe Code wie bei einem abgelaufenen Verweis
    // (WORLD_ARCHIVE_NOT_FOUND, 404) – kein Orakel über fremde Uploads.
    const fremd = '99999999-9999-4999-8999-999999999999';
    const store = fakeStore({
      uploadId: UPLOAD_ID,
      content: Buffer.from('PK-Archiv'),
      format: 'zip',
      ownerId: fremd,
    });
    const harness = makeHarness({ worldArchives: store });

    await expect(harness.service.createServer(mitImport(), OWNER_ID)).rejects.toMatchObject({
      code: 'WORLD_ARCHIVE_NOT_FOUND',
    });
    expect(
      harness.socket.commands.some((eintrag) => eintrag.command === 'UPLOAD_ARCHIVE_BLOCK'),
    ).toBe(false);
    // Nicht abgeholt heißt auch: dem Eigentümer nichts entzogen.
    expect(store.freigegeben).toEqual([]);
  });

  it('legt ohne worldImport kein Archiv an', async () => {
    const store = fakeStore(null);
    const harness = makeHarness({ worldArchives: store });

    await harness.service.createServer(createInput(), OWNER_ID);

    expect(store.abgeholt).toEqual([]);
    expect(
      harness.socket.commands.some((eintrag) => eintrag.command === 'UPLOAD_ARCHIVE_BLOCK'),
    ).toBe(false);
  });

  it('lässt das Anlegen scheitern, wenn der Upload abgelaufen ist', async () => {
    const harness = makeHarness({ worldArchives: fakeStore(null) });

    await expect(harness.service.createServer(mitImport(), OWNER_ID)).rejects.toMatchObject({
      code: 'WORLD_ARCHIVE_NOT_FOUND',
    });

    // Ein Server ohne die erwartete Welt gilt als fehlgeschlagen, nicht als
    // fertig – sonst stünde ein leerer Server unter dem Namen eines übernommenen.
    const [server] = await harness.repository.listAll();

    expect(server?.status).toBe('error');
  });

  it('lehnt ein Archiv über der Grenze ab, bevor es an den Agent geht', async () => {
    const store = fakeStore({
      uploadId: UPLOAD_ID,
      content: Buffer.alloc(2048),
      format: 'zip',
    });
    const harness = makeHarness({ worldArchives: store, maxWorldArchiveBytes: 1024 });

    await expect(harness.service.createServer(mitImport(), OWNER_ID)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    expect(
      harness.socket.commands.some((eintrag) => eintrag.command === 'UPLOAD_ARCHIVE_BLOCK'),
    ).toBe(false);
    // Auch der abgelehnte Versuch gibt das Archiv frei.
    expect(store.freigegeben).toEqual([UPLOAD_ID]);
  });

  it('teilt ein großes Archiv in mehrere Blöcke', async () => {
    const inhalt = Buffer.alloc(WORLD_IMPORT_CHUNK_BYTES + 1024, 7);
    const store = fakeStore({ uploadId: UPLOAD_ID, content: inhalt, format: 'tar.gz' });
    const harness = makeHarness({ worldArchives: store });

    await harness.service.createServer(mitImport(), OWNER_ID);

    const bloecke = harness.socket.commands.filter(
      (eintrag) => eintrag.command === 'UPLOAD_ARCHIVE_BLOCK',
    );

    expect(bloecke).toHaveLength(2);
    expect(bloecke[0]?.payload).toMatchObject({ offset: 0, last: false });
    expect(bloecke[1]?.payload).toMatchObject({ offset: WORLD_IMPORT_CHUNK_BYTES, last: true });
  });
});

describe('Verlauf der Messwerte (Arbeitspaket P5)', () => {
  /** Ablage im Speicher – dieselbe Schnittstelle wie die Drizzle-Umsetzung. */
  function fakeAblage(): ServerStatsRepository & { readonly proben: StatsSample[] } {
    const proben: StatsSample[] = [];

    return {
      proben,
      insert: (probe) => {
        proben.push(probe);

        return Promise.resolve();
      },
      listSince: (serverId, since) =>
        Promise.resolve(
          proben.filter(
            (probe) => probe.serverId === serverId && probe.recordedAt.getTime() >= since.getTime(),
          ),
        ),
      prune: (before) => {
        const vorher = proben.length;

        for (let index = proben.length - 1; index >= 0; index -= 1) {
          if ((proben[index] as StatsSample).recordedAt.getTime() < before.getTime()) {
            proben.splice(index, 1);
          }
        }

        return Promise.resolve(vorher - proben.length);
      },
    };
  }

  /** Ein laufender Server – nur laufende werden abgetastet. */
  async function laufenderServer(harness: Harness): Promise<string> {
    const server = await harness.service.createServer(createInput(), OWNER_ID);
    await harness.service.startServer(server.id, OWNER_ID);
    // Erst nach bestandenem Health-Check steht der Server auf `running` – nur
    // laufende Server werden abgetastet.
    await settle(harness, server.id, ['running']);

    return server.id;
  }

  it('hält die Messwerte eines laufenden Servers fest', async () => {
    const ablage = fakeAblage();
    const harness = makeHarness({ statsHistory: ablage });
    const serverId = await laufenderServer(harness);

    const abgetastet = await harness.service.sampleServerStats(HOST.id);

    expect(abgetastet).toEqual([serverId]);
    expect(ablage.proben).toHaveLength(1);
    expect(ablage.proben[0]).toMatchObject({ serverId, diskUsedMb: null });
  });

  it('tastet einen gestoppten Server nicht ab', async () => {
    const ablage = fakeAblage();
    const harness = makeHarness({ statsHistory: ablage });
    await harness.service.createServer(createInput(), OWNER_ID);

    expect(await harness.service.sampleServerStats(HOST.id)).toEqual([]);
    expect(ablage.proben).toEqual([]);
  });

  it('legt die zuletzt gemeldete Spielerzahl neben die Werte der Engine', async () => {
    const ablage = fakeAblage();
    const harness = makeHarness({ statsHistory: ablage });
    const serverId = await laufenderServer(harness);

    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'STATS_UPDATE',
      serverId,
      emittedAt: new Date(NOW.getTime()).toISOString(),
      payload: { source: 'serverQuery', playersOnline: 7, playersMax: 20, pingMs: 11 },
    } as never);

    await harness.service.sampleServerStats(HOST.id);

    expect(ablage.proben[0]).toMatchObject({ playersOnline: 7, playersMax: 20, pingMs: 11 });
  });

  /**
   * Fundpunkt 175: Der belegte Plattenplatz erreichte die Live-Anzeige nie.
   *
   * Er kommt nur auf `GET_STATS` an – der Agent misst ihn am Datenordner, nicht
   * im Statistik-Strom der Engine. Der Live-Kanal führte ihn deshalb dauerhaft
   * als `null`, und weil das Frontend die Messwerte je Rahmen vollständig
   * ersetzt, stand in der Kachel „Platte" immer „—", obwohl Verlauf und
   * Ressourcen-Warnung die Zahl längst hatten.
   */
  it('trägt den abgetasteten Plattenplatz in die folgenden Live-Rahmen (Fundpunkt 175)', async () => {
    const ablage = fakeAblage();
    const harness = makeHarness({ statsHistory: ablage });
    const serverId = await laufenderServer(harness);

    harness.socket.answers.set('GET_STATS', {
      success: true,
      data: {
        containerId: 'container-1',
        cpuPercent: 42.5,
        memoryUsedBytes: 1024 * 1024 * 512,
        memoryLimitBytes: 1024 * 1024 * 2048,
        networkRxBytes: 5_000,
        networkTxBytes: 6_000,
        blockReadBytes: 0,
        blockWriteBytes: 0,
        pids: 12,
        diskUsedBytes: 3 * 1024 * 1024 * 1024,
        sampledAt: NOW.toISOString(),
      },
      error: null,
    });

    await harness.service.sampleServerStats(HOST.id);

    expect(ablage.proben[0]).toMatchObject({ diskUsedMb: 3_072 });

    // Messwerte der Engine …
    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'STATS_UPDATE',
      serverId,
      emittedAt: harness.now().toISOString(),
      payload: {
        containerId: 'container-1',
        cpuPercent: 12,
        memoryUsedBytes: 1024 * 1024 * 256,
        memoryLimitBytes: 1024 * 1024 * 2048,
        networkRxBytes: 1,
        networkTxBytes: 2,
        blockReadBytes: 0,
        blockWriteBytes: 0,
        pids: 4,
        sampledAt: harness.now().toISOString(),
      },
    } as never);

    // … und die Server-Abfrage danach. Sie misst keinen Plattenplatz und darf
    // den gerade gelieferten Wert deshalb auch nicht löschen: Genau dieses
    // Überschreiben ließ die Anzeige von einer Zahl auf „—" springen.
    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'STATS_UPDATE',
      serverId,
      emittedAt: harness.now().toISOString(),
      payload: { source: 'serverQuery', playersOnline: 7, playersMax: 20, pingMs: 11 },
    } as never);

    const platten = harness.emitted
      .filter((e) => e.event === 'server.statsUpdated')
      .map((e) => (e.payload as { stats: { diskUsedMb: number | null } }).stats.diskUsedMb);

    expect(platten).toEqual([3_072, 3_072]);
  });

  /**
   * Fundpunkt 179: Die Messwert-Kacheln flackerten im Takt der Server-Abfrage.
   *
   * Dasselbe Muster wie beim Plattenplatz, nur in der Gegenrichtung. CPU,
   * Arbeitsspeicher und Netzverkehr kennt allein der Statistik-Strom der
   * Engine; der Zweig der Server-Abfrage trug dort ein festes `null`. Weil das
   * Frontend die Messwerte je Rahmen vollständig ersetzt, sprangen die drei
   * Kacheln bei jedem Abfrage-Rahmen auf „—", bis der nächste Engine-Rahmen kam.
   */
  describe('Engine-Messwerte über den Abfrage-Rahmen hinweg (Fundpunkt 179)', () => {
    /** Ein Rahmen des Statistik-Stroms mit frei wählbarer CPU-Last. */
    async function meldeEngine(
      harness: Harness,
      serverId: string,
      cpuPercent: number,
    ): Promise<void> {
      await harness.service.handleAgentEvent(HOST.id, {
        kind: 'event',
        event: 'STATS_UPDATE',
        serverId,
        emittedAt: harness.now().toISOString(),
        payload: {
          containerId: 'container-1',
          cpuPercent,
          memoryUsedBytes: 1024 * 1024 * 256,
          memoryLimitBytes: 1024 * 1024 * 2048,
          networkRxBytes: 5_000,
          networkTxBytes: 6_000,
          blockReadBytes: 0,
          blockWriteBytes: 0,
          pids: 4,
          sampledAt: harness.now().toISOString(),
        },
      } as never);
    }

    /** Ein Rahmen der Server-Abfrage – misst keine Ressourcen. */
    async function meldeAbfrage(harness: Harness, serverId: string): Promise<void> {
      await harness.service.handleAgentEvent(HOST.id, {
        kind: 'event',
        event: 'STATS_UPDATE',
        serverId,
        emittedAt: harness.now().toISOString(),
        payload: { source: 'serverQuery', playersOnline: 7, playersMax: 20, pingMs: 11 },
      } as never);
    }

    /** Die Messwerte aller bisher gemeldeten Live-Rahmen. */
    function gemeldeteMesswerte(harness: Harness): {
      cpuPercent: number | null;
      ramUsedMb: number | null;
      networkRxBytes: number | null;
      networkTxBytes: number | null;
    }[] {
      return harness.emitted
        .filter((e) => e.event === 'server.statsUpdated')
        .map(
          (e) =>
            (
              e.payload as {
                stats: {
                  cpuPercent: number | null;
                  ramUsedMb: number | null;
                  networkRxBytes: number | null;
                  networkTxBytes: number | null;
                };
              }
            ).stats,
        );
    }

    it('löscht CPU, Arbeitsspeicher und Netzverkehr nicht mit dem Abfrage-Rahmen', async () => {
      const harness = makeHarness({ statsHistory: fakeAblage() });
      const serverId = await laufenderServer(harness);

      await meldeEngine(harness, serverId, 12);
      // Der Abfrage-Rahmen folgt eine Sekunde später – so kommt er im Betrieb.
      harness.advance(1_000);
      await meldeAbfrage(harness, serverId);

      const messwerte = gemeldeteMesswerte(harness);

      expect(messwerte).toHaveLength(2);
      // Beide Rahmen tragen dieselben Zahlen: Die Kachel bleibt stehen.
      expect(messwerte[1]).toMatchObject({
        cpuPercent: 12,
        ramUsedMb: 256,
        networkRxBytes: 5_000,
        networkTxBytes: 6_000,
      });
    });

    it('bringt mit dem nächsten Engine-Rahmen die frischen Werte', async () => {
      const harness = makeHarness({ statsHistory: fakeAblage() });
      const serverId = await laufenderServer(harness);

      await meldeEngine(harness, serverId, 12);
      harness.advance(1_000);
      await meldeAbfrage(harness, serverId);
      harness.advance(1_000);
      await meldeEngine(harness, serverId, 87);

      expect(gemeldeteMesswerte(harness).map((m) => m.cpuPercent)).toEqual([12, 12, 87]);
    });

    /*
     * **Der Fall, den dieser Weg riskiert.**
     *
     * Der gemerkte Wert wird mit der Empfangszeit des Abfrage-Rahmens
     * ausgeliefert – er sieht also frischer aus, als er ist. Solange der
     * Statistik-Strom im Sekundentakt liefert, ist das eine Sekunde. Bleibt er
     * aus, während die Abfrage weiterläuft, wäre es eine Behauptung: Die
     * Kachel zeigte eine CPU-Last, die niemand mehr misst. Genau dagegen steht
     * die Frist – danach ist „—" die wahre Antwort.
     */
    it('lässt die Kacheln leer, wenn der Statistik-Strom ausbleibt', async () => {
      const harness = makeHarness({ statsHistory: fakeAblage() });
      const serverId = await laufenderServer(harness);

      await meldeEngine(harness, serverId, 12);
      // Der Strom schweigt eine Minute; nur die Abfrage meldet noch.
      harness.advance(60_000);
      await meldeAbfrage(harness, serverId);

      const messwerte = gemeldeteMesswerte(harness);

      expect(messwerte[1]).toMatchObject({
        cpuPercent: null,
        ramUsedMb: null,
        networkRxBytes: null,
        networkTxBytes: null,
      });
    });
  });

  it('lässt den Plattenplatz im Live-Rahmen leer, solange nichts gemessen ist', async () => {
    /*
     * „nicht gemessen" ist etwas anderes als „null Bytes belegt": Aus einer 0
     * rechnete die Schwellwert-Prüfung „0 % belegt" und schwiege auch dann,
     * wenn die Platte längst voll wäre. Der Agent des Testaufbaus meldet
     * `diskUsedBytes` nicht – wie ein älterer Agent oder ein Ordner, den noch
     * niemand durchlaufen hat.
     */
    const harness = makeHarness({ statsHistory: fakeAblage() });
    const serverId = await laufenderServer(harness);

    await harness.service.sampleServerStats(HOST.id);
    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'STATS_UPDATE',
      serverId,
      emittedAt: harness.now().toISOString(),
      payload: { source: 'serverQuery', playersOnline: 1, playersMax: 20, pingMs: 9 },
    } as never);

    const gemeldet = harness.emitted.find((e) => e.event === 'server.statsUpdated');

    expect(gemeldet?.payload).toMatchObject({ stats: { diskUsedMb: null } });
  });

  /*
   * Clock-Skew Agent ↔ Backend (Audit W2-14, orchestration-features-03).
   *
   * Bis hierher entschied `emittedAt` – die Uhr des Homeservers – darüber, wie
   * alt eine Abfrage ist. Ging sie mehr als fünf Minuten nach, fiel jede
   * Spielerzahl aus dem Zwischenspeicher und stand dauerhaft als `null` im
   * Verlauf; ging sie vor, sahen veraltete Werte ewig frisch aus. Der
   * Zeitstempel kommt jetzt vom Backend.
   */
  describe('Uhr des Agents weicht ab (W2-14)', () => {
    /** Frame einer Server-Abfrage mit frei wählbarer Agent-Zeit. */
    async function meldeAbfrage(
      harness: Harness,
      serverId: string,
      agentZeit: Date,
      playersOnline: number,
    ): Promise<void> {
      await harness.service.handleAgentEvent(HOST.id, {
        kind: 'event',
        event: 'STATS_UPDATE',
        serverId,
        emittedAt: agentZeit.toISOString(),
        payload: { source: 'serverQuery', playersOnline, playersMax: 20, pingMs: 11 },
      } as never);
    }

    it('nimmt die Spielerzahl auch bei 90 s vorgehender Agent-Uhr in den Verlauf', async () => {
      const ablage = fakeAblage();
      const harness = makeHarness({ statsHistory: ablage });
      const serverId = await laufenderServer(harness);
      const backendZeit = harness.now();

      await meldeAbfrage(harness, serverId, new Date(backendZeit.getTime() + 90_000), 7);
      await harness.service.sampleServerStats(HOST.id);

      expect(ablage.proben).toHaveLength(1);
      expect(ablage.proben[0]).toMatchObject({
        playersOnline: 7,
        playersMax: 20,
        pingMs: 11,
        // Festgehalten wird mit der Backend-Uhr – nicht 90 s in der Zukunft.
        recordedAt: backendZeit,
      });

      // Auch der Live-Kanal trägt die Empfangszeit.
      const gemeldet = harness.emitted.find((e) => e.event === 'server.statsUpdated');

      expect(gemeldet?.payload).toMatchObject({
        stats: { updatedAt: backendZeit.toISOString() },
      });
    });

    it('übernimmt eine nachgehende Agent-Uhr und hält die Reihenfolge im Verlauf monoton', async () => {
      const ablage = fakeAblage();
      const harness = makeHarness({ statsHistory: ablage });
      const serverId = await laufenderServer(harness);
      const start = harness.now();

      await meldeAbfrage(harness, serverId, new Date(start.getTime() - 90_000), 3);
      await harness.service.sampleServerStats(HOST.id);

      harness.advance(60_000);
      // Die Agent-Uhr springt zusätzlich zurück: Der zweite Frame trägt eine
      // ältere Zeit als der erste. Der Verlauf darf davon nichts merken.
      await meldeAbfrage(harness, serverId, new Date(start.getTime() - 120_000), 5);
      await harness.service.sampleServerStats(HOST.id);

      expect(ablage.proben.map((probe) => probe.playersOnline)).toEqual([3, 5]);
      expect((ablage.proben[1] as StatsSample).recordedAt.getTime()).toBeGreaterThan(
        (ablage.proben[0] as StatsSample).recordedAt.getTime(),
      );

      // Auch die Live-Meldungen laufen vorwärts, obwohl die Agent-Zeiten
      // rückwärts liefen.
      const zeiten = harness.emitted
        .filter((e) => e.event === 'server.statsUpdated')
        .map((e) => (e.payload as { stats: { updatedAt: string } }).stats.updatedAt);

      expect(zeiten).toEqual([start.toISOString(), harness.now().toISOString()]);
    });

    it('führt den Messwert auch bei stundenweiter Abweichung und meldet sie gedrosselt', async () => {
      const ablage = fakeAblage();
      const harness = makeHarness({ statsHistory: ablage });
      const serverId = await laufenderServer(harness);
      const abweichungMs = 3 * 60 * 60 * 1000;

      // Drei Frames dicht hintereinander – so kommen sie im Betrieb.
      for (const spielerzahl of [4, 5, 6]) {
        await meldeAbfrage(
          harness,
          serverId,
          new Date(harness.now().getTime() + abweichungMs),
          spielerzahl,
        );
      }

      await harness.service.sampleServerStats(HOST.id);

      // Der Messwert zählt trotzdem – verworfen wird nichts.
      expect(ablage.proben[0]).toMatchObject({ playersOnline: 6, recordedAt: harness.now() });

      const meldungen = harness.logged.filter((zeile) =>
        zeile.message.startsWith('Uhr des Agents'),
      );

      expect(meldungen).toHaveLength(1);
      expect(meldungen[0]?.details).toMatchObject({ serverId, skewMs: abweichungMs });

      // Nach Ablauf der Sperrfrist wieder – der Zustand hält ja an.
      harness.advance(60 * 60 * 1000);
      await meldeAbfrage(harness, serverId, new Date(harness.now().getTime() + abweichungMs), 6);

      expect(
        harness.logged.filter((zeile) => zeile.message.startsWith('Uhr des Agents')),
      ).toHaveLength(2);
    });

    it('protokolliert eine Abweichung innerhalb des Toleranzfensters nicht', async () => {
      const harness = makeHarness({ statsHistory: fakeAblage() });
      const serverId = await laufenderServer(harness);

      await meldeAbfrage(harness, serverId, new Date(harness.now().getTime() + 30_000), 2);

      expect(harness.logged.filter((zeile) => zeile.message.startsWith('Uhr des Agents'))).toEqual(
        [],
      );
    });
  });

  it('liefert den Verlauf im Fenster und kappt es an der Aufbewahrungsfrist', async () => {
    const ablage = fakeAblage();
    const harness = makeHarness({ statsHistory: ablage, statsHistoryRetentionHours: 2 });
    const serverId = await laufenderServer(harness);
    await harness.service.sampleServerStats(HOST.id);

    const verlauf = await harness.service.getStatsHistory(serverId, 10_000);

    expect(verlauf.windowMinutes).toBe(120);
    expect(verlauf.samples).toHaveLength(1);
    expect(verlauf.intervalSeconds).toBe(60);
  });

  it('räumt Stichproben jenseits der Frist weg', async () => {
    const ablage = fakeAblage();
    const harness = makeHarness({ statsHistory: ablage, statsHistoryRetentionHours: 1 });
    await laufenderServer(harness);
    await harness.service.sampleServerStats(HOST.id);

    expect(await harness.service.pruneServerStats()).toBe(0);

    harness.advance(2 * 60 * 60 * 1000);

    expect(await harness.service.pruneServerStats()).toBe(1);
    expect(ablage.proben).toEqual([]);
  });

  it('hält ohne Ablage nichts fest und liefert eine leere Reihe', async () => {
    const harness = makeHarness();
    const serverId = await laufenderServer(harness);

    expect(await harness.service.sampleServerStats(HOST.id)).toEqual([]);
    expect((await harness.service.getStatsHistory(serverId, 60)).samples).toEqual([]);
  });

  /**
   * Zweiter Abnehmer derselben Abtastung: die Ressourcen-Warnung auf
   * Server-Ebene (Lastenheft §3.3). Sie bekommt ihre Zahlen aus diesem
   * Durchlauf und stellt keine eigene Abfrage.
   */
  describe('Last je Server für die Ressourcen-Warnung', () => {
    it('liefert Messwert, Limit und Besitzer eines laufenden Servers', async () => {
      const harness = makeHarness({ statsHistory: fakeAblage() });
      const serverId = await laufenderServer(harness);
      const server = await harness.service.requireServer(serverId);

      await harness.service.sampleServerStats(HOST.id);

      expect(harness.service.listServerLoads()).toEqual([
        {
          serverId,
          nodeId: HOST.id,
          ownerId: OWNER_ID,
          limits: server.resourceLimits,
          // 512 MiB der Attrappe.
          usedRamMb: 512,
          // 42,5 % **eines Kerns** sind 0,425 Kerne – nicht 42,5.
          usedCpuCores: 0.425,
          // Belegter Plattenplatz je Container fehlt im Agent-Protokoll; `null`
          // darf nie zu einer Warnung führen.
          usedDiskMb: null,
        },
      ]);
    });

    it('kennt einen gestoppten Server nicht', async () => {
      const harness = makeHarness({ statsHistory: fakeAblage() });
      await harness.service.createServer(createInput(), OWNER_ID);

      await harness.service.sampleServerStats(HOST.id);

      expect(harness.service.listServerLoads()).toEqual([]);
    });

    it('vergisst die Last einer Node, die zwei Takte nicht gemessen wurde', async () => {
      // Etwa nach einem Verbindungsabbruch des Agents: Der letzte Messwert ist
      // dann kein Warnungsgrund mehr, sondern ein Messproblem.
      const harness = makeHarness({ statsHistory: fakeAblage() });
      await laufenderServer(harness);
      await harness.service.sampleServerStats(HOST.id);

      harness.advance(2 * 60_000);
      expect(harness.service.listServerLoads()).toHaveLength(1);

      harness.advance(1);
      expect(harness.service.listServerLoads()).toEqual([]);
    });
  });
});
