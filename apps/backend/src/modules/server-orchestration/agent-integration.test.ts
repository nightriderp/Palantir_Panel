/**
 * Agent ↔ Backend über einen echten WebSocket (Review 2026-09-16, Befund 7.1).
 *
 * Bis dahin prüfte jede Seite nur gegen Attrappen: `agent-route.test.ts` sprach
 * das Protokoll von Hand, `agent-connection.test.ts` gegen einen erfundenen
 * Transport. Ob beide Seiten **zusammen** funktionieren – Handshake, Befehl
 * mit Antwort, Ist-Zustands-Bericht, Ereignis, Wiederanlauf –, sah kein Test.
 *
 * Hier lauscht ein echtes Fastify auf einem freien Port, und der **echte
 * Agent-Client** aus `@palantir/agent` (WebSocket-Transport, Backoff,
 * Korrelations-Speicher) verbindet sich dorthin. Nur die Container-Runtime des
 * Agents ist eine Attrappe – Docker gibt es in der CI nicht.
 */

import websocket from '@fastify/websocket';
import {
  type AgentContainerState,
  type AgentContainerStats,
  type AgentEventFrame,
  type AgentStateReportFrame,
  AGENT_PROTOCOL_VERSION,
  ok,
} from '@palantir/contracts';
import {
  type AgentRuntimePort,
  type CommandExecution,
  createAgentConnection,
} from '@palantir/agent/connection';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { type AgentGatewayLogger, AgentRegistry } from './agent-gateway.js';
import { registerAgentRoute } from './agent-route.js';

const HOST_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'integrationstest-token-mit-genug-laenge';

const silentLog: AgentGatewayLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const STATS: AgentContainerStats = {
  containerId: 'container-1',
  cpuPercent: 12.5,
  memoryUsedBytes: 512 * 1024 * 1024,
  memoryLimitBytes: 2048 * 1024 * 1024,
  networkRxBytes: 1_000,
  networkTxBytes: 2_000,
  blockReadBytes: 0,
  blockWriteBytes: 0,
  pids: 7,
  sampledAt: '2026-09-18T10:00:05.000Z',
};

const CONTAINER: AgentContainerState = {
  serverId: SERVER_ID,
  containerId: 'container-1',
  status: 'running',
  exitCode: null,
  startedAt: '2026-09-18T10:00:00.000Z',
  observedAt: '2026-09-18T10:00:05.000Z',
};

/** Container-Runtime des Agents als Attrappe: zählt Befehle, antwortet fest. */
class FakeRuntime implements AgentRuntimePort {
  readonly ausgefuehrt: CommandExecution[] = [];
  berichte = 0;

  execute(execution: CommandExecution): Promise<ReturnType<typeof ok>> {
    this.ausgefuehrt.push(execution);

    if (execution.command === 'GET_STATS') {
      return Promise.resolve(ok(STATS));
    }

    return Promise.resolve(ok(null));
  }

  listContainerStates(): Promise<readonly AgentContainerState[]> {
    this.berichte += 1;

    return Promise.resolve([CONTAINER]);
  }
}

interface Aufbau {
  readonly app: FastifyInstance;
  readonly agents: AgentRegistry;
  readonly url: string;
  readonly stateReports: AgentStateReportFrame[];
  readonly events: AgentEventFrame[];
  readonly connected: string[];
  readonly disconnected: string[];
}

let offen: Aufbau | null = null;
let stoppen: (() => void) | null = null;

async function baueBackend(): Promise<Aufbau> {
  const app = Fastify({ logger: false });
  const agents = new AgentRegistry();
  const stateReports: AgentStateReportFrame[] = [];
  const events: AgentEventFrame[] = [];
  const connected: string[] = [];
  const disconnected: string[] = [];

  await app.register(websocket);
  registerAgentRoute(app, {
    agents,
    handlers: {
      onStateReport: (_hostId, frame) => {
        stateReports.push(frame);
      },
      onEvent: (_hostId, frame) => {
        events.push(frame);
      },
      onConnected: (hostId) => {
        connected.push(hostId);
      },
      onDisconnected: (hostId) => {
        disconnected.push(hostId);
      },
      // Dieselbe Verdrahtung wie in `index.ts` (Befund 11.3).
      onHello: (hostId, info) => {
        agents.noteHello(hostId, info);
      },
    },
    log: silentLog,
    token: TOKEN,
    resolveHostId: async () => HOST_ID,
    countHosts: async () => 1,
  });

  // Freier Port auf dem Loopback – so kollidieren parallele Testläufe nicht.
  const adresse = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `${adresse.replace(/^http/, 'ws')}/agent`;

  offen = { app, agents, url, stateReports, events, connected, disconnected };

  return offen;
}

