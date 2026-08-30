/**
 * Der zentrale Zeitgeber (R2, Gefundener Punkt 63).
 *
 * Zwei Fragen stehen im Vordergrund:
 *
 * 1. **Löst er tatsächlich aus?** Genau das fehlte bisher – beide Abläufe waren
 *    gebaut und getestet, wurden aber von niemandem aufgerufen.
 * 2. **Schaltet er nichts versehentlich ab?** Der Auto-Shutdown-Sweep läuft nun
 *    jede Minute; ein Server innerhalb seiner Schonfrist darf davon nicht
 *    berührt werden (Pflichtenheft §9).
 *
 * Für Frage 2 hängt der Test am **echten** Dienst der Server-Orchestrierung mit
 * einem Agent am echten Protokoll-Gegenstück – nicht an einer Attrappe des
 * Sweeps. Sonst prüfte er nur seine eigene Nachbildung der Regel.
 */

import {
  type AgentCommandName,
  type ApiResponse,
  type GameConfigValues,
  type ResourceLowEvent,
  type ServerMemberLevel,
  type ServerResourceLimits,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  AgentSession,
  type AgentSocket,
} from './modules/server-orchestration/agent-gateway.js';
import { createGameRegistry } from './modules/server-orchestration/game-registry.js';
import { type HealthProbe } from './modules/server-orchestration/health-check.js';
import { createPortAllocator } from './modules/server-orchestration/ports.js';
import {
  type CreateServerData,
  type HostNodeRecord,
  type PersistLifecycleData,
  type ServerMemberRecord,
  type ServerRecord,
  type ServerRepository,
  type UpdateServerData,
} from './modules/server-orchestration/repository.js';
import { createPermissiveResourceGuard } from './modules/server-orchestration/resource-guard.js';
import { ServerOrchestrationService } from './modules/server-orchestration/service.js';
import {
  type NodeWarningEvaluator,
  type ResourceEventSink,
  type ScheduledTask,
  type SchedulerLogger,
  type SchedulerTimer,
  type TimerHandle,
  autoShutdownTask,
  backupScheduleTask,
  resourceWarningTask,
  startScheduler,
} from './scheduler.js';

/**
 * Stille Protokollierung für beide Schnittstellen dieses Tests.
 *
 * Bewusst ohne Typannotation: Dasselbe Objekt dient als `SchedulerLogger` und
 * als `AgentGatewayLogger` (der zusätzlich `info` verlangt).
 */
const silentLog = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

/** Zeitgeber, dessen Takt der Test selbst schlägt – ohne echte Wartezeit. */
function manualTimer(): SchedulerTimer & { fire(): void; readonly cleared: boolean } {
  let handler: (() => void) | null = null;
  let cleared = false;

  return {
    set(next: () => void): TimerHandle {
      handler = next;

      return 'handle';
    },
    clear(): void {
      cleared = true;
      handler = null;
    },
    fire(): void {
      handler?.();
    },
    get cleared(): boolean {
      return cleared;
    },
  };
}

