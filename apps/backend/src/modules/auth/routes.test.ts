/**
 * HTTP-Ebene des Auth-Moduls: Envelope, Cookies, CSRF, Rate-Limit und die
 * Verzahnung mit dem RBAC-Guard aus B2.
 *
 * Läuft ohne Datenbank und ohne Netz: Ablage, Rollen und Anbieter kommen aus
 * `test-doubles.ts`, die Geheimnisse werden ausdrücklich übergeben statt aus der
 * zentralen `.env` gelesen.
 */

import { createHash } from 'node:crypto';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, type AccountDto } from '@palantir/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { buildServer } from '../../server.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from './cookies.js';
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

let app: FastifyInstance;
let repository: FakeAuthRepository;
let roles: FakeRoleRepository;

/** Sammelt die gesetzten Cookies aus einer Antwort als Header-Wert. */
type CookieJar = Record<string, string>;

function collectCookies(
  jar: CookieJar,
  response: { cookies: { name: string; value: string }[] },
): CookieJar {
  const next = { ...jar };

  for (const cookie of response.cookies) {
    if (cookie.value === '') {
      delete next[cookie.name];
    } else {
      next[cookie.name] = cookie.value;
    }
  }

  return next;
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

/** Registriert ein Konto und liefert die Cookies der neuen Sitzung. */
async function registerAccount(
  username = 'spieler',
): Promise<{ jar: CookieJar; account: AccountDto }> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: PASSWORD, altcha: await solveAltcha() },
  });

  expect(response.statusCode).toBe(201);

  return {
    jar: collectCookies({}, response),
    account: response.json<{ data: { account: AccountDto } }>().data.account,
  };
}

beforeEach(async () => {
  repository = createFakeAuthRepository();
  roles = createFakeRoleRepository([{ name: 'Admin', permissions: ['user.manage'] }]);
  app = await buildServer({
    auth: {
      repository,
      roles,
      providers: createFakeProviderRegistry(),
      secrets: SECRETS,
    },
  });
});

afterEach(async () => {
  await app.close();
});

describe('ALTCHA-Endpunkt (Pflichtenheft §7)', () => {
  it('liefert die Challenge im Envelope aus Pflichtenheft §5.1', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/altcha/challenge' });
    const body = response.json<{ success: boolean; data: { algorithm: string }; error: null }>();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data.algorithm).toBe('SHA-256');
  });
});

describe('Registrierung über HTTP (Lastenheft §3.1)', () => {
  it('legt das Konto an und setzt die drei Sitzungs-Cookies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'spieler', password: PASSWORD, altcha: await solveAltcha() },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { account: AccountDto } }>().data.account.awaitingApproval).toBe(
      true,
    );

    const names = response.cookies.map((cookie) => cookie.name);
    expect(names).toContain(ACCESS_COOKIE_NAME);
    expect(names).toContain(REFRESH_COOKIE_NAME);
    expect(names).toContain(CSRF_COOKIE_NAME);
  });

  it('setzt die Cookie-Flags aus Pflichtenheft §7', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'spieler', password: PASSWORD, altcha: await solveAltcha() },
    });

    const access = response.cookies.find((cookie) => cookie.name === ACCESS_COOKIE_NAME);
    const refresh = response.cookies.find((cookie) => cookie.name === REFRESH_COOKIE_NAME);
    const csrf = response.cookies.find((cookie) => cookie.name === CSRF_COOKIE_NAME);

    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite?.toLowerCase()).toBe('lax');
    expect(access?.secure).toBe(env.COOKIE_SECURE);

    // Der Refresh-Token wird nur an die /auth-Routen geschickt.
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.path).toBe('/auth');

    // Das CSRF-Cookie muss das Frontend lesen können (Double-Submit).
    expect(csrf?.httpOnly).toBeFalsy();
  });

  it('lehnt eine Registrierung ohne gültigen ALTCHA-Nachweis ab', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'spieler', password: PASSWORD, altcha: 'gefaelscht' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_CAPTCHA_INVALID');
    expect(repository.users).toHaveLength(0);
  });

  it('lehnt ein zu kurzes Passwort ab (Pflichtenheft §7)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'spieler', password: 'kurz', altcha: await solveAltcha() },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_PASSWORD_TOO_WEAK');
  });

  it('meldet einen vergebenen Benutzernamen mit 409', async () => {
    await registerAccount('spieler');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'Spieler', password: PASSWORD, altcha: await solveAltcha() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_USERNAME_TAKEN');
  });

  it('greift beim IP-Rate-Limit (Pflichtenheft §7, §18)', async () => {
    const limit = env.AUTH_RATE_LIMIT_REGISTER_MAX;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username: `spieler${String(attempt)}`,
          password: PASSWORD,
          altcha: await solveAltcha(),
        },
      });
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'zuviel', password: PASSWORD, altcha: await solveAltcha() },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('AUTH_RATE_LIMITED');
  });
});

