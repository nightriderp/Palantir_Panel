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
  type AgentCommandName,
  type ApiResponse,
  type NodeResourceUsage,
  type ServerCloneJobDto,
  type ServerMemberLevel,
  type ServerStatus,
  type UserResourceUsage,
  NO_USER_RESOURCE_LIMITS,
} from '@palantir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type HostNodeRepository,
  type ServerUsageRepository,
  type UserResourceLimitRepository,
  createResourceService,
} from '../resources/index.js';
import { AgentRegistry, AgentSession, type AgentSocket } from './agent-gateway.js';
import { type ServerOrchestrationError } from './errors.js';
import { TEST_GAME_TYPE, createGameRegistry } from './game-registry.js';
import { type HealthCheckResult, type HealthProbe } from './health-check.js';
import { createPortAllocator } from './ports.js';
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
import { type OrchestrationEventSink, ServerOrchestrationService } from './service.js';
import { type DnsProvider, type DnsRecord } from './dns/types.js';
import { type ServerStatsRepository, type StatsSample } from './stats-history.js';
import { type StoredWorldArchive, type WorldArchiveStore } from './world-import.js';

const HOST: HostNodeRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online',
};

const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-26T12:00:00.000Z');

let idCounter = 0;

const nextId = (): string => `44444444-4444-4444-8444-${String(++idCounter).padStart(12, '0')}`;

/** In-Memory-Ausprägung des Repositories – die Abläufe sollen ohne Datenbank prüfbar sein. */
class FakeRepository implements ServerRepository {
  readonly servers = new Map<string, ServerRecord>();
  readonly members = new Map<string, Map<string, ServerMemberLevel>>();

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

