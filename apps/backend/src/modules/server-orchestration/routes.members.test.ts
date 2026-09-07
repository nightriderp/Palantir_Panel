/**
 * HTTP-Ebene der Mitgliederverwaltung (Lastenheft §3.3, Fundpunkt 132).
 *
 * Geprüft wird, was an der Route hängt und nicht im Dienst: die Pfade, auf die
 * das Frontend zeigt (`lib/api/servers.ts`, `MembersPanel.tsx`), der Vertrag
 * `ServerMemberDto` inklusive `canEdit`, die Antwortform von `PUT` (ein
 * Mitglied, nicht die Liste) und `DELETE` (`null`) sowie die Trennung „Lesen mit
 * `canView`, Ändern mit `canManageMembers`" (orchestration-core-11).
 */

import { type ServerMemberDto, type ServerMemberLevel } from '@palantir/contracts';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { createGameRegistry } from './game-registry.js';
import { type ServerMemberRecord, type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerScheduleService } from './schedules.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const FREMD_ID = '33333333-3333-4333-8333-333333333333';
/** Mitglied der Stufe `manager`: darf den Server sehen, aber nicht freigeben. */
const MANAGER_ID = '55555555-5555-4555-8555-555555555555';
/** Konto, das der Besitzer im Test neu freigibt. */
const NEU_ID = '66666666-6666-4666-8666-666666666666';

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

const MANAGER: ServerMemberRecord = {
  userId: MANAGER_ID,
  displayName: 'Mitverwalter',
  level: 'manager',
  addedAt: '2026-08-31T08:00:00.000Z',
};

/** Konto-Id je Test-Akteur; entscheidet über Besitz und Mitgliedschaft. */
const viewerIds: Record<string, string> = {
  besitzer: OWNER_ID,
  manager: MANAGER_ID,
  fremd: FREMD_ID,
};

const actors: Record<string, PermissionActor> = {
  besitzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  // Mitglied der Stufe `manager`: `server.manage.own` reicht für Einstellungen
  // und Dateien, `canManageMembers` bleibt beim Besitzer.
  manager: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  fremd: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
};

/** Mitschrift dessen, was die Routen am Repository aufrufen. */
interface Aufrufe {
  upsert: { userId: string; level: ServerMemberLevel }[];
  remove: string[];
}

async function buildApp(): Promise<{ app: FastifyInstance; aufrufe: Aufrufe }> {
  const aufrufe: Aufrufe = { upsert: [], remove: [] };
  const mitglieder = new Map<string, ServerMemberRecord>([[MANAGER_ID, MANAGER]]);

  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
  } as unknown as ServerOrchestrationService;

  const repository = {
    listMembers: async () => [...mitglieder.values()],
    upsertMember: async (_serverId: string, userId: string, level: ServerMemberLevel) => {
      aufrufe.upsert.push({ userId, level });
      mitglieder.set(userId, {
        userId,
        displayName:
          userId === NEU_ID ? 'Neues Mitglied' : (mitglieder.get(userId)?.displayName ?? ''),
        level,
        addedAt: '2026-09-01T12:00:00.000Z',
      });
    },
    removeMember: async (_serverId: string, userId: string) => {
      aufrufe.remove.push(userId);
      mitglieder.delete(userId);
    },
    listPinnedServerIds: async () => new Set<string>(),
  } as unknown as ServerRepository;

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
    repository,
    registry: createGameRegistry(1),
    baseDomain: 'example.tld',
    // Aufgaben und Weltdaten-Uploads stehen in eigenen Testdateien.
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
    } as unknown as ServerScheduleService,
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

async function call(
  app: FastifyInstance,
  method: 'GET' | 'PUT' | 'DELETE',
  url: string,
  options: { actor?: string; payload?: unknown } = {},
) {
  const inject: InjectOptions = {
    method,
    url,
    headers: { 'x-test-actor': options.actor ?? 'besitzer' },
  };

  if (options.payload !== undefined) {
    inject.payload = options.payload as InjectOptions['payload'];
  }

  return app.inject(inject);
}

/**
 * Prüft eine Antwort gegen den Vertrag `ServerMemberDto`.
 *
 * `@palantir/validation` führt (noch) kein Schema für das DTO – geprüft wird
 * deshalb Feld für Feld, inklusive `canEdit`.
 */
function erwarteMitgliedsDto(data: unknown, erwartet: ServerMemberDto): void {
  expect(data).toEqual(erwartet);
  expect(typeof (data as ServerMemberDto).canEdit).toBe('boolean');
}

let offen: FastifyInstance | null = null;

afterEach(async () => {
  await offen?.close();
  offen = null;
});

describe('Routen der Mitgliederverwaltung', () => {
  it('liefert die Mitgliederliste als ServerMemberDto mit canEdit für den Besitzer', async () => {
    const { app } = await buildApp();
    offen = app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/members`);
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    erwarteMitgliedsDto(body.data[0], {
      userId: MANAGER_ID,
      displayName: 'Mitverwalter',
      level: 'manager',
      addedAt: '2026-08-31T08:00:00.000Z',
      canEdit: true,
    });
  });

  it('lässt ein Mitglied ohne canManageMembers lesen, aber mit canEdit false', async () => {
    const { app } = await buildApp();
    offen = app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/members`, {
      actor: 'manager',
    });

    expect(response.statusCode).toBe(200);
    erwarteMitgliedsDto(response.json().data[0], {
      userId: MANAGER_ID,
      displayName: 'Mitverwalter',
      level: 'manager',
      addedAt: '2026-08-31T08:00:00.000Z',
      canEdit: false,
    });
  });

  it('meldet einen Server, den der Aufrufer nicht sehen darf, als nicht gefunden', async () => {
    const { app } = await buildApp();
    offen = app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/members`, {
      actor: 'fremd',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SERVER_NOT_FOUND');
  });

  it('gibt beim Freigeben genau das betroffene Mitglied zurück, nicht die Liste', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'PUT', `/api/servers/${SERVER_ID}/members`, {
      payload: { userId: NEU_ID, level: 'operator' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(body.data)).toBe(false);
    erwarteMitgliedsDto(body.data, {
      userId: NEU_ID,
      displayName: 'Neues Mitglied',
      level: 'operator',
      addedAt: '2026-09-01T12:00:00.000Z',
      canEdit: true,
    });
    expect(aufrufe.upsert).toEqual([{ userId: NEU_ID, level: 'operator' }]);
  });

  it('verweigert einem Mitglied ohne canManageMembers das Freigeben', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'PUT', `/api/servers/${SERVER_ID}/members`, {
      actor: 'manager',
      payload: { userId: NEU_ID, level: 'operator' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe.upsert).toHaveLength(0);
  });

  it('trägt den Besitzer nicht als Mitglied ein', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'PUT', `/api/servers/${SERVER_ID}/members`, {
      payload: { userId: OWNER_ID, level: 'manager' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SERVER_STATE_CONFLICT');
    expect(aufrufe.upsert).toHaveLength(0);
  });

  it('entfernt ein Mitglied und antwortet mit null', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'DELETE', `/api/servers/${SERVER_ID}/members/${MANAGER_ID}`);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeNull();
    expect(aufrufe.remove).toEqual([MANAGER_ID]);

    const danach = await call(app, 'GET', `/api/servers/${SERVER_ID}/members`);

    expect(danach.json().data).toEqual([]);
  });

  it('verweigert einem Mitglied ohne canManageMembers das Entfernen', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'DELETE', `/api/servers/${SERVER_ID}/members/${MANAGER_ID}`, {
      actor: 'manager',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe.remove).toHaveLength(0);
  });
});
