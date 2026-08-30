/**
 * HTTP-Ebene der geplanten Aufgaben (Arbeitspaket P3, Lastenheft §3.3).
 *
 * Geprüft wird, was an der Route hängt und nicht im Dienst: die Pfade, auf die
 * das Frontend zeigt (`lib/api/servers.ts`, `TasksTab.tsx`), der Guard
 * `canManageSchedules`, das Envelope-Format (Pflichtenheft §5.1) und das
 * `permissions`-Objekt je Aufgabe. Der Dienst ist ein Stub – was er tut, prüft
 * `schedules.test.ts`.
 */

import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { ServerOrchestrationError } from './errors.js';
import { createGameRegistry } from './game-registry.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerScheduleRecord } from './schedule-repository.js';
import { type ServerScheduleService } from './schedules.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const SCHEDULE_ID = '55555555-5555-4555-8555-555555555555';
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

const RECORD: ServerScheduleRecord = {
  id: SCHEDULE_ID,
  serverId: SERVER_ID,
  name: 'Nächtlicher Neustart',
  action: 'restart',
  command: null,
  cronExpression: '0 4 * * *',
  timezone: 'Europe/Berlin',
  enabled: true,
  lastRunAt: null,
  lastRunResult: null,
  nextRunAt: new Date('2026-09-02T02:00:00.000Z'),
};

const EINGABE = {
  name: 'Nächtlicher Neustart',
  action: 'restart',
  command: null,
  cronExpression: '0 4 * * *',
  timezone: 'Europe/Berlin',
  enabled: true,
};

const actors: Record<string, PermissionActor> = {
  besitzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  // Sieht eigene Server, darf aber nichts verwalten – prüft den Guard.
  zuschauer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own'] }],
  }),
  fremd: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
};

/** Mitschrift dessen, was die Routen am Dienst aufrufen. */
interface Aufrufe {
  list: string[];
  create: { serverId: string; name: string }[];
  update: { serverId: string; scheduleId: string; enabled: boolean }[];
  remove: { serverId: string; scheduleId: string }[];
}

async function buildApp(options: { fehler?: ServerOrchestrationError } = {}): Promise<{
  app: FastifyInstance;
  aufrufe: Aufrufe;
}> {
  const aufrufe: Aufrufe = { list: [], create: [], update: [], remove: [] };

  function pruefeFehler(): void {
    if (options.fehler) throw options.fehler;
  }

  const schedules: ServerScheduleService = {
    list: async (serverId) => {
      pruefeFehler();
      aufrufe.list.push(serverId);

      return [RECORD];
    },
    create: async (serverId, input) => {
      pruefeFehler();
      aufrufe.create.push({ serverId, name: input.name });

      return RECORD;
    },
    update: async (serverId, scheduleId, input) => {
      pruefeFehler();
      aufrufe.update.push({ serverId, scheduleId, enabled: input.enabled });

      return { ...RECORD, enabled: input.enabled };
    },
    remove: async (serverId, scheduleId) => {
      pruefeFehler();
      aufrufe.remove.push({ serverId, scheduleId });
    },
    tick: async () => ({ executedScheduleIds: [], failedScheduleIds: [] }),
  };

  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
  } as unknown as ServerOrchestrationService;

  const repository = { listMembers: async () => [] } as unknown as ServerRepository;

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
    repository,
    registry: createGameRegistry(1),
    baseDomain: 'example.tld',
    schedules,
  });
  await app.ready();

  return { app, aufrufe };
}

async function call(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

let offen: FastifyInstance | null = null;

afterEach(async () => {
  await offen?.close();
  offen = null;
});

describe('Routen der geplanten Aufgaben', () => {
  it('liefert die Aufgabenliste im Envelope samt permissions-Objekt', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/schedules`);
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(aufrufe.list).toEqual([SERVER_ID]);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: SCHEDULE_ID,
      name: 'Nächtlicher Neustart',
      action: 'restart',
      timezone: 'Europe/Berlin',
      nextRunAt: '2026-09-02T02:00:00.000Z',
      permissions: { canEdit: true, canDelete: true, canToggle: true },
    });
  });

  it('legt eine Aufgabe an und antwortet mit 201', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'POST', `/api/servers/${SERVER_ID}/schedules`, {
      payload: EINGABE,
    });

    expect(response.statusCode).toBe(201);
    expect(aufrufe.create).toEqual([{ serverId: SERVER_ID, name: 'Nächtlicher Neustart' }]);
  });

  it('reicht das Pausieren als Änderung durch', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(
      app,
      'PATCH',
      `/api/servers/${SERVER_ID}/schedules/${SCHEDULE_ID}`,
      { payload: { ...EINGABE, enabled: false } },
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.enabled).toBe(false);
    expect(aufrufe.update).toEqual([
      { serverId: SERVER_ID, scheduleId: SCHEDULE_ID, enabled: false },
    ]);
  });

  it('löscht eine Aufgabe', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(
      app,
      'DELETE',
      `/api/servers/${SERVER_ID}/schedules/${SCHEDULE_ID}`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeNull();
    expect(aufrufe.remove).toEqual([{ serverId: SERVER_ID, scheduleId: SCHEDULE_ID }]);
  });

  it('weist ab, wer den Server nicht verwalten darf', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/schedules`, {
      actor: 'zuschauer',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe.list).toHaveLength(0);
  });

  it('meldet einen fremden Server als nicht gefunden', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/schedules`, {
      actor: 'fremd',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SERVER_NOT_FOUND');
    expect(aufrufe.list).toHaveLength(0);
  });

  it('gibt einen Fehler des Dienstes als benannten Code weiter', async () => {
    const { app } = await buildApp({
      fehler: new ServerOrchestrationError('SCHEDULE_NOT_FOUND'),
    });
    offen = app;

    const response = await call(
      app,
      'DELETE',
      `/api/servers/${SERVER_ID}/schedules/${SCHEDULE_ID}`,
    );

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SCHEDULE_NOT_FOUND');
  });

  it('lehnt eine unvollständige Eingabe ab, bevor der Dienst sie sieht', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;

    const response = await call(app, 'POST', `/api/servers/${SERVER_ID}/schedules`, {
      payload: { ...EINGABE, cronExpression: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(aufrufe.create).toHaveLength(0);
  });
});
