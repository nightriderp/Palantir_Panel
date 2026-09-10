/**
 * Serverliste mit Besitzer-Filter (Fundpunkt 138).
 *
 * Die Nutzerverwaltung fragte „Welche Server hat dieses Konto?", indem sie die
 * **Gesamtliste** holte und im Browser nach `ownerId` filterte. Zwei Folgen:
 * Alle DTOs der Instanz wanderten für eine Handvoll Server über die Leitung,
 * und mitverwaltete Server (Mitgliedschaft ohne Besitz) ließen sich gar nicht
 * zeigen.
 *
 * Geprüft wird deshalb an der Route: dass `userId` die Liste auf dieses eine
 * Konto einschränkt (samt seiner Mitgliedschaften), dass die Abfrage dafür
 * wirklich am Datenbestand gestellt wird statt hinterher zu filtern, und dass
 * der Filter ohne `server.view.any` mit einem benannten Fehlercode abgelehnt
 * wird – nicht stillschweigend übergangen.
 */

import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { ALLE_GAME_TYPE_DEFINITIONS, createGameRegistry } from './game-registry.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerOrchestrationService } from './service.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ALEX_ID = '22222222-2222-4222-8222-222222222222';
const BEA_ID = '33333333-3333-4333-8333-333333333333';

function serverRecord(overrides: Partial<ServerRecord> & Pick<ServerRecord, 'id'>): ServerRecord {
  return {
    ownerId: ALEX_ID,
    ownerDisplayName: 'Alex',
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
    ...overrides,
  };
}

/** Alex besitzt „Welt", ist bei „Bea-Welt" nur Mitglied; Bea besitzt Letztere. */
const ALEX_EIGEN = serverRecord({
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Welt',
  subdomain: 'welt',
});
const BEA_EIGEN = serverRecord({
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Bea-Welt',
  subdomain: 'bea-welt',
  ownerId: BEA_ID,
  ownerDisplayName: 'Bea',
});

const actors: Record<string, PermissionActor> = {
  admin: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.view.any'] }],
  }),
  alex: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own'] }],
  }),
};

const viewerIds: Record<string, string> = { admin: ADMIN_ID, alex: ALEX_ID };

/**
 * Datenbestand im Speicher mit derselben Schnittstelle wie das Repository.
 *
 * `listByOwnerOrMembership` und `listAll` sind `vi.fn()`, damit sich prüfen
 * lässt, **welche** Abfrage die Route stellt – der Kern des Fundpunkts ist ja,
 * dass nicht mehr alles geholt und danach gefiltert wird.
 */
function fakeRepository() {
  const memberships = new Map<string, readonly string[]>([[ALEX_ID, [BEA_EIGEN.id]]]);

  const mitgliederVon = (serverId: string) =>
    [...memberships]
      .filter(([, serverIds]) => serverIds.includes(serverId))
      .map(([userId]) => ({
        userId,
        displayName: 'Alex',
        level: 'viewer' as const,
        addedAt: '2026-08-30T09:30:00.000Z',
      }));

  return {
    listMembers: async (serverId: string) => mitgliederVon(serverId),
    // Sammelabfrage der Liste (Fundpunkt 231) - dieselbe Auskunft, eine Runde.
    listMembersOf: async (serverIds: readonly string[]) =>
      new Map(serverIds.map((id) => [id, mitgliederVon(id)])),
    listPinnedServerIds: async () => new Set<string>(),
    listAll: vi.fn(async () => [ALEX_EIGEN, BEA_EIGEN] as readonly ServerRecord[]),
    listByOwnerOrMembership: vi.fn(async (userId: string) => {
      const eigene = [ALEX_EIGEN, BEA_EIGEN].filter((server) => server.ownerId === userId);
      const mitverwaltet = [ALEX_EIGEN, BEA_EIGEN].filter(
        (server) =>
          server.ownerId !== userId && (memberships.get(userId) ?? []).includes(server.id),
      );

      return [...eigene, ...mitverwaltet] as readonly ServerRecord[];
    }),
  };
}

function buildApp(repository: ReturnType<typeof fakeRepository>): FastifyInstance {
  const service = {
    requireServer: async () => ALEX_EIGEN,
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
    request.viewerUserId = typeof header === 'string' ? (viewerIds[header] ?? null) : null;
  });

  registerServerRoutes(app, {
    service,
    repository: repository as unknown as ServerRepository,
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

  return app;
}

async function call(app: FastifyInstance, url: string, actor?: string) {
  const request: InjectOptions = {
    method: 'GET',
    url,
    headers: actor ? { 'x-test-actor': actor } : {},
  };

  return await app.inject(request);
}

function namen(response: Awaited<ReturnType<typeof call>>): string[] {
  return response.json<{ data: { name: string }[] }>().data.map((server) => server.name);
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe('GET /api/servers – Filter nach Konto (Fundpunkt 138)', () => {
  it('liefert mit dem Recht nur die Server des gefragten Kontos', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, `/api/servers?userId=${BEA_ID}`, 'admin');

    expect(response.statusCode).toBe(200);
    expect(namen(response)).toEqual(['Bea-Welt']);
  });

  it('zählt mitverwaltete Server zum Konto', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, `/api/servers?userId=${ALEX_ID}`, 'admin');

    expect(namen(response)).toEqual(['Welt', 'Bea-Welt']);
  });

  it('stellt die Abfrage am Datenbestand statt die Gesamtliste zu holen', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    await call(app, `/api/servers?userId=${BEA_ID}`, 'admin');

    expect(repository.listByOwnerOrMembership).toHaveBeenCalledWith(BEA_ID);
    expect(repository.listAll).not.toHaveBeenCalled();
  });

  it('lehnt den Filter ohne `server.view.any` mit einem Fehlercode ab', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, `/api/servers?userId=${BEA_ID}`, 'alex');

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
    expect(repository.listByOwnerOrMembership).not.toHaveBeenCalled();
  });

  it('lehnt den Filter auch für das eigene Konto ab, statt ihn zu übergehen', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, `/api/servers?userId=${ALEX_ID}`, 'alex');

    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
  });

  it('weist eine unbrauchbare Konto-Angabe ab', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, '/api/servers?userId=keine-uuid', 'admin');

    expect(response.statusCode).toBe(400);
  });

  it('lässt die Liste ohne Filter unverändert', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const alle = await call(app, '/api/servers', 'admin');
    const eigene = await call(app, '/api/servers', 'alex');

    expect(namen(alle)).toEqual(['Welt', 'Bea-Welt']);
    expect(namen(eigene)).toEqual(['Welt', 'Bea-Welt']);
    expect(repository.listAll).toHaveBeenCalledTimes(1);
    expect(repository.listByOwnerOrMembership).toHaveBeenCalledWith(ALEX_ID);
  });

  it('verlangt eine Anmeldung', async () => {
    const repository = fakeRepository();
    app = buildApp(repository);
    await app.ready();

    const response = await call(app, `/api/servers?userId=${BEA_ID}`);

    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });
});
