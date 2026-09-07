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
  httpStatusForErrorCode,
} from '@palantir/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentGatewayLogger,
  type AgentSessionHandlers,
  type AgentSocket,
  AgentRegistry,
  AgentSession,
  CLOSE_CODE_FRAME_TOO_LARGE,
  CLOSE_CODE_PROTOCOL_MISMATCH,
  CLOSE_CODE_UNAUTHORIZED,
  MAX_AGENT_COMMAND_RESULT_BYTES,
  MAX_AGENT_FRAME_BYTES,
  isAuthorizedAgentHandshake,
} from './agent-gateway.js';
import { type ServerOrchestrationError } from './errors.js';
import { AGENT_FILE_CHANNEL_MAX_BYTES } from './files.js';

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

function makeSession(
  overrides: {
    correlationIds?: string[];
    hostId?: string;
    log?: AgentGatewayLogger;
    maxFrameBytes?: number;
    maxCommandResultBytes?: number;
  } = {},
): {
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
    log: overrides.log ?? silentLog,
    commandTimeoutMs: 1_000,
    ...(overrides.maxFrameBytes === undefined ? {} : { maxFrameBytes: overrides.maxFrameBytes }),
    ...(overrides.maxCommandResultBytes === undefined
      ? {}
      : { maxCommandResultBytes: overrides.maxCommandResultBytes }),
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

/** Ein Logger, der seine Zeilen zum Nachlesen sammelt. */
function sammelndesLog(): AgentGatewayLogger & {
  readonly warnungen: { details: Record<string, unknown>; message: string }[];
  readonly fehler: { details: Record<string, unknown>; message: string }[];
} {
  const warnungen: { details: Record<string, unknown>; message: string }[] = [];
  const fehler: { details: Record<string, unknown>; message: string }[] = [];

  return {
    warnungen,
    fehler,
    info: (): void => undefined,
    warn: (details, message): void => {
      warnungen.push({ details, message });
    },
    error: (details, message): void => {
      fehler.push({ details, message });
    },
  };
}

function stateReport(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: 'stateReport',
    reason: 'connected',
    containers: [],
    reportedAt: NOW.toISOString(),
    ...extra,
  });
}

function containerState(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverId: SERVER_ID,
    containerId: 'c1',
    status: 'running',
    exitCode: null,
    startedAt: NOW.toISOString(),
    observedAt: NOW.toISOString(),
    ...extra,
  };
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

describe('Frames vor dem Handshake (Audit security-matrix-07)', () => {
  /*
   * Bis zum Audit lief `onStateReport`/`onEvent` auch ohne `hello`: Die Prüfung
   * der Protokollversion und der gemeldeten Node-Kennung (`handleHello`) ließ
   * sich damit schlicht überspringen, obwohl beides die Verbindung beenden
   * soll.
   */
  it('verwirft einen Ist-Zustands-Bericht vor dem Handshake – eine Logzeile, keine Verarbeitung', () => {
    const log = sammelndesLog();
    const { session, socket, stateReports } = makeSession({ log });

    session.handleMessage(stateReport({ containers: [containerState()] }));

    expect(stateReports).toEqual([]);
    expect(log.warnungen).toHaveLength(1);
    expect(log.warnungen[0]?.message).toContain('vor dem Handshake');
    expect(log.warnungen[0]?.details).toMatchObject({ hostId: 'host-1', kind: 'stateReport' });
    // Die Verbindung bleibt offen: Ein Agent, dessen `hello` sich verzögert,
    // soll nicht in eine Reconnect-Schleife laufen.
    expect(socket.closedWith).toBeNull();
    expect(session.isReady).toBe(false);
  });

  it('verwirft ein Ereignis vor dem Handshake und arbeitet nach dem hello regulär weiter', () => {
    const log = sammelndesLog();
    const { session, events } = makeSession({ log });

    const ereignis = JSON.stringify({
      kind: 'event',
      event: 'CRASHED',
      serverId: SERVER_ID,
      payload: { exitCode: 137 },
      emittedAt: NOW.toISOString(),
    });

    session.handleMessage(ereignis);
    expect(events).toEqual([]);
    expect(log.warnungen).toHaveLength(1);

    session.handleMessage(hello());
    session.handleMessage(ereignis);

    expect(events).toHaveLength(1);
    expect(log.warnungen).toHaveLength(1);
  });

  it('verwirft auch ein Befehlsergebnis vor dem Handshake', () => {
    const log = sammelndesLog();
    const { session } = makeSession({ log });

    session.handleMessage(
      JSON.stringify({
        kind: 'commandResult',
        correlationId: '00000000-0000-4000-8000-000000000001',
        command: 'START',
        result: { success: true, data: null, error: null },
        duplicate: false,
        completedAt: NOW.toISOString(),
      }),
    );

    expect(log.warnungen).toHaveLength(1);
    expect(log.warnungen[0]?.details).toMatchObject({ kind: 'commandResult' });
  });
});

