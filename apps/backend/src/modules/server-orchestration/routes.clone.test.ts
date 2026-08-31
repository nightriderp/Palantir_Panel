/**
 * HTTP-Ebene des Klonens (Arbeitspaket P7, Pflichtenheft §9).
 *
 * Geprüft wird, was an der Route hängt: dass `POST /clone` den **Auftrag** und
 * nicht den fertigen Server liefert (Status 202), dass es die Poll-Route
 * `GET /clone/:jobId` gibt, auf die `fetchCloneJob()` im Frontend zeigt, und
 * dass beide an `canClone` hängen. Was der Dienst dabei tut, prüft
 * `service.test.ts`.
 */

import { type ServerCloneJobDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { createGameRegistry } from './game-registry.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '66666666-6666-4666-8666-666666666666';
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
  lastStartedAt: '2026-08-30T10:00:00.000Z',
  lastActivityAt: null,
  crashTimestamps: [],
  dockerContainerId: 'container-1',
  imageRef: 'ghcr.io/test:1',
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

const JOB: ServerCloneJobDto = {
  id: JOB_ID,
  serverId: SERVER_ID,
  status: 'running',
  progressPercent: 60,
  step: 'Weltdaten werden übertragen',
  statusMessage: null,
  startedAt: '2026-09-01T10:00:00.000Z',
  finishedAt: null,
  targetServerId: '55555555-5555-4555-8555-555555555555',
  targetName: 'Klon',
  targetSubdomain: 'klon',
  includeWorldData: true,
  copiedBytes: 0,
  totalBytes: 4_096,
};

const actors: Record<string, PermissionActor> = {
  besitzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own', 'server.create'] }],
  }),
  // Darf verwalten, aber keine Server anlegen – `canClone` verlangt beides.
  ohneAnlegen: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  fremd: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own', 'server.create'] }],
  }),
};

interface Aufrufe {
  clone: { serverId: string; subdomain: string; includeWorldData: boolean }[];
  find: { serverId: string; jobId: string }[];
}

async function buildApp(options: { job?: ServerCloneJobDto | null } = {}): Promise<{
  app: FastifyInstance;
  aufrufe: Aufrufe;
}> {
  const aufrufe: Aufrufe = { clone: [], find: [] };

  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
    cloneServer: async (
      serverId: string,
      input: { subdomain: string; includeWorldData: boolean },
    ): Promise<ServerCloneJobDto> => {
      aufrufe.clone.push({
        serverId,
        subdomain: input.subdomain,
        includeWorldData: input.includeWorldData,
      });

      return JOB;
    },
    findCloneJob: (serverId: string, jobId: string): ServerCloneJobDto | null => {
      aufrufe.find.push({ serverId, jobId });

      return options.job === undefined ? JOB : options.job;
    },
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
    request.viewerUserId = request.headers['x-test-actor'] === 'fremd' ? FREMD_ID : OWNER_ID;
  });

  registerServerRoutes(app, {
    service,
    repository: { listMembers: async () => [] } as unknown as ServerRepository,
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
  await app.ready();

  return { app, aufrufe };
}

let offen: FastifyInstance | null = null;

afterEach(async () => {
  await offen?.close();
  offen = null;
});

describe('POST /api/servers/:id/clone', () => {
  it('antwortet mit dem Auftrag und Status 202', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'POST',
      url: `/api/servers/${SERVER_ID}/clone`,
      headers: { 'x-test-actor': 'besitzer' },
      payload: { name: 'Klon', subdomain: 'klon', includeWorldData: true },
    });
    const body = response.json();

    expect(response.statusCode).toBe(202);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: JOB_ID, status: 'running', includeWorldData: true });
    expect(aufrufe.clone).toEqual([
      { serverId: SERVER_ID, subdomain: 'klon', includeWorldData: true },
    ]);
  });

  it('weist ab, wer keine Server anlegen darf', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'POST',
      url: `/api/servers/${SERVER_ID}/clone`,
      headers: { 'x-test-actor': 'ohneAnlegen' },
      payload: { name: 'Klon', subdomain: 'klon', includeWorldData: false },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe.clone).toEqual([]);
  });
});

describe('GET /api/servers/:id/clone/:jobId', () => {
  it('liefert den Stand des Auftrags', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER_ID}/clone/${JOB_ID}`,
      headers: { 'x-test-actor': 'besitzer' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: JOB_ID, progressPercent: 60 });
    expect(aufrufe.find).toEqual([{ serverId: SERVER_ID, jobId: JOB_ID }]);
  });

  it('meldet einen unbekannten Auftrag als nicht gefunden', async () => {
    const { app } = await buildApp({ job: null });
    offen = app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER_ID}/clone/${JOB_ID}`,
      headers: { 'x-test-actor': 'besitzer' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SERVER_NOT_FOUND');
  });

  it('meldet einen fremden Server als nicht gefunden', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER_ID}/clone/${JOB_ID}`,
      headers: { 'x-test-actor': 'fremd' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SERVER_NOT_FOUND');
    expect(aufrufe.find).toEqual([]);
  });

  it('lehnt eine unsinnige Auftrags-Id ab', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER_ID}/clone/keine-uuid`,
      headers: { 'x-test-actor': 'besitzer' },
    });

    expect(response.statusCode).toBe(400);
    expect(aufrufe.find).toEqual([]);
  });
});