/** Wartet, bis alle bereits angestoßenen Zusagen abgearbeitet sind. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('Zeitgeber: Auslösen und Überschneidung', () => {
  it('stößt bei jedem Takt alle Aufgaben an', async () => {
    const laeufe: string[] = [];
    const timer = manualTimer();
    const task = (name: string): ScheduledTask => ({
      name,
      run: (): Promise<void> => {
        laeufe.push(name);

        return Promise.resolve();
      },
    });

    startScheduler({
      tasks: [task('a'), task('b')],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    // Vor dem ersten Takt passiert nichts: Der Agent baut seine Verbindung nach
    // einem Neustart des Backends erst auf (Pflichtenheft §2.2).
    expect(laeufe).toEqual([]);

    timer.fire();
    await settle();
    timer.fire();
    await settle();

    expect(laeufe).toEqual(['a', 'b', 'a', 'b']);
  });

  it('überspringt einen Takt, solange der vorige Durchlauf läuft', async () => {
    const timer = manualTimer();
    let starts = 0;
    // Als Feld eines Objekts, damit TypeScript die Zuweisung im Callback nicht
    // wegnarrowt (eine lokale `let`-Variable gilt danach als `null`).
    const langsam: { freigeben: (() => void) | null } = { freigeben: null };

    startScheduler({
      tasks: [
        {
          name: 'langsam',
          run: (): Promise<void> => {
            starts += 1;

            return new Promise<void>((resolve) => {
              langsam.freigeben = resolve;
            });
          },
        },
      ],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();
    expect(starts).toBe(1);

    // Zweiter Takt, während der erste noch hängt: übersprungen, nicht eingereiht.
    timer.fire();
    await settle();
    expect(starts).toBe(1);

    langsam.freigeben?.();
    await settle();

    // Erst der Takt danach läuft wieder – der übersprungene wird nicht nachgeholt.
    timer.fire();
    await settle();
    expect(starts).toBe(2);
  });

  it('lässt eine fehlgeschlagene Aufgabe die übrigen nicht aufhalten', async () => {
    const timer = manualTimer();
    const fehler: string[] = [];
    let zweiteGelaufen = 0;

    const recordingLog: SchedulerLogger = {
      ...silentLog,
      error: (details): void => {
        fehler.push(String(details.task));
      },
    };

    startScheduler({
      tasks: [
        {
          name: 'kaputt',
          run: (): Promise<void> => Promise.reject(new Error('Homeserver antwortet nicht')),
        },
        {
          name: 'heil',
          run: (): Promise<void> => {
            zweiteGelaufen += 1;

            return Promise.resolve();
          },
        },
      ],
      intervalMs: 60_000,
      log: recordingLog,
      timer,
    });

    timer.fire();
    await settle();
    timer.fire();
    await settle();

    expect(fehler).toEqual(['kaputt', 'kaputt']);
    expect(zweiteGelaufen).toBe(2);
  });

  it('beendet den Takt bei stop()', () => {
    const timer = manualTimer();
    const scheduler = startScheduler({ tasks: [], intervalMs: 60_000, log: silentLog, timer });

    scheduler.stop();

    expect(timer.cleared).toBe(true);
  });
});

describe('Zeitgeber: fällige Backup-Zeitpläne', () => {
  it('ruft tick() bei jedem Takt auf', async () => {
    const timer = manualTimer();
    let ticks = 0;

    startScheduler({
      tasks: [
        backupScheduleTask(
          {
            tick: (): Promise<{ startedScheduleIds: string[]; skippedScheduleIds: string[] }> => {
              ticks += 1;

              return Promise.resolve({ startedScheduleIds: [], skippedScheduleIds: [] });
            },
          },
          silentLog,
        ),
      ],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();
    timer.fire();
    await settle();

    expect(ticks).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Auto-Shutdown am echten Dienst (Pflichtenheft §9)
// ---------------------------------------------------------------------------

const HOST: HostNodeRecord = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online',
};

const SERVER_ID = '66666666-6666-4666-8666-666666666666';
const OWNER_ID = '77777777-7777-4777-8777-777777777777';
const NOW = new Date('2026-08-26T12:00:00.000Z');

const RESOURCE_LIMITS: ServerResourceLimits = { ramMb: 2048, cpuCores: 2, diskMb: 10_240 };

function runningServer(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    ...overrides,
    id: SERVER_ID,
    ownerId: OWNER_ID,
    ownerDisplayName: 'Besitzerin',
    hostId: HOST.id,
    hostName: HOST.name,
    name: 'Wüstensturm',
    gameType: 'test',
    status: 'running',
    statusMessage: null,
    statusChangedAt: NOW.toISOString(),
    lastStartedAt: NOW.toISOString(),
    lastActivityAt: null,
    crashTimestamps: [],
    dockerContainerId: 'container-1',
    subdomain: 'wuestensturm',
    dnsRecordId: 'rec-1',
    assignedPorts: [],
    resourceLimits: RESOURCE_LIMITS,
    configJson: {} as GameConfigValues,
    startupParameters: '',
    autoShutdown: { enabled: true, idleTimeoutMinutes: 30, graceMinutes: 15 },
    restartRequired: false,
    clonedFromServerId: null,
    createdAt: NOW.toISOString(),
  };
}

/**
 * Repository für genau diesen Test.
 *
 * Bewusst nicht der vollständige Nachbau aus `service.test.ts`: Geprüft wird
 * hier der Weg Zeitgeber → Sweep → Stopp-Befehl. Alles, was dieser Weg nicht
 * berührt, meldet sich lautstark, falls es doch aufgerufen wird – ein stiller
 * Vorgabewert würde einen Testfehler in ein falsches Ergebnis verwandeln.
 */
class SweepRepository implements ServerRepository {
  server: ServerRecord;

  constructor(server: ServerRecord) {
    this.server = server;
  }

  findById(id: string): Promise<ServerRecord | null> {
    return Promise.resolve(id === this.server.id ? this.server : null);
  }

  listByHost(hostId: string): Promise<readonly ServerRecord[]> {
    return Promise.resolve(hostId === this.server.hostId ? [this.server] : []);
  }

