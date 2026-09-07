/**
 * Tests des WebSocket-Endpunkts `/agent` (Pflichtenheft §2.2) – genauer: der
 * Prüfungen **vor** dem Protokoll. Die Protokoll-Logik dahinter prüft
 * `agent-gateway.test.ts`; hier geht es um Quelladresse (Fundpunkt 121,
 * `AGENT_SOURCE_ALLOWLIST`) und Token, und um deren Reihenfolge.
 *
 * `injectWS` aus `@fastify/websocket` baut den Handshake über ein Stream-Paar
 * nach, ohne offenen Port. Die Gegenstelle ist dort ein bloßes Objekt – die
 * Socket-Adresse, die die Route liest, kommt aus dem Test.
 */

import { type Socket } from 'node:net';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { AGENT_PROTOCOL_VERSION } from '@palantir/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentRegistry,
  CLOSE_CODE_FRAME_TOO_LARGE,
  CLOSE_CODE_UNAUTHORIZED,
  MAX_AGENT_FRAME_BYTES,
} from './agent-gateway.js';
import { type AgentRouteOptions, registerAgentRoute } from './agent-route.js';
import { parseSourceAllowlist } from './source-allowlist.js';

const TOKEN = 'palantir-agent_nur-fuer-diesen-test';
const HOST_ID = '11111111-1111-4111-8111-111111111111';

/** Protokolliert Warnungen, damit der Test prüfen kann, was darin steht. */
function recordingLog(): AgentRouteOptions['log'] & { readonly warnings: string[] } {
  const warnings: string[] = [];

  return {
    warnings,
    info: (): void => undefined,
    warn: (details, message): void => {
      warnings.push(JSON.stringify({ details, message }));
    },
    error: (): void => undefined,
  };
}

/**
 * `injectWS` reicht den Kontext als rohe Anfrage durch; `socket` muss darin nur
 * die Adresse tragen, die `request.socket.remoteAddress` liest. Ein echter
 * `net.Socket` wäre hier nur Ballast – daher die Umdeutung.
 */
function fakeSocket(remoteAddress: string): Socket {
  return { remoteAddress } as unknown as Socket;
}

let app: FastifyInstance | null = null;

async function buildApp(
  overrides: Partial<AgentRouteOptions> = {},
): Promise<{ app: FastifyInstance; log: ReturnType<typeof recordingLog> }> {
  const log = recordingLog();

  app = Fastify({ logger: false });
  await app.register(websocket);
  registerAgentRoute(app, {
    agents: new AgentRegistry(),
    handlers: {
      onStateReport: (): void => undefined,
      onEvent: (): void => undefined,
    },
    log,
    token: TOKEN,
    resolveHostId: async (): Promise<string | null> => HOST_ID,
    ...overrides,
  });
  await app.ready();

  return { app, log };
}

afterEach(async () => {
  await app?.close();
  app = null;
});

interface Verbindung {
  /** Erster Close-Frame des Backends. */
  readonly closed: Promise<{ code: number; reason: string }>;
  /** Erste Nachricht des Backends. */
  readonly firstMessage: Promise<string>;
  readonly send: (data: string) => void;
  readonly terminate: () => void;
}

async function verbinden(
  instance: FastifyInstance,
  options: { peer: string; authorization?: string },
): Promise<Verbindung> {
  let resolveClosed: (value: { code: number; reason: string }) => void = () => undefined;
  let resolveMessage: (value: string) => void = () => undefined;
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    resolveClosed = resolve;
  });
  const firstMessage = new Promise<string>((resolve) => {
    resolveMessage = resolve;
  });

  const client = await instance.injectWS(
    '/agent',
    {
      headers: options.authorization === undefined ? {} : { authorization: options.authorization },
      socket: fakeSocket(options.peer),
    },
    {
      // Vor dem Handshake anhängen: Der Close-Frame kann sofort nach `open` kommen.
      onInit: (ws) => {
        ws.on('close', (code: number, reason: Buffer) => {
          resolveClosed({ code, reason: reason.toString() });
        });
        ws.on('message', (data) => {
          resolveMessage(String(data));
        });
      },
    },
  );

  return {
    closed,
    firstMessage,
    send: (data) => {
      client.send(data);
    },
    terminate: () => {
      client.terminate();
    },
  };
}

function hello(): string {
  return JSON.stringify({
    kind: 'hello',
    protocolVersion: AGENT_PROTOCOL_VERSION,
    agentVersion: '0.1.0',
    sentAt: new Date().toISOString(),
  });
}

