import { type Permission } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { type PermissionActor, buildPermissionActor, registerRbac } from '../rbac/index.js';
import { registerBackupRoutes } from './routes.js';
import { createBackupScheduleService } from './schedules.js';
import { type BackupService, createBackupService } from './service.js';
import {
  fakeAgent,
  fakeServerDirectory,
  fakeUserDirectory,
  inMemoryBackupRepository,
  recordingEventPublisher,
  testId,
  testServer,
} from './test-doubles.js';

const BESITZER_ID = testId('2');
const SERVER = testServer({ ownerId: BESITZER_ID });

function actorMit(...permissions: Permission[]): PermissionActor {
  return buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: permissions }] });
}

/**
 * Fastify-Instanz mit den Backup-Routen.
 *
 * `x-test-actor` steht für die Sitzungsauflösung aus B1 (analog zum Guard-Test
 * in B2): Sie bestimmt Rechte **und** Konto-Id, weil die `.own`-Prüfung beides
 * braucht.
 */
async function buildTestApp(): Promise<{ app: FastifyInstance; backups: BackupService }> {
  const offeneJobs: (() => Promise<void>)[] = [];
  const repository = inMemoryBackupRepository();
  const servers = fakeServerDirectory([SERVER]);

  const backups = createBackupService({
    repository,
    servers,
    users: fakeUserDirectory({ [BESITZER_ID]: 'Alex' }),
    agent: fakeAgent(),
    events: recordingEventPublisher(),
    runJob: (job) => {
      offeneJobs.push(job);
    },
  });

  const schedules = createBackupScheduleService({ repository, servers, backups });

  const rollen: Record<string, { actor: PermissionActor; userId: string }> = {
    besitzer: { actor: actorMit('backup.manage.own'), userId: BESITZER_ID },
    fremder: { actor: actorMit('backup.manage.own'), userId: testId('7') },
    admin: { actor: actorMit('backup.manage.any'), userId: testId('8') },
    gast: { actor: actorMit(), userId: testId('9') },
  };

  function rolleAus(request: { headers: Record<string, unknown> }) {
    const header = request.headers['x-test-actor'];

    return typeof header === 'string' ? (rollen[header] ?? null) : null;
  }

  const app = Fastify({ logger: false });

  registerRbac(app, { resolveActor: (request) => rolleAus(request)?.actor ?? null });

  await app.register(
    registerBackupRoutes({
      backups,
      schedules,
      resolveUserId: (request) => rolleAus(request)?.userId ?? null,
    }),
  );

  await app.ready();

  return { app, backups };
}

async function anfrage(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  actor: string | null,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    ...(actor === null ? {} : { headers: { 'x-test-actor': actor } }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

describe('Backup-Routen – Envelope und Statuscodes (Pflichtenheft §5.1)', () => {
  it('antwortet ohne Anmeldung mit AUTH_REQUIRED', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', `/servers/${SERVER.id}/backups`, null);

    expect(antwort.statusCode).toBe(401);
    expect(antwort.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'AUTH_REQUIRED', message: expect.any(String) },
    });
  });

  it('antwortet ohne Backup-Recht mit PERMISSION_DENIED', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', `/servers/${SERVER.id}/backups`, 'gast');

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('liefert die Backupliste eines Servers im Erfolgs-Envelope', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', `/servers/${SERVER.id}/backups`, 'besitzer');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ success: true, data: [], error: null });
  });

  it('nimmt ein manuelles Backup mit 202 an, weil der Lauf noch nicht fertig ist', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'POST', `/servers/${SERVER.id}/backups`, 'besitzer', {});

    expect(antwort.statusCode).toBe(202);
    expect(antwort.json().data.status).toBe('pending');
    expect(antwort.json().data.type).toBe('manual');
  });

  it('kennzeichnet den Datenexport als solchen', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'POST', `/servers/${SERVER.id}/export`, 'besitzer', {});

    expect(antwort.statusCode).toBe(202);
    expect(antwort.json().data.isExport).toBe(true);
  });

  it('meldet einen fremden Server als SERVER_NOT_FOUND, nicht als PERMISSION_DENIED', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', `/servers/${SERVER.id}/backups`, 'fremder');

    // Sonst verriete die Antwort die Existenz fremder Server.
    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('SERVER_NOT_FOUND');
  });

  it('lehnt eine ungültige Id als VALIDATION_FAILED ab, nicht mit einem 500er', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', '/servers/keine-uuid/backups', 'besitzer');

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('meldet ein unbekanntes Backup mit BACKUP_NOT_FOUND', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', `/backups/${testId('5')}`, 'besitzer');

    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('BACKUP_NOT_FOUND');
  });
});

describe('Backup-Zeitplan über die API', () => {
  it('speichert einen gültigen Zeitplan', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'PUT', `/servers/${SERVER.id}/backup-schedule`, 'besitzer', {
      enabled: true,
      cronExpression: '0 4 * * *',
    });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json().data.cronExpression).toBe('0 4 * * *');
    expect(antwort.json().data.nextRunAt).toEqual(expect.any(String));
  });

  it('lehnt einen formal falschen Ausdruck schon im Schema ab', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'PUT', `/servers/${SERVER.id}/backup-schedule`, 'besitzer', {
      enabled: true,
      cronExpression: 'täglich um vier',
    });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('lehnt einen formgerechten, aber unmöglichen Ausdruck mit SCHEDULE_INVALID_CRON ab', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'PUT', `/servers/${SERVER.id}/backup-schedule`, 'besitzer', {
      enabled: true,
      cronExpression: '0 99 * * *',
    });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('SCHEDULE_INVALID_CRON');
  });
});

describe('Globale Übersicht über die API (Lastenheft §3.7)', () => {
  it('bleibt für Nutzer ohne backup.manage.any gesperrt', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', '/admin/backups', 'besitzer');

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('liefert Summen und Speicherverbrauch für Admins', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', '/admin/backups', 'admin');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json().data).toMatchObject({
      totalCount: 0,
      totalSizeBytes: 0,
      perUser: [],
      perServer: [],
      permissions: { canManageAny: true },
    });
  });
});
