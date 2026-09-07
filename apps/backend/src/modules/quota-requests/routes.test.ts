/**
 * HTTP-Ebene der Kontingent-Anfragen (backend-admin-resources-14).
 *
 * Geprüft wird, was an den sechs Routen hängt und nicht im Service steht: die
 * Guards (`requireApproved()` für die eigenen Anfragen, `user.manage` für die
 * Bescheide), das Envelope-Format aus Pflichtenheft §5.1, die Schema-Prüfung
 * und – besonders – dass ein anonymer oder nicht freigeschalteter Aufruf als
 * benannter Fehlercode ankommt statt als 500 (backend-admin-resources-05,
 * security-matrix-06).
 *
 * Der Service ist ein Fake nach dem Muster von `resources/routes.test.ts` –
 * ohne laufende Datenbank (CLAUDE.md §4).
 */

import { type QuotaRequestDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, buildPermissionActor, registerRbac } from '../rbac/index.js';
import { QuotaRequestError } from './errors.js';
import { type QuotaRequestService } from './index.js';
import { registerQuotaRequestRoutes } from './routes.js';

const USER_ID = '11111111-1111-4111-8111-000000000001';
const ADMIN_ID = '11111111-1111-4111-8111-000000000002';
const REQUEST_ID = '22222222-2222-4222-8222-000000000001';

/**
 * Die drei Kontostände, auf die es hier ankommt.
 *
 * `gast` trägt ausschließlich die geschützte Systemrolle „Gast" – das frisch
 * registrierte, noch nicht freigeschaltete Konto aus Lastenheft §3.1.
 */
const actors: Record<string, PermissionActor> = {
  gast: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [], name: 'Gast' }] }),
  nutzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.create'], name: 'Nutzer' }],
  }),
  admin: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['user.manage'], name: 'Admin' }],
  }),
};

const dto: QuotaRequestDto = {
  id: REQUEST_ID,
  userId: USER_ID,
  userDisplayName: 'Antragsteller',
  requestedRamMb: 8192,
  requestedMaxConcurrentServers: null,
  reason: 'Der Server läuft mit 4 GB regelmäßig voll.',
  status: 'pending',
  decisionNote: null,
  decidedByDisplayName: null,
  decidedAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  permissions: { canDecide: false, canWithdraw: true },
};

/** Aufrufe, die den Service tatsächlich erreicht haben. */
let aufrufe: string[] = [];

function buildService(options: { fehler?: QuotaRequestError } = {}): QuotaRequestService {
  function pruefe<T>(name: string, ergebnis: T): Promise<T> {
    aufrufe.push(name);

    return options.fehler ? Promise.reject(options.fehler) : Promise.resolve(ergebnis);
  }

  return {
    create: () => pruefe('create', dto),
    listOwn: () => pruefe('listOwn', [dto]),
    list: () => pruefe('list', [dto]),
    approve: () => pruefe('approve', { ...dto, status: 'approved' as const }),
    reject: () => pruefe('reject', { ...dto, status: 'rejected' as const }),
    withdraw: () => pruefe('withdraw', undefined),
  };
}

/**
 * Fastify-Instanz mit den Routen und dem Fake-Service.
 *
 * Handelnder und Konto-Id kommen beide aus demselben Test-Kopf `x-test-actor` –
 * kein Kopf heißt „niemand angemeldet", genau wie ohne Sitzung im Betrieb.
 */
async function buildApp(options: { fehler?: QuotaRequestError } = {}): Promise<FastifyInstance> {
  aufrufe = [];

  const app = Fastify({ logger: false });

  // Wie im Betrieb: Der globale Handler übersetzt, was die Route selbst nicht
  // abfängt – hier die `ZodError` der Schema-Prüfung (Pflichtenheft §5.1).
  registerErrorHandler(app);

  registerRbac(app, {
    resolveActor: (request) => {
      const kopf = request.headers['x-test-actor'];

      return typeof kopf === 'string' ? (actors[kopf] ?? null) : null;
    },
  });

  await app.register(
    registerQuotaRequestRoutes({
      service: buildService(options),
      actorUserId: (request) => {
        const kopf = request.headers['x-test-actor'];

        if (typeof kopf !== 'string' || !(kopf in actors)) {
          return null;
        }

        return kopf === 'admin' ? ADMIN_ID : USER_ID;
      },
    }),
  );
  await app.ready();

  return app;
}

