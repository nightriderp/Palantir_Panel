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
  type UserResourceLimitDto,
  type UserResourceLimits,
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
      return { ...emptyUsage };
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

  await app.register(registerResourceRoutes({ resourceLimits }));
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
