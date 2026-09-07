import { AGENT_PROTOCOL_VERSION, ok } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH,
  agentCommandResultFrameSchema,
  agentEventFrameSchema,
  agentHelloFrameSchema,
  agentStateReportFrameSchema,
  agentToBackendFrameSchema,
  backendToAgentFrameSchema,
  correlationIdSchema,
} from './agent-protocol.js';

const CORRELATION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SERVER_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';
const NOW = '2026-08-26T10:00:00.000Z';

describe('Korrelations-ID (Pflichtenheft §2.2)', () => {
  it('akzeptiert eine UUID und lehnt Freitext ab', () => {
    expect(correlationIdSchema.safeParse(CORRELATION_ID).success).toBe(true);
    expect(correlationIdSchema.safeParse('cmd-42').success).toBe(false);
    expect(correlationIdSchema.safeParse('').success).toBe(false);
  });
});

describe('Befehls-Frame Backend -> Agent', () => {
  const validCommand = {
    kind: 'command',
    correlationId: CORRELATION_ID,
    command: 'START',
    serverId: SERVER_ID,
    payload: { foo: 'bar' },
    issuedAt: NOW,
  };

  it('akzeptiert einen vollständigen Befehl', () => {
    expect(backendToAgentFrameSchema.safeParse(validCommand).success).toBe(true);
  });

  it('akzeptiert node-weite Befehle ohne serverId', () => {
    const result = backendToAgentFrameSchema.safeParse({
      ...validCommand,
      command: 'GET_STORAGE_BREAKDOWN',
      serverId: null,
    });
    expect(result.success).toBe(true);
  });

  it('lehnt einen Befehl ab, der nicht im Katalog steht', () => {
    expect(
      backendToAgentFrameSchema.safeParse({ ...validCommand, command: 'SHUTDOWN_HOST' }).success,
    ).toBe(false);
  });

  it('lehnt eine Korrelations-ID ab, die keine UUID ist', () => {
    expect(
      backendToAgentFrameSchema.safeParse({ ...validCommand, correlationId: 'retry-1' }).success,
    ).toBe(false);
  });

  it('lehnt einen Befehl ohne Korrelations-ID ab', () => {
    const { correlationId: _ignored, ...ohneId } = validCommand;
    expect(backendToAgentFrameSchema.safeParse(ohneId).success).toBe(false);
  });

  it('lehnt einen unbekannten Frame-Typ ab', () => {
    expect(backendToAgentFrameSchema.safeParse({ kind: 'shutdown' }).success).toBe(false);
  });

  it('akzeptiert welcome und stateRequest', () => {
    expect(
      backendToAgentFrameSchema.safeParse({
        kind: 'welcome',
        protocolVersion: AGENT_PROTOCOL_VERSION,
        sentAt: NOW,
      }).success,
    ).toBe(true);
    expect(
      backendToAgentFrameSchema.safeParse({ kind: 'stateRequest', requestedAt: NOW }).success,
    ).toBe(true);
  });
});

describe('Hello-Frame Agent -> Backend', () => {
  const hello = {
    kind: 'hello',
    protocolVersion: AGENT_PROTOCOL_VERSION,
    agentVersion: '0.1.0',
    sentAt: NOW,
  };

  it('nimmt einen Agent ohne Node-Kennung an (additiv, Gefundener Punkt 57)', () => {
    const parsed = agentHelloFrameSchema.parse(hello);

    expect(parsed.nodeId ?? null).toBeNull();
  });

  it('nimmt eine Node-Kennung als UUID an und lehnt Freitext ab', () => {
    expect(agentHelloFrameSchema.parse({ ...hello, nodeId: SERVER_ID }).nodeId).toBe(SERVER_ID);
    expect(agentHelloFrameSchema.safeParse({ ...hello, nodeId: 'homeserver' }).success).toBe(false);
  });
});

