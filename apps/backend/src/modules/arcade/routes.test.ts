/**
 * HTTP-Ebene des Arcade-Bereichs (Arbeitspaket F8).
 *
 * Geprüft wird, was an den Routen hängt und nicht im Dienst steht: die
 * Freischalt-Schranke (`security-matrix-06`) und die Missbrauchsgrenze je Konto
 * (Audit W2-3, `backend-community-14`). Der Punktestand ist hier bewusst
 * client-authoritativ – umso wichtiger ist, dass er nicht in Schleife
 * eintreffen kann: Jeder Aufruf ist eine Zeile in `arcade_scores` plus drei
 * Abfragen.
 *
 * Der Dienst ist ein Fake nach dem Muster von `quota-requests/routes.test.ts` –
 * ohne laufende Datenbank (CLAUDE.md §4).
 */

import { type ArcadeLeaderboardDto, type ArcadeSubmitResultDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ABUSE_LIMITS, ABUSE_LIMIT_ERROR_CODE } from '../../lib/abuse-limits.js';
import { type PermissionActor, buildPermissionActor, registerRbac } from '../rbac/index.js';
import { registerArcadeRoutes } from './routes.js';
import { type ArcadeService } from './service.js';

const SPIELER = '11111111-1111-4111-8111-000000000001';
const ZWEITER = '11111111-1111-4111-8111-000000000002';

/** Freigeschaltetes Konto und ein noch wartendes (nur Rolle „Gast"). */
const actors: Record<string, PermissionActor> = {
  spieler: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [], name: 'A' }] }),
  zweiter: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [], name: 'A' }] }),
  gast: buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [], name: 'Gast' }] }),
};

const kontoIds: Record<string, string> = { spieler: SPIELER, zweiter: ZWEITER, gast: SPIELER };

const ergebnis: ArcadeSubmitResultDto = {
  score: {
    id: '22222222-2222-4222-8222-000000000001',
    gameId: 'kriechpfad',
    score: 120,
    createdAt: '2026-09-01T10:00:00.000Z',
  },
  personal: { bestScore: 120, rank: 1, gamesPlayed: 1 },
  isNewPersonalBest: true,
};

const bestenliste: ArcadeLeaderboardDto = {
  gameId: 'kriechpfad',
  entries: [],
  personal: null,
  permissions: { canSubmit: true },
};

/** Aufrufe, die den Dienst tatsächlich erreicht haben. */
let aufrufe: string[] = [];

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

async function buildApp(): Promise<FastifyInstance> {
  aufrufe = [];

  const arcade: ArcadeService = {
    submitScore: async () => {
      aufrufe.push('submitScore');

      return ergebnis;
    },
    getLeaderboard: async () => {
      aufrufe.push('getLeaderboard');

      return bestenliste;
    },
  };

  const instance = Fastify({ logger: false });

  registerRbac(instance, {
    resolveActor: (request) => {
      const kopf = request.headers['x-test-actor'];

      return typeof kopf === 'string' ? (actors[kopf] ?? null) : null;
    },
  });

  await instance.register(
    registerArcadeRoutes({
      arcade,
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

function absenden(instance: FastifyInstance, actor: string | null) {
  return instance.inject({
    method: 'POST',
    url: '/arcade/scores',
    ...(actor === null ? {} : { headers: { 'x-test-actor': actor } }),
    payload: { gameId: 'kriechpfad', score: 120 },
  });
}

describe('Punktestand absenden', () => {
  it('nimmt einen Punktestand eines freigeschalteten Kontos an', async () => {
    const instance = await buildApp();

    const antwort = await absenden(instance, 'spieler');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ success: true, data: ergebnis, error: null });
  });

  it('verschließt die Route für ein noch nicht freigeschaltetes Konto', async () => {
    const instance = await buildApp();

    const antwort = await absenden(instance, 'gast');

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe).toEqual([]);
  });
});

/**
 * Missbrauchsgrenze je Konto (Audit W2-3, `backend-community-14`).
 */
describe('Missbrauchsgrenze', () => {
  it('lehnt den Aufruf nach der zulässigen Anzahl in der Minute mit 429 ab', async () => {
    const instance = await buildApp();

    for (let nummer = 0; nummer < ABUSE_LIMITS['arcade.score'].maxAttempts; nummer += 1) {
      expect((await absenden(instance, 'spieler')).statusCode).toBe(200);
    }

    const abgelehnt = await absenden(instance, 'spieler');

    expect(abgelehnt.statusCode).toBe(429);
    expect(abgelehnt.json()).toMatchObject({
      success: false,
      data: null,
      error: { code: ABUSE_LIMIT_ERROR_CODE },
    });
    // Der abgewiesene Aufruf hat den Dienst nicht mehr erreicht – keine Zeile
    // in `arcade_scores`.
    expect(aufrufe).toHaveLength(ABUSE_LIMITS['arcade.score'].maxAttempts);
  });

  it('trifft nur das Konto, das die Grenze reißt', async () => {
    const instance = await buildApp();

    for (let nummer = 0; nummer <= ABUSE_LIMITS['arcade.score'].maxAttempts; nummer += 1) {
      await absenden(instance, 'spieler');
    }

    expect((await absenden(instance, 'spieler')).statusCode).toBe(429);
    expect((await absenden(instance, 'zweiter')).statusCode).toBe(200);
  });
});
