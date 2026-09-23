/**
 * Route der Live-Steuerung (Betreiber-Wunsch 23.09.2026): Recht und Form der
 * Eingabe. Was der Dienst daraus macht, prüft `service.test.ts`; hier ist er
 * ein Fake ohne Agent und ohne Datenbank.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { ALLE_GAME_TYPE_DEFINITIONS, createGameRegistry } from './game-registry.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const BESITZER_ID = '22222222-2222-4222-8222-222222222222';
const ZWEITER_ID = '33333333-3333-4333-8333-333333333333';

const SERVER: ServerRecord = {
  id: SERVER_ID,
  ownerId: BESITZER_ID,
  ownerDisplayName: 'Besitzer',
  ownerAvatarUpdatedAt: null,
  ownerTitleAchievementId: null,
  hostId: '44444444-4444-4444-8444-444444444444',
  hostName: 'homeserver',
  hostStatus: 'online',
  hostCpuCores: 8,
  hostRamMb: null,
  name: 'Testserver',
  gameType: 'test-echo',
  status: 'running',
  statusMessage: null,
  statusChangedAt: '2026-08-30T10:00:00.000Z',
  lastStartedAt: null,
  lastActivityAt: null,
  crashTimestamps: [],
  totalUptimeSeconds: 0,
  dockerContainerId: 'container-1',
  imageRef: 'ghcr.io/test:1',
  gameVersion: null,
  gameVersionUrl: null,
  gameVersionHash: null,
  gameVersionHashAlgorithm: null,
  containerSpecHash: null,
  subdomain: 'testserver',
  dnsRecordId: null,
  assignedPorts: [],
  resourceLimits: { ramMb: 2048 },
  configJson: {},
  startupParameters: '',
  autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 15 },
  restartRequired: false,
  clonedFromServerId: null,
  createdAt: '2026-08-30T09:00:00.000Z',
};

/**
 * `verwalter` darf die Konsole benutzen (`server.manage.any`), `zuschauer`
 * sieht den Server nur – die Live-Steuerung braucht dasselbe Recht wie die
 * Konsole.
 */
const actors: Record<string, PermissionActor> = {
  verwalter: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.any', 'server.manage.any'], name: 'Admin' }],
  }),
  zuschauer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.any'], name: 'Zuschauer' }],
  }),
};

const kontoIds: Record<string, string> = { verwalter: BESITZER_ID, zuschauer: ZWEITER_ID };

/** Eingaben, die den Dienst tatsächlich erreicht haben. */
let aufrufe: Record<string, string | number>[] = [];

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

function buildApp(): FastifyInstance {
  aufrufe = [];

  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
    applyLiveValues: async (_serverId: string, werte: Record<string, string | number>) => {
      aufrufe.push(werte);

      return { ...SERVER, liveValues: werte };
    },
  } as unknown as ServerOrchestrationService;

  const instance = Fastify({ logger: false });

  registerErrorHandler(instance);
  registerRbac(instance, {
    resolveActor: (request) => {
      const kopf = request.headers['x-test-actor'];

      return typeof kopf === 'string' ? (actors[kopf] ?? null) : null;
    },
  });

  instance.decorateRequest('viewerUserId', null);
  instance.addHook('onRequest', async (request) => {
    const kopf = request.headers['x-test-actor'];

    request.viewerUserId = typeof kopf === 'string' ? (kontoIds[kopf] ?? null) : null;
  });

  registerServerRoutes(instance, {
    service,
    repository: {
      listMembers: async () => [],
      listPinnedServerIds: async () => new Set<string>(),
    } as unknown as ServerRepository,
    registry: createGameRegistry(1, ALLE_GAME_TYPE_DEFINITIONS),
    baseDomain: 'example.tld',
    schedules: {
      list: async () => [],
      create: async () => {
        throw new Error('nicht benutzt');
      },
      update: async () => {
        throw new Error('nicht benutzt');
      },
      remove: async () => undefined,
      tick: async () => ({ executedScheduleIds: [], failedScheduleIds: [] }),
    },
    worldArchives: {
      save: async () => {
        throw new Error('nicht benutzt');
      },
      take: async () => null,
      sweep: async () => 0,
    },
  });

  app = instance;

  return instance;
}

function schicke(instance: FastifyInstance, actor: string, payload: unknown) {
  return instance.inject({
    method: 'POST',
    url: `/api/servers/${SERVER_ID}/live`,
    headers: { 'x-test-actor': actor },
    payload: payload as Record<string, unknown>,
  });
}

describe('POST /api/servers/:id/live', () => {
  it('reicht die Werte an den Dienst und meldet die Live-Werte zurück', async () => {
    const antwort = await schicke(buildApp(), 'verwalter', { values: { bots: 3 } });

    expect(antwort.statusCode).toBe(200);
    expect(aufrufe).toEqual([{ bots: 3 }]);
    expect(antwort.json()).toMatchObject({ success: true, data: { liveValues: { bots: 3 } } });
  });

  it('verlangt dasselbe Recht wie die Konsole', async () => {
    const antwort = await schicke(buildApp(), 'zuschauer', { values: { bots: 3 } });

    expect(antwort.statusCode).toBe(403);
    expect(aufrufe).toHaveLength(0);
  });

  it('lässt eine ungültige Eingabe nicht bis zum Dienst durch', async () => {
    const instance = buildApp();

    expect((await schicke(instance, 'verwalter', { values: {} })).statusCode).toBe(400);
    expect((await schicke(instance, 'verwalter', { values: { gotv: true } })).statusCode).toBe(400);
    expect(
      (await schicke(instance, 'verwalter', { values: { bots: 1 }, extra: 1 })).statusCode,
    ).toBe(400);
    expect(aufrufe).toHaveLength(0);
  });
});