  persistLifecycle(id: string, data: PersistLifecycleData): Promise<void> {
    if (id === this.server.id) {
      this.server = { ...this.server, ...data };
    }

    return Promise.resolve();
  }

  findHost(hostId: string): Promise<HostNodeRecord | null> {
    return Promise.resolve(hostId === HOST.id ? HOST : null);
  }

  defaultHost(): Promise<HostNodeRecord | null> {
    return Promise.resolve(HOST);
  }

  markHostConnected(): Promise<void> {
    return this.nichtGebraucht('markHostConnected');
  }

  markHostDisconnected(): Promise<void> {
    return this.nichtGebraucht('markHostDisconnected');
  }

  updateMeasuredResources(): Promise<void> {
    return this.nichtGebraucht('updateMeasuredResources');
  }

  private nichtGebraucht(methode: string): never {
    throw new Error(`Der Auto-Shutdown-Sweep sollte ${methode}() nicht aufrufen.`);
  }

  findByContainerId(): Promise<ServerRecord | null> {
    return this.nichtGebraucht('findByContainerId');
  }

  listAll(): Promise<readonly ServerRecord[]> {
    return this.nichtGebraucht('listAll');
  }

  listByOwnerOrMembership(): Promise<readonly ServerRecord[]> {
    return this.nichtGebraucht('listByOwnerOrMembership');
  }

  isSubdomainTaken(): Promise<boolean> {
    return this.nichtGebraucht('isSubdomainTaken');
  }

  create(_data: CreateServerData): Promise<ServerRecord> {
    return this.nichtGebraucht('create');
  }

  update(_id: string, _data: UpdateServerData): Promise<void> {
    return this.nichtGebraucht('update');
  }

  delete(): Promise<void> {
    return this.nichtGebraucht('delete');
  }

  listMembers(): Promise<readonly ServerMemberRecord[]> {
    return this.nichtGebraucht('listMembers');
  }

  memberLevel(): Promise<ServerMemberLevel | null> {
    return this.nichtGebraucht('memberLevel');
  }

  upsertMember(_serverId: string, _userId: string, _level: ServerMemberLevel): Promise<void> {
    return this.nichtGebraucht('upsertMember');
  }

  removeMember(): Promise<void> {
    return this.nichtGebraucht('removeMember');
  }
}

/** Socket, der jeden Befehl sofort mit Erfolg beantwortet. */
class AnsweringSocket implements AgentSocket {
  readonly commands: AgentCommandName[] = [];
  session: AgentSession | null = null;

