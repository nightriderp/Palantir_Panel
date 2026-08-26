/**
 * Sitzungsauflösung für geschützte Routen und der Handelnde im Audit-Log
 * (R1, Gefundener Punkt 45).
 *
 * Zwei Zusicherungen, die zusammengehören:
 *
 * 1. Ohne Sitzung antwortet eine geschützte Route mit `AUTH_REQUIRED` – die
 *    sichere Vorgabe aus B8 bleibt erhalten.
 * 2. Mit Sitzung trägt jeder Audit-Eintrag den Handelnden. Ein Audit-Log ohne
 *    Handelnden wäre für die Nachvollziehbarkeit wertlos (Pflichtenheft §6).
 *
 * Läuft ohne Datenbank: Die Admin-Routen werden mit den Attrappen aus
 * `modules/admin/test-support.ts` auf dieselbe Fastify-Instanz gehängt, die
 * `buildServer()` mit eingehängtem Auth-Modul liefert. Damit läuft die
 * Auflösung genau so wie im Betrieb – über Cookie, Access-Token und Sitzung.
 */

import { createHash } from 'node:crypto';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, type AccountDto } from '@palantir/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../admin/audit.js';
import { createHostNodeService } from '../admin/nodes.js';
import { createPortPoolService } from '../admin/ports.js';
import { createRegistrationRequestService } from '../admin/registration-requests.js';
import { registerAdminRoutes } from '../admin/routes.js';
import { createStorageExplorerService } from '../admin/storage.js';
import {
  type FakeAuditRepository,
  createFakeAuditRepository,
  createFakeHostNodeRepository,
  createFakePortPoolRepository,
  createFakeStorageRepository,
} from '../admin/test-support.js';
import { buildServer } from '../../server.js';
import {
  type FakeAuthRepository,
  type FakeRoleRepository,
  createFakeAuthRepository,
  createFakeProviderRegistry,
  createFakeRoleRepository,
} from './test-doubles.js';

const SECRETS = {
  jwtSecret: 'test-jwt-secret',
  csrfSecret: 'test-csrf-secret',
  altchaHmacKey: 'test-altcha-key',
};

const PASSWORD = 'ein-sehr-langes-passwort';

const NEW_NODE = {
  name: 'Homeserver-2',
  wireguardIp: '10.10.0.3',
  totalResources: { ramMb: 16_384, cpuCores: 4, diskMb: 1_000_000 },
};

let app: FastifyInstance;
let repository: FakeAuthRepository;
let roles: FakeRoleRepository;
let auditRepository: FakeAuditRepository;

type CookieJar = Record<string, string>;

function collectCookies(response: { cookies: { name: string; value: string }[] }): CookieJar {
  const jar: CookieJar = {};

  for (const cookie of response.cookies) {
    if (cookie.value !== '') {
      jar[cookie.name] = cookie.value;
    }
  }

  return jar;
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** Löst eine ALTCHA-Challenge so, wie es das Widget im Browser tut. */
async function solveAltcha(): Promise<string> {
  const response = await app.inject({ method: 'GET', url: '/auth/altcha/challenge' });
  const challenge = response.json<{
    data: {
      algorithm: string;
      challenge: string;
      salt: string;
      signature: string;
      maxnumber: number;
    };
  }>().data;

  for (let number = 0; number <= challenge.maxnumber; number += 1) {
    const hash = createHash('sha256')
      .update(`${challenge.salt}${String(number)}`, 'utf8')
      .digest('hex');

    if (hash === challenge.challenge) {
      return Buffer.from(
        JSON.stringify({
          algorithm: challenge.algorithm,
          challenge: challenge.challenge,
          salt: challenge.salt,
          number,
          signature: challenge.signature,
        }),
      ).toString('base64');
    }
  }

  throw new Error('Challenge war nicht lösbar.');
}

/** Registriert ein Konto, gibt ihm die genannte Rolle und liefert die Cookies. */
async function registerWithRole(
  roleName: string,
): Promise<{ jar: CookieJar; account: AccountDto }> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username: 'betreiber', password: PASSWORD, altcha: await solveAltcha() },
  });

  expect(response.statusCode).toBe(201);

  const account = response.json<{ data: { account: AccountDto } }>().data.account;
  const role = await roles.findByName(roleName);

  if (!role) {
    throw new Error(`Rolle ${roleName} fehlt in der Attrappe.`);
  }

  await roles.assignToUser(account.id, role.id);

  return { jar: collectCookies(response), account };
}

