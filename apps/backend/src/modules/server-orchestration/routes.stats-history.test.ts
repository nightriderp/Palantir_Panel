/**
 * HTTP-Ebene des Messwert-Verlaufs (Arbeitspaket P5, Lastenheft §3.3).
 *
 * Geprüft wird, was an der Route hängt: der Pfad, auf den
 * `fetchStatsHistory()` im Frontend zeigt, die Schranke `canView` (wer den
 * Server sehen darf, sieht auch seinen Verlauf), die Übergabe des Fensters und
 * das Envelope-Format. Was der Dienst rechnet, prüft `service.test.ts`.
 */

import { type ServerStatsHistoryDto } from '@palantir/contracts';
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

async function buildApp(): Promise<{ app: FastifyInstance; fenster: number[] }> {
  const fenster: number[] = [];

  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
    getStatsHistory: async (
      serverId: string,
      windowMinutes: number,
    ): Promise<ServerStatsHistoryDto> => {
      fenster.push(windowMinutes);

      return {
        serverId,
        windowMinutes,
        intervalSeconds: 60,
        samples: [
          {
            cpuPercent: 42.5,
            ramUsedMb: 512,
            diskUsedMb: null,
            pingMs: 12,
            playersOnline: 3,
            playersMax: 20,
            networkRxBytes: 5_000,
            networkTxBytes: 6_000,
            updatedAt: '2026-09-01T10:00:00.000Z',
          },
        ],
      };
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

  return { app, fenster };
}

let offen: FastifyInstance | null = null;

afterEach(async () => {
  await offen?.close();
  offen = null;
});

describe('GET /api/servers/:id/stats/history', () => {
  it('liefert den Verlauf im Envelope', async () => {
    const { app, fenster } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER_ID}/stats/history?windowMinutes=180`,
      headers: { 'x-test-actor': 'besitzer' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(fenster).toEqual([180]);
    expect(body.data).toMatchObject({ serverId: SERVER_ID, intervalSeconds: 60 });
    expect(body.data.samples).toHaveLength(1);
  });

  it('nimmt ohne Angabe ein Fenster von 60 Minuten', async () => {
    const { app, fenster } = await buildApp();
    offen = app;

    await app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER_ID}/stats/history`,
      headers: { 'x-test-actor': 'besitzer' },
    });

    expect(fenster).toEqual([60]);
  });

  it('lehnt ein unsinniges Fenster ab', async () => {
    const { app, fenster } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER_ID}/stats/history?windowMinutes=-5`,
      headers: { 'x-test-actor': 'besitzer' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(fenster).toEqual([]);
  });

  it('meldet einen fremden Server als nicht gefunden', async () => {
    const { app, fenster } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER_ID}/stats/history`,
      headers: { 'x-test-actor': 'fremd' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SERVER_NOT_FOUND');
    expect(fenster).toEqual([]);
  });
});