async function call(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'DELETE',
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

describe('Eigene Anfragen', () => {
  it('legt für ein freigeschaltetes Konto an und antwortet im Envelope-Format', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/quota-requests', {
      actor: 'nutzer',
      payload: { requestedRamMb: 8192, reason: 'Der Server läuft mit 4 GB regelmäßig voll.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: dto, error: null });
    expect(aufrufe).toEqual(['create']);
  });

  /*
   * backend-admin-resources-05: Vorher warf `requireUserId()` einen nackten
   * `Error`, und weil er vor `requireActor()` lief, endete der anonyme Aufruf
   * als INTERNAL_ERROR (500) statt als AUTH_REQUIRED (401).
   */
  it('antwortet anonym mit AUTH_REQUIRED (401), nicht mit 500', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/quota-requests', {
      payload: { requestedRamMb: 8192, reason: 'Der Server läuft mit 4 GB regelmäßig voll.' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'AUTH_REQUIRED', message: expect.any(String) },
    });
    expect(aufrufe).toEqual([]);
  });

  it('antwortet auch bei gültigem Body ohne Sitzung nicht mit INTERNAL_ERROR', async () => {
    app = await buildApp();

    for (const url of ['/quota-requests/mine', `/quota-requests/${REQUEST_ID}`]) {
      const response = await call(app, url === '/quota-requests/mine' ? 'GET' : 'DELETE', url);

      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
    }
  });

  /*
   * security-matrix-06: Ein Konto, das noch auf die Freischaltung wartet, soll
   * die Warteliste der Administratoren nicht mit Wünschen füllen können.
   */
  it('weist ein nicht freigeschaltetes Gast-Konto mit PERMISSION_DENIED (403) ab', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/quota-requests', {
      actor: 'gast',
      payload: { requestedRamMb: 8192, reason: 'Der Server läuft mit 4 GB regelmäßig voll.' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe).toEqual([]);
  });

  it('sperrt auch Lesen und Zurückziehen für ein Gast-Konto', async () => {
    app = await buildApp();

    const liste = await call(app, 'GET', '/quota-requests/mine', { actor: 'gast' });
    const rueckzug = await call(app, 'DELETE', `/quota-requests/${REQUEST_ID}`, { actor: 'gast' });

    expect(liste.statusCode).toBe(403);
    expect(rueckzug.statusCode).toBe(403);
    expect(aufrufe).toEqual([]);
  });

  it('liefert die eigenen Anfragen als Liste', async () => {
    app = await buildApp();

    const response = await call(app, 'GET', '/quota-requests/mine', { actor: 'nutzer' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: QuotaRequestDto[] }>().data).toEqual([dto]);
  });

  it('meldet einen fehlerhaften Body als VALIDATION_FAILED (400)', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/quota-requests', {
      actor: 'nutzer',
      payload: { reason: 'zu kurz' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
    expect(aufrufe).toEqual([]);
  });

  it('zieht zurück und antwortet mit `data: null`', async () => {
    app = await buildApp();

    const response = await call(app, 'DELETE', `/quota-requests/${REQUEST_ID}`, {
      actor: 'nutzer',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: null, error: null });
    expect(aufrufe).toEqual(['withdraw']);
  });

  it('reicht den Konflikt des Rennens als 409 durch, nicht als 500', async () => {
    app = await buildApp({ fehler: new QuotaRequestError('QUOTA_REQUEST_INVALID_STATE') });

    const response = await call(app, 'DELETE', `/quota-requests/${REQUEST_ID}`, {
      actor: 'nutzer',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'QUOTA_REQUEST_INVALID_STATE',
    );
  });
});

describe('Bescheiden (Administration)', () => {
  it('verlangt für die Liste `user.manage`', async () => {
    app = await buildApp();

    const ohne = await call(app, 'GET', '/admin/quota-requests', { actor: 'nutzer' });
    const mit = await call(app, 'GET', '/admin/quota-requests', { actor: 'admin' });

    expect(ohne.statusCode).toBe(403);
    expect(mit.statusCode).toBe(200);
    expect(aufrufe).toEqual(['list']);
  });

  it('antwortet ohne Sitzung mit AUTH_REQUIRED (401)', async () => {
    app = await buildApp();

    const response = await call(app, 'GET', '/admin/quota-requests');

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });

  it('genehmigt und lehnt ab', async () => {
    app = await buildApp();

    const genehmigt = await call(app, 'POST', `/admin/quota-requests/${REQUEST_ID}/approve`, {
      actor: 'admin',
      payload: {},
    });
    const abgelehnt = await call(app, 'POST', `/admin/quota-requests/${REQUEST_ID}/reject`, {
      actor: 'admin',
      payload: { note: 'Node ist zu klein.' },
    });

    expect(genehmigt.json<{ data: QuotaRequestDto }>().data.status).toBe('approved');
    expect(abgelehnt.json<{ data: QuotaRequestDto }>().data.status).toBe('rejected');
    expect(aufrufe).toEqual(['approve', 'reject']);
  });

  it('sperrt das Bescheiden für ein Konto ohne `user.manage`', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', `/admin/quota-requests/${REQUEST_ID}/approve`, {
      actor: 'nutzer',
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(aufrufe).toEqual([]);
  });

  it('meldet eine unbrauchbare Id als VALIDATION_FAILED (400)', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/admin/quota-requests/keine-uuid/approve', {
      actor: 'admin',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });

  it('reicht den Konflikt des Rennens als 409 durch', async () => {
    app = await buildApp({ fehler: new QuotaRequestError('QUOTA_REQUEST_INVALID_STATE') });

    const response = await call(app, 'POST', `/admin/quota-requests/${REQUEST_ID}/approve`, {
      actor: 'admin',
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'QUOTA_REQUEST_INVALID_STATE',
    );
  });
});