beforeEach(async () => {
  repository = createFakeAuthRepository();
  roles = createFakeRoleRepository([{ name: 'Admin', permissions: ['node.manage'] }]);
  app = await buildServer({
    auth: {
      repository,
      roles,
      providers: createFakeProviderRegistry(),
      secrets: SECRETS,
    },
  });

  /*
   * Die Admin-Routen hängt `buildServer()` im Betrieb nur mit gesetzter
   * `DATABASE_URL` ein. Hier kommen sie mit Attrappen dazu – vor dem ersten
   * `inject()`, also noch vor `ready()`.
   */
  auditRepository = createFakeAuditRepository();
  const audit = createAuditService(auditRepository);
  const nodes = createHostNodeService({ repository: createFakeHostNodeRepository(), audit });

  await registerAdminRoutes(app, {
    nodes,
    audit,
    ports: createPortPoolService({ repository: createFakePortPoolRepository(), audit }),
    storage: createStorageExplorerService({
      repository: createFakeStorageRepository(),
      nodes,
    }),
    registrationRequests: createRegistrationRequestService({
      repository: {
        list: async () => ({ rows: [], total: 0 }),
        findByUserId: async () => null,
        setBanned: async () => undefined,
      },
      roles: {} as never,
      audit,
    }),
  });
});

afterEach(async () => {
  await app.close();
});

describe('Sitzungsauflösung für geschützte Routen (Gefundener Punkt 45)', () => {
  it('antwortet ohne Sitzung mit AUTH_REQUIRED', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/nodes' });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });

  it('antwortet mit Sitzung, aber ohne Permission mit PERMISSION_DENIED', async () => {
    // Neu registrierte Konten tragen nur die Gast-Rolle (Lastenheft §3.1).
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'gast', password: PASSWORD, altcha: await solveAltcha() },
    });

    const answer = await app.inject({
      method: 'GET',
      url: '/admin/nodes',
      headers: { cookie: cookieHeader(collectCookies(response)) },
    });

    expect(answer.statusCode).toBe(403);
    expect(answer.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
  });

  it('lässt die Route mit passender Rolle aus der Sitzung durch', async () => {
    const { jar } = await registerWithRole('Admin');

    const response = await app.inject({
      method: 'GET',
      url: '/admin/nodes',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('Handelnder im Audit-Log (Pflichtenheft §6)', () => {
  it('trägt Konto-Id und Anzeigename des Aufrufers', async () => {
    const { jar, account } = await registerWithRole('Admin');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/nodes',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
      payload: NEW_NODE,
    });

    expect(response.statusCode).toBe(200);

    const entry = auditRepository.rows.at(-1);

    expect(entry?.action).toBe('node.created');
    expect(entry?.actorId).toBe(account.id);
    expect(entry?.actorDisplayName).toBe(account.displayName);
  });

  it('hält den Anzeigenamen als Kopie fest', async () => {
    // Der Eintrag muss lesbar bleiben, auch wenn das Konto später umbenannt
    // wird oder verschwindet (Pflichtenheft §6, `AuditLog.actorDisplayName`).
    const { jar, account } = await registerWithRole('Admin');

    await app.inject({
      method: 'POST',
      url: '/admin/nodes',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
      payload: NEW_NODE,
    });

    await repository.deleteUser(account.id);

    expect(auditRepository.rows.at(-1)?.actorDisplayName).toBe(account.displayName);
  });

  it('vermerkt die grobe Herkunft des Requests, nicht die volle Adresse', async () => {
    const { jar } = await registerWithRole('Admin');

    await app.inject({
      method: 'POST',
      url: '/admin/nodes',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
      remoteAddress: '203.0.113.10',
      payload: NEW_NODE,
    });

    expect(auditRepository.rows.at(-1)?.ipHint).toBe('203.0.113.x');
  });
});
