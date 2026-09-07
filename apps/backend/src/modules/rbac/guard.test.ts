import { ok } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  registerRbac,
  requireAllPermissions,
  requireAnyPermission,
  requireApproved,
  requirePermission,
} from './guard.js';
import { type PermissionActor, buildPermissionActor } from './permissions.js';

/**
 * Baut eine Fastify-Instanz mit Guard-geschützten Testrouten.
 *
 * `resolveActor` steht hier für die Sitzungsauflösung aus B1: der Actor wird
 * über den Header `x-test-actor` gesteuert, damit der Guard ohne Auth-Modul
 * prüfbar ist.
 */
async function buildTestApp(): Promise<FastifyInstance> {
  const actors: Record<string, PermissionActor> = {
    owner: buildPermissionActor({ isOwner: true, roles: [] }),
    gast: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [] }] }),
    moderator: buildPermissionActor({
      isOwner: false,
      roles: [{ grantedPermissions: ['message.moderate'] }],
    }),
    admin: buildPermissionActor({
      isOwner: false,
      roles: [{ grantedPermissions: ['user.manage', 'role.manage'] }],
    }),
    // Freischaltung (Lastenheft §3.1): Das frisch registrierte Konto trägt
    // ausschließlich die geschützte Systemrolle „Gast".
    wartend: buildPermissionActor({
      isOwner: false,
      roles: [{ grantedPermissions: [], name: 'Gast' }],
    }),
    ohneRolle: buildPermissionActor({ isOwner: false, roles: [] }),
    freigeschaltet: buildPermissionActor({
      isOwner: false,
      roles: [
        { grantedPermissions: [], name: 'Gast' },
        { grantedPermissions: ['server.create'], name: 'Nutzer' },
      ],
    }),
  };

  const app = Fastify({ logger: false });

  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  app.get('/nur-moderation', { preHandler: requirePermission('message.moderate') }, async () =>
    ok({ erlaubt: true }),
  );
  app.get(
    '/verwaltung',
    { preHandler: requireAnyPermission('user.manage', 'role.manage') },
    async () => ok({ erlaubt: true }),
  );
  app.get(
    '/beides',
    { preHandler: requireAllPermissions('user.manage', 'message.moderate') },
    async () => ok({ erlaubt: true }),
  );
  app.get('/nur-freigeschaltet', { preHandler: requireApproved() }, async () =>
    ok({ erlaubt: true }),
  );

  await app.ready();

  return app;
}

describe('Permission-Guard für Fastify-Routen (Pflichtenheft §8)', () => {
  it('antwortet ohne Anmeldung mit AUTH_REQUIRED (401)', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/nur-moderation' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'AUTH_REQUIRED', message: expect.any(String) },
    });

    await app.close();
  });

  it('antwortet bei fehlender Permission mit PERMISSION_DENIED (403)', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/nur-moderation',
      headers: { 'x-test-actor': 'gast' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');

    await app.close();
  });

  it('lässt den Aufruf mit passender Permission durch', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/nur-moderation',
      headers: { 'x-test-actor': 'moderator' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: { erlaubt: true }, error: null });

    await app.close();
  });

  it('lässt den Owner überall durch', async () => {
    const app = await buildTestApp();

    for (const url of ['/nur-moderation', '/verwaltung', '/beides']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-test-actor': 'owner' },
      });
      expect(response.statusCode).toBe(200);
    }

    await app.close();
  });

  it('requireAnyPermission genügt eine der Permissions', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/verwaltung',
      headers: { 'x-test-actor': 'admin' },
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('requireAllPermissions verlangt alle Permissions', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/beides',
      headers: { 'x-test-actor': 'admin' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');

    await app.close();
  });
});

/**
 * Freischaltung als Backend-Schranke (Lastenheft §3.1, security-matrix-06).
 *
 * Vor `requireApproved()` reichte auf einer Reihe von Routen die bloße Sitzung –
 * ein Konto in der Warteliste kam durch, obwohl es „keinerlei Zugriff auf
 * Funktionen" haben soll.
 */
describe('requireApproved (Freischaltung)', () => {
  async function ruf(actor?: string): Promise<{ status: number; code?: string }> {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/nur-freigeschaltet',
      headers: actor === undefined ? {} : { 'x-test-actor': actor },
    });
    await app.close();

    return {
      status: response.statusCode,
      code: response.statusCode === 200 ? undefined : response.json().error.code,
    };
  }

  it('antwortet ohne Anmeldung mit AUTH_REQUIRED (401)', async () => {
    expect(await ruf()).toEqual({ status: 401, code: 'AUTH_REQUIRED' });
  });

  it('sperrt ein Konto mit ausschließlich der Rolle „Gast" (403)', async () => {
    expect(await ruf('wartend')).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
  });

  it('sperrt ein Konto ganz ohne Rolle (403)', async () => {
    // `every` auf der leeren Liste ist wahr – dieselbe Lesart wie `statusOf()`
    // in der Warteliste (B8).
    expect(await ruf('ohneRolle')).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
  });

  it('lässt durch, sobald neben „Gast" eine weitere Rolle steht', async () => {
    expect(await ruf('freigeschaltet')).toEqual({ status: 200, code: undefined });
  });

  it('lässt den Owner immer durch – auch ohne jede Rolle', async () => {
    expect(await ruf('owner')).toEqual({ status: 200, code: undefined });
  });

  it('verlangt keine Permission: ein Moderator ohne user.manage kommt durch', async () => {
    expect(await ruf('moderator')).toEqual({ status: 200, code: undefined });
  });
});
