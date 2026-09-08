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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { buildServer } from '../../server.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from './cookies.js';
import { generateTotp } from './totp.js';
import {
  type FakeAuthRepository,
  type FakeRoleRepository,
  createFakeAuthRepository,
  createFakeProviderRegistry,
  createFakeRoleRepository,
} from './test-doubles.js';

/*
 * Zeitlimit dieser Datei – ausdrücklich gesetzt, nicht global (Fundpunkt 147).
 *
 * **Warum es nötig ist.** Jeder Test hier geht durch den echten Argon2id-Pfad:
 * eine Registrierung kostet einen Hash mit 64 MiB und 3 Durchgängen
 * (`passwords.ts`), ein Login einen Vergleich, ein Passwortwechsel beides. Der
 * Rate-Limit-Test rechnet allein `AUTH_RATE_LIMIT_REGISTER_MAX + 1` = 6
 * Registrierungen samt ALTCHA-Nachweis. Auf einer ruhigen Maschine sind das
 * ~750 ms, unter Last dieser Maschine wurden 1831 ms (Maßnahme W2-28) und
 * 2421 ms gemessen – die Vitest-Vorgabe von 5000 ms ist damit nicht mehr weit,
 * und der Test fiel gelegentlich in die Frist statt an einer Zusicherung.
 *
 * **Warum für die ganze Datei und nicht für den einen Test.** Gemessen über
 * mehrere Läufe gibt es keine Kante: hinter dem Rate-Limit-Test (1985 ms)
 * folgen der Passwort-Reset (1867 ms) und der erzwungene Wechsel (1481 ms)
 * dicht auf, danach läuft es stetig aus. Die Ursache ist bei allen dieselbe,
 * und unter Last skalieren sie gemeinsam – eine handverlesene Liste einzelner
 * Tests wäre willkürlich gezogen und würde beim nächsten hinzugefügten
 * Registrierungsschritt erneut umfallen.
 *
 * **Warum nicht global und warum nicht billiger hashen.** Global heraufgesetzt
 * würde das Limit echte Hänger in allen anderen Suiten verdecken; `vi.setConfig`
 * wirkt nur in dieser Datei. Die Kosten des Hashings zu senken, hätte eine Naht
 * in `passwords.ts` gebraucht – die gibt es nicht, und sie nachzurüsten hieße,
 * den Produktivpfad der Passwortprüfung für Tests abzuschwächen oder
 * wegzumocken (CLAUDE.md §2). Der Test soll gerade die echte Kette prüfen.
 *
 * 30 s sind großzügig gegenüber dem Gemessenen und fangen einen echten Hänger
 * (nicht aufgelöstes Promise, Deadlock) trotzdem ab, statt ihn laufen zu lassen.
 */
