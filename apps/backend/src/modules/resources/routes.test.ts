/**
 * HTTP-Ebene der Nutzer-Kontingente (Gefundener Punkt 88).
 *
 * Geprüft wird, was an der Route hängt: der Guard `user.manage`, das
 * Envelope-Format aus Pflichtenheft §5.1, die Schema-Prüfung der Eingaben und –
 * besonders – dass die Fehlercodes des `ResourceService` (B4) als fachliche
 * Antwort ankommen statt als unerwarteter Fehler mit Status 500.
 *
 * Die Repositories sind schlichte Fakes wie in `service.test.ts` – ohne
 * laufende Datenbank (CLAUDE.md §4).
 */

import {
  NO_USER_RESOURCE_LIMITS,
  type ResourceQuotaDto,
  type UserResourceLimitDto,
  type UserResourceLimits,
  type UserResourceUsage,
} from '@palantir/contracts';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import type {
  HostNodeRecord,
  HostNodeRepository,
  ServerUsageRepository,
  UserResourceLimitRecord,
  UserResourceLimitRepository,
} from './ports.js';
import { registerResourceRoutes } from './routes.js';
import { createResourceService } from './service.js';

const USER_ID = 'a1e5b6c2-0000-4000-8000-000000000010';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';
const NODE_ID = 'a1e5b6c2-0000-4000-8000-000000000001';

const NODE: HostNodeRecord = {
  id: NODE_ID,
  name: 'homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online',
  totalResources: { ramMb: 32_768, cpuCores: 16, diskMb: 2_097_152 },
};

const actors: Record<string, PermissionActor> = {
  userAdmin: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['user.manage'] }],
  }),
  gast: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.create'] }],
  }),
};

const emptyUsage = {
  runningRamMb: 0,
  runningCpuCores: 0,
  allocatedDiskMb: 0,
  runningServers: 0,
  totalServers: 0,
} as const;

/** Fastify-Instanz mit den Kontingent-Routen und einem Fake-`ResourceService`. */
async function buildApp(options?: {
  limits?: UserResourceLimits;
  userExists?: boolean;
  userUsage?: Partial<UserResourceUsage>;
}): Promise<FastifyInstance> {
  const stored: { record: UserResourceLimitRecord | null } = {
    record:
      options?.userExists === false
        ? null
        : {
            userId: USER_ID,
            userDisplayName: 'Testnutzer',
            limits: options?.limits ?? NO_USER_RESOURCE_LIMITS,
            updatedAt: options?.limits ? new Date('2026-08-01T00:00:00.000Z') : null,
          },
  };

  const limits: UserResourceLimitRepository = {
    async findByUserId() {
      return stored.record;
    },
    async upsert(_userId, next) {
      if (!stored.record) {
        return null;
      }

      stored.record = { ...stored.record, limits: next, updatedAt: new Date() };

      return stored.record;
    },
    async remove() {
      if (stored.record) {
        stored.record = { ...stored.record, limits: NO_USER_RESOURCE_LIMITS, updatedAt: null };
      }
    },
  };

  const nodes: HostNodeRepository = {
    async findById() {
      return NODE;
    },
    async listAll() {
      return [NODE];
    },
  };

  const usage: ServerUsageRepository = {
    async usageForUser() {
      return { ...emptyUsage, ...options?.userUsage };
    },
    async usageForNode() {
      return { ...emptyUsage };
    },
  };

  const resourceLimits = createResourceService({
    limits,
    nodes,
    usage,
    thresholds: { nodePercent: 85, serverPercent: 90 },
  });

  const app = Fastify({ logger: false });

  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  /*
   * Die Konto-Id kommt im Betrieb aus der Sitzung (B1). Hier hängt sie am
   * selben Test-Kopf wie der Handelnde: kein Kopf, kein angemeldetes Konto.
   */
  await app.register(
    registerResourceRoutes({
      resourceLimits,
      resolveUserId: (request) =>
        typeof request.headers['x-test-actor'] === 'string' ? USER_ID : null,
    }),
  );
  await app.ready();

  return app;
}