  send(data: string): void {
    const frame = JSON.parse(data) as {
      kind: string;
      command?: AgentCommandName;
      correlationId?: string;
    };

    if (frame.kind !== 'command' || frame.command === undefined) {
      return;
    }

    this.commands.push(frame.command);

    const result: ApiResponse<unknown> = { success: true, data: null, error: null };

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
}

const neverHealthy: HealthProbe = {
  check: () => new Promise(() => undefined),
};

interface SweepHarness {
  readonly repository: SweepRepository;
  readonly socket: AnsweringSocket;
  readonly agents: AgentRegistry;
  readonly service: ServerOrchestrationService;
  advance(ms: number): void;
}

function makeSweepHarness(server: ServerRecord): SweepHarness {
  const repository = new SweepRepository(server);
  const agents = new AgentRegistry();
  const socket = new AnsweringSocket();

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

  let clock = NOW.getTime();

  const service = new ServerOrchestrationService({
    repository,
    agents,
    registry: createGameRegistry(1),
    dns: {
      upsertRecord: () => Promise.resolve('rec-1'),
      deleteRecord: () => Promise.resolve(),
    },
    ports: createPortAllocator({
      allocateForServer: () => Promise.resolve([]),
      releaseForServer: () => Promise.resolve(0),
    }),
    resources: createPermissiveResourceGuard(() => undefined),
    healthProbe: neverHealthy,
    events: { emit: (): void => undefined },
    log: silentLog,
    config: {
      baseDomain: 'example.tld',
      publicIpv4: '203.0.113.10',
      routerHostname: null,
      virtualHostPort: 25_565,
      crashLoopPolicy: { maxRestarts: 2, windowMinutes: 10 },
      healthCheckIntervalMs: 5_000,
      healthCheckAttemptTimeoutMs: 1_000,
      maxUploadBytes: 2 * 1024 * 1024 * 1024,
      maxWorldArchiveBytes: 64 * 1024 * 1024,
      defaultAutoShutdown: { enabled: true, idleTimeoutMinutes: 30, graceMinutes: 15 },
    },
    now: (): Date => new Date(clock),
  });

  return {
    repository,
    socket,
    agents,
    service,
    advance: (ms: number): void => {
      clock += ms;
    },
  };
}

describe('Zeitgeber: Auto-Shutdown (Pflichtenheft §9)', () => {
  it('lässt einen Server unberührt, solange die Schonfrist läuft', async () => {
    const harness = makeSweepHarness(runningServer());
    const timer = manualTimer();

    startScheduler({
      tasks: [autoShutdownTask(harness.service, harness.agents, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    // 14 Minuten nach dem Start – die Schonfrist beträgt 15 Minuten. Auch die
    // Inaktivität ist damit rechnerisch schon länger als nichts, aber die
    // Schonfrist geht vor.
    harness.advance(14 * 60_000);

    for (let takt = 0; takt < 14; takt += 1) {
      timer.fire();
      await settle();
    }

    expect(harness.socket.commands).toEqual([]);
    expect(harness.repository.server.status).toBe('running');
  });

  it('schaltet erst nach Schonfrist und Inaktivitäts-Timeout ab', async () => {
    const harness = makeSweepHarness(runningServer());
    const timer = manualTimer();

    startScheduler({
      tasks: [autoShutdownTask(harness.service, harness.agents, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    // Schonfrist (15) ist vorbei, das Inaktivitäts-Timeout (30) noch nicht.
    harness.advance(20 * 60_000);
    timer.fire();
    await settle();

    expect(harness.socket.commands).toEqual([]);

    harness.advance(15 * 60_000);
    timer.fire();
    await settle();

    expect(harness.socket.commands).toEqual(['STOP']);
    expect(harness.repository.server.status).toBe('stopped');
  });

  it('rührt Nodes ohne Agent-Verbindung nicht an', async () => {
    const harness = makeSweepHarness(runningServer());
    const timer = manualTimer();

    startScheduler({
      tasks: [autoShutdownTask(harness.service, harness.agents, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    harness.agents.closeAll();
    harness.advance(60 * 60_000);

    timer.fire();
    await settle();

    expect(harness.socket.commands).toEqual([]);
    expect(harness.repository.server.status).toBe('running');
  });
});

describe('Zeitgeber: Ressourcen-Warnungen', () => {
  const NODE_ID = '11111111-1111-4111-8111-111111111111';

  /** Eine Warnung auf Node-Ebene, wie sie B4 (`evaluateNodeWarnings`) liefert. */
  function nodeWarning(usedPercent: number): ResourceLowEvent {
    return {
      scope: 'node',
      resource: 'ram',
      unit: 'mb',
      nodeId: NODE_ID,
      serverId: null,
      used: 30_000,
      total: 32_768,
      usedPercent,
      thresholdPercent: 85,
      at: '2026-08-30T00:00:00.000Z',
    };
  }

  /** Senke, die jede gemeldete `resource.low`-Nutzlast festhält. */
  function capturingSink(): ResourceEventSink & {
    readonly events: { event: string; payload: Record<string, unknown> }[];
  } {
    const events: { event: string; payload: Record<string, unknown> }[] = [];

    return {
      events,
      emit(event, payload): void {
        events.push({ event, payload });
      },
    };
  }

  it('meldet resource.low, wenn eine Node über dem Schwellwert liegt', async () => {
    const timer = manualTimer();
    const sink = capturingSink();
    const evaluator: NodeWarningEvaluator = {
      evaluateAllNodeWarnings: () => Promise.resolve([nodeWarning(91.5)]),
    };

    startScheduler({
      tasks: [resourceWarningTask(evaluator, sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.event).toBe('resource.low');
    // ResourceLowEvent-Felder unverändert, nur `ownerId` ergänzt (Node: null).
    expect(sink.events[0]?.payload).toMatchObject({
      scope: 'node',
      nodeId: NODE_ID,
      usedPercent: 91.5,
      thresholdPercent: 85,
      ownerId: null,
    });
  });

  it('meldet nichts, solange keine Node über dem Schwellwert liegt', async () => {
    const timer = manualTimer();
    const sink = capturingSink();
    const evaluator: NodeWarningEvaluator = {
      evaluateAllNodeWarnings: () => Promise.resolve([]),
    };

    startScheduler({
      tasks: [resourceWarningTask(evaluator, sink, silentLog)],
      intervalMs: 60_000,
      log: silentLog,
      timer,
    });

    timer.fire();
    await settle();

    expect(sink.events).toEqual([]);
  });
});