vi.setConfig({ testTimeout: 30_000 });

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
  roles = createFakeRoleRepository([
    { name: 'Admin', permissions: ['user.manage'] },
    { name: 'Vollverwalter', permissions: ['user.manage', 'role.manage'] },
  ]);
  app = await buildServer({
    /*
     * Wie in `admin-identity.test.ts`: Die datenbankgestützten Module bleiben
     * draußen (Audit W2-28, `test-gaps-01`). Ohne das Abschalten hing dieser
     * Test daran, ob auf der Maschine eine `.env` mit `DATABASE_URL` liegt –
     * ohne Variable grün, mit unerreichbarer Datenbank 25-mal rot
     * (`expected 500 to be 201` aus den Instanz-Einstellungen), und in der CI
     * lief er still gegen die echte Postgres. Datenbanknahe Tests stehen jetzt
     * ausdrücklich in den `*.db.test.ts`-Dateien.
     */
    database: false,
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

    /*
     * Der Refresh-Token liegt auf `/`, damit die Route-Sperre des Frontends
     * eine abgelaufene Sitzung erneuern kann – sie sieht sonst nur Cookies,
     * die zum aufgerufenen Pfad passen. Abgesichert ist er durch `httpOnly`,
     * `SameSite=Lax` und die CSRF-Pflicht auf `/auth/refresh`.
     */
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.path).toBe('/');
    expect(refresh?.sameSite?.toLowerCase()).toBe('lax');

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

  /*
   * Audit backend-auth-05: Vorher beantwortete `parseBody` jeden Schema-Verstoß
   * pauschal mit `AUTH_PASSWORD_TOO_WEAK` – auch einen zu kurzen Benutzernamen.
   * Das Formular markierte damit das falsche Feld.
   */
  it('nennt zu jedem Feld den passenden Fehlercode', async () => {
    const nachricht = await solveAltcha();

    const benutzername = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'ab', password: PASSWORD, altcha: nachricht },
    });
    expect(benutzername.statusCode).toBe(400);
    expect(benutzername.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');

    const anzeigename = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'spieler', password: PASSWORD, displayName: 'x', altcha: nachricht },
    });
    expect(anzeigename.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');

    const nachweis = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'spieler', password: PASSWORD },
    });
    expect(nachweis.json<{ error: { code: string } }>().error.code).toBe('AUTH_CAPTCHA_INVALID');

    // Die Meldung des Schemas bleibt erhalten und nennt das Feld beim Namen.
    expect(benutzername.json<{ error: { message: string } }>().error.message).toContain(
      'Benutzername',
    );
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

  it('lehnt einen Login ohne ALTCHA-Nachweis ab', async () => {
    // Pflichtenheft §7 und §18 verlangen den Spam-Schutz auch beim Login. Ein
    // stilles Durchwinken wäre ein Auth-Bypass (CLAUDE.md §2).
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_CAPTCHA_INVALID');
    expect(response.cookies.some((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toBe(false);
  });

  it('lehnt einen Login mit gefälschtem ALTCHA-Nachweis ab', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: 'gefaelscht' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_CAPTCHA_INVALID');
    expect(response.cookies.some((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toBe(false);
  });

  it('lässt denselben ALTCHA-Nachweis kein zweites Mal gelten', async () => {
    const solved = await solveAltcha();

    const first = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: solved },
    });
    expect(first.statusCode).toBe(200);

    // Wäre der Nachweis mehrfach verwendbar, würde eine einmal geleistete
    // Arbeit für beliebig viele weitere Versuche reichen.
    const second = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: solved },
    });

    expect(second.statusCode).toBe(400);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('AUTH_CAPTCHA_INVALID');
  });

  it('lässt einen bei der Registrierung eingelösten Nachweis nicht beim Login gelten', async () => {
    const solved = await solveAltcha();

    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'zweitkonto', password: PASSWORD, altcha: solved },
    });
    expect(registered.statusCode).toBe(201);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'zweitkonto', password: PASSWORD, altcha: solved },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_CAPTCHA_INVALID');
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

  it('meldet auch ohne gültiges Zugriffs-Token ab (Fundpunkt frontend-lib-05)', async () => {
    /*
     * Nach 15 Minuten verwirft der Browser das Access-Cookie (Max-Age), Refresh-
     * und CSRF-Cookie bleiben. Bisher löschte „Abmelden" dann nur die Cookies,
     * während die Sitzung 30 Tage lang gültig und erneuerbar blieb.
     */
    const abgelaufen = { ...jar };
    delete abgelaufen[ACCESS_COOKIE_NAME];

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: cookieHeader(abgelaufen),
        [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.sessions[0]?.revokedAt).not.toBeNull();

    // Und der Refresh-Token trägt danach nicht mehr.
    const erneuert = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: cookieHeader(abgelaufen),
        [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '',
      },
    });

    expect(erneuert.statusCode).toBe(401);
  });

  it('verlangt auch beim Abmelden über den Refresh-Token einen CSRF-Header', async () => {
    const abgelaufen = { ...jar };
    delete abgelaufen[ACCESS_COOKIE_NAME];

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader(abgelaufen) },
    });

    expect(response.statusCode).toBe(403);
    expect(repository.sessions[0]?.revokedAt).toBeNull();
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

  /*
   * Fundpunkt 140: Der Sammelpfad. Vorher gab es nur `:sessionId`, und die
   * Oberfläche schickte ein `DELETE` je Gerät.
   */
  it('meldet mit einem Aufruf alle anderen Geräte ab und bleibt selbst angemeldet', async () => {
    const zweites = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: await solveAltcha() },
    });
    const zweitesJar = collectCookies({}, zweites);
    const drittes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: await solveAltcha() },
    });
    const drittesJar = collectCookies({}, drittes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/sessions',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
    });

    expect(response.statusCode).toBe(200);
    // Die Antwort trägt die verbliebenen Sitzungen – dieselbe Nutzlast wie GET.
    const verbleibend = response.json<{ data: { id: string; current: boolean }[] }>().data;
    expect(verbleibend).toHaveLength(1);
    expect(verbleibend[0]?.current).toBe(true);

    // Beide fremden Geräte sind sofort draußen, obwohl ihr Access-Token
    // formal noch gälte.
    for (const fremd of [zweitesJar, drittesJar]) {
      const blocked = await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: { cookie: cookieHeader(fremd) },
      });
      expect(blocked.statusCode).toBe(401);
    }

    // Die eigene Sitzung gilt weiter, und die Cookies bleiben stehen.
    const eigene = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: cookieHeader(jar) },
    });
    expect(eigene.statusCode).toBe(200);
    expect(response.cookies.filter((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toHaveLength(0);
  });

  it('verlangt für den Sammel-Logout einen CSRF-Header', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/sessions',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(response.statusCode).toBe(403);
    expect(repository.sessions.every((session) => session.revokedAt === null)).toBe(true);
  });

  it('lehnt den Sammel-Logout ohne Anmeldung ab', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/sessions',
      headers: { [CSRF_HEADER_NAME]: 'x', cookie: `${CSRF_COOKIE_NAME}=x` },
    });

    expect(response.statusCode).toBe(401);
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

