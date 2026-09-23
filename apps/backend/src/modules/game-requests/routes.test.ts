/**
 * HTTP-Ebene der Spiel-Wünsche.
 *
 * Geprüft wird, was an den sechs Routen hängt und nicht im Dienst steht: die
 * Wächter (`requireApproved()` für die eigenen Wünsche, `user.manage` für die
 * Bescheide), das Envelope-Format aus Pflichtenheft §5.1, die Schema-Prüfung
 * und dass ein anonymer oder nicht freigeschalteter Aufruf als benannter
 * Fehlercode ankommt statt als 500.
 *
 * Der Dienst ist ein Fake nach dem Muster von `quota-requests/routes.test.ts` –
 * ohne laufende Datenbank (Entwicklungsregeln §4).
 */

import { type GameRequestDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, buildPermissionActor, registerRbac } from '../rbac/index.js';
import { GameRequestError } from './errors.js';
import { type GameRequestService } from './index.js';
import { registerGameRequestRoutes } from './routes.js';

const USER_ID = '11111111-1111-4111-8111-000000000001';
const ADMIN_ID = '11111111-1111-4111-8111-000000000002';
const REQUEST_ID = '22222222-2222-4222-8222-000000000001';

const actors: Record<string, PermissionActor> = {
  gast: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [], name: 'Gast' }] }),
  nutzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.create'], name: 'Nutzer' }],
  }),
  admin: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['gametype.manage'], name: 'Admin' }],
  }),
};

const dto: GameRequestDto = {
  id: REQUEST_ID,
  userId: USER_ID,
  userDisplayName: 'Antragsteller',
  game: 'Terraria',
  reason: 'Wir wollen zu dritt bauen.',
  status: 'pending',
  decisionNote: null,
  decidedByDisplayName: null,
  decidedAt: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  permissions: { canDecide: false, canWithdraw: true },
};

/** Aufrufe, die den Dienst tatsächlich erreicht haben. */
let aufrufe: string[] = [];

function buildService(options: { fehler?: GameRequestError } = {}): GameRequestService {
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

async function buildApp(options: { fehler?: GameRequestError } = {}): Promise<FastifyInstance> {
  aufrufe = [];

  const app = Fastify({ logger: false });

  registerErrorHandler(app);

  registerRbac(app, {
    resolveActor: (request) => {
      const kopf = request.headers['x-test-actor'];

      return typeof kopf === 'string' ? (actors[kopf] ?? null) : null;
    },
  });

  await app.register(
    registerGameRequestRoutes({
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

describe('Eigene Wünsche', () => {
  it('legt für ein freigeschaltetes Konto an und antwortet im Envelope-Format', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/game-requests', {
      actor: 'nutzer',
      payload: { game: 'Terraria' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: dto, error: null });
    expect(aufrufe).toEqual(['create']);
  });

  it('weist ein noch nicht freigeschaltetes Konto ab, ohne den Dienst zu rufen', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/game-requests', {
      actor: 'gast',
      payload: { game: 'Terraria' },
    });

    // Der Wächter antwortet mit PERMISSION_DENIED – dasselbe wie bei der
    // Kontingent-Anfrage; das frisch registrierte Konto erfährt nicht, ob es
    // an der Freischaltung oder an einem Recht liegt.
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe).toEqual([]);
  });

  it('weist einen anonymen Aufruf als benannten Fehler ab, nicht als 500', async () => {
    app = await buildApp();

    const response = await call(app, 'GET', '/game-requests/mine');

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
    expect(aufrufe).toEqual([]);
  });

  it('lehnt einen Wunsch ohne Spielnamen mit VALIDATION_FAILED ab', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/game-requests', {
      actor: 'nutzer',
      payload: { reason: 'Bitte irgendwas.' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(aufrufe).toEqual([]);
  });

  it('gibt die eigenen Wünsche zurück und zieht einen zurück', async () => {
    app = await buildApp();

    const liste = await call(app, 'GET', '/game-requests/mine', { actor: 'nutzer' });
    const zurueck = await call(app, 'DELETE', `/game-requests/${REQUEST_ID}`, { actor: 'nutzer' });

    expect(liste.json().data).toEqual([dto]);
    expect(zurueck.json()).toEqual({ success: true, data: null, error: null });
    expect(aufrufe).toEqual(['listOwn', 'withdraw']);
  });

  it('reicht den Fehlercode des Dienstes durch', async () => {
    app = await buildApp({ fehler: new GameRequestError('GAME_REQUEST_ALREADY_OPEN') });

    const response = await call(app, 'POST', '/game-requests', {
      actor: 'nutzer',
      payload: { game: 'Terraria' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('GAME_REQUEST_ALREADY_OPEN');
  });
});

describe('Bescheide der Administration', () => {
  it('lässt nur user.manage an die Liste', async () => {
    app = await buildApp();

    const verboten = await call(app, 'GET', '/admin/game-requests', { actor: 'nutzer' });
    const erlaubt = await call(app, 'GET', '/admin/game-requests', { actor: 'admin' });

    expect(verboten.statusCode).toBe(403);
    expect(verboten.json().error.code).toBe('PERMISSION_DENIED');
    expect(erlaubt.json().data).toEqual([dto]);
    expect(aufrufe).toEqual(['list']);
  });

  it('sagt zu und lehnt ab', async () => {
    app = await buildApp();

    const zusage = await call(app, 'POST', `/admin/game-requests/${REQUEST_ID}/approve`, {
      actor: 'admin',
      payload: { note: 'Kommt mit dem nächsten Image.' },
    });
    const absage = await call(app, 'POST', `/admin/game-requests/${REQUEST_ID}/reject`, {
      actor: 'admin',
    });

    expect(zusage.json().data.status).toBe('approved');
    expect(absage.json().data.status).toBe('rejected');
    expect(aufrufe).toEqual(['approve', 'reject']);
  });

  it('lehnt eine unsinnige Id ab, bevor der Dienst sie sieht', async () => {
    app = await buildApp();

    const response = await call(app, 'POST', '/admin/game-requests/keine-uuid/approve', {
      actor: 'admin',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(aufrufe).toEqual([]);
  });
});
