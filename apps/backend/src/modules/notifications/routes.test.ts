import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { registerNotificationRoutes } from './routes.js';
import { createNotificationService, type NotificationService } from './service.js';
import {
  adminActor,
  fakeDirectory,
  fakeRepository,
  plainActor,
  recordingTransport,
  serverEvent,
  testChannel,
  testId,
  testRule,
  type FakeRepository,
} from './test-doubles.js';

const ADMIN_ID = testId('a');
const NUTZER_ID = testId('b');
const FREMDER_ID = testId('c');

/**
 * Fastify-Instanz mit den Benachrichtigungs-Routen.
 *
 * `x-test-actor` steht für die Sitzungsauflösung aus B1 (wie im Routen-Test von
 * B5): Sie bestimmt Rechte **und** Konto-Id – die Inbox braucht die Identität,
 * die Verwaltung die Permission.
 */
async function buildTestApp(seed?: {
  repository?: FakeRepository;
}): Promise<{ app: FastifyInstance; notifications: NotificationService; repository: FakeRepository }> {
  const repository = seed?.repository ?? fakeRepository();
  const notifications = createNotificationService({
    repository,
    directory: fakeDirectory({ activeUserIds: [ADMIN_ID, NUTZER_ID, FREMDER_ID] }),
    transport: recordingTransport(),
    jobs: (job) => {
      void job();
    },
    now: () => new Date('2026-08-26T12:00:00.000Z'),
  });

  const rollen: Record<string, { actor: PermissionActor; userId: string }> = {
    admin: { actor: adminActor(), userId: ADMIN_ID },
    nutzer: { actor: plainActor(), userId: NUTZER_ID },
    fremder: { actor: plainActor(), userId: FREMDER_ID },
  };

  function rolleAus(request: { headers: Record<string, unknown> }) {
    const header = request.headers['x-test-actor'];

    return typeof header === 'string' ? (rollen[header] ?? null) : null;
  }

  const app = Fastify({ logger: false });

  registerRbac(app, { resolveActor: (request) => rolleAus(request)?.actor ?? null });

  await app.register(
    registerNotificationRoutes({
      notifications,
      resolveUserId: (request) => rolleAus(request)?.userId ?? null,
    }),
  );

  await app.ready();

  return { app, notifications, repository };
}

async function anfrage(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

describe('Envelope und Statuscodes (Pflichtenheft §5.1)', () => {
  it('antwortet auf die Inbox ohne Anmeldung mit AUTH_REQUIRED', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', '/notifications', null);

    expect(antwort.statusCode).toBe(401);
    expect(antwort.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'AUTH_REQUIRED', message: expect.any(String) },
    });
  });

  it('sperrt die Verwaltung ohne notification.manage', async () => {
    const { app } = await buildTestApp();

    for (const url of [
      '/admin/notification-channels',
      '/admin/notification-rules',
      '/admin/announcements',
      '/admin/notification-deliveries',
    ]) {
      const antwort = await anfrage(app, 'GET', url, 'nutzer');

      expect(antwort.statusCode, url).toBe(403);
      expect(antwort.json().error.code, url).toBe('PERMISSION_DENIED');
    }
  });

  it('liefert Erfolge im Envelope aus', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'GET', '/admin/notification-channels', 'admin');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ success: true, data: [], error: null });
  });

  it('meldet ungültige Eingaben als VALIDATION_FAILED', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'POST', '/admin/notification-rules', 'admin', {
      event: 'server.statsUpdated',
      recipientScope: 'resourceOwner',
    });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('meldet eine ungültige Id als VALIDATION_FAILED statt als Serverfehler', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'DELETE', '/notifications/keine-uuid', 'nutzer');

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('Kanäle und Regeln über die Admin-Oberfläche', () => {
  it('legt einen Kanal mit 201 an und liefert kein Geheimnis aus', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'POST', '/admin/notification-channels', 'admin', {
      name: 'Systemkanal',
      target: { webhookUrl: 'https://discord.com/api/webhooks/123456/streng-geheim' },
    });

    expect(antwort.statusCode).toBe(201);
    expect(antwort.body).not.toContain('streng-geheim');
    expect(antwort.json().data.target.hint).toBe('discord.com/…/heim');
  });

  it('lehnt einen doppelten Kanalnamen mit 409 ab', async () => {
    const { app } = await buildTestApp({
      repository: fakeRepository({ channels: [testChannel({ name: 'Systemkanal' })] }),
    });

    const antwort = await anfrage(app, 'POST', '/admin/notification-channels', 'admin', {
      name: 'Systemkanal',
    });

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json().error.code).toBe('NOTIFICATION_CHANNEL_NAME_TAKEN');
  });

  it('legt eine Regel mit 201 an', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'POST', '/admin/notification-rules', 'admin', {
      event: 'backup.failed',
      recipientScope: 'resourceOwner',
    });

    expect(antwort.statusCode).toBe(201);
    expect(antwort.json().data).toMatchObject({
      event: 'backup.failed',
      channelId: null,
      inboxEnabled: true,
      severity: null,
    });
  });

  it('meldet einen unbekannten Kanal mit 404', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(
      app,
      'DELETE',
      `/admin/notification-channels/${testId('4')}`,
      'admin',
    );

    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('NOTIFICATION_CHANNEL_NOT_FOUND');
  });
});

