import { createHash } from 'node:crypto';
import { type Permission, fail, ok } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { type PermissionActor, buildPermissionActor, registerRbac } from '../rbac/index.js';
import { registerBackupRoutes } from './routes.js';
import { createBackupScheduleService } from './schedules.js';
import { type BackupService, createBackupService } from './service.js';
import {
  type FakeAgent,
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
async function buildTestApp(): Promise<{
  app: FastifyInstance;
  backups: BackupService;
  agent: FakeAgent;
  /** Führt die angestoßenen Backup-Läufe aus – im Betrieb tut das der Job-Runner. */
  laufeJobs: () => Promise<void>;
}> {
  const offeneJobs: (() => Promise<void>)[] = [];
  const repository = inMemoryBackupRepository();
  const servers = fakeServerDirectory([SERVER]);
  const agent = fakeAgent();

  const backups = createBackupService({
    repository,
    servers,
    users: fakeUserDirectory({ [BESITZER_ID]: 'Alex' }),
    agent,
    events: recordingEventPublisher(),
    runJob: (job) => {
      offeneJobs.push(job);
    },
  });

  async function laufeJobs(): Promise<void> {
    for (let job = offeneJobs.shift(); job !== undefined; job = offeneJobs.shift()) {
      await job();
    }
  }

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

  return { app, backups, agent, laufeJobs };
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

describe('Download und Löschen über HTTP (Lastenheft §3.3, Fundpunkt 120)', () => {
  const INHALT = Buffer.from('Palantir');

  /** Legt ein fertiges Backup mit passender Prüfsumme an und liefert seine Id. */
  async function fertigesBackup(harness: Awaited<ReturnType<typeof buildTestApp>>) {
    harness.agent.createResponse = ok({
      backupId: '00000000-0000-4000-8000-000000000000',
      storagePath: '/srv/palantir/backups/a.tar.zst',
      sizeBytes: INHALT.length,
      checksumSha256: createHash('sha256').update(INHALT).digest('hex'),
      containerStopped: false,
      startedAt: '2026-08-26T04:00:00.000Z',
      completedAt: '2026-08-26T04:01:00.000Z',
    });

    const angelegt = await anfrage(
      harness.app,
      'POST',
      `/servers/${SERVER.id}/backups`,
      'besitzer',
      {},
    );
    expect(angelegt.statusCode).toBe(202);
    await harness.laufeJobs();

    return angelegt.json().data.id as string;
  }

  function block(backupId: string, offset: number, text: string, eof: boolean) {
    return ok({
      backupId,
      offset,
      contentBase64: Buffer.from(text).toString('base64'),
      bytesRead: text.length,
      totalBytes: INHALT.length,
      eof,
    });
  }

  it('streamt das Archiv als Bytes mit Länge und Dateinamen', async () => {
    const harness = await buildTestApp();
    const backupId = await fertigesBackup(harness);
    harness.agent.downloadResponses = [
      block(backupId, 0, 'Palan', false),
      block(backupId, 5, 'tir', true),
    ];

    const antwort = await anfrage(harness.app, 'GET', `/backups/${backupId}/download`, 'besitzer');

    // Genau der Fall aus Fundpunkt 120: Ein AsyncGenerator als Payload endete
    // hier als 500, weil Fastify ihn nicht als Stream annimmt.
    expect(antwort.statusCode).toBe(200);
    expect(antwort.headers['content-type']).toBe('application/octet-stream');
    expect(antwort.headers['content-length']).toBe(String(INHALT.length));
    expect(antwort.headers['content-disposition']).toMatch(/^attachment; filename=".*\.tar\.zst"$/);
    expect(antwort.rawPayload.equals(INHALT)).toBe(true);
  });

  it('meldet einen Fehler vor dem ersten Block als Envelope statt als leeren 200', async () => {
    const harness = await buildTestApp();
    const backupId = await fertigesBackup(harness);
    harness.agent.downloadResponses = [
      fail('AGENT_NOT_CONNECTED', 'Der Agent der Node ist nicht verbunden.'),
    ];

    const antwort = await anfrage(harness.app, 'GET', `/backups/${backupId}/download`, 'besitzer');

    expect(antwort.statusCode).toBeGreaterThanOrEqual(400);
    expect(antwort.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'AGENT_NOT_CONNECTED', message: expect.any(String) },
    });
  });

  it('bricht die Verbindung ab, wenn ein späterer Block fehlt – kein stiller 200', async () => {
    const harness = await buildTestApp();
    const backupId = await fertigesBackup(harness);
    harness.agent.downloadResponses = [
      block(backupId, 0, 'Palan', false),
      fail('AGENT_COMMAND_FAILED', 'Verbindung zur Node verloren.'),
    ];

    // Die Kopfzeilen sind nach dem ersten Block raus – es gibt keinen zweiten
    // Antwortversuch mehr. Entweder scheitert die Anfrage sichtbar oder der
    // Körper bleibt unvollständig; ein vollständiger 200 wäre der Fehler.
    const ergebnis = await anfrage(
      harness.app,
      'GET',
      `/backups/${backupId}/download`,
      'besitzer',
    ).then(
      (antwort) => ({ antwort }),
      (error: unknown) => ({ error }),
    );

    if ('antwort' in ergebnis) {
      expect(ergebnis.antwort.rawPayload.equals(INHALT)).toBe(false);
    } else {
      expect(ergebnis.error).toBeDefined();
    }
  });

  it('weist den Download eines noch laufenden Backups mit BACKUP_NOT_READY ab', async () => {
    const harness = await buildTestApp();
    const angelegt = await anfrage(
      harness.app,
      'POST',
      `/servers/${SERVER.id}/backups`,
      'besitzer',
      {},
    );
    const backupId = angelegt.json().data.id as string;

    const antwort = await anfrage(harness.app, 'GET', `/backups/${backupId}/download`, 'besitzer');

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json().error.code).toBe('BACKUP_NOT_READY');
  });

  it('löscht ein fertiges Backup und meldet es danach als unbekannt', async () => {
    const harness = await buildTestApp();
    const backupId = await fertigesBackup(harness);

    const geloescht = await anfrage(harness.app, 'DELETE', `/backups/${backupId}`, 'besitzer');
    expect(geloescht.statusCode).toBe(200);
    expect(harness.agent.deletedStoragePaths).toEqual(['/srv/palantir/backups/a.tar.zst']);

    const danach = await anfrage(harness.app, 'GET', `/backups/${backupId}`, 'besitzer');
    expect(danach.statusCode).toBe(404);
    expect(danach.json().error.code).toBe('BACKUP_NOT_FOUND');
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

  it('lehnt einen nie zutreffenden Ausdruck mit SCHEDULE_UNSATISFIABLE ab (Audit bb-14)', async () => {
    const { app } = await buildTestApp();

    // Formal gültig, aber der 30. Februar kommt nie: Gespeichert wäre das ein
    // Zeitplan mit `enabled: true`, der niemals auslöst.
    const antwort = await anfrage(app, 'PUT', `/servers/${SERVER.id}/backup-schedule`, 'besitzer', {
      enabled: true,
      cronExpression: '0 4 30 2 *',
    });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('SCHEDULE_UNSATISFIABLE');
  });

  it('liefert den gespeicherten „sauberen Spielstand“ mit aus', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'PUT', `/servers/${SERVER.id}/backup-schedule`, 'besitzer', {
      enabled: true,
      cronExpression: '0 4 * * *',
      stopServer: true,
    });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json().data.stopServer).toBe(true);
  });
});

