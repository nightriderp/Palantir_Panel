/**
 * HTTP-Ebene des Erfolgs-Moduls (Betreiber-Wunsch 21.09.2026).
 *
 * Geprüft wird, was an den Routen hängt und nicht im Dienst steht: die
 * Freischalt-Schranke (`security-matrix-06`), die Zuordnung zum **eigenen**
 * Konto und die Form der Eingabe. Der Dienst ist ein Fake – ohne laufende
 * Datenbank (Entwicklungsregeln §4).
 */

import { type AchievementOverviewDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { type PermissionActor, buildPermissionActor, registerRbac } from '../rbac/index.js';
import { registerAchievementRoutes } from './routes.js';
import { type AchievementService } from './service.js';

const SAMMLER = '11111111-1111-4111-8111-000000000001';

const actors: Record<string, PermissionActor> = {
  sammler: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [], name: 'A' }] }),
  gast: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [], name: 'Gast' }] }),
};

const kontoIds: Record<string, string> = { sammler: SAMMLER, gast: SAMMLER };

const uebersicht: AchievementOverviewDto = {
  entries: [],
  unlockedCount: 0,
  totalCount: 20,
  level: { level: 1, required: 0, label: 'Neuling' },
  nextLevel: { level: 2, required: 2, label: 'Eingelebt' },
  availableTitles: [],
  selectedTitle: null,
  permissions: { canChooseTitle: false },
};

/** Aufrufe, die den Dienst tatsächlich erreicht haben. */
let aufrufe: { name: string; args: unknown[] }[] = [];

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

async function buildApp(): Promise<FastifyInstance> {
  aufrufe = [];

  const achievements: AchievementService = {
    overviewFor: async (userId) => {
      aufrufe.push({ name: 'overviewFor', args: [userId] });

      return uebersicht;
    },
    chooseTitle: async (userId, achievementId) => {
      aufrufe.push({ name: 'chooseTitle', args: [userId, achievementId] });

      return uebersicht;
    },
    evaluate: async () => [],
    evaluateArcade: async () => [],
  };

  const instance = Fastify({ logger: false });

  registerRbac(instance, {
    resolveActor: (request) => {
      const kopf = request.headers['x-test-actor'];

      return typeof kopf === 'string' ? (actors[kopf] ?? null) : null;
    },
  });

  await instance.register(
    registerAchievementRoutes({
      achievements,
      resolveUserId: (request) => {
        const kopf = request.headers['x-test-actor'];

        return typeof kopf === 'string' ? (kontoIds[kopf] ?? null) : null;
      },
    }),
  );

  await instance.ready();
  app = instance;

  return instance;
}

describe('Übersicht abrufen', () => {
  it('liefert die Abzeichen des aufrufenden Kontos im Envelope', async () => {
    const instance = await buildApp();

    const antwort = await instance.inject({
      method: 'GET',
      url: '/achievements',
      headers: { 'x-test-actor': 'sammler' },
    });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ success: true, data: uebersicht, error: null });
    // Die Konto-Id kommt aus der Sitzung, nicht aus der Anfrage – fremde
    // Abzeichen lassen sich über diese Route nicht erreichen.
    expect(aufrufe).toEqual([{ name: 'overviewFor', args: [SAMMLER] }]);
  });

  it('verschließt die Route für ein noch nicht freigeschaltetes Konto', async () => {
    const instance = await buildApp();

    const antwort = await instance.inject({
      method: 'GET',
      url: '/achievements',
      headers: { 'x-test-actor': 'gast' },
    });

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe).toEqual([]);
  });
});

describe('Titel wählen', () => {
  function waehlen(instance: FastifyInstance, payload: unknown, actor = 'sammler') {
    return instance.inject({
      method: 'PUT',
      url: '/achievements/title',
      headers: { 'x-test-actor': actor },
      payload: payload as Record<string, unknown>,
    });
  }

  it('reicht die gewählte Kennung an den Dienst durch', async () => {
    const instance = await buildApp();

    const antwort = await waehlen(instance, { achievementId: 'nachtschicht' });

    expect(antwort.statusCode).toBe(200);
    expect(aufrufe).toEqual([{ name: 'chooseTitle', args: [SAMMLER, 'nachtschicht'] }]);
  });

  it('nimmt `null` als „keinen Titel tragen" an', async () => {
    const instance = await buildApp();

    const antwort = await waehlen(instance, { achievementId: null });

    expect(antwort.statusCode).toBe(200);
    expect(aufrufe).toEqual([{ name: 'chooseTitle', args: [SAMMLER, null] }]);
  });

  it('lehnt eine unbekannte Kennung ab, bevor sie den Dienst erreicht', async () => {
    const instance = await buildApp();

    const antwort = await waehlen(instance, { achievementId: 'gibtsNicht' });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
    expect(aufrufe).toEqual([]);
  });

  it('lehnt einen Rumpf ohne das Feld ab – ein vergessenes Feld ist kein „Titel ablegen"', async () => {
    const instance = await buildApp();

    const antwort = await waehlen(instance, {});

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
    expect(aufrufe).toEqual([]);
  });

  it('lehnt unbekannte Felder ab (`strict`)', async () => {
    const instance = await buildApp();

    const antwort = await waehlen(instance, { achievementId: null, userId: 'jemand-anderes' });

    expect(antwort.statusCode).toBe(400);
    expect(aufrufe).toEqual([]);
  });

  it('verschließt die Route für ein noch nicht freigeschaltetes Konto', async () => {
    const instance = await buildApp();

    const antwort = await waehlen(instance, { achievementId: null }, 'gast');

    expect(antwort.statusCode).toBe(403);
    expect(aufrufe).toEqual([]);
  });
});
