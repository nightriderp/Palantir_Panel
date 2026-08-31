/**
 * Tests des Backend-Gegenstücks zum Agent-Protokoll (Pflichtenheft §2.2, §5.3).
 *
 * Geprüft wird das, was ohne echten Socket schwer zu erwischen ist: Handshake,
 * Zuordnung von Befehl und Ergebnis, Fristen, Abbruch mitten im Befehl.
 */

import {
  AGENT_PROTOCOL_VERSION,
  type AgentEventFrame,
  type AgentStateReportFrame,
  type BackendToAgentFrame,
} from '@palantir/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentSocket,
  AgentRegistry,
  AgentSession,
  CLOSE_CODE_PROTOCOL_MISMATCH,
  CLOSE_CODE_UNAUTHORIZED,
  isAuthorizedAgentHandshake,
} from './agent-gateway.js';
import { type ServerOrchestrationError } from './errors.js';

const NOW = new Date('2026-08-26T12:00:00.000Z');

/** Eingehende Frames werden gegen `@palantir/validation` geprüft – IDs sind UUIDs. */
const SERVER_ID = '11111111-1111-4111-8111-111111111111';

const silentLog = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

class FakeSocket implements AgentSocket {
  readonly sent: BackendToAgentFrame[] = [];
  closedWith: { code: number; reason: string } | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as BackendToAgentFrame);
  }

  close(code: number, reason: string): void {
    this.closedWith ??= { code, reason };
  }

  lastFrame(): BackendToAgentFrame | undefined {
    return this.sent.at(-1);
  }
}

function makeSession(overrides: { correlationIds?: string[]; hostId?: string } = {}): {
  session: AgentSession;
  socket: FakeSocket;
  stateReports: AgentStateReportFrame[];
  events: AgentEventFrame[];
  connected: string[];
  disconnected: string[];
} {
  const socket = new FakeSocket();
  const stateReports: AgentStateReportFrame[] = [];
  const events: AgentEventFrame[] = [];
  const connected: string[] = [];
  const disconnected: string[] = [];
  const ids = overrides.correlationIds ?? ['00000000-0000-4000-8000-000000000001'];
  let index = 0;

  const session = new AgentSession({
    hostId: overrides.hostId ?? 'host-1',
    socket,
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
    },
    log: silentLog,
    commandTimeoutMs: 1_000,
    now: () => NOW,
    newCorrelationId: () => ids[index++] ?? `id-${String(index)}`,
  });

  return { session, socket, stateReports, events, connected, disconnected };
}

/** Zwei Node-Kennungen für die Prüfung aus Punkt 57 – `HostNode.id` ist eine UUID. */
const NODE_A = '11111111-1111-4111-8111-111111111111';
const NODE_B = '22222222-2222-4222-8222-222222222222';

function hello(protocolVersion = AGENT_PROTOCOL_VERSION, nodeId?: string): string {
  return JSON.stringify({
    kind: 'hello',
    protocolVersion,
    agentVersion: '0.1.0',
    ...(nodeId === undefined ? {} : { nodeId }),
    sentAt: NOW.toISOString(),
  });
}