  persistLifecycle(id: string, data: PersistLifecycleData): Promise<void> {
    const current = this.servers.get(id);

    if (current !== undefined) {
      this.servers.set(id, { ...current, ...data });
    }

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

  findHost(hostId: string): Promise<HostNodeRecord | null> {
    return Promise.resolve(hostId === HOST.id ? this.host() : null);
  }

  markHostConnected(): Promise<void> {
    return Promise.resolve();
  }

  markHostDisconnected(): Promise<void> {
    return Promise.resolve();
  }

  readonly measuredUpdates: { hostId: string; ramMb: number; cpuCores: number; diskMb: number }[] =
    [];

  updateMeasuredResources(
    hostId: string,
    resources: { ramMb: number; cpuCores: number; diskMb: number },
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

    const result = this.answers.get(frame.command) ?? this.defaultAnswerFor(frame.command);

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
  private defaultAnswerFor(command: AgentCommandName): ApiResponse<unknown> {
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

interface Harness {
  readonly service: ServerOrchestrationService;
  readonly repository: FakeRepository;
  readonly socket: AnsweringSocket;
  readonly emitted: { event: string; payload: Record<string, unknown> }[];
  readonly dnsRecords: DnsRecord[];
  readonly deletedDnsNames: string[];
  readonly releasedPorts: string[];
  /** Stellt die Uhr des Dienstes vor – ohne echte Wartezeit. */
  advance(ms: number): void;
}

function makeHarness(
  options: {
    healthy?: boolean | 'pending';
    /** Eigene, serialisierende Reservierung – für den TOCTOU-Test (Punkt 98). */
    buildReservation?: (repository: FakeRepository) => CapacityReservation;
    /** Upload-Grenze, um sie im Test ohne 64-MiB-Puffer zu erreichen (P2). */
    maxUploadBytes?: number;
    /** Zwischenspeicher der Weltdaten-Archive; ohne Angabe keiner (P4). */
    worldArchives?: WorldArchiveStore;
    /** Grenze für Weltarchive, um sie im Test ohne 64 MiB zu erreichen (P4). */
    maxWorldArchiveBytes?: number;
    /** Ablage des Messwert-Verlaufs; ohne Angabe wird nichts festgehalten (P5). */
    statsHistory?: ServerStatsRepository;
    /** Aufbewahrungsfrist des Verlaufs in Stunden (P5). */
    statsHistoryRetentionHours?: number;
  } = {},
): Harness {
  const repository = new FakeRepository();
  const agents = new AgentRegistry();
  const socket = new AnsweringSocket();
  const emitted: { event: string; payload: Record<string, unknown> }[] = [];
  const dnsRecords: DnsRecord[] = [];
  const deletedDnsNames: string[] = [];

  const silentLog = {
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
  };

  const session = new AgentSession({
    hostId: HOST.id,
    socket,
    handlers: { onStateReport: () => undefined, onEvent: () => undefined },
    log: silentLog,
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

  const dns: DnsProvider = {
    upsertRecord: (record) => {
      dnsRecords.push(record);

      return Promise.resolve(`rec-${String(dnsRecords.length)}`);
    },
    deleteRecord: (name) => {
      deletedDnsNames.push(name);

      return Promise.resolve();
    },
  };

  const events: OrchestrationEventSink = {
    emit: (event, payload) => {
      emitted.push({ event, payload });
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
      Promise.resolve(
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

  // Virtuelle Uhr: `sleep()` stellt sie vor, statt echte Zeit zu verbrauchen.
  // Die Startfrist des Health-Checks läuft dadurch gegen dieselbe Uhr.
  let clock = NOW.getTime();

  const service = new ServerOrchestrationService({
    repository,
    agents,
    registry: createGameRegistry(1),
    dns,
    ports: createPortAllocator(portPool),
    resources: createPermissiveResourceGuard(() => undefined),
    reservation: options.buildReservation?.(repository),
    healthProbe: healthyProbe(options.healthy ?? true),
    ...(options.worldArchives === undefined ? {} : { worldArchives: options.worldArchives }),
    ...(options.statsHistory === undefined ? {} : { statsHistory: options.statsHistory }),
    events,
    log: silentLog,
    config: {
      baseDomain: 'example.tld',
      publicIpv4: '203.0.113.10',
      routerHostname: null,
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
    advance: (ms: number): void => {
      clock += ms;
    },
  };
}

const createInput = (subdomain = 'mein-server') => ({
  name: 'Mein Server',
  gameType: TEST_GAME_TYPE.id,
  subdomain,
  hostId: HOST.id,
  resourceLimits: TEST_GAME_TYPE.resourceDefaults,
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

  it('lässt einen gestoppten Server dabei aus', async () => {
    const harness = makeHarness();
    await harness.service.createServer(createInput(), OWNER_ID);
    harness.socket.commands.length = 0;

    expect(await harness.service.refreshServerQueries(HOST.id)).toEqual([]);
    expect(abfragen(harness)).toHaveLength(0);
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
    expect(
      harness.emitted.filter(
        (e) => e.event === 'server.failed' && e.payload.reason === 'crashLoop',
      ),
    ).toHaveLength(1);
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
  it('schaltet einen lange leeren Server ab', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    harness.advance(60 * 60_000);

    const stopped = await harness.service.runAutoShutdownSweep(HOST.id);

    expect(stopped).toEqual([created.id]);
    expect(harness.emitted.map((e) => e.event)).toContain('autoShutdown.triggered');
  });

  it('lässt einen Server innerhalb der Schonfrist laufen', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.startServer(created.id, OWNER_ID);
    await settle(harness, created.id, ['running']);

    harness.advance(5 * 60_000);

    expect(await harness.service.runAutoShutdownSweep(HOST.id)).toEqual([]);
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

  it('gibt die oeffentlichen Ports wieder an den Pool zurueck', async () => {
    // Sonst bliebe eine Portzuordnung ohne Server zurueck (Pflichtenheft §2.4).
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);

    await harness.service.deleteServer(created.id);

    expect(harness.releasedPorts).toEqual([created.id]);
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
      { hostId: HOST.id, ramMb: 28_672, cpuCores: 8, diskMb: 1_500_000 },
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
  it('zieht bei verbundenen Spielern den Aktivitätszeitpunkt nach', async () => {
    const harness = makeHarness();
    const created = await harness.service.createServer(createInput(), OWNER_ID);
    const at = new Date(NOW.getTime() + 120_000).toISOString();

    await harness.service.handleAgentEvent(HOST.id, {
      kind: 'event',
      event: 'STATS_UPDATE',
      serverId: created.id,
      payload: { source: 'serverQuery', playersOnline: 2 },
      emittedAt: at,
    });

    expect((await harness.service.requireServer(created.id)).lastActivityAt).toBe(at);
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
    // Nutzlast unverändert durchgereicht.
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
        updatedAt: '2026-08-26T12:00:02.000Z',
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
  function buildReservation(repository: FakeRepository): CapacityReservation {
    const only = (servers: readonly ServerRecord[], excludeServerId?: string): ServerRecord[] =>
      servers.filter((server) => server.id !== excludeServerId);

    const usage: ServerUsageRepository = {
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
    const inner = createInlineCapacityReservation(guard, repository);

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

  it('löscht rekursiv und sperrt den Datenordner selbst', async () => {
    const harness = makeHarness();
    const id = await angelegterServer(harness);

    await harness.service.deleteFile(id, 'welt');

    expect(befehle(harness, 'FILE_DELETE').at(-1)?.payload).toMatchObject({
      path: `${DATEN_ORDNER}/welt`,
      recursive: true,
    });

    await expect(harness.service.deleteFile(id, '')).rejects.toMatchObject({
      code: 'AGENT_INVALID_PATH',
    });
    expect(befehle(harness, 'FILE_DELETE')).toHaveLength(1);
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

  /** Zwischenspeicher im Speicher – dieselbe Schnittstelle wie die Platte. */
  function fakeStore(archiv: StoredWorldArchive | null): WorldArchiveStore & {
    readonly abgeholt: string[];
  } {
    const abgeholt: string[] = [];

    return {
      abgeholt,
      save: () => Promise.reject(new Error('nicht benutzt')),
      take: (uploadId) => {
        abgeholt.push(uploadId);

        return Promise.resolve(archiv);
      },
      sweep: () => Promise.resolve(0),
    };
  }

  const mitImport = () => ({
    ...createInput(),
    worldImport: { uploadId: UPLOAD_ID, fileName: 'welt.zip' },
  });

  it('schickt das Archiv als FILE_EXTRACT an den Agent', async () => {
    const store = fakeStore({
      uploadId: UPLOAD_ID,
      content: Buffer.from('PK-Archiv'),
      format: 'zip',
    });
    const harness = makeHarness({ worldArchives: store });

    const server = await harness.service.createServer(mitImport(), OWNER_ID);

    expect(store.abgeholt).toEqual([UPLOAD_ID]);

    const extract = harness.socket.commands.find((eintrag) => eintrag.command === 'FILE_EXTRACT');

    expect(extract?.payload).toMatchObject({
      path: '',
      format: 'zip',
      contentBase64: Buffer.from('PK-Archiv').toString('base64'),
    });
    // Der Import läuft, während der Server angelegt wird – danach ist er fertig.
    expect(server.status).not.toBe('error');
  });

  it('legt ohne worldImport kein Archiv an', async () => {
    const store = fakeStore(null);
    const harness = makeHarness({ worldArchives: store });

    await harness.service.createServer(createInput(), OWNER_ID);

    expect(store.abgeholt).toEqual([]);
    expect(harness.socket.commands.some((eintrag) => eintrag.command === 'FILE_EXTRACT')).toBe(
      false,
    );
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
    const harness = makeHarness({
      worldArchives: fakeStore({
        uploadId: UPLOAD_ID,
        content: Buffer.alloc(2048),
        format: 'zip',
      }),
      maxWorldArchiveBytes: 1024,
    });

    await expect(harness.service.createServer(mitImport(), OWNER_ID)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    expect(harness.socket.commands.some((eintrag) => eintrag.command === 'FILE_EXTRACT')).toBe(
      false,
    );
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
});
