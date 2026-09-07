/**
 * Der Server-Live-Kanal `/live` auf Vertragsbasis (Audit W2-5).
 *
 * Geprüft wird genau das, was vorher am Kanal fehlte:
 * - `contracts-validation-04`: Eingehende Frames laufen über
 *   `liveClientFrameSchema`; ein Konsolenbefehl über der Längengrenze erreicht
 *   den Agenten nicht mehr, sondern wird beantwortet.
 * - `event-flow-03`: `subscribe` liefert den Ist-Stand, `ping` ein `pong`.
 * - `event-flow-07`: Zeilen-Ids tragen die Kennung dieses Prozesses.
 * - `orchestration-core-09`: Ein Abo endet, wenn die Sichtbarkeit wegfällt.
 * - `security-matrix-04`: Ein Handshake mit fremder Herkunft kommt nicht durch.
 *
 * Der Kanal wird echt geöffnet (`app.injectWS`), nicht nachgebaut: Handshake,
 * Hooks und Frame-Verarbeitung sollen zusammen geprüft sein.
 */

import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  SERVER_LIVE_CLOSE_CODE_FORBIDDEN,
  SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED,
} from '@palantir/contracts';
import { liveClientFrameSchema } from '@palantir/validation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { createGameRegistry } from './game-registry.js';
import { ServerLiveHub } from './live-hub.js';
import { LIVE_CLOSE_CODE_FORBIDDEN, LIVE_CLOSE_CODE_UNAUTHORIZED } from './live-frames.js';
import { LIVE_BOOT_ID, registerServerLiveRoute } from './live-route.js';
import { type ServerMemberRecord, type ServerRecord, type ServerRepository } from './repository.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const MITGLIED_ID = '33333333-3333-4333-8333-333333333333';
const PANEL = 'https://panel.example.tld';

const SERVER: ServerRecord = {
  id: SERVER_ID,
  ownerId: OWNER_ID,
  ownerDisplayName: 'Besitzer',
  hostId: '44444444-4444-4444-8444-444444444444',
  hostName: 'homeserver',
  name: 'Testserver',
  gameType: 'test-echo',
  status: 'running',
  statusMessage: 'Läuft seit 5 Minuten',
  statusChangedAt: '2026-09-06T10:00:00.000Z',
  lastStartedAt: null,
  lastActivityAt: null,
  crashTimestamps: [],
  dockerContainerId: 'container-1',
  imageRef: 'ghcr.io/test:1',
  containerSpecHash: null,
  subdomain: 'testserver',
  dnsRecordId: null,
  assignedPorts: [],
  resourceLimits: { ramMb: 2048, cpuCores: 2, diskMb: 10_240 },
  configJson: {},
  startupParameters: '',
  autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 15 },
  restartRequired: false,
  clonedFromServerId: null,
  createdAt: '2026-09-06T09:00:00.000Z',
};

/** Beide Konten dürfen eigene Server sehen und verwalten – mehr nicht. */
const actors: Record<string, PermissionActor> = {
  besitzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  mitglied: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
};

const konten: Record<string, string> = { besitzer: OWNER_ID, mitglied: MITGLIED_ID };

interface Aufbau {
  readonly app: FastifyInstance;
  readonly hub: ServerLiveHub;
  readonly execConsole: ReturnType<typeof vi.fn>;
  /** Mitgliederliste des Servers – im Test veränderbar (Rechteentzug). */
  readonly members: ServerMemberRecord[];
}

interface AufbauOptionen {
  readonly allowedOrigin?: string;
  readonly subscriptionCheckIntervalMs?: number;
}

let offen: FastifyInstance | null = null;

