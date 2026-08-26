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
  type ServerMemberLevel,
  type ServerStatus,
} from '@palantir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
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
import { createPermissiveResourceGuard } from './resource-guard.js';
import { type OrchestrationEventSink, ServerOrchestrationService } from './service.js';
import { type DnsProvider, type DnsRecord } from './dns/types.js';

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

  defaultHost(): Promise<HostNodeRecord | null> {
    return Promise.resolve(HOST);
  }

  findHost(hostId: string): Promise<HostNodeRecord | null> {
    return Promise.resolve(hostId === HOST.id ? HOST : null);
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

function makeHarness(options: { healthy?: boolean | 'pending' } = {}): Harness {
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
    healthProbe: healthyProbe(options.healthy ?? true),
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

    expect(harness.socket.commands.map((c) => c.command)).toEqual(['STOP', 'START']);
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

    const clone = await harness.service.cloneServer(
      source.id,
      { name: 'Klon', subdomain: 'klon-eins', includeWorldData: false },
      OWNER_ID,
    );

    expect(clone.subdomain).toBe('klon-eins');
    expect(clone.configJson.greeting).toBe('Hallo Klon');
    expect(clone.clonedFromServerId).toBe(source.id);
    expect(harness.emitted.map((e) => e.event)).toContain('server.cloned');
  });

  it('lehnt eine bereits vergebene Subdomain für den Klon ab', async () => {
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
  });

  it('meldet das Mitkopieren der Weltdaten als noch nicht umgesetzt', async () => {
    // Ein leerer Server soll nicht als vollständiger Klon durchgehen.
    const harness = makeHarness();
    const source = await harness.service.createServer(createInput('vorlage'), OWNER_ID);

    try {
      await harness.service.cloneServer(
        source.id,
        { name: 'Klon', subdomain: 'klon-zwei', includeWorldData: true },
        OWNER_ID,
      );
      expect.unreachable('Das Mitkopieren hätte scheitern müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('AGENT_COMMAND_NOT_IMPLEMENTED');
    }
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
      payload: { playersOnline: 2 },
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
      payload: { playersOnline: 0 },
      emittedAt: new Date(NOW.getTime() + 120_000).toISOString(),
    });

    expect((await harness.service.requireServer(created.id)).lastActivityAt).toBeNull();
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