describe('Frames Agent -> Backend', () => {
  it('akzeptiert einen vollständigen Ist-Zustands-Bericht', () => {
    const result = agentStateReportFrameSchema.safeParse({
      kind: 'stateReport',
      reason: 'connected',
      containers: [
        {
          serverId: SERVER_ID,
          containerId: 'abc123',
          status: 'running',
          exitCode: null,
          startedAt: NOW,
          observedAt: NOW,
        },
      ],
      reportedAt: NOW,
    });
    expect(result.success).toBe(true);
  });

  it('akzeptiert einen leeren Ist-Zustands-Bericht (kein Container bekannt)', () => {
    expect(
      agentStateReportFrameSchema.safeParse({
        kind: 'stateReport',
        reason: 'requested',
        containers: [],
        reportedAt: NOW,
      }).success,
    ).toBe(true);
  });

  it('lehnt einen Container-Zustand aus dem Server-Lifecycle ab', () => {
    const result = agentStateReportFrameSchema.safeParse({
      kind: 'stateReport',
      reason: 'connected',
      containers: [
        {
          serverId: SERVER_ID,
          containerId: 'abc123',
          // `starting` ist ein Lifecycle-Zustand des Backends (Pflichtenheft §9),
          // kein beobachtbarer Container-Zustand.
          status: 'starting',
          exitCode: null,
          startedAt: null,
          observedAt: NOW,
        },
      ],
      reportedAt: NOW,
    });
    expect(result.success).toBe(false);
  });

  it('nutzt im Befehlsergebnis den Response-Envelope aus §5.1', () => {
    const result = agentCommandResultFrameSchema.safeParse({
      kind: 'commandResult',
      correlationId: CORRELATION_ID,
      command: 'START',
      result: ok({ containerId: 'abc123' }),
      duplicate: false,
      completedAt: NOW,
    });
    expect(result.success).toBe(true);
  });

  it('lehnt ein Befehlsergebnis mit Freitext-Fehlercode ab', () => {
    const result = agentCommandResultFrameSchema.safeParse({
      kind: 'commandResult',
      correlationId: CORRELATION_ID,
      command: 'START',
      result: { success: false, data: null, error: { code: 'BOOM', message: 'kaputt' } },
      duplicate: false,
      completedAt: NOW,
    });
    expect(result.success).toBe(false);
  });
});

/**
 * Feldgrenze der Ereignis-Nutzlasten (Audit W2-30, Fundpunkt 145).
 *
 * Gedeckelt war bisher nur der ganze Frame (1 MiB). `LOG_LINE.message` wandert
 * ungefiltert in den Konsolenpuffer jedes Browsers, der den Server abonniert
 * hat – eine Logzeile von einem Megabyte war damit kein Protokollfehler,
 * sondern ein gültiger Frame.
 */
describe('Feldgrenze der Ereignis-Nutzlast', () => {
  const logFrame = (message: string): unknown => ({
    kind: 'event',
    event: 'LOG_LINE',
    serverId: SERVER_ID,
    payload: { containerId: 'abc123', stream: 'stdout', message, timestamp: NOW, at: NOW },
    emittedAt: NOW,
  });

  it('nimmt eine Konsolenzeile bis zur Grenze an', () => {
    const gerade = agentEventFrameSchema.safeParse(
      logFrame('a'.repeat(AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH)),
    );

    expect(gerade.success).toBe(true);
  });

  it('lehnt eine überlange Konsolenzeile ab', () => {
    const zuLang = agentEventFrameSchema.safeParse(
      logFrame('a'.repeat(AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH + 1)),
    );

    expect(zuLang.success).toBe(false);
    // Auch über die Frame-Union, denn dort kommt der Frame tatsächlich an.
    expect(
      agentToBackendFrameSchema.safeParse(
        logFrame('a'.repeat(AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH + 1)),
      ).success,
    ).toBe(false);
  });

  it('greift auch für ein verschachteltes Feld', () => {
    // Die heutigen Nutzlasten sind flach; die Grenze soll aber auch dann noch
    // greifen, wenn ein späteres Ereignis seine Zeilen bündelt.
    const verschachtelt = agentEventFrameSchema.safeParse({
      kind: 'event',
      event: 'LOG_LINE',
      serverId: SERVER_ID,
      payload: { lines: [{ message: 'a'.repeat(AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH + 1) }] },
      emittedAt: NOW,
    });

    expect(verschachtelt.success).toBe(false);
  });

  it('lässt einen Frame ohne Nutzlast weiterhin gültig', () => {
    // `payload` ist im Vertrag optional (`AgentEventFrame`) – die Grenze darf
    // daran nichts ändern.
    const ohne = agentEventFrameSchema.safeParse({
      kind: 'event',
      event: 'CRASHED',
      serverId: SERVER_ID,
      emittedAt: NOW,
    });

    expect(ohne.success).toBe(true);
  });
});