describe('Inbox', () => {
  it('zeigt jedem nur seine eigenen Meldungen', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { app, notifications } = await buildTestApp({ repository });

    await notifications.publish(serverEvent('server.crashed', { ownerId: NUTZER_ID }));

    const eigene = await anfrage(app, 'GET', '/notifications', 'nutzer');
    const fremde = await anfrage(app, 'GET', '/notifications', 'fremder');

    expect(eigene.json().data.total).toBe(1);
    expect(fremde.json().data.total).toBe(0);
  });

  it('markiert Meldungen als gelesen', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { app, notifications } = await buildTestApp({ repository });

    await notifications.publish(serverEvent('server.crashed', { ownerId: NUTZER_ID }));

    const antwort = await anfrage(app, 'POST', '/notifications/read', 'nutzer', {});

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json().data).toEqual({ changed: 1 });
  });

  /** Eine fremde Meldung verhält sich wie eine nicht vorhandene. */
  it('lässt niemanden eine fremde Meldung löschen', async () => {
    const repository = fakeRepository({ rules: [testRule({ event: 'server.crashed' })] });
    const { app, notifications, repository: repo } = await buildTestApp({ repository });

    await notifications.publish(serverEvent('server.crashed', { ownerId: NUTZER_ID }));
    const id = repo.notifications[0]?.id ?? '';

    const antwort = await anfrage(app, 'DELETE', `/notifications/${id}`, 'fremder');

    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('NOTIFICATION_NOT_FOUND');
    expect(repo.notifications).toHaveLength(1);
  });
});

describe('Systemweite Ankündigungen', () => {
  it('veröffentlicht mit 201 und meldet die Reichweite', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'POST', '/admin/announcements', 'admin', {
      title: 'Wartung',
      body: 'Am Sonntag ab 02:00 Uhr.',
      severity: 'warning',
    });

    expect(antwort.statusCode).toBe(201);
    expect(antwort.json().data).toMatchObject({
      title: 'Wartung',
      severity: 'warning',
      recipientCount: 3,
    });
  });

  it('erreicht die Inbox jedes freigeschalteten Kontos', async () => {
    const { app } = await buildTestApp();

    await anfrage(app, 'POST', '/admin/announcements', 'admin', {
      title: 'Wartung',
      body: 'Am Sonntag ab 02:00 Uhr.',
    });

    const antwort = await anfrage(app, 'GET', '/notifications', 'nutzer');

    expect(antwort.json().data.entries[0]).toMatchObject({
      event: 'announcement.published',
      title: 'Wartung',
    });
  });

  it('lehnt eine Ankündigung ohne Titel ab', async () => {
    const { app } = await buildTestApp();

    const antwort = await anfrage(app, 'POST', '/admin/announcements', 'admin', {
      title: '   ',
      body: 'Text',
    });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
  });
});