describe('Größengrenze unaufgeforderter Frames (Audit security-matrix-07)', () => {
  /** Ein Frame, der die Grenze sicher überschreitet – rund 2 MiB Nutzlast. */
  function zuGrosserFrame(): string {
    return JSON.stringify({
      kind: 'event',
      event: 'LOG_LINE',
      serverId: SERVER_ID,
      payload: { message: 'x'.repeat(2 * 1024 * 1024) },
      emittedAt: NOW.toISOString(),
    });
  }

  it('hält die enge Grenze bei 1 MiB', () => {
    // Der größte reguläre Frame, den der Agent von sich aus schickt, ist der
    // Ist-Zustands-Bericht; 1000 Container wiegen als JSON rund 200 KiB.
    // Befehlsergebnisse haben eine eigene Grenze (siehe unten).
    expect(MAX_AGENT_FRAME_BYTES).toBe(1_048_576);
  });

  it('beendet die Verbindung bei einem 2-MiB-Frame und nennt Größe und Grenze', () => {
    const log = sammelndesLog();
    const { session, socket, events } = makeSession({ log });

    session.handleMessage(hello());
    session.handleMessage(zuGrosserFrame());

    expect(socket.closedWith?.code).toBe(CLOSE_CODE_FRAME_TOO_LARGE);
    expect(events).toEqual([]);
    expect(session.isReady).toBe(false);
    expect(log.fehler).toHaveLength(1);
    expect(log.fehler[0]?.details).toMatchObject({
      hostId: 'host-1',
      grenzeBytes: MAX_AGENT_FRAME_BYTES,
    });
    expect(Number(log.fehler[0]?.details.groesseBytes)).toBeGreaterThan(MAX_AGENT_FRAME_BYTES);
  });

  it('prüft die Größe schon am Rohpuffer, bevor daraus ein String wird', () => {
    // So kommt der Frame aus `ws` an (`agent-route.ts`): Ein 100-MiB-Frame soll
    // nicht erst vollständig dekodiert und dann verworfen werden.
    const log = sammelndesLog();
    const { session, socket } = makeSession({ log });

    session.handleMessage(hello());
    session.handleMessage(Buffer.from(zuGrosserFrame(), 'utf8'));

    expect(socket.closedWith?.code).toBe(CLOSE_CODE_FRAME_TOO_LARGE);
    expect(log.fehler).toHaveLength(1);
  });

  it('lässt einen Frame direkt unterhalb der Grenze durch', () => {
    const { session, socket, events } = makeSession({ maxFrameBytes: 512 });

    session.handleMessage(hello());
    session.handleMessage(
      JSON.stringify({
        kind: 'event',
        event: 'LOG_LINE',
        serverId: SERVER_ID,
        payload: { message: 'kurz' },
        emittedAt: NOW.toISOString(),
      }),
    );

    expect(socket.closedWith).toBeNull();
    expect(events).toHaveLength(1);
  });

  it('verarbeitet nach dem Schließen keinen weiteren Frame mehr', () => {
    const { session, events } = makeSession({ maxFrameBytes: 200 });

    session.handleMessage(hello());
    session.handleMessage(stateReport({ containers: [containerState(), containerState()] }));

    // Die Verbindung ist zu; ein noch in der Warteschlange liegender Frame darf
    // keinen Vorgang mehr auslösen.
    session.handleMessage(
      JSON.stringify({
        kind: 'event',
        event: 'CRASHED',
        serverId: SERVER_ID,
        payload: { exitCode: 137 },
        emittedAt: NOW.toISOString(),
      }),
    );

    expect(events).toEqual([]);
  });
});