/** Wartet, bis `bedingung` wahr ist – die Verbindung läuft asynchron über das Netz. */
async function warteBis(bedingung: () => boolean, maxMs = 3_000): Promise<void> {
  const ende = Date.now() + maxMs;

  while (!bedingung()) {
    if (Date.now() > ende) {
      throw new Error('Bedingung wurde nicht rechtzeitig wahr.');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function verbindeAgent(url: string, runtime: FakeRuntime, token = TOKEN) {
  const connection = createAgentConnection({
    backendWsUrl: url,
    token,
    runtime,
    agentVersion: '0.0.0-test',
    nodeId: HOST_ID,
    // Kurzer Backoff ohne Streuung: Der Wiederanlauf soll im Test in
    // Millisekunden sichtbar werden, nicht in Sekunden.
    backoff: { initialDelayMs: 50, maxDelayMs: 200, factor: 2, jitterRatio: 0 },
  });

  connection.start();
  stoppen = () => connection.stop();

  return connection;
}

afterEach(async () => {
  stoppen?.();
  stoppen = null;
  offen?.agents.closeAll();
  await offen?.app.close();
  offen = null;
});

describe('Agent ↔ Backend über echten WebSocket (Befund 7.1)', () => {
  it('schließt den Handshake ab und meldet die Node als verbunden', async () => {
    const { url, agents, connected } = await baueBackend();
    const runtime = new FakeRuntime();
    const connection = verbindeAgent(url, runtime);

    await warteBis(() => agents.get(HOST_ID) !== null);

    expect(connection.isReady).toBe(true);
    expect(connected).toEqual([HOST_ID]);
    // Das Backend kennt Fassung und Protokoll des Agents (Befund 11.3).
    expect(agents.helloOf(HOST_ID)).toMatchObject({
      agentVersion: '0.0.0-test',
      protocolVersion: AGENT_PROTOCOL_VERSION,
      compatible: true,
    });
  });

  it('beantwortet einen Befehl des Backends mit dem Ergebnis der Runtime', async () => {
    const { url, agents } = await baueBackend();
    const runtime = new FakeRuntime();
    verbindeAgent(url, runtime);
    await warteBis(() => agents.get(HOST_ID) !== null);

    const session = agents.require(HOST_ID);
    const stats = await session.sendCommand('GET_STATS', SERVER_ID, {
      containerId: 'container-1',
    });

    expect(stats).toEqual(STATS);
    expect(runtime.ausgefuehrt).toHaveLength(1);
    expect(runtime.ausgefuehrt[0]).toMatchObject({
      command: 'GET_STATS',
      serverId: SERVER_ID,
      payload: { containerId: 'container-1' },
    });
  });

  it('liefert den Ist-Zustand auf Anforderung und beim Verbindungsaufbau', async () => {
    const { url, agents, stateReports } = await baueBackend();
    const runtime = new FakeRuntime();
    verbindeAgent(url, runtime);
    await warteBis(() => agents.get(HOST_ID) !== null);

    // Nach dem Handshake schickt der Agent seinen Bericht von selbst
    // (Pflichtenheft §2.2, Reconnect-Strategie).
    await warteBis(() => stateReports.length >= 1);
    expect(stateReports[0]).toMatchObject({
      kind: 'stateReport',
      reason: 'connected',
      containers: [CONTAINER],
    });

    agents.require(HOST_ID).requestState();
    await warteBis(() => stateReports.length >= 2);
    expect(stateReports[1]).toMatchObject({ reason: 'requested', containers: [CONTAINER] });
    expect(runtime.berichte).toBe(2);
  });

  it('reicht ein unaufgefordertes Ereignis des Agents an den Handler durch', async () => {
    const { url, agents, events } = await baueBackend();
    const runtime = new FakeRuntime();
    const connection = verbindeAgent(url, runtime);
    await warteBis(() => agents.get(HOST_ID) !== null);

    const gesendet = connection.sendEvent({
      event: 'STATUS_CHANGED',
      serverId: SERVER_ID,
      payload: { containerId: 'container-1', status: 'exited', exitCode: 0 },
    });

    expect(gesendet).toBe(true);
    await warteBis(() => events.length >= 1);
    expect(events[0]).toMatchObject({
      kind: 'event',
      event: 'STATUS_CHANGED',
      serverId: SERVER_ID,
    });
  });

  it('baut nach einem Abriss durch das Backend von selbst neu auf', async () => {
    const { url, agents, connected, disconnected } = await baueBackend();
    const runtime = new FakeRuntime();
    verbindeAgent(url, runtime);
    await warteBis(() => agents.get(HOST_ID) !== null);

    // Das Backend beendet die Verbindung, wie bei einem Neustart des Prozesses.
    agents.require(HOST_ID).close(1001, 'Backend startet neu');
    await warteBis(() => disconnected.length >= 1);
    expect(agents.get(HOST_ID)).toBeNull();

    // Der Agent kommt mit Backoff zurück – und meldet erneut seinen Zustand.
    await warteBis(() => agents.get(HOST_ID) !== null);
    expect(connected).toEqual([HOST_ID, HOST_ID]);
    expect(runtime.berichte).toBeGreaterThanOrEqual(2);
  });

  it('weist ein falsches Token ab, ohne dass die Node je als verbunden gilt', async () => {
    const { url, agents, connected } = await baueBackend();
    const runtime = new FakeRuntime();
    const connection = verbindeAgent(url, runtime, 'falsches-token-mit-genug-laenge');

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(connection.isReady).toBe(false);
    expect(agents.get(HOST_ID)).toBeNull();
    expect(connected).toEqual([]);
  });
});