async function baueApp(optionen: AufbauOptionen = {}): Promise<Aufbau> {
  const execConsole = vi.fn(async () => ({ stdout: 'pong', stderr: '' }));
  const members: ServerMemberRecord[] = [];

  const service = {
    requireServer: async (serverId: string) => {
      if (serverId !== SERVER_ID) {
        throw new Error('unbekannter Server');
      }

      return SERVER;
    },
    recentCrashCount: () => 0,
    execConsole,
  } as unknown as ServerOrchestrationService;

  const repository = {
    listMembers: async () => members,
  } as unknown as ServerRepository;

  const app = Fastify({ logger: false });

  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  app.decorateRequest('viewerUserId', null);
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-test-actor'];
    request.viewerUserId = typeof header === 'string' ? (konten[header] ?? null) : null;
  });

  await app.register(websocket);

  const hub = new ServerLiveHub();

  registerServerLiveRoute(app, {
    hub,
    service,
    repository,
    registry: createGameRegistry(1),
    baseDomain: 'example.tld',
    ...(optionen.allowedOrigin === undefined ? {} : { allowedOrigin: optionen.allowedOrigin }),
    ...(optionen.subscriptionCheckIntervalMs === undefined
      ? {}
      : { subscriptionCheckIntervalMs: optionen.subscriptionCheckIntervalMs }),
  });

  await app.ready();
  offen = app;

  return { app, hub, execConsole, members };
}

interface Verbindung {
  readonly frames: Record<string, unknown>[];
  send(frame: unknown): void;
  close(): void;
}

/** Öffnet den Kanal als angemeldetes Konto und sammelt alle Frames. */
async function verbinde(app: FastifyInstance, actor = 'besitzer'): Promise<Verbindung> {
  const socket = await app.injectWS('/live', {
    headers: { 'x-test-actor': actor, origin: PANEL },
  });
  const frames: Record<string, unknown>[] = [];

  socket.on('message', (data: unknown) => {
    frames.push(JSON.parse(String(data)) as Record<string, unknown>);
  });

  return {
    frames,
    send: (frame) => socket.send(JSON.stringify(frame)),
    close: () => socket.close(),
  };
}

/** Wartet, bis mindestens `anzahl` Frames eingetroffen sind (oder die Zeit reißt). */
async function warteAufFrames(
  frames: readonly unknown[],
  anzahl: number,
  maxMs = 1000,
): Promise<void> {
  const ende = Date.now() + maxMs;

  while (frames.length < anzahl && Date.now() < ende) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Lässt die Ereignisschleife ein paar Runden drehen, ohne auf etwas zu warten. */
async function kurzWarten(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await offen?.close();
  offen = null;
});

describe('Eingehende Frames gegen den Vertrag (contracts-validation-04)', () => {
  it('lehnt einen Konsolenbefehl über der Längengrenze ab und ruft den Agenten nicht', async () => {
    const { app, execConsole } = await baueApp();
    const kanal = await verbinde(app);

    kanal.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(kanal.frames, 1);

    kanal.send({
      kind: 'consoleCommand',
      topic: { resource: 'server', id: SERVER_ID },
      command: 'a'.repeat(513),
    });
    await warteAufFrames(kanal.frames, 2);

    const antwort = kanal.frames.at(-1);

    expect(antwort).toMatchObject({ kind: 'error', code: 'VALIDATION_FAILED' });
    expect(antwort).toMatchObject({ topic: { resource: 'server', id: SERVER_ID } });
    expect(execConsole).not.toHaveBeenCalled();
  });

  it('lehnt einen mehrzeiligen Konsolenbefehl ab – dieselbe Regel wie auf dem REST-Weg', async () => {
    const { app, execConsole } = await baueApp();
    const kanal = await verbinde(app);

    kanal.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(kanal.frames, 1);

    kanal.send({
      kind: 'consoleCommand',
      topic: { resource: 'server', id: SERVER_ID },
      command: 'stop\nrm -rf /',
    });
    await warteAufFrames(kanal.frames, 2);

    expect(kanal.frames.at(-1)).toMatchObject({ kind: 'error', code: 'VALIDATION_FAILED' });
    expect(execConsole).not.toHaveBeenCalled();
  });

  it('verwirft ein Frame mit unbekanntem Typ kommentarlos', async () => {
    const { app, execConsole } = await baueApp();
    const kanal = await verbinde(app);

    kanal.send({ kind: 'kaputt', topic: { resource: 'server', id: SERVER_ID } });
    kanal.send({ kind: 'subscribe', topic: { resource: 'fremd', id: SERVER_ID } });
    kanal.send('kein JSON');
    await kurzWarten();

    expect(kanal.frames).toHaveLength(0);
    expect(execConsole).not.toHaveBeenCalled();
  });

  it('führt einen gültigen Befehl weiterhin aus', async () => {
    const { app, execConsole } = await baueApp();
    const kanal = await verbinde(app);

    kanal.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(kanal.frames, 1);

    kanal.send({
      kind: 'consoleCommand',
      topic: { resource: 'server', id: SERVER_ID },
      command: 'list',
    });
    await warteAufFrames(kanal.frames, 3);

    expect(execConsole).toHaveBeenCalledWith(SERVER_ID, 'list');
    expect(kanal.frames.some((frame) => frame.kind === 'error')).toBe(false);
  });
});

