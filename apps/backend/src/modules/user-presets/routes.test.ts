/**
 * HTTP-Ebene der eigenen Profile: Wächter, Envelope-Format, Schema-Prüfung und
 * dass die Konto-Id aus der Sitzung kommt. Dienst als Fake, ohne Datenbank.
 */

import { type UserPresetDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, buildPermissionActor, registerRbac } from '../rbac/index.js';
import { UserPresetError } from './errors.js';
import { type UserPresetService } from './index.js';
import { registerUserPresetRoutes } from './routes.js';

const USER_ID = '11111111-1111-4111-8111-000000000001';
const PRESET_ID = '22222222-2222-4222-8222-000000000001';

const actors: Record<string, PermissionActor> = {
  gast: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [], name: 'Gast' }] }),
  nutzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.create'], name: 'Nutzer' }],
  }),
};

const dto: UserPresetDto = {
  id: PRESET_ID,
  gameType: 'cs2',
  name: 'Smokes',
  values: { gameMode: 'custom', bots: 0 },
  createdAt: '2026-09-26T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
  permissions: { canEdit: true, canDelete: true },
};

let aufrufe: { name: string; userId: string }[] = [];

function buildService(fehler?: UserPresetError): UserPresetService {
  function pruefe<T>(name: string, userId: string, ergebnis: T): Promise<T> {
    aufrufe.push({ name, userId });

    return fehler ? Promise.reject(fehler) : Promise.resolve(ergebnis);
  }

  return {
    listOwn: (userId) => pruefe('listOwn', userId, [dto]),
    create: (userId) => pruefe('create', userId, dto),
    update: (userId) => pruefe('update', userId, dto),
    remove: (userId) => pruefe('remove', userId, undefined),
  };
}

async function buildApp(fehler?: UserPresetError): Promise<FastifyInstance> {
  aufrufe = [];
  const instanz = Fastify({ logger: false });

  registerErrorHandler(instanz);
  registerRbac(instanz, {
    resolveActor: (request) => {
      const kopf = request.headers['x-test-actor'];

      return typeof kopf === 'string' ? (actors[kopf] ?? null) : null;
    },
  });
  await instanz.register(
    registerUserPresetRoutes({
      service: buildService(fehler),
      actorUserId: (request) =>
        typeof request.headers['x-test-actor'] === 'string' ? USER_ID : null,
    }),
  );
  await instanz.ready();

  return instanz;
}

async function call(
  instanz: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  return await instanz.inject(request);
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe('Eigene Profile – Routen', () => {
  it('listet die eigenen Profile eines Spiels im Envelope-Format', async () => {
    app = await buildApp();

    const antwort = await call(app, 'GET', '/user-presets?gameType=cs2', { actor: 'nutzer' });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ success: true, data: [dto], error: null });
    expect(aufrufe).toEqual([{ name: 'listOwn', userId: USER_ID }]);
  });

  it('legt an, ändert und löscht – die Konto-Id kommt aus der Sitzung', async () => {
    app = await buildApp();

    const anlegen = await call(app, 'POST', '/user-presets', {
      actor: 'nutzer',
      payload: { gameType: 'cs2', name: 'Smokes', values: { bots: 0 } },
    });
    const aendern = await call(app, 'PATCH', `/user-presets/${PRESET_ID}`, {
      actor: 'nutzer',
      payload: { name: 'Neu' },
    });
    const loeschen = await call(app, 'DELETE', `/user-presets/${PRESET_ID}`, { actor: 'nutzer' });

    expect([anlegen.statusCode, aendern.statusCode, loeschen.statusCode]).toEqual([200, 200, 200]);
    expect(aufrufe.map((a) => a.name)).toEqual(['create', 'update', 'remove']);
    expect(aufrufe.every((a) => a.userId === USER_ID)).toBe(true);
  });

  it('weist Anonyme und nicht freigeschaltete Konten ab, ohne den Dienst zu rufen', async () => {
    app = await buildApp();

    const anonym = await call(app, 'GET', '/user-presets?gameType=cs2');
    const gast = await call(app, 'POST', '/user-presets', {
      actor: 'gast',
      payload: { gameType: 'cs2', name: 'X', values: { bots: 0 } },
    });

    expect(anonym.statusCode).toBe(401);
    expect(gast.statusCode).toBe(403);
    expect(aufrufe).toEqual([]);
  });

  it('prüft die Eingabe und reicht Fehlercodes des Dienstes durch', async () => {
    app = await buildApp(new UserPresetError('USER_PRESET_NAME_TAKEN'));

    const leer = await call(app, 'POST', '/user-presets', {
      actor: 'nutzer',
      payload: { gameType: 'cs2', name: '', values: {} },
    });
    const doppelt = await call(app, 'POST', '/user-presets', {
      actor: 'nutzer',
      payload: { gameType: 'cs2', name: 'Smokes', values: { bots: 0 } },
    });

    expect(leer.statusCode).toBe(400);
    expect(doppelt.statusCode).toBe(409);
    expect(doppelt.json().error.code).toBe('USER_PRESET_NAME_TAKEN');
  });
});
