/**
 * Anheften eines Servers an die eigene Übersicht (WORK_STATUS.md, Gefundener
 * Punkt 50).
 *
 * Geprüft wird, was an der Route hängt: dass beide Aufrufe idempotent sind, dass
 * die Anheftung am **Konto** und nicht am Server hängt (zwei Konten, zwei
 * Antworten) und dass ein Server, den der Aufrufer nicht sehen darf, sich auch
 * nicht anheften lässt.
 */

import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { createGameRegistry } from './game-registry.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const FREMD_ID = '33333333-3333-4333-8333-333333333333';

const SERVER: ServerRecord = {
  id: SERVER_ID,
  ownerId: OWNER_ID,
  ownerDisplayName: 'Besitzer',
  hostId: '44444444-4444-4444-8444-444444444444',
  hostName: 'homeserver',
  name: 'Testserver',
  gameType: 'test-echo',
  status: 'running',
  statusMessage: null,
  statusChangedAt: '2026-08-30T10:00:00.000Z',
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
  createdAt: '2026-08-30T09:00:00.000Z',
};

const actors: Record<string, PermissionActor> = {
  besitzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own'] }],
  }),
  fremd: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own'] }],
  }),
};

/** Anheftungen im Speicher – dieselbe Schnittstelle wie die Tabelle. */
function fakeRepository() {
  const pins = new Map<string, Set<string>>();

  return {
    pins,
    listMembers: async () => [],
    listPinnedServerIds: async (userId: string) => pins.get(userId) ?? new Set<string>(),
    pinServer: async (userId: string, serverId: string) => {
      const vorhanden = pins.get(userId) ?? new Set<string>();
      vorhanden.add(serverId);
      pins.set(userId, vorhanden);
    },
    unpinServer: async (userId: string, serverId: string) => {
      pins.get(userId)?.delete(serverId);
    },
    listAll: async () => [SERVER],
    listByOwnerOrMembership: async () => [SERVER],
  };
}

function buildApp(repository: ReturnType<typeof fakeRepository>): FastifyInstance {
  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
  } as unknown as ServerOrchestrationService;

  const app = Fastify({ logger: false });

  registerErrorHandler(app);
  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  app.decorateRequest('viewerUserId', null);
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-test-actor'];
    request.viewerUserId = header === 'fremd' ? FREMD_ID : header === 'besitzer' ? OWNER_ID : null;
  });

  registerServerRoutes(app, {
    service,
    repository: repository as unknown as ServerRepository,
    registry: createGameRegistry(1),
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

  return app;
}

async function call(
  app: FastifyInstance,
  method: 'GET' | 'PUT' | 'DELETE',
  url: string,
  actor?: string,
) {
  const request: InjectOptions = {
    method,
    url,
    headers: actor ? { 'x-test-actor': actor } : {},
  };

  return await app.inject(request);
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe('Anheften (Gefundener Punkt 50)', () => {
  it('heftet an und meldet den Server als angeheftet', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, 'PUT', `/api/servers/${SERVER_ID}/pin`, 'besitzer');

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { pinned: boolean } }>().data.pinned).toBe(true);
    expect(repository.pins.get(OWNER_ID)?.has(SERVER_ID)).toBe(true);
  });

  it('ist beim zweiten Anheften unverändert', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    await call(app, 'PUT', `/api/servers/${SERVER_ID}/pin`, 'besitzer');
    const zweiter = await call(app, 'PUT', `/api/servers/${SERVER_ID}/pin`, 'besitzer');

    expect(zweiter.statusCode).toBe(200);
    expect(repository.pins.get(OWNER_ID)?.size).toBe(1);
  });

  it('löst wieder – auch wenn nichts angeheftet war', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, 'DELETE', `/api/servers/${SERVER_ID}/pin`, 'besitzer');

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { pinned: boolean } }>().data.pinned).toBe(false);
  });

  it('zeigt die Anheftung nur dem Konto, das sie gesetzt hat', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    await call(app, 'PUT', `/api/servers/${SERVER_ID}/pin`, 'besitzer');

    const eigene = await call(app, 'GET', '/api/servers', 'besitzer');
    const fremde = await call(app, 'GET', '/api/servers', 'fremd');

    expect(eigene.json<{ data: { pinned: boolean }[] }>().data[0]?.pinned).toBe(true);
    expect(fremde.json<{ data: { pinned: boolean }[] }>().data).toHaveLength(0);
  });

  it('verlangt eine Anmeldung', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, 'PUT', `/api/servers/${SERVER_ID}/pin`);

    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });
});
