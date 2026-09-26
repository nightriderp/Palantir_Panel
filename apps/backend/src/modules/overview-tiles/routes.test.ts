/**
 * Routen der Übersichts-Kacheln: Wer lesen darf, wer schreiben darf, und dass
 * eine kaputte Eingabe als `VALIDATION_FAILED` zurückkommt statt als Absturz.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { actorWith, ownerActor } from '../admin/test-support.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { createOverviewTileService } from './index.js';
import { registerOverviewTileRoutes } from './routes.js';
import { TILE_ID, createFakeOverviewTileRepository, tileRecord } from './test-support.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const actors: Record<string, PermissionActor> = {
    owner: ownerActor(),
    nutzer: actorWith(),
    instanzAdmin: actorWith('instance.manage'),
  };

  const app = Fastify({ logger: false });

  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  await app.register(
    registerOverviewTileRoutes({
      service: createOverviewTileService({
        repository: createFakeOverviewTileRepository([tileRecord()]),
        kennt: (gameTypeId) => gameTypeId === 'cs2',
      }),
      actorUserId: () => 'user-1',
    }),
  );

  await app.ready();

  return app;
}

describe('Übersichts-Kacheln – Routen', () => {
  it('liefert die Liste jedem angemeldeten Konto', async () => {
    const app = await buildTestApp();
    const antwort = await app.inject({
      method: 'GET',
      url: '/api/overview-tiles',
      headers: { 'x-test-actor': 'nutzer' },
    });

    expect(antwort.statusCode).toBe(200);
    const body = antwort.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].permissions).toEqual({ canEdit: false, canDelete: false });
  });

  it('verlangt eine Anmeldung zum Lesen', async () => {
    const app = await buildTestApp();
    const antwort = await app.inject({ method: 'GET', url: '/api/overview-tiles' });

    expect(antwort.statusCode).toBe(401);
  });

  it('lässt nur instance.manage anlegen', async () => {
    const app = await buildTestApp();

    const verboten = await app.inject({
      method: 'POST',
      url: '/api/admin/overview-tiles',
      headers: { 'x-test-actor': 'nutzer' },
      payload: { title: 'BHOP' },
    });
    expect(verboten.statusCode).toBe(403);

    const erlaubt = await app.inject({
      method: 'POST',
      url: '/api/admin/overview-tiles',
      headers: { 'x-test-actor': 'instanzAdmin' },
      payload: { title: 'BHOP', gameTypeId: 'cs2', linkUrl: 'https://discord.gg/asa' },
    });
    expect(erlaubt.statusCode).toBe(201);
    expect(erlaubt.json().data.title).toBe('BHOP');
    expect(erlaubt.json().data.address).toBeNull();
  });

  it('weist einen Link mit fremdem Schema als VALIDATION_FAILED ab', async () => {
    const app = await buildTestApp();
    const antwort = await app.inject({
      method: 'POST',
      url: '/api/admin/overview-tiles',
      headers: { 'x-test-actor': 'owner' },
      payload: { title: 'x', linkUrl: 'javascript:alert(1)' },
    });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('ändert und entfernt über die Kennung, unbekannte Kennung ist NOT_FOUND', async () => {
    const app = await buildTestApp();

    const geaendert = await app.inject({
      method: 'PATCH',
      url: `/api/admin/overview-tiles/${TILE_ID}`,
      headers: { 'x-test-actor': 'owner' },
      payload: { address: 'surf.example.org:27015' },
    });
    expect(geaendert.statusCode).toBe(200);
    expect(geaendert.json().data.address).toBe('surf.example.org:27015');

    const fremd = await app.inject({
      method: 'DELETE',
      url: '/api/admin/overview-tiles/ffffffff-ffff-4fff-8fff-ffffffffffff',
      headers: { 'x-test-actor': 'owner' },
    });
    expect(fremd.statusCode).toBe(404);

    const entfernt = await app.inject({
      method: 'DELETE',
      url: `/api/admin/overview-tiles/${TILE_ID}`,
      headers: { 'x-test-actor': 'owner' },
    });
    expect(entfernt.statusCode).toBe(200);

    const liste = await app.inject({
      method: 'GET',
      url: '/api/overview-tiles',
      headers: { 'x-test-actor': 'nutzer' },
    });
    expect(liste.json().data).toHaveLength(0);
  });
});