describe('Ist-Stand und Lebenszeichen (event-flow-03)', () => {
  it('beantwortet ein subscribe mit dem aktuellen Status', async () => {
    const { app } = await baueApp();
    const kanal = await verbinde(app);

    kanal.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(kanal.frames, 1);

    expect(kanal.frames[0]).toMatchObject({
      kind: 'resync',
      topic: { resource: 'server', id: SERVER_ID },
      data: { status: 'running', statusMessage: 'Läuft seit 5 Minuten' },
    });
  });

  it('schickt nach einem Wiederanlauf erneut den Ist-Stand', async () => {
    const { app } = await baueApp();

    const erste = await verbinde(app);
    erste.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(erste.frames, 1);
    erste.close();

    // Der Browser meldet nach dem Wiederanlauf dieselben Abos erneut an.
    const zweite = await verbinde(app);
    zweite.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(zweite.frames, 1);

    expect(zweite.frames[0]).toMatchObject({ kind: 'resync', data: { status: 'running' } });
  });

  it('antwortet auf ein ping mit einem pong', async () => {
    const { app } = await baueApp();
    const kanal = await verbinde(app);

    kanal.send({ kind: 'ping' });
    await warteAufFrames(kanal.frames, 1);

    expect(kanal.frames[0]).toMatchObject({ kind: 'pong' });
    expect(typeof kanal.frames[0]?.sentAt).toBe('string');
  });

  it('lässt das ping über dasselbe Schema laufen wie die übrigen Frames', () => {
    // Contracts-Nachzug W2-C2: Vorher fing die Route das Lebenszeichen von Hand
    // vor `liveClientFrameSchema` ab, weil der Vertrag es nicht kannte – ein
    // zweiter Parser für denselben Kanal.
    expect(liveClientFrameSchema.parse({ kind: 'ping' })).toEqual({ kind: 'ping' });
  });

  it('antwortet einem nicht abonnierten Server gegenüber nicht auf subscribe', async () => {
    const { app } = await baueApp();
    const kanal = await verbinde(app, 'mitglied');

    // Kein Mitglied, kein Besitzer: kein Abo und keine Auskunft darüber, dass
    // es diesen Server gibt.
    kanal.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await kurzWarten();

    expect(kanal.frames).toHaveLength(0);
  });
});