describe('Rolle mit ausschließlich backup.manage.any (Audit bb-12)', () => {
  /*
   * Eine Rolle „Backup-Verwalter“ mit nur `backup.manage.any` ist laut
   * Pflichtenheft §8 die stärkere Ausprägung desselben Rechts. Der Service
   * behandelt sie überall als Obermenge von `.own`, der Routen-Guard verlangte
   * aber exakt `.own` und wies sie mit 403 an der Tür ab – während
   * `/admin/backups` ihr dieselben Backups zeigte und deren `permissions`
   * `canDelete`/`canRestore` versprachen.
   */

  it('darf die Backups eines fremden Servers sehen', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', `/servers/${SERVER.id}/backups`, 'admin');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ success: true, data: [], error: null });
  });

  it('darf ein Backup anstoßen und danach abrufen', async () => {
    const { app } = await buildTestApp();

    const angelegt = await anfrage(app, 'POST', `/servers/${SERVER.id}/backups`, 'admin', {});

    expect(angelegt.statusCode).toBe(202);

    const einzeln = await anfrage(
      app,
      'GET',
      `/backups/${angelegt.json().data.id as string}`,
      'admin',
    );

    expect(einzeln.statusCode).toBe(200);
  });

  it('darf den Zeitplan eines fremden Servers lesen und setzen', async () => {
    const { app } = await buildTestApp();

    const gesetzt = await anfrage(app, 'PUT', `/servers/${SERVER.id}/backup-schedule`, 'admin', {
      enabled: true,
      cronExpression: '0 4 * * *',
    });

    expect(gesetzt.statusCode).toBe(200);

    const gelesen = await anfrage(app, 'GET', `/servers/${SERVER.id}/backup-schedule`, 'admin');

    expect(gelesen.statusCode).toBe(200);
    expect(gelesen.json().data.cronExpression).toBe('0 4 * * *');
  });

  it('darf die Backups eines fremden Kontos auflisten', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', `/users/${BESITZER_ID}/backups`, 'admin');

    expect(antwort.statusCode).toBe(200);
  });

  it('sperrt weiterhin, wer gar kein Backup-Recht hat', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', `/servers/${SERVER.id}/backup-schedule`, 'gast');

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json().error.code).toBe('PERMISSION_DENIED');
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