describe('Quelladressen-Allowlist (Fundpunkt 121, AGENT_SOURCE_ALLOWLIST)', () => {
  it('lehnt eine Quelladresse außerhalb der Allowlist mit 4401 ab – vor der Token-Prüfung', async () => {
    const resolveHostIdByToken = vi.fn(async (): Promise<string | null> => HOST_ID);
    const { app: instance, log } = await buildApp({
      sourceAllowlist: parseSourceAllowlist('10.10.0.0/24'),
      resolveHostIdByToken,
    });

    // Gültiges Token, aber die Gegenstelle ist der Traefik-Container aus dem Docker-Netz.
    const verbindung = await verbinden(instance, {
      peer: '172.18.0.3',
      authorization: `Bearer ${TOKEN}`,
    });

    await expect(verbindung.closed).resolves.toEqual({
      code: CLOSE_CODE_UNAUTHORIZED,
      reason: 'Quelladresse nicht zugelassen.',
    });
    expect(resolveHostIdByToken).not.toHaveBeenCalled();
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toContain('172.18.0.3');
    expect(log.warnings[0]).toContain('AGENT_SOURCE_ALLOWLIST');
    // Das Token gehört nicht ins Protokoll.
    expect(log.warnings[0]).not.toContain(TOKEN);
  });

  it('nimmt eine Quelladresse aus dem Tunnelnetz an und prüft dann das Token', async () => {
    const { app: instance, log } = await buildApp({
      sourceAllowlist: parseSourceAllowlist('10.10.0.0/24'),
    });

    const verbindung = await verbinden(instance, {
      peer: '10.10.0.2',
      authorization: `Bearer ${TOKEN}`,
    });
    verbindung.send(hello());

    const antwort = JSON.parse(await verbindung.firstMessage) as { kind: string };

    expect(antwort.kind).toBe('welcome');
    expect(log.warnings).toEqual([]);
    verbindung.terminate();
  });

  it('behandelt die IPv4-mapped Schreibweise der Gegenstelle wie IPv4', async () => {
    const { app: instance } = await buildApp({
      sourceAllowlist: parseSourceAllowlist('10.10.0.0/24'),
    });

    const verbindung = await verbinden(instance, {
      peer: '::ffff:10.10.0.2',
      authorization: `Bearer ${TOKEN}`,
    });
    verbindung.send(hello());

    const antwort = JSON.parse(await verbindung.firstMessage) as { kind: string };

    expect(antwort.kind).toBe('welcome');
    verbindung.terminate();
  });

  it('lässt bei erlaubter Quelladresse ein falsches Token weiterhin scheitern', async () => {
    const { app: instance, log } = await buildApp({
      sourceAllowlist: parseSourceAllowlist('10.10.0.0/24'),
    });

    const verbindung = await verbinden(instance, {
      peer: '10.10.0.2',
      authorization: 'Bearer falsch',
    });

    await expect(verbindung.closed).resolves.toEqual({
      code: CLOSE_CODE_UNAUTHORIZED,
      reason: 'Ungültiges Agent-Token.',
    });
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toContain('Pre-Shared-Token');
  });

  it('prüft ohne Allowlist keine Quelladresse (wie bisher)', async () => {
    const { app: instance, log } = await buildApp();

    const verbindung = await verbinden(instance, {
      peer: '203.0.113.10',
      authorization: `Bearer ${TOKEN}`,
    });
    verbindung.send(hello());

    const antwort = JSON.parse(await verbindung.firstMessage) as { kind: string };

    expect(antwort.kind).toBe('welcome');
    expect(log.warnings).toEqual([]);
    verbindung.terminate();
  });

  it('prüft mit leerer Allowlist keine Quelladresse (leerer Wert in der .env)', async () => {
    const { app: instance } = await buildApp({ sourceAllowlist: parseSourceAllowlist('') });

    const verbindung = await verbinden(instance, {
      peer: '203.0.113.10',
      authorization: 'Bearer falsch',
    });

    // Bis zur Token-Prüfung kommt die Verbindung – und scheitert erst dort.
    await expect(verbindung.closed).resolves.toEqual({
      code: CLOSE_CODE_UNAUTHORIZED,
      reason: 'Ungültiges Agent-Token.',
    });
  });
});

describe('Frame-Prüfung am echten Socket (Audit security-matrix-07)', () => {
  /*
   * Die Protokoll-Logik prüft `agent-gateway.test.ts`. Hier geht es um den Weg
   * dorthin: `ws` reicht die Nutzlast als `Buffer` durch, und genau daran hängt,
   * dass die Größengrenze greift, **bevor** ein 100-MiB-Frame als String im
   * Speicher landet.
   */
  function stateReport(): string {
    return JSON.stringify({
      kind: 'stateReport',
      reason: 'connected',
      containers: [],
      reportedAt: new Date().toISOString(),
    });
  }

  it('verwirft einen Ist-Zustands-Bericht, der vor dem hello eintrifft', async () => {
    const berichte: string[] = [];
    const { app: instance, log } = await buildApp({
      handlers: {
        onStateReport: (hostId): void => {
          berichte.push(hostId);
        },
        onEvent: (): void => undefined,
      },
    });

    const verbindung = await verbinden(instance, {
      peer: '10.10.0.2',
      authorization: `Bearer ${TOKEN}`,
    });

    verbindung.send(stateReport());
    verbindung.send(hello());

    const antwort = JSON.parse(await verbindung.firstMessage) as { kind: string };

    // Das `welcome` beweist, dass der frühe Bericht bereits durch war …
    expect(antwort.kind).toBe('welcome');
    // … und der Handler ihn nie gesehen hat.
    expect(berichte).toEqual([]);
    expect(log.warnings.some((zeile) => zeile.includes('vor dem Handshake'))).toBe(true);
    verbindung.terminate();
  });

  it('beendet die Verbindung bei einem Frame über der Größengrenze', async () => {
    const ereignisse: string[] = [];
    const { app: instance } = await buildApp({
      handlers: {
        onStateReport: (): void => undefined,
        onEvent: (hostId): void => {
          ereignisse.push(hostId);
        },
      },
    });

    const verbindung = await verbinden(instance, {
      peer: '10.10.0.2',
      authorization: `Bearer ${TOKEN}`,
    });

    verbindung.send(hello());
    await verbindung.firstMessage;

    verbindung.send(
      JSON.stringify({
        kind: 'event',
        event: 'LOG_LINE',
        serverId: null,
        payload: { message: 'x'.repeat(MAX_AGENT_FRAME_BYTES + 1) },
        emittedAt: new Date().toISOString(),
      }),
    );

    const geschlossen = await verbindung.closed;

    expect(geschlossen.code).toBe(CLOSE_CODE_FRAME_TOO_LARGE);
    expect(ereignisse).toEqual([]);
  });
});