describe('Zeilen-Ids überleben einen Backend-Neustart (event-flow-07)', () => {
  it('setzt die Prozesskennung in jede Zeilen-Id', async () => {
    const { app } = await baueApp();
    const kanal = await verbinde(app);

    kanal.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(kanal.frames, 1);

    kanal.send({
      kind: 'consoleCommand',
      topic: { resource: 'server', id: SERVER_ID },
      command: 'list',
    });
    await warteAufFrames(kanal.frames, 3);

    const zeilen = kanal.frames
      .filter((frame) => frame.event === 'server.consoleLineAppended')
      .map((frame) => (frame.data as { line: { id: string } }).line.id);

    expect(zeilen.length).toBeGreaterThanOrEqual(2);
    for (const id of zeilen) {
      expect(id.startsWith(`${SERVER_ID}-${LIVE_BOOT_ID}-`)).toBe(true);
    }
    // Innerhalb eines Prozesses bleiben die Ids eindeutig.
    expect(new Set(zeilen).size).toBe(zeilen.length);
  });

  it('vergibt eine Kennung, die nicht bei jedem Start dieselbe ist', () => {
    // 12 Hex-Zeichen: keine feste Zahl wie der frühere Zähler, der nach jedem
    // Deploy wieder bei 0 begann und den Client die neuen Zeilen verwerfen ließ.
    expect(LIVE_BOOT_ID).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('Abos beim Rechteentzug (orchestration-core-09)', () => {
  it('beendet das Abo, wenn die Sichtbarkeit während der Verbindung wegfällt', async () => {
    const { app, hub, members } = await baueApp({ subscriptionCheckIntervalMs: 20 });

    members.push({
      userId: MITGLIED_ID,
      displayName: 'Mitglied',
      level: 'operator',
      addedAt: '2026-09-06T09:30:00.000Z',
    });

    const kanal = await verbinde(app, 'mitglied');
    kanal.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(kanal.frames, 1);

    hub.publish('server.statusChanged', {
      serverId: SERVER_ID,
      status: 'stopped',
      statusMessage: null,
    });
    await warteAufFrames(kanal.frames, 2);
    expect(kanal.frames.at(-1)).toMatchObject({ event: 'server.statusChanged' });

    // Der Besitzer entfernt das Mitglied.
    members.length = 0;
    await kurzWarten(120);

    const vorher = kanal.frames.length;
    hub.publish('server.statusChanged', {
      serverId: SERVER_ID,
      status: 'running',
      statusMessage: null,
    });
    await kurzWarten();

    expect(kanal.frames).toHaveLength(vorher);
  });

  it('schließt über closeAll alle Verbindungen eines Kontos', async () => {
    const { app, hub } = await baueApp();
    const kanal = await verbinde(app);

    kanal.send({ kind: 'subscribe', topic: { resource: 'server', id: SERVER_ID } });
    await warteAufFrames(kanal.frames, 1);

    expect(hub.closeAll(OWNER_ID, 4401, 'Sitzung beendet.')).toBe(1);
    expect(hub.socketCount).toBe(0);
  });
});

describe('Herkunft des Handshakes (security-matrix-04)', () => {
  it('lässt die konfigurierte Panel-Adresse durch', async () => {
    const { app } = await baueApp({ allowedOrigin: PANEL });

    const socket = await app.injectWS('/live', {
      headers: { 'x-test-actor': 'besitzer', origin: PANEL },
    });

    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });

  it('weist eine fremde Herkunft schon beim Handshake ab', async () => {
    const { app } = await baueApp({ allowedOrigin: PANEL });

    await expect(
      app.injectWS('/live', {
        headers: { 'x-test-actor': 'besitzer', origin: 'https://boese.example' },
      }),
    ).rejects.toThrow('403');
  });

  it('weist einen Handshake ohne Herkunft ab', async () => {
    const { app } = await baueApp({ allowedOrigin: PANEL });

    await expect(
      app.injectWS('/live', { headers: { 'x-test-actor': 'besitzer' } }),
    ).rejects.toThrow('403');
  });
});

/**
 * Contracts-Nachzug W2-C2: Die Close-Codes des Kanals stehen im Vertrag; das
 * Backend reicht sie nur unter seinem bisherigen Namen weiter. Vorher hielt
 * jede Seite ihre eigene Zahl.
 */
describe('Close-Codes des Server-Live-Kanals', () => {
  it('nimmt beide Zahlen unverändert aus dem Vertrag', () => {
    expect(LIVE_CLOSE_CODE_UNAUTHORIZED).toBe(SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED);
    expect(LIVE_CLOSE_CODE_FORBIDDEN).toBe(SERVER_LIVE_CLOSE_CODE_FORBIDDEN);
  });
});