async function call(
  app: FastifyInstance,
  method: 'GET' | 'PUT' | 'DELETE',
  url: string,
  options: { actor?: string; payload?: Record<string, unknown> } = {},
) {
  const request: InjectOptions = {
    method,
    url,
    headers: options.actor ? { 'x-test-actor': options.actor } : {},
  };

  if (options.payload !== undefined) {
    request.payload = options.payload;
  }

  return await app.inject(request);
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe('GET /me/resource-quota', () => {
  it('liefert je Ressource Limit, Belegung und Rest im Envelope-Format', async () => {
    app = await buildApp({
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: 51_200, maxConcurrentServers: 2 },
      userUsage: {
        runningRamMb: 2048,
        runningCpuCores: 1,
        allocatedDiskMb: 20_480,
        runningServers: 1,
        totalServers: 3,
      },
    });

    const response = await call(app, 'GET', '/me/resource-quota', { actor: 'gast' });
    const body = response.json<{ success: boolean; data: ResourceQuotaDto; error: null }>();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data.userId).toBe(USER_ID);
    expect(body.data.ram).toEqual({
      resource: 'ram',
      unit: 'mb',
      limit: 8192,
      used: 2048,
      remaining: 6144,
    });
    expect(body.data.cpu.remaining).toBe(3);
    expect(body.data.disk.remaining).toBe(30_720);
    expect(body.data.servers.remaining).toBe(1);
    // Eigenes Kontingent: sehen ja, ändern nur mit `user.manage`.
    expect(body.data.permissions).toEqual({ canView: true, canEdit: false });
  });

  it('liefert ohne gesetztes Limit null als Limit und Rest', async () => {
    app = await buildApp({ userUsage: { runningRamMb: 1024 } });

    const response = await call(app, 'GET', '/me/resource-quota', { actor: 'gast' });
    const body = response.json<{ data: ResourceQuotaDto }>();

    expect(response.statusCode).toBe(200);
    expect(body.data.ram.limit).toBeNull();
    expect(body.data.ram.remaining).toBeNull();
    expect(body.data.ram.used).toBe(1024);
    expect(body.data.updatedAt).toBeNull();
  });

  it('antwortet ohne Sitzung mit AUTH_REQUIRED', async () => {
    app = await buildApp({});

    const response = await call(app, 'GET', '/me/resource-quota');

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });
});

describe('GET /admin/users/:userId/limits', () => {
  it('liefert den DTO im Envelope-Format inkl. permissions-Objekt', async () => {
    app = await buildApp({
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: null, maxConcurrentServers: 2 },
    });

    const response = await call(app, 'GET', `/admin/users/${USER_ID}/limits`, {
      actor: 'userAdmin',
    });
    const body = response.json<{ success: boolean; data: UserResourceLimitDto; error: null }>();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe(USER_ID);
    expect(body.data.limits.maxRamMb).toBe(8192);
    expect(body.data.permissions).toEqual({ canView: true, canEdit: true });
  });

  it('lehnt ohne user.manage mit PERMISSION_DENIED ab', async () => {
    app = await buildApp({});

    const response = await call(app, 'GET', `/admin/users/${USER_ID}/limits`, { actor: 'gast' });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
  });

  it('meldet ein unbekanntes Konto mit USER_NOT_FOUND', async () => {
    app = await buildApp({ userExists: false });

    const response = await call(app, 'GET', `/admin/users/${UNKNOWN_ID}/limits`, {
      actor: 'userAdmin',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('USER_NOT_FOUND');
  });
});

describe('PUT /admin/users/:userId/limits', () => {
  it('setzt ein Teil-Update und lässt die übrigen Felder stehen', async () => {
    app = await buildApp({
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: 51_200, maxConcurrentServers: 2 },
    });

    const response = await call(app, 'PUT', `/admin/users/${USER_ID}/limits`, {
      actor: 'userAdmin',
      payload: { maxRamMb: 16_384 },
    });
    const body = response.json<{ success: boolean; data: UserResourceLimitDto }>();

    expect(response.statusCode).toBe(200);
    expect(body.data.limits).toEqual({
      maxRamMb: 16_384,
      maxCpuCores: 4,
      maxDiskMb: 51_200,
      maxConcurrentServers: 2,
    });
  });

  it('hebt eine einzelne Grenze über ausdrückliches null auf', async () => {
    app = await buildApp({
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: 51_200, maxConcurrentServers: 2 },
    });

    const response = await call(app, 'PUT', `/admin/users/${USER_ID}/limits`, {
      actor: 'userAdmin',
      payload: { maxCpuCores: null },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: UserResourceLimitDto }>().data.limits.maxCpuCores).toBeNull();
  });

  it('lehnt einen negativen Wert mit VALIDATION_FAILED ab', async () => {
    app = await buildApp({});

    const response = await call(app, 'PUT', `/admin/users/${USER_ID}/limits`, {
      actor: 'userAdmin',
      payload: { maxRamMb: -1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });

  it('lehnt einen leeren Körper mit VALIDATION_FAILED ab', async () => {
    app = await buildApp({});

    const response = await call(app, 'PUT', `/admin/users/${USER_ID}/limits`, {
      actor: 'userAdmin',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });

  it('lehnt ohne user.manage mit PERMISSION_DENIED ab', async () => {
    app = await buildApp({});

    const response = await call(app, 'PUT', `/admin/users/${USER_ID}/limits`, {
      actor: 'gast',
      payload: { maxRamMb: 1024 },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
  });
});

describe('DELETE /admin/users/:userId/limits', () => {
  it('hebt das gesamte Kontingent auf', async () => {
    app = await buildApp({
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: 51_200, maxConcurrentServers: 2 },
    });

    const response = await call(app, 'DELETE', `/admin/users/${USER_ID}/limits`, {
      actor: 'userAdmin',
    });
    const body = response.json<{ data: UserResourceLimitDto }>();

    expect(response.statusCode).toBe(200);
    expect(body.data.limits).toEqual(NO_USER_RESOURCE_LIMITS);
    expect(body.data.updatedAt).toBeNull();
  });

  it('lehnt ohne user.manage mit PERMISSION_DENIED ab', async () => {
    app = await buildApp({});

    const response = await call(app, 'DELETE', `/admin/users/${USER_ID}/limits`, { actor: 'gast' });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
  });
});