describe('Eigene Grenze für Befehlsergebnisse (Audit security-matrix-07)', () => {
  /*
   * Die 1-MiB-Grenze darf nicht pauschal gelten: `FILE_READ` liefert den
   * Dateiinhalt als Base64 in **einem** Frame, und die Obergrenze dafür steht
   * bereits bei `AGENT_FILE_CHANNEL_MAX_BYTES` (64 MiB). Eine pauschale Grenze
   * hätte jeden Download über rund 768 KiB nicht abgelehnt, sondern die
   * Agent-Verbindung der ganzen Node beendet.
   */
  const KORRELATION = '00000000-0000-4000-8000-000000000001';

  /** Ein Befehlsergebnis mit `fuellung` Byte Beiwerk in der Nutzlast. */
  function ergebnis(fuellung: number): string {
    return JSON.stringify({
      kind: 'commandResult',
      correlationId: KORRELATION,
      command: 'FILE_READ',
      result: {
        success: true,
        data: { contentBase64: 'A'.repeat(fuellung) },
        error: null,
      },
      duplicate: false,
      completedAt: NOW.toISOString(),
    });
  }

  it('deckt eine Datei in voller Größe des Datei-Kanals ab und bleibt unter dem ws-Standard', () => {
    // Base64 bläht um 4/3 auf; darunter wäre ein regulärer Download nicht mehr
    // zustellbar, darüber würde `ws` (maxPayload 100 MiB) zuerst abschneiden.
    const base64Laenge = Math.ceil(AGENT_FILE_CHANNEL_MAX_BYTES / 3) * 4;

    expect(MAX_AGENT_COMMAND_RESULT_BYTES).toBeGreaterThan(base64Laenge);
    expect(MAX_AGENT_COMMAND_RESULT_BYTES).toBeLessThan(100 * 1024 * 1024);
    // … und deutlich über der engen Grenze, sonst wäre die Stufe sinnlos.
    expect(MAX_AGENT_COMMAND_RESULT_BYTES).toBeGreaterThan(MAX_AGENT_FRAME_BYTES);
  });

  it('lässt ein großes Befehlsergebnis durch, solange ein Befehl offen ist', async () => {
    const { session, socket } = makeSession({
      maxFrameBytes: 256,
      maxCommandResultBytes: 8_192,
    });

    session.handleMessage(hello());

    const offen = session.sendCommand('FILE_READ', SERVER_ID, {
      containerId: 'c1',
      path: '/data/server.properties',
    });

    // Weit über der engen Grenze, aber innerhalb der Grenze für Ergebnisse.
    session.handleMessage(ergebnis(4_096));

    await expect(offen).resolves.toMatchObject({ contentBase64: 'A'.repeat(4_096) });
    expect(socket.closedWith).toBeNull();
  });

  it('beendet die Verbindung, wenn auch die Ergebnis-Grenze überschritten wird', async () => {
    const log = sammelndesLog();
    const { session, socket } = makeSession({
      maxFrameBytes: 256,
      maxCommandResultBytes: 1_024,
      log,
    });

    session.handleMessage(hello());

    const offen = session.sendCommand('FILE_READ', SERVER_ID, {
      containerId: 'c1',
      path: '/data/server.properties',
    });

    session.handleMessage(ergebnis(4_096));

    expect(socket.closedWith?.code).toBe(CLOSE_CODE_FRAME_TOO_LARGE);
    expect(log.fehler[0]?.details).toMatchObject({ grenzeBytes: 1_024 });
    // Der offene Befehl scheitert sofort, statt in seine Frist zu laufen.
    await expect(offen).rejects.toMatchObject({ code: 'AGENT_NOT_CONNECTED' });
  });

  it('gilt nicht für ein Ereignis, das während eines offenen Befehls eintrifft', async () => {
    /*
     * Sonst könnte ein Agent die weite Grenze mitbenutzen, während ein Download
     * läuft – und eine 85-MiB-Konsolenzeile ginge an alle Abonnenten des
     * Live-Kanals.
     */
    const log = sammelndesLog();
    const { session, socket, events } = makeSession({
      maxFrameBytes: 256,
      maxCommandResultBytes: 8_192,
      log,
    });

    session.handleMessage(hello());

    const offen = session.sendCommand('FILE_READ', SERVER_ID, {
      containerId: 'c1',
      path: '/data/server.properties',
    });

    session.handleMessage(
      JSON.stringify({
        kind: 'event',
        event: 'LOG_LINE',
        serverId: SERVER_ID,
        payload: { message: 'x'.repeat(2_048) },
        emittedAt: NOW.toISOString(),
      }),
    );

    expect(socket.closedWith?.code).toBe(CLOSE_CODE_FRAME_TOO_LARGE);
    expect(events).toEqual([]);
    // Die enge Grenze hat gegriffen, nicht die für Ergebnisse.
    expect(log.fehler[0]?.details).toMatchObject({ grenzeBytes: 256, kind: 'event' });
    await expect(offen).rejects.toMatchObject({ code: 'AGENT_NOT_CONNECTED' });
  });

  it('gilt nicht mehr, sobald der Befehl beantwortet ist', async () => {
    const { session, socket } = makeSession({
      maxFrameBytes: 256,
      maxCommandResultBytes: 8_192,
      correlationIds: [KORRELATION, '00000000-0000-4000-8000-000000000002'],
    });

    session.handleMessage(hello());

    const offen = session.sendCommand('FILE_READ', SERVER_ID, {
      containerId: 'c1',
      path: '/data/server.properties',
    });

    session.handleMessage(ergebnis(1_024));
    await offen;

    // Kein Befehl mehr offen – jetzt zählt wieder die enge Grenze.
    session.handleMessage(ergebnis(1_024));

    expect(socket.closedWith?.code).toBe(CLOSE_CODE_FRAME_TOO_LARGE);
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

  /**
   * Schickt ein `START` und beantwortet es mit dem gegebenen Fehlercode.
   *
   * Liefert die Ablehnung als Wert – so lässt sich der Code prüfen, statt nur
   * auf ein `rejects` zu setzen.
   */
  async function fehlerAusAgent(
    code: string,
  ): Promise<{ fehler: ServerOrchestrationError; warnungen: string[] }> {
    const log = sammelndesLog();
    const { session } = makeSession({ log });

    session.handleMessage(hello());

    const pending = session.sendCommand('START', SERVER_ID, { containerId: 'c1' });

    session.handleMessage(
      JSON.stringify({
        kind: 'commandResult',
        correlationId: '00000000-0000-4000-8000-000000000001',
        command: 'START',
        result: { success: false, data: null, error: { code, message: 'Meldung des Agents' } },
        duplicate: false,
        completedAt: NOW.toISOString(),
      }),
    );

    const fehler = await pending.then(
      () => {
        throw new Error('Der Befehl hätte scheitern müssen.');
      },
      (error: unknown) => error as ServerOrchestrationError,
    );

    return { fehler, warnungen: log.warnungen.map((eintrag) => eintrag.message) };
  }

  it('macht aus einem Fehlercode, den der Agent nicht setzen darf, AGENT_COMMAND_FAILED', async () => {
    /*
     * Audit security-matrix-07: Bisher wurde jeder Katalog-Code übernommen und
     * bis in die HTTP-Antwort durchgereicht. Ein Agent, der auf `START` mit
     * `AUTH_REQUIRED` antwortet, hätte dem Nutzer eine 401 beschert – das
     * Frontend beginnt darauf eine Sitzungs-Erneuerung für einen Fehler, der
     * mit seiner Anmeldung nichts zu tun hat.
     */
    const { fehler, warnungen } = await fehlerAusAgent('AUTH_REQUIRED');

    expect(fehler.code).toBe('AGENT_COMMAND_FAILED');
    // An der HTTP-Schnittstelle: ein Katalog-Fehler mit passendem Status …
    expect(httpStatusForErrorCode(fehler.code)).toBe(500);
    // … statt der 401, die der Agent sich sonst hätte aussuchen können.
    expect(httpStatusForErrorCode('AUTH_REQUIRED')).toBe(401);
    // Der ursprünglich gemeldete Code bleibt im Log und am Fehler nachvollziehbar.
    expect(warnungen.some((zeile) => zeile.includes('nicht setzen darf'))).toBe(true);
    expect(fehler.details).toMatchObject({ gemeldeterCode: 'AUTH_REQUIRED' });
  });

  it('lehnt auch Codes ab, die dem Backend gehören, obwohl sie mit AGENT_ beginnen', async () => {
    // `AGENT_NOT_CONNECTED` (503) und `AGENT_COMMAND_TIMEOUT` (504) beschreiben
    // Zustände, über die das Backend urteilt – nicht der Agent.
    const nichtVerbunden = await fehlerAusAgent('AGENT_NOT_CONNECTED');
    const frist = await fehlerAusAgent('AGENT_COMMAND_TIMEOUT');

    expect(nichtVerbunden.fehler.code).toBe('AGENT_COMMAND_FAILED');
    expect(frist.fehler.code).toBe('AGENT_COMMAND_FAILED');
  });

  it('übernimmt die Codes, die der Agent tatsächlich erzeugt', async () => {
    // Werte aus `RUNTIME_ERROR_TO_API_CODE` (apps/agent) – sie tragen den
    // passenden Status und sollen weiterhin bis zum Nutzer durchkommen.
    const nichtGefunden = await fehlerAusAgent('AGENT_CONTAINER_NOT_FOUND');
    const pruefsumme = await fehlerAusAgent('BACKUP_CHECKSUM_MISMATCH');

    expect(nichtGefunden.fehler.code).toBe('AGENT_CONTAINER_NOT_FOUND');
    expect(httpStatusForErrorCode(nichtGefunden.fehler.code)).toBe(404);
    expect(pruefsumme.fehler.code).toBe('BACKUP_CHECKSUM_MISMATCH');
    expect(nichtGefunden.warnungen).toEqual([]);
  });

  it('lässt einen Freitext-Code gar nicht erst durch das Protokoll', async () => {
    // Zweite Schranke vor der Katalog-Prüfung: `apiResponseSchema` kennt nur
    // Codes aus dem Katalog, ein Freitext-Code verwirft schon den ganzen Frame.
    // Der Befehl läuft dann in seine Frist – kein halb verstandenes Ergebnis.
    const log = sammelndesLog();
    const { session } = makeSession({ log });

    session.handleMessage(hello());

    const pending = session.sendCommand('START', SERVER_ID, { containerId: 'c1' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AGENT_COMMAND_TIMEOUT' });

    session.handleMessage(
      JSON.stringify({
        kind: 'commandResult',
        correlationId: '00000000-0000-4000-8000-000000000001',
        command: 'START',
        result: { success: false, data: null, error: { code: 'IRGENDWAS', message: 'x' } },
        duplicate: false,
        completedAt: NOW.toISOString(),
      }),
    );

    expect(
      log.warnungen.some((zeile) => zeile.message.includes('entspricht nicht dem Protokoll')),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;
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

  it('verwirft ein Ergebnis, das erst nach Ablauf der Frist eintrifft', async () => {
    /*
     * Der Fall aus Audit W1-5 (bb-02): Der Agent packt noch, die Frist läuft
     * ab, der Aufrufer hat seine Antwort. Trifft das Ergebnis danach ein, darf
     * es den Befehl nicht ein zweites Mal auflösen – sonst liefe eine
     * Fehlerbehandlung neben einem vermeintlichen Erfolg her. Verworfen wird
     * es nicht still, sondern mit einem Protokolleintrag.
     */
    const verworfen: Record<string, unknown>[] = [];
    const { session } = makeSession({
      log: {
        ...silentLog,
        warn: (details): void => {
          verworfen.push(details);
        },
      },
    });

    session.handleMessage(hello());

    const pending = session.sendCommand('CREATE_BACKUP', SERVER_ID, {
      backupId: '33333333-3333-4333-8333-333333333333',
      serverId: SERVER_ID,
      sourcePath: '/srv/palantir/servers/x',
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AGENT_COMMAND_TIMEOUT' });

    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;

    session.handleMessage(
      JSON.stringify({
        kind: 'commandResult',
        correlationId: '00000000-0000-4000-8000-000000000001',
        command: 'CREATE_BACKUP',
        result: {
          success: true,
          data: { sizeBytes: 1_024, completedAt: NOW.toISOString() },
          error: null,
        },
        duplicate: false,
        completedAt: NOW.toISOString(),
      }),
    );

    expect(verworfen).toHaveLength(1);
    expect(verworfen[0]).toMatchObject({
      correlationId: '00000000-0000-4000-8000-000000000001',
      command: 'CREATE_BACKUP',
    });
    // Kein zweites Auflösen: Das Ergebnis bleibt die Ablehnung der Frist.
    await expect(pending).rejects.toMatchObject({ code: 'AGENT_COMMAND_TIMEOUT' });
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

describe('Ist-Zustands-Bericht wird feldweise gelesen (Audit contract-drift-05)', () => {
  /*
   * Vorher prüfte `agentToBackendFrameSchema` den ganzen Frame: Ein einziges
   * unbrauchbares Nebenfeld verwarf den kompletten Bericht. Die Node galt
   * weiter als verbunden, der Soll/Ist-Abgleich lief aber nie – sichtbar war
   * nur eine `warn`-Zeile.
   */
  function berichtGeben(rohframe: string): {
    stateReports: AgentStateReportFrame[];
    warnungen: { details: Record<string, unknown>; message: string }[];
  } {
    const log = sammelndesLog();
    const { session, stateReports } = makeSession({ log });

    session.handleMessage(hello());
    session.handleMessage(rohframe);

    return { stateReports, warnungen: log.warnungen };
  }

  it('verarbeitet den Kern, wenn ein unbekanntes Nebenfeld dabeisteht', () => {
    const { stateReports, warnungen } = berichtGeben(
      stateReport({
        containers: [containerState()],
        unbekanntesNebenfeld: { irgendwas: 42 },
      }),
    );

    expect(stateReports).toHaveLength(1);
    expect(stateReports[0]?.containers).toHaveLength(1);
    expect(stateReports[0]?.reason).toBe('connected');
    // Ein zusätzliches Feld ist kein Befund – es wird schlicht nicht gelesen.
    expect(warnungen).toEqual([]);
  });

  it('lässt unbrauchbare nodeStats weg, statt den Bericht zu kippen', () => {
    // `cpuCores: 0` entsteht real: `os.cpus()` kann auf manchen Plattformen
    // eine leere Liste liefern (agent/connection/node-stats.ts).
    const { stateReports, warnungen } = berichtGeben(
      stateReport({
        containers: [containerState()],
        nodeStats: {
          cpuCores: 0,
          cpuLoad1m: null,
          ramTotalMb: 16_384,
          ramAvailableMb: 8_192,
          diskTotalMb: 500_000,
          diskAvailableMb: 200_000,
          observedAt: NOW.toISOString(),
        },
      }),
    );

    expect(stateReports).toHaveLength(1);
    expect(stateReports[0]?.nodeStats).toBeUndefined();
    expect(stateReports[0]?.containers).toHaveLength(1);
    expect(warnungen).toHaveLength(1);
    expect(warnungen[0]?.details).toMatchObject({ nodeStatsVerworfen: true });
  });

  it('nimmt gültige nodeStats weiterhin an', () => {
    const { stateReports, warnungen } = berichtGeben(
      stateReport({
        nodeStats: {
          cpuCores: 8,
          cpuLoad1m: 0.5,
          ramTotalMb: 16_384,
          ramAvailableMb: 8_192,
          diskTotalMb: 500_000,
          diskAvailableMb: 200_000,
          observedAt: NOW.toISOString(),
        },
      }),
    );

    expect(stateReports[0]?.nodeStats?.cpuCores).toBe(8);
    expect(warnungen).toEqual([]);
  });

  it('behält einen Container mit unbrauchbarer serverId und setzt sie auf null', () => {
    /*
     * Ein fremder Container auf derselben Node kann das Label
     * `palantir.serverId` mit beliebigem Inhalt tragen. Den Eintrag deshalb
     * wegzuwerfen hieße: Der Abgleich sieht den Container nicht und hält den
     * zugehörigen Server für verschwunden.
     */
    const { stateReports, warnungen } = berichtGeben(
      stateReport({
        containers: [
          containerState({ serverId: 'kein-uuid' }),
          containerState({ containerId: 'c2' }),
        ],
      }),
    );

    expect(stateReports[0]?.containers).toHaveLength(2);
    expect(stateReports[0]?.containers[0]?.serverId).toBeNull();
    expect(stateReports[0]?.containers[0]?.containerId).toBe('c1');
    expect(stateReports[0]?.containers[1]?.serverId).toBe(SERVER_ID);
    expect(warnungen[0]?.details).toMatchObject({ bereinigteServerIds: 1 });
  });

  it('verwirft einen unlesbaren Container einzeln und verarbeitet den Rest', () => {
    const { stateReports, warnungen } = berichtGeben(
      stateReport({
        containers: [
          containerState({ containerId: 'c2', status: 'gibt-es-nicht' }),
          containerState(),
        ],
      }),
    );

    expect(stateReports).toHaveLength(1);
    expect(stateReports[0]?.containers).toHaveLength(1);
    expect(stateReports[0]?.containers[0]?.containerId).toBe('c1');
    expect(warnungen[0]?.details).toMatchObject({ verworfeneContainer: 1 });
  });

  it('verwirft den Bericht weiterhin, wenn der Kern nicht stimmt', () => {
    // Ohne Anlass ist der Bericht nicht auswertbar, und `containers` muss eine
    // Liste sein – sonst wäre „keine Container" nicht von „Feld kaputt" zu
    // unterscheiden, und der Abgleich hielte jeden Server für verschwunden.
    const ohneAnlass = berichtGeben(stateReport({ reason: 'irgendwas' }));
    const ohneListe = berichtGeben(stateReport({ containers: 'keine Liste' }));

    expect(ohneAnlass.stateReports).toEqual([]);
    expect(ohneListe.stateReports).toEqual([]);
    expect(ohneAnlass.warnungen[0]?.message).toContain('entspricht nicht dem Protokoll');
  });
});

describe('Fehler in Handlern (Audit W0-5, Fundpunkt 126)', () => {
  /*
   * Der Spion an `unhandledRejection` ist die eigentliche Prüfung: Node
   * beendete den Prozess bei der ersten unbehandelten Ablehnung – ein Agent,
   * der ein zweites `CRASHED` schickt, hätte damit das Panel abgeschossen.
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
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  function makeThrowingSession(): {
    session: AgentSession;
    socket: FakeSocket;
    errors: { details: Record<string, unknown>; message: string }[];
  } {
    const socket = new FakeSocket();
    const errors: { details: Record<string, unknown>; message: string }[] = [];

    const session = new AgentSession({
      hostId: 'host-1',
      socket,
      handlers: {
        onStateReport: () => Promise.reject(new Error('Datenbank nicht erreichbar')),
        onEvent: () => Promise.reject(new Error('SERVER_STATE_CONFLICT: crashed → crashed')),
        onConnected: () => Promise.reject(new Error('markHostConnected scheitert')),
        onDisconnected: () => Promise.reject(new Error('markHostDisconnected scheitert')),
      },
      log: {
        ...silentLog,
        error: (details, message): void => {
          errors.push({ details, message });
        },
      },
      now: () => NOW,
    });

    return { session, socket, errors };
  }

  it('loggt eine Ablehnung des Ereignis-Handlers, statt den Prozess sterben zu lassen', async () => {
    const { session, socket, errors } = makeThrowingSession();

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
    await tick();

    expect(rejections).toEqual([]);
    const geloggt = errors.find((entry) => entry.details.vorgang === 'Agent-Ereignis verarbeiten');

    expect(geloggt?.message).toBe('Hintergrundvorgang fehlgeschlagen');
    expect(geloggt?.details).toMatchObject({
      hostId: 'host-1',
      event: 'CRASHED',
      serverId: SERVER_ID,
      error: 'SERVER_STATE_CONFLICT: crashed → crashed',
    });
    // Die Verbindung bleibt offen: Ein verworfenes Ereignis ist kein Grund,
    // einen laufenden Server unbeaufsichtigt zu lassen.
    expect(socket.closedWith).toBeNull();
    expect(session.isReady).toBe(true);
  });

  it('loggt eine Ablehnung beim Ist-Zustands-Bericht mit dem Anlass', async () => {
    const { session, errors } = makeThrowingSession();

    session.handleMessage(hello());
    session.handleMessage(
      JSON.stringify({
        kind: 'stateReport',
        reason: 'connected',
        containers: [],
        reportedAt: NOW.toISOString(),
      }),
    );
    await tick();

    expect(rejections).toEqual([]);
    expect(
      errors.find(
        (entry) => entry.details.vorgang === 'Ist-Zustands-Bericht des Agents verarbeiten',
      )?.details,
    ).toMatchObject({ hostId: 'host-1', reason: 'connected', error: 'Datenbank nicht erreichbar' });
  });

  it('fängt auch Ablehnungen von onConnected und onDisconnected', async () => {
    const { session, socket, errors } = makeThrowingSession();

    session.handleMessage(hello());
    session.close();
    await tick();

    expect(rejections).toEqual([]);
    expect(errors.map((entry) => entry.details.vorgang)).toEqual([
      'Node als verbunden melden',
      'Node als getrennt melden',
    ]);
    // Der Handshake ist trotz des Fehlers durchgelaufen – `welcome` ging raus.
    expect(socket.sent[0]?.kind).toBe('welcome');
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

describe('Übernahme einer Node-Verbindung (Audit event-flow-12)', () => {
  /*
   * Der Fall: Der Agent verbindet sich neu, während die alte TCP-Verbindung im
   * Backend noch als offen gilt. Vorher liefen `markHostDisconnected` (alte
   * Sitzung) und `markHostConnected` (neue Sitzung) als zwei nicht abgewartete
   * Promises auf verschiedenen Pool-Verbindungen. Landete der `offline`-Write
   * nach dem `online`-Write, zeigte die Node-Übersicht „offline" bei
   * verbundenem Agent – und `requireNodeAcceptsStarts` lehnte Starts mit
   * `NODE_UNAVAILABLE` ab, obwohl der Homeserver da war.
   */
  const HOST = '33333333-3333-4333-8333-333333333333';

  function warte(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  interface Nodezustand {
    readonly ablauf: string[];
    status: 'connected' | 'disconnected';
    readonly handlers: AgentSessionHandlers;
  }

  /**
   * Handler, die den Node-Status wie `index.ts` fortschreiben – nur langsamer:
   * Die Abmeldung braucht länger als die Anmeldung. Genau in dieser Konstellation
   * überholte der `online`-Write den `offline`-Write.
   */
  function nodezustand(): Nodezustand {
    const ablauf: string[] = [];
    const zustand: Nodezustand = {
      ablauf,
      status: 'disconnected',
      handlers: {
        onStateReport: (): void => undefined,
        onEvent: (): void => undefined,
        onConnected: async (): Promise<void> => {
          ablauf.push('onConnected:start');
          await warte(1);
          zustand.status = 'connected';
          ablauf.push('onConnected:fertig');
        },
        onDisconnected: async (): Promise<void> => {
          ablauf.push('onDisconnected:start');
          await warte(25);
          zustand.status = 'disconnected';
          ablauf.push('onDisconnected:fertig');
        },
      },
    };

    return zustand;
  }

  function sitzung(zustand: Nodezustand): { session: AgentSession; socket: FakeSocket } {
    const socket = new FakeSocket();
    const session = new AgentSession({
      hostId: HOST,
      socket,
      handlers: zustand.handlers,
      log: silentLog,
      now: () => NOW,
    });

    return { session, socket };
  }

  it('meldet die alte Sitzung ab, bevor die neue sich anmeldet – der Status endet auf connected', async () => {
    const zustand = nodezustand();
    const registry = new AgentRegistry();

    const erste = sitzung(zustand);
    registry.register(erste.session);
    erste.session.handleMessage(hello());
    await warte(10);

    expect(zustand.status).toBe('connected');

    // Zweite Verbindung derselben Node – so wie `agent-route.ts` es tut:
    // erst eintragen, dann kommt das `hello` über den Socket.
    const zweite = sitzung(zustand);
    registry.register(zweite.session);
    zweite.session.handleMessage(hello());

    await warte(60);

    expect(zustand.ablauf).toEqual([
      'onConnected:start',
      'onConnected:fertig',
      'onDisconnected:start',
      'onDisconnected:fertig',
      'onConnected:start',
      'onConnected:fertig',
    ]);
    expect(zustand.status).toBe('connected');
    // Die alte Sitzung ist sauber abgemeldet und geschlossen …
    expect(erste.socket.closedWith?.code).toBe(1001);
    expect(erste.session.isReady).toBe(false);
    // … und die neue führt die Node.
    expect(registry.get(HOST)).toBe(zweite.session);
  });

  it('meldet nicht als verbunden, wenn die übernehmende Sitzung während des Wartens wegfällt', async () => {
    const zustand = nodezustand();
    const registry = new AgentRegistry();

    const erste = sitzung(zustand);
    registry.register(erste.session);
    erste.session.handleMessage(hello());
    await warte(10);

    const zweite = sitzung(zustand);
    registry.register(zweite.session);
    zweite.session.handleMessage(hello());
    // Die neue Verbindung bricht ab, während die Abmeldung der alten noch läuft.
    zweite.session.handleSocketClosed(1006, 'abgebrochen');

    await warte(60);

    expect(zustand.status).toBe('disconnected');
    expect(zustand.ablauf.filter((eintrag) => eintrag === 'onConnected:start')).toHaveLength(1);
  });

  it('meldet ohne Vorgängerverbindung weiterhin sofort als verbunden', async () => {
    const zustand = nodezustand();
    const registry = new AgentRegistry();

    const erste = sitzung(zustand);
    registry.register(erste.session);
    erste.session.handleMessage(hello());

    // Kein zusätzlicher Microtask: Der Handler läuft schon los, bevor der Test
    // überhaupt wartet.
    expect(zustand.ablauf).toEqual(['onConnected:start']);
    await warte(10);
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