describe('Zweiter Anmeldeschritt über HTTP (Pflichtenheft §7)', () => {
  /**
   * Schaltet die 2FA für das angemeldete Konto über die Routen ein und meldet
   * danach ab; zurück kommt das TOTP-Geheimnis.
   *
   * Bewusst über HTTP statt am Dienst vorbei: Geprüft werden soll ja gerade der
   * Weg, den der Browser nimmt.
   */
  async function enableTwoFactor(jar: CookieJar): Promise<string> {
    const csrf = jar[CSRF_COOKIE_NAME] ?? '';

    const setup = await app.inject({
      method: 'POST',
      url: '/auth/2fa/setup',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: csrf },
    });
    expect(setup.statusCode).toBe(200);
    const secret = setup.json<{ data: { secret: string } }>().data.secret;

    const confirmed = await app.inject({
      method: 'POST',
      url: '/auth/2fa/confirm',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: csrf },
      payload: { code: generateTotp(secret, Date.now()) },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<{ data: { account: AccountDto } }>().data.account.twoFactorEnabled).toBe(
      true,
    );

    return secret;
  }

  /** Erster Schritt mit aktivierter 2FA. */
  function login(): Promise<Awaited<ReturnType<typeof app.inject>>> {
    return solveAltcha().then((altcha) =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'spieler', password: PASSWORD, altcha },
      }),
    );
  }

  it('gibt im ersten Schritt einen Zwischen-Token und noch keine Sitzungs-Cookies aus', async () => {
    /*
     * Der Kern des Findings `test-gaps-06`: Im Dienst ist der Schritt dicht
     * getestet, aber der Dienst sieht keine Cookies. Setzte die Route sie schon
     * hier, wäre der zweite Faktor wirkungslos – und kein Test bemerkte es.
     */
    const { jar } = await registerAccount('spieler');
    await enableTwoFactor(jar);

    const response = await login();
    const body = response.json<{ data: { status: string; twoFactorToken?: string } }>().data;

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('two_factor_required');
    expect(body.twoFactorToken).toBeTruthy();

    const namen = response.cookies.map((cookie) => cookie.name);
    expect(namen).not.toContain(ACCESS_COOKIE_NAME);
    expect(namen).not.toContain(REFRESH_COOKIE_NAME);
  });

  it('setzt die Sitzungs-Cookies erst nach dem bestätigten Code', async () => {
    const { jar } = await registerAccount('spieler');
    const secret = await enableTwoFactor(jar);

    const erster = await login();
    const token = erster.json<{ data: { twoFactorToken: string } }>().data.twoFactorToken;

    const zweiter = await app.inject({
      method: 'POST',
      url: '/auth/login/2fa',
      payload: { twoFactorToken: token, code: generateTotp(secret, Date.now()) },
    });

    expect(zweiter.statusCode).toBe(200);
    const namen = zweiter.cookies.map((cookie) => cookie.name);
    expect(namen).toContain(ACCESS_COOKIE_NAME);
    expect(namen).toContain(REFRESH_COOKIE_NAME);
    expect(namen).toContain(CSRF_COOKIE_NAME);

    // Und die neuen Cookies tragen tatsächlich eine Sitzung.
    const neu = collectCookies({}, zweiter);
    const sitzung = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: cookieHeader(neu) },
    });
    expect(sitzung.statusCode).toBe(200);
    expect(sitzung.json<{ data: { account: AccountDto } }>().data.account.username).toBe('spieler');
  });

  it('lehnt einen falschen Code mit 401 und ohne Cookies ab', async () => {
    const { jar } = await registerAccount('spieler');
    await enableTwoFactor(jar);

    const erster = await login();
    const token = erster.json<{ data: { twoFactorToken: string } }>().data.twoFactorToken;

    const zweiter = await app.inject({
      method: 'POST',
      url: '/auth/login/2fa',
      payload: { twoFactorToken: token, code: '000000' },
    });

    expect(zweiter.statusCode).toBe(401);
    expect(zweiter.json<{ error: { code: string } }>().error.code).toBe('AUTH_TWO_FACTOR_INVALID');
    expect(zweiter.cookies.some((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toBe(false);
  });

  it('lehnt einen erfundenen Zwischen-Token ab, auch mit gültigem Code', async () => {
    const { jar } = await registerAccount('spieler');
    const secret = await enableTwoFactor(jar);

    const zweiter = await app.inject({
      method: 'POST',
      url: '/auth/login/2fa',
      payload: { twoFactorToken: 'selbst.gebastelt.token', code: generateTotp(secret, Date.now()) },
    });

    expect(zweiter.statusCode).toBe(401);
    expect(zweiter.cookies.some((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toBe(false);
  });

  it('nimmt den Zwischen-Token nicht als Zugriffs-Token an', async () => {
    // Beide sind signierte JWT desselben Geheimnisses; nur die Nutzlast trennt
    // sie. Ein zu nachsichtiges Prüfen machte den zweiten Faktor überflüssig.
    const { jar } = await registerAccount('spieler');
    await enableTwoFactor(jar);

    const erster = await login();
    const token = erster.json<{ data: { twoFactorToken: string } }>().data.twoFactorToken;

    const response = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `${ACCESS_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('Gleichzeitige Erneuerungen (Pflichtenheft §7, backend-auth-02)', () => {
  it('bedient zwei parallele Refreshes mit demselben Token, ohne die Sitzung zu verwerfen', async () => {
    /*
     * Der Browser schickt zwei Anfragen los, deren Zugriffs-Token gerade
     * abgelaufen ist – beide erneuern mit **demselben** Refresh-Token. Vor der
     * Kulanzfrist (W2-1) las der zweite Aufruf einen bereits ersetzten Token,
     * wertete das als Diebstahl und widerrief alle Sitzungen des Kontos: Der
     * Nutzer flog beim Öffnen zweier Reiter aus dem Panel.
     *
     * Bewusst ohne `await` dazwischen – genau das unterscheidet diesen Test von
     * den sequentiellen Rotationstests im Dienst.
     */
    const { jar } = await registerAccount('spieler');
    const kopf = {
      cookie: cookieHeader(jar),
      [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '',
    };

    const [erste, zweite] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/refresh', headers: kopf }),
      app.inject({ method: 'POST', url: '/auth/refresh', headers: kopf }),
    ]);

    expect(erste.statusCode).toBe(200);
    expect(zweite.statusCode).toBe(200);

    // Jede Antwort bringt ein eigenes Refresh-Cookie mit; keine der beiden
    // übernimmt die Sitzung der anderen.
    const ersteCookies = collectCookies({}, erste);
    const zweiteCookies = collectCookies({}, zweite);
    expect(ersteCookies[REFRESH_COOKIE_NAME]).toBeTruthy();
    expect(zweiteCookies[REFRESH_COOKIE_NAME]).toBeTruthy();
    expect(ersteCookies[REFRESH_COOKIE_NAME]).not.toBe(zweiteCookies[REFRESH_COOKIE_NAME]);

    // Und die Sitzung lebt: kein Rundumschlag durch `revokeEverySession`.
    expect(repository.sessions.every((sitzung) => sitzung.revokedAt === null)).toBe(true);

    const sitzung = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: cookieHeader(zweiteCookies) },
    });
    expect(sitzung.statusCode).toBe(200);
  });

  it('widerruft weiterhin alles, wenn ein längst ersetzter Token wieder auftaucht', async () => {
    /*
     * Die Kehrseite: Die Kulanzfrist darf den Diebstahlsschutz nicht abschalten.
     * Ein Token, dessen Sitzung nach der Frist erneut damit erneuert werden
     * soll, gilt weiter als Anzeichen (Pflichtenheft §7).
     */
    const { jar } = await registerAccount('spieler');
    const alt = jar[REFRESH_COOKIE_NAME] ?? '';
    const csrf = jar[CSRF_COOKIE_NAME] ?? '';

    const erneuert = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: csrf },
    });
    expect(erneuert.statusCode).toBe(200);

    /*
     * Kulanzfrist künstlich ablaufen lassen, statt sie abzuwarten: Die Rotation
     * wird auf 60 s zurückdatiert, also auf das Doppelte von
     * `REFRESH_ROTATION_GRACE_MS` (30 s, modulintern in `service.ts`). Der
     * Abstand ist bewusst großzügig – bei einer knapp darüber liegenden Zahl
     * entschiede die Laufzeit des Testlaufs mit.
     */
    repository.sessions.forEach((sitzung, index) => {
      repository.sessions[index] = { ...sitzung, rotatedAt: new Date(Date.now() - 60_000) };
    });

    const nochmal = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: `${REFRESH_COOKIE_NAME}=${alt}; ${CSRF_COOKIE_NAME}=${csrf}`,
        [CSRF_HEADER_NAME]: csrf,
      },
    });

    expect(nochmal.statusCode).toBe(401);
    expect(repository.sessions.every((sitzung) => sitzung.revokedAt !== null)).toBe(true);
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

  /*
   * Audit backend-auth-09: Wer eine verdächtige Fremdsitzung sieht, muss sie
   * sofort abmelden können – erst das Passwort zu wechseln, während die fremde
   * Sitzung weiterläuft, dreht die Reihenfolge um.
   */
  it('lässt den Widerruf einer Sitzung zu', async () => {
    const { jar } = await registerAccount('spieler');

    // Zweite Sitzung desselben Kontos, damit es etwas zu widerrufen gibt.
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: await solveAltcha() },
    });

    const method = repository.methods[0];
    repository.methods[0] = { ...method!, mustChangePassword: true };

    const sessions = await app.inject({
      method: 'GET',
      url: '/auth/sessions',
      headers: { cookie: cookieHeader(jar) },
    });
    const fremd = sessions
      .json<{ data: { id: string; current: boolean }[] }>()
      .data.find((session) => !session.current);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/auth/sessions/${fremd?.id ?? ''}`,
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
    });

    expect(revoked.statusCode).toBe(200);
  });

  // Aus demselben Grund steht auch der Sammelpfad auf der Liste (Fundpunkt 140).
  it('lässt auch den Sammel-Logout zu', async () => {
    const { jar } = await registerAccount('spieler');

    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'spieler', password: PASSWORD, altcha: await solveAltcha() },
    });

    const method = repository.methods[0];
    repository.methods[0] = { ...method!, mustChangePassword: true };

    const revoked = await app.inject({
      method: 'DELETE',
      url: '/auth/sessions',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
    });

    expect(revoked.statusCode).toBe(200);
    expect(revoked.json<{ data: { current: boolean }[] }>().data).toHaveLength(1);
  });

  it('lässt die Konto-Löschung zu, das Profil aber nicht', async () => {
    const { jar } = await registerAccount('spieler');
    const method = repository.methods[0];
    repository.methods[0] = { ...method!, mustChangePassword: true };

    const headers = {
      cookie: cookieHeader(jar),
      [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '',
    };

    // Der Anzeigename ist keine Ausnahme: `/auth/account` trägt zwei Vorgänge,
    // die Liste unterscheidet sie an der Methode.
    const profil = await app.inject({
      method: 'PATCH',
      url: '/auth/account',
      headers,
      payload: { displayName: 'Neuer Name' },
    });
    expect(profil.statusCode).toBe(403);
    expect(profil.json<{ error: { code: string } }>().error.code).toBe(
      'AUTH_PASSWORD_CHANGE_REQUIRED',
    );

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers,
      payload: { confirmName: 'spieler', password: PASSWORD },
    });
    expect(deleted.statusCode).toBe(200);
    expect(repository.users).toHaveLength(0);
  });

  it('bleibt für beide Ausnahmen bei der CSRF-Pflicht', async () => {
    // Die Ausnahme gilt dem erzwungenen Passwortwechsel, nicht dem
    // Double-Submit: Beides sind zustandsändernde Vorgänge an einer
    // bestehenden Sitzung.
    const { jar } = await registerAccount('spieler');
    const method = repository.methods[0];
    repository.methods[0] = { ...method!, mustChangePassword: true };

    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/account',
      headers: { cookie: cookieHeader(jar) },
      payload: { confirmName: 'spieler', password: PASSWORD },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_CSRF_INVALID');
    expect(repository.users).toHaveLength(1);
  });
});