describe('Login über HTTP', () => {
  beforeEach(async () => {
    await registerAccount('spieler');
  });

  it('meldet mit richtigen Zugangsdaten an', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: await solveAltcha() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { status: string } }>().data.status).toBe('authenticated');
  });

  it('antwortet bei falschen Zugangsdaten mit 401 und benanntem Code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'spieler',
        password: 'falsch-aber-lang',
        altcha: await solveAltcha(),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'AUTH_INVALID_CREDENTIALS',
    );
    expect(response.cookies.some((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toBe(false);
  });
});

describe('Sitzung und CSRF (Pflichtenheft §7, §18)', () => {
  let jar: CookieJar;

  beforeEach(async () => {
    ({ jar } = await registerAccount('spieler'));
  });

  it('liefert das eigene Konto an angemeldete Aufrufer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { account: AccountDto } }>().data.account.username).toBe(
      'spieler',
    );
  });

  it('antwortet ohne Sitzung mit AUTH_REQUIRED', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/session' });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });

  it('lehnt einen zustandsändernden Request ohne CSRF-Header ab', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_CSRF_INVALID');
  });

  it('lehnt einen falschen CSRF-Header ab', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: 'anderer-wert' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lässt einen Request mit passendem CSRF-Header durch und meldet ab', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.sessions[0]?.revokedAt).not.toBeNull();

    // Danach ist das Access-Cookie wertlos.
    const after = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: cookieHeader(jar) },
    });
    expect(after.statusCode).toBe(401);
  });

  it('wirkt ein Remote-Logout sofort, obwohl das Access-Token noch gültig wäre', async () => {
    const second = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: await solveAltcha() },
    });
    const secondJar = collectCookies({}, second);

    const sessions = await app.inject({
      method: 'GET',
      url: '/auth/sessions',
      headers: { cookie: cookieHeader(jar) },
    });
    const other = sessions
      .json<{ data: { id: string; current: boolean }[] }>()
      .data.find((session) => !session.current);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/auth/sessions/${other?.id ?? ''}`,
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
    });
    expect(revoked.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: cookieHeader(secondJar) },
    });
    expect(blocked.statusCode).toBe(401);
  });

  it('tauscht beim Refresh die Cookies aus', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
    });

    expect(response.statusCode).toBe(200);

    const refreshed = collectCookies(jar, response);
    expect(refreshed[REFRESH_COOKIE_NAME]).not.toBe(jar[REFRESH_COOKIE_NAME]);
  });

  it('löscht die Cookies, wenn der Refresh scheitert', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: `${REFRESH_COOKIE_NAME}=unbekannt; ${CSRF_COOKIE_NAME}=x`,
        [CSRF_HEADER_NAME]: 'x',
      },
    });

    expect(response.statusCode).toBe(401);
    // Sonst versuchte der Browser es endlos mit demselben ungültigen Token.
    expect(response.cookies.filter((cookie) => cookie.name === ACCESS_COOKIE_NAME)[0]?.value).toBe(
      '',
    );
  });
});

describe('Erzwungener Passwortwechsel (Lastenheft §3.1)', () => {
  it('sperrt andere zustandsändernde Routen, lässt den Wechsel aber zu', async () => {
    const { jar, account } = await registerAccount('spieler');
    const method = repository.methods[0];
    repository.methods[0] = { ...method!, mustChangePassword: true };

    const csrf = jar[CSRF_COOKIE_NAME] ?? '';

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/2fa/setup',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: csrf },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe(
      'AUTH_PASSWORD_CHANGE_REQUIRED',
    );

    const changed = await app.inject({
      method: 'POST',
      url: '/auth/password/change',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: csrf },
      payload: { currentPassword: PASSWORD, newPassword: `${PASSWORD}-neu` },
    });
    expect(changed.statusCode).toBe(200);
    const body = changed.json<{ data: { account: AccountDto } }>().data.account;
    expect(body.mustChangePassword).toBe(false);
    expect(body.id).toBe(account.id);
  });
});

describe('Admin-Eingriffe hinter dem RBAC-Guard aus B2', () => {
  it('verlangt eine Anmeldung', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/admin/users/00000000-0000-4000-8000-000000000000/password-reset',
      headers: { [CSRF_HEADER_NAME]: 'x', cookie: `${CSRF_COOKIE_NAME}=x` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });

  it('lehnt ein Konto ohne user.manage mit PERMISSION_DENIED ab', async () => {
    const { jar, account } = await registerAccount('spieler');

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/users/${account.id}/password-reset`,
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
  });

  it('lässt ein Konto mit user.manage das Passwort zurücksetzen', async () => {
    const target = await registerAccount('spieler');
    const admin = await registerAccount('verwalter');
    const adminRole = roles.roles.find((role) => role.name === 'Admin');
    await roles.assignToUser(admin.account.id, adminRole!.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/users/${target.account.id}/password-reset`,
      headers: {
        cookie: cookieHeader(admin.jar),
        [CSRF_HEADER_NAME]: admin.jar[CSRF_COOKIE_NAME] ?? '',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ data: { temporaryPassword: string } }>().data.temporaryPassword.length,
    ).toBeGreaterThan(12);
  });
});

describe('Anbieter-Login über HTTP (Pflichtenheft §7)', () => {
  it('leitet zum Provider weiter und setzt ein signiertes state-Cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/discord/start' });

    // Echte Weiterleitung: der Client in F1 navigiert hierher, er ruft die
    // Adresse nicht per fetch ab.
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toContain('discord');

    const state = response.cookies.find((cookie) => cookie.name === 'palantir_oauth');
    expect(state?.httpOnly).toBe(true);
    // Signiert: der Wert trägt einen angehängten HMAC-Anteil.
    expect(state?.value).toContain('.');
  });

  it('leitet bei unbekanntem Provider mit Fehlercode ins Frontend zurück', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/github/start' });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toContain('/login?error=AUTH_PROVIDER_NOT_CONFIGURED');
  });

  it('meldet nach der Rückkehr an und leitet ins Frontend weiter', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/discord/start' });
    const jar = collectCookies({}, start);

    const callback = await app.inject({
      method: 'GET',
      url: '/auth/discord/callback?state=state-discord&code=abc',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toContain('registered=discord');
    expect(repository.users).toHaveLength(1);
    expect(repository.methods[0]?.type).toBe('discord');
  });

  it('leitet bei falschem state mit Fehlercode zurück, ohne ein Konto anzulegen', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/discord/start' });
    const jar = collectCookies({}, start);

    const callback = await app.inject({
      method: 'GET',
      url: '/auth/discord/callback?state=untergeschoben&code=abc',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toContain('error=');
    expect(repository.users).toHaveLength(0);
  });

  it('lehnt eine Rückkehr ohne state-Cookie ab', async () => {
    const callback = await app.inject({
      method: 'GET',
      url: '/auth/discord/callback?state=state-discord&code=abc',
    });

    expect(callback.headers.location).toContain('/login?error=AUTH_OAUTH_STATE_INVALID');
    expect(repository.users).toHaveLength(0);
  });

  it('lässt einen state nicht beim falschen Anbieter einlösen', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/discord/start' });
    const jar = collectCookies({}, start);

    const callback = await app.inject({
      method: 'GET',
      url: '/auth/twitch/callback?state=state-discord&code=abc',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(callback.headers.location).toContain('/login?error=AUTH_OAUTH_STATE_INVALID');
    expect(repository.users).toHaveLength(0);
  });

  it('verknüpft im eingeloggten Zustand statt ein zweites Konto anzulegen', async () => {
    const { jar } = await registerAccount('spieler');
    const start = await app.inject({
      method: 'GET',
      url: '/auth/discord/start',
      headers: { cookie: cookieHeader(jar) },
    });
    const withState = collectCookies(jar, start);

    const callback = await app.inject({
      method: 'GET',
      url: '/auth/discord/callback?state=state-discord&code=abc',
      headers: { cookie: cookieHeader(withState) },
    });

    expect(callback.headers.location).toContain('linked=discord');
    expect(repository.users).toHaveLength(1);
    expect(repository.methods.map((method) => method.type).sort()).toEqual(['discord', 'password']);
  });
});