describe('Handshake (Pflichtenheft §2.2)', () => {
  it('antwortet auf hello mit welcome', () => {
    const { session, socket } = makeSession();

    session.handleMessage(hello());

    expect(socket.lastFrame()).toEqual({
      kind: 'welcome',
      protocolVersion: AGENT_PROTOCOL_VERSION,
      sentAt: NOW.toISOString(),
    });
    expect(session.isReady).toBe(true);
  });

  it('nimmt die Node-Kennung an, wenn sie zum Token passt (Gefundener Punkt 57)', () => {
    const { session, socket } = makeSession({ hostId: NODE_A });

    session.handleMessage(hello(AGENT_PROTOCOL_VERSION, NODE_A));

    expect(session.isReady).toBe(true);
    expect(socket.closedWith).toBeNull();
  });

  it('lehnt eine Node-Kennung ab, die nicht zum Token gehört', () => {
    const { session, socket } = makeSession({ hostId: NODE_A });

    // Der Agent meldet eine andere Node, als sein Token ausweist. Beides
    // auseinanderzuhalten hieße, Befehle an die falsche Node zu schicken.
    session.handleMessage(hello(AGENT_PROTOCOL_VERSION, NODE_B));

    expect(session.isReady).toBe(false);
    expect(socket.closedWith?.code).toBe(CLOSE_CODE_UNAUTHORIZED);
  });

  it('lehnt eine abweichende Protokollversion ab, statt halb verstanden weiterzuarbeiten', () => {
    const { session, socket } = makeSession();

    session.handleMessage(hello(AGENT_PROTOCOL_VERSION + 1));

    expect(session.isReady).toBe(false);
    expect(socket.closedWith?.code).toBe(CLOSE_CODE_PROTOCOL_MISMATCH);
  });

  it('nimmt vor dem Handshake keine Befehle an', async () => {
    const { session } = makeSession();

    await expect(
      session.sendCommand('START', SERVER_ID, { containerId: 'c1' }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_CONNECTED' });
  });
});

describe('Verbindungszustand der Node (Gefundener Punkt 86)', () => {
  it('meldet onConnected mit der hostId, sobald der Handshake durchläuft', () => {
    const { session, connected } = makeSession();

    session.handleMessage(hello());

    expect(connected).toEqual(['host-1']);
  });

  it('meldet onDisconnected genau einmal beim Schließen einer verbundenen Sitzung', () => {
    const { session, disconnected } = makeSession();
    session.handleMessage(hello());

    session.handleSocketClosed(1000, 'normal');
    // Ein zweiter Aufruf (z. B. Race zwischen close-Event und closeAll) darf
    // nicht erneut melden.
    session.handleSocketClosed(1000, 'normal');

    expect(disconnected).toEqual(['host-1']);
  });

  it('meldet weder connected noch disconnected, wenn der Handshake nie gelang', () => {
    const { session, connected, disconnected } = makeSession();

    // Abweichende Protokollversion schließt vor dem `hello`.
    session.handleMessage(hello(AGENT_PROTOCOL_VERSION + 1));

    expect(connected).toEqual([]);
    expect(disconnected).toEqual([]);
  });
});

describe('Ungültige Frames', () => {
  it('verwirft kaputtes JSON, ohne die Verbindung zu beenden', () => {
    // Ein einzelner kaputter Frame ist kein Grund, einen laufenden Server
    // unbeaufsichtigt zu lassen.
    const { session, socket } = makeSession();

    session.handleMessage(hello());
    session.handleMessage('{kein json');

    expect(socket.closedWith).toBeNull();
    expect(session.isReady).toBe(true);
  });

  it('verwirft einen Frame, der nicht dem Protokoll entspricht', () => {
    const { session, socket, events } = makeSession();

    session.handleMessage(hello());
    session.handleMessage(JSON.stringify({ kind: 'unbekannt' }));

    expect(socket.closedWith).toBeNull();
    expect(events).toEqual([]);
  });
});

describe('Befehle und Korrelations-IDs (Pflichtenheft §5.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schickt den Befehl mit Korrelations-ID und löst über das Ergebnis auf', async () => {
    const { session, socket } = makeSession();

    session.handleMessage(hello());

    const pending = session.sendCommand('CREATE', SERVER_ID, {
      name: 'palantir-server-1',
      image: 'test:1',
      env: {},
      ports: [],
      resources: { memoryMb: 256, cpuCores: 0.5 },
      dataVolume: { hostPath: '/srv/x', containerPath: '/data' },
    });

    const sent = socket.lastFrame();

    expect(sent).toMatchObject({
      kind: 'command',
      command: 'CREATE',
      correlationId: '00000000-0000-4000-8000-000000000001',
      serverId: SERVER_ID,
    });

    session.handleMessage(
      JSON.stringify({
        kind: 'commandResult',
        correlationId: '00000000-0000-4000-8000-000000000001',
        command: 'CREATE',
        result: {
          success: true,
          data: { containerId: 'c1', name: 'x', warnings: [] },
          error: null,
        },
        duplicate: false,
        completedAt: NOW.toISOString(),
      }),
    );

    await expect(pending).resolves.toEqual({ containerId: 'c1', name: 'x', warnings: [] });
  });

  it('behandelt ein Ergebnis mit duplicate: true wie ein reguläres', async () => {
    // Ein Retry entsteht meist gerade deshalb, weil das erste Ergebnis das
    // Backend nicht erreicht hat (Pflichtenheft §5.3).
    const { session } = makeSession();

    session.handleMessage(hello());

    const pending = session.sendCommand('STOP', SERVER_ID, { containerId: 'c1' });

    session.handleMessage(
      JSON.stringify({
        kind: 'commandResult',
        correlationId: '00000000-0000-4000-8000-000000000001',
        command: 'STOP',
        result: { success: true, data: null, error: null },
        duplicate: true,
        completedAt: NOW.toISOString(),
      }),
    );

    await expect(pending).resolves.toBeNull();
  });

  it('reicht den benannten Fehlercode des Agents durch', async () => {
    const { session } = makeSession();

    session.handleMessage(hello());

    const pending = session.sendCommand('START', SERVER_ID, { containerId: 'c1' });

    session.handleMessage(
      JSON.stringify({
        kind: 'commandResult',
        correlationId: '00000000-0000-4000-8000-000000000001',
        command: 'START',
        result: {
          success: false,
          data: null,
          error: { code: 'AGENT_CONTAINER_NOT_FOUND', message: 'weg' },
        },
        duplicate: false,
        completedAt: NOW.toISOString(),
      }),
    );

    await expect(pending).rejects.toMatchObject({ code: 'AGENT_CONTAINER_NOT_FOUND' });
  });

  it('scheitert mit AGENT_COMMAND_TIMEOUT, wenn die Frist abläuft', async () => {
    const { session } = makeSession();

    session.handleMessage(hello());

    // Die Erwartung wird vor dem Vorspulen angehängt – sonst gilt die Ablehnung
    // im Moment des Auslösens kurzzeitig als unbehandelt.
    const pending = session.sendCommand('START', SERVER_ID, { containerId: 'c1' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AGENT_COMMAND_TIMEOUT' });

    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;
  });

  it('verwirft ein Ergebnis ohne offenen Befehl', () => {
    const { session, socket } = makeSession();

    session.handleMessage(hello());
    session.handleMessage(
      JSON.stringify({
        kind: 'commandResult',
        correlationId: '00000000-0000-4000-8000-00000000dead',
        command: 'START',
        result: { success: true, data: null, error: null },
        duplicate: false,
        completedAt: NOW.toISOString(),
      }),
    );

    expect(socket.closedWith).toBeNull();
  });

  it('bricht offene Befehle beim Schließen ab, statt sie hängen zu lassen', async () => {
    const { session } = makeSession();

    session.handleMessage(hello());

    const pending = session.sendCommand('STOP', SERVER_ID, { containerId: 'c1' });

    session.close();

    await expect(pending).rejects.toMatchObject({ code: 'AGENT_NOT_CONNECTED' });
  });
});

describe('Ereignisse und Ist-Zustand', () => {
  it('reicht den Ist-Zustands-Bericht durch', () => {
    const { session, stateReports } = makeSession();

    session.handleMessage(hello());
    session.handleMessage(
      JSON.stringify({
        kind: 'stateReport',
        reason: 'connected',
        containers: [],
        reportedAt: NOW.toISOString(),
      }),
    );

    expect(stateReports).toHaveLength(1);
    expect(stateReports[0]?.reason).toBe('connected');
  });

  it('reicht Ereignisse durch', () => {
    const { session, events } = makeSession();

    session.handleMessage(hello());
    session.handleMessage(
      JSON.stringify({
        kind: 'event',
        event: 'CRASHED',
        serverId: SERVER_ID,
        payload: { exitCode: 137 },
        emittedAt: NOW.toISOString(),
      }),
    );

    expect(events[0]?.event).toBe('CRASHED');
  });

  it('fordert einen Ist-Zustands-Bericht an', () => {
    const { session, socket } = makeSession();

    session.handleMessage(hello());
    session.requestState();

    expect(socket.lastFrame()).toEqual({
      kind: 'stateRequest',
      requestedAt: NOW.toISOString(),
    });
  });
});

describe('AgentRegistry', () => {
  it('liefert nur Verbindungen nach abgeschlossenem Handshake', () => {
    const registry = new AgentRegistry();
    const { session } = makeSession();

    registry.register(session);
    expect(registry.get('host-1')).toBeNull();

    session.handleMessage(hello());
    expect(registry.get('host-1')).toBe(session);
  });

  it('meldet eine fehlende Verbindung als AGENT_NOT_CONNECTED', () => {
    const registry = new AgentRegistry();

    try {
      registry.require('host-1');
      expect.unreachable('Die Node hätte als nicht verbunden gemeldet werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('AGENT_NOT_CONNECTED');
    }
  });

  it('lässt die neuere Verbindung derselben Node gewinnen', () => {
    // Zwei gleichzeitige Agents auf einer Node würden dieselben Container
    // doppelt steuern.
    const registry = new AgentRegistry();
    const first = makeSession();
    const second = makeSession();

    first.session.handleMessage(hello());
    second.session.handleMessage(hello());

    registry.register(first.session);
    registry.register(second.session);

    expect(first.socket.closedWith).not.toBeNull();
    expect(registry.get('host-1')).toBe(second.session);
  });

  it('entfernt nur die eigene Verbindung beim Abmelden', () => {
    const registry = new AgentRegistry();
    const first = makeSession();
    const second = makeSession();

    first.session.handleMessage(hello());
    second.session.handleMessage(hello());

    registry.register(second.session);
    registry.unregister(first.session);

    expect(registry.get('host-1')).toBe(second.session);
  });

  it('listet verbundene Nodes und schließt beim Shutdown alles', () => {
    const registry = new AgentRegistry();
    const { session, socket } = makeSession();

    session.handleMessage(hello());
    registry.register(session);

    expect(registry.connectedHostIds()).toEqual(['host-1']);

    registry.closeAll();

    expect(socket.closedWith).not.toBeNull();
    expect(registry.connectedHostIds()).toEqual([]);
  });
});

describe('isAuthorizedAgentHandshake() (Pflichtenheft §2.2, §18)', () => {
  it('nimmt das richtige Token an', () => {
    expect(isAuthorizedAgentHandshake('Bearer geheim', 'geheim')).toBe(true);
  });

  it('lehnt ein falsches Token ab', () => {
    expect(isAuthorizedAgentHandshake('Bearer falsch', 'geheim')).toBe(false);
  });

  it('lehnt ein Token abweichender Länge ab', () => {
    expect(isAuthorizedAgentHandshake('Bearer geheimer', 'geheim')).toBe(false);
  });

  it('lehnt einen fehlenden Header ab', () => {
    expect(isAuthorizedAgentHandshake(undefined, 'geheim')).toBe(false);
  });

  it('lehnt ein falsches Schema ab', () => {
    expect(isAuthorizedAgentHandshake('Basic geheim', 'geheim')).toBe(false);
  });

  it('lehnt jede Verbindung ab, wenn gar kein Token konfiguriert ist', () => {
    // Ein offener Agent-Endpunkt wäre vollständiger Zugriff auf den Homeserver.
    expect(isAuthorizedAgentHandshake('Bearer irgendwas', undefined)).toBe(false);
    expect(isAuthorizedAgentHandshake('Bearer irgendwas', '')).toBe(false);
  });

  it('nutzt den Close-Code 4401, den der Agent kennt', () => {
    expect(CLOSE_CODE_UNAUTHORIZED).toBe(4401);
  });
});