describe('Anzeigename ändern (Lastenheft §3.1)', () => {
  it('nimmt den neuen Namen an und schickt das aktualisierte Konto zurück', async () => {
    const { jar, account } = await registerAccount('spieler');

    const response = await app.inject({
      method: 'PATCH',
      url: '/auth/account',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
      payload: { displayName: '  Der Kapitän  ' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { account: AccountDto } }>().data.account;
    expect(body.id).toBe(account.id);
    // Leerraum schneidet das Schema ab, bevor der Wert im Service ankommt.
    expect(body.displayName).toBe('Der Kapitän');
  });

  it('weist einen zu kurzen Namen ab', async () => {
    const { jar } = await registerAccount('spieler');

    const response = await app.inject({
      method: 'PATCH',
      url: '/auth/account',
      headers: { cookie: cookieHeader(jar), [CSRF_HEADER_NAME]: jar[CSRF_COOKIE_NAME] ?? '' },
      payload: { displayName: 'x' },
    });

    expect(response.statusCode).toBe(400);
    // Der Anzeigename ist kein Passwortfeld (Audit backend-auth-05).
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });

  it('verlangt eine Anmeldung', async () => {
    // Mit passendem CSRF-Paar, aber ohne Sitzung: sonst greift die
    // CSRF-Pruefung zuerst und der Auth-Teil bliebe ungeprueft.
    const response = await app.inject({
      method: 'PATCH',
      url: '/auth/account',
      headers: { cookie: `${CSRF_COOKIE_NAME}=probe`, [CSRF_HEADER_NAME]: 'probe' },
      payload: { displayName: 'Fremder' },
    });

    expect(response.statusCode).toBe(401);
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

  // -- Rangregel (Fundpunkte 119 und 124) ----------------------------------

  async function adminWithRole(roleName: string): Promise<ReturnType<typeof registerAccount>> {
    const admin = await registerAccount(`admin-${roleName.toLowerCase()}`);
    const role = roles.roles.find((candidate) => candidate.name === roleName);
    await roles.assignToUser(admin.account.id, role!.id);

    return admin;
  }

  it('lässt user.manage allein kein Konto mit Verwaltungsrolle anlegen (Fundpunkt 119)', async () => {
    const admin = await adminWithRole('Admin');
    const adminRole = roles.roles.find((role) => role.name === 'Admin');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/admin/users',
      headers: {
        cookie: cookieHeader(admin.jar),
        [CSRF_HEADER_NAME]: admin.jar[CSRF_COOKIE_NAME] ?? '',
      },
      payload: { username: 'neu', password: PASSWORD, roleIds: [adminRole!.id] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
    expect(repository.users.some((user) => user.username === 'neu')).toBe(false);
  });

  it('legt mit role.manage auch Konten mit Verwaltungsrolle an', async () => {
    const admin = await adminWithRole('Vollverwalter');
    const adminRole = roles.roles.find((role) => role.name === 'Admin');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/admin/users',
      headers: {
        cookie: cookieHeader(admin.jar),
        [CSRF_HEADER_NAME]: admin.jar[CSRF_COOKIE_NAME] ?? '',
      },
      payload: { username: 'neu', password: PASSWORD, roleIds: [adminRole!.id] },
    });

    expect(response.statusCode).toBe(201);
    expect(
      response.json<{ data: { account: AccountDto } }>().data.account.roles.map((r) => r.name),
    ).toEqual(['Admin']);
  });

  it('schützt das Owner-Konto vor Passwort-Reset und 2FA-Abschaltung (Fundpunkt 124)', async () => {
    const owner = await registerAccount('owner');
    await repository.setOwner(owner.account.id);
    const admin = await adminWithRole('Vollverwalter');
    const headers = {
      cookie: cookieHeader(admin.jar),
      [CSRF_HEADER_NAME]: admin.jar[CSRF_COOKIE_NAME] ?? '',
    };

    const reset = await app.inject({
      method: 'POST',
      url: `/auth/admin/users/${owner.account.id}/password-reset`,
      headers,
    });
    expect(reset.statusCode).toBe(403);
    expect(reset.json<{ error: { code: string } }>().error.code).toBe('AUTH_OWNER_PROTECTED');

    const twoFactor = await app.inject({
      method: 'DELETE',
      url: `/auth/admin/users/${owner.account.id}/2fa`,
      headers,
    });
    expect(twoFactor.statusCode).toBe(403);
    expect(twoFactor.json<{ error: { code: string } }>().error.code).toBe('AUTH_OWNER_PROTECTED');
  });

  it('lässt user.manage allein kein Verwaltungskonto zurücksetzen (Fundpunkt 124)', async () => {
    const target = await adminWithRole('Vollverwalter');
    const admin = await adminWithRole('Admin');

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/users/${target.account.id}/password-reset`,
      headers: {
        cookie: cookieHeader(admin.jar),
        [CSRF_HEADER_NAME]: admin.jar[CSRF_COOKIE_NAME] ?? '',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
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

  /*
   * Fundpunkt 134: Ein gescheitertes Verknüpfen ging auf `/login?error=<CODE>`.
   * Von dort schickt die Middleware ein angemeldetes Konto sofort weiter auf
   * die Serverübersicht, und die wertet den Code nicht aus – die Meldung kam
   * also nie an. Der Anmelde-Fall bleibt unverändert bei `/login`.
   */
  it('schickt ein gescheitertes Verknüpfen zurück zum Ausgangsort (Fundpunkt 134)', async () => {
    const { jar } = await registerAccount('spieler');
    const start = await app.inject({
      method: 'GET',
      url: '/auth/discord/start?returnTo=%2Fprofil',
      headers: { cookie: cookieHeader(jar) },
    });
    const withState = collectCookies(jar, start);

    // Untergeschobener `state`: Der Dienst weist die Rückkehr ab.
    const callback = await app.inject({
      method: 'GET',
      url: '/auth/discord/callback?state=untergeschoben&code=abc',
      headers: { cookie: cookieHeader(withState) },
    });

    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toMatch(/\/profil\?error=AUTH_OAUTH_STATE_INVALID$/);
    // Verknüpft wurde nichts – nur das Passwort-Verfahren steht am Konto.
    expect(repository.methods.map((method) => method.type)).toEqual(['password']);
  });

  it('bleibt beim Anmelde-Fall unverändert auf der Anmeldeseite', async () => {
    // Ohne Anmeldung ist die Rückkehr ein Login-Versuch: `/login` zeigt den
    // Code an (`LoginView`), ein Rücksprungziel gibt es hier nicht.
    const start = await app.inject({ method: 'GET', url: '/auth/discord/start' });
    const jar = collectCookies({}, start);

    const callback = await app.inject({
      method: 'GET',
      url: '/auth/discord/callback?state=untergeschoben&code=abc',
      headers: { cookie: cookieHeader(jar) },
    });

    expect(callback.headers.location).toMatch(/\/login\?error=AUTH_OAUTH_STATE_INVALID$/);
  });

  it('fällt beim Verknüpfen ohne Rücksprungziel auf die Übersicht zurück', async () => {
    // Ohne `returnTo` steht im Cookie das Standardziel – die Allowlist lässt
    // nichts anderes zu, ein untergeschobener Wert landet ebenfalls hier.
    const { jar } = await registerAccount('spieler');
    const start = await app.inject({
      method: 'GET',
      url: '/auth/discord/start?returnTo=https%3A%2F%2Fboese.tld',
      headers: { cookie: cookieHeader(jar) },
    });
    const withState = collectCookies(jar, start);

    const callback = await app.inject({
      method: 'GET',
      url: '/auth/discord/callback?state=untergeschoben&code=abc',
      headers: { cookie: cookieHeader(withState) },
    });

    expect(callback.headers.location).toMatch(/\/servers\?error=AUTH_OAUTH_STATE_INVALID$/);
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
