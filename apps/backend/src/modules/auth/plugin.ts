/**
 * Einhängen des Auth-Moduls in die Fastify-Instanz (Pflichtenheft §7).
 *
 * Reihenfolge je Request:
 * 1. `onRequest`: Access-Token aus dem Cookie prüfen, Sitzung gegen die
 *    Datenbank auflösen und Konto an den Request hängen. Erst dieser zweite
 *    Schritt macht den Remote-Logout sofort wirksam – ein noch gültiges JWT
 *    einer widerrufenen Sitzung reicht nicht.
 * 2. `onRequest`: CSRF-Token bei zustandsändernden Requests prüfen
 *    (Double-Submit, Pflichtenheft §7).
 * 3. `onRequest`: Konten mit erzwungenem Passwortwechsel auf die dafür nötigen
 *    Routen beschränken (Lastenheft §3.1).
 *
 * Die Auflösung der effektiven Rechte (RBAC-Hook aus B2) hängt `server.ts`
 * anschließend ein – dort, wo auch ohne Auth-Modul ein Handelnder ermittelt
 * werden kann. Diese Reihenfolge ist nötig, damit `request.authUser` bereits
 * gesetzt ist, wenn der Hook läuft.
 *
 * Bewusst als normale Funktion statt als Fastify-Plugin – dieselbe Begründung
 * wie bei `registerRbac` in B2: `decorateRequest` wirkt sonst nur im
 * Plugin-Kontext, und `fastify-plugin` als zusätzliche Abhängigkeit wäre dafür
 * nicht gerechtfertigt (CLAUDE.md §1).
 */

import fastifyCookie from '@fastify/cookie';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@palantir/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type AuthSecrets, env, requireAuthSecrets } from '../../config/env.js';
import { getDb } from '../../db/index.js';
import {
  type RoleRepository,
  createDrizzleRoleRepository,
  replyWithErrorCode,
} from '../rbac/index.js';
import { ACCESS_COOKIE_NAME, type CookieSettings } from './cookies.js';
import { csrfTokenMatches, isSafeMethod } from './csrf.js';
import { type FetchLike, type ProviderRegistry, createProviderRegistry } from './providers.js';
import { createRateLimiter } from './rate-limit.js';
import { createDrizzleAuthRepository } from './repository.js';
import { registerAuthRoutes } from './routes.js';
import { AuthService } from './service.js';
import { parseDurationMs, verifyAccessToken } from './tokens.js';
import type { AuthRepository, UserRecord } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Angemeldetes Konto; `null`, solange niemand angemeldet ist. */
    authUser: UserRecord | null;
    /** Id der Sitzung, aus der der Request stammt. */
    authSessionId: string | null;
  }
}

export interface AuthModuleOptions {
  /** Einspeisbar für Tests; sonst die Drizzle-Implementierung. */
  readonly repository?: AuthRepository;
  readonly roles?: RoleRepository;
  /** Einspeisbar, damit Anbieter-Abläufe ohne Netzzugang testbar sind. */
  readonly fetchImpl?: FetchLike;
  /** Vollständig ersetzte Anbieter-Registry – nur für Tests. */
  readonly providers?: ProviderRegistry;
  readonly secrets?: AuthSecrets;
}

/**
 * Routen, die auch mit erzwungenem Passwortwechsel erreichbar bleiben müssen –
 * sonst käme der Nutzer aus dem Zustand nicht mehr heraus.
 */
const PASSWORD_CHANGE_EXEMPT_PATHS = new Set([
  '/auth/password/change',
  '/auth/logout',
  '/auth/refresh',
  '/auth/altcha/challenge',
]);

/**
 * Anmelde-Routen ohne CSRF-Prüfung.
 *
 * Dort existiert noch keine Sitzung, die sich seitenübergreifend missbrauchen
 * ließe; ein Angreifer könnte höchstens einen Login-Versuch mit eigenen
 * Zugangsdaten auslösen. `refresh` ist bewusst **nicht** ausgenommen: der
 * Refresh-Token hängt an einer bestehenden Sitzung.
 */
const CSRF_EXEMPT_PATHS = new Set(['/auth/register', '/auth/login', '/auth/login/2fa']);

function routePath(request: FastifyRequest): string {
  // `routerPath` ist das Muster der Route (ohne Query); fällt zurück auf die
  // rohe URL, falls noch keine Route zugeordnet wurde.
  return (request.routeOptions.url ?? request.url.split('?')[0]) || '';
}

export async function registerAuthModule(
  app: FastifyInstance,
  options: AuthModuleOptions = {},
): Promise<AuthService> {
  const secrets = options.secrets ?? requireAuthSecrets();

  await app.register(fastifyCookie, { secret: secrets.csrfSecret });

  const cookies: CookieSettings = {
    secure: env.COOKIE_SECURE,
    domain: env.COOKIE_DOMAIN && env.COOKIE_DOMAIN.length > 0 ? env.COOKIE_DOMAIN : undefined,
  };

  const repository = options.repository ?? createDrizzleAuthRepository(getDb());
  const roles = options.roles ?? createDrizzleRoleRepository(getDb());

  const service = new AuthService({
    repository,
    roles,
    providers:
      options.providers ??
      createProviderRegistry(
        {
          discord: {
            clientId: env.DISCORD_CLIENT_ID,
            clientSecret: env.DISCORD_CLIENT_SECRET,
            redirectUri: env.DISCORD_REDIRECT_URI,
          },
          twitch: {
            clientId: env.TWITCH_CLIENT_ID,
            clientSecret: env.TWITCH_CLIENT_SECRET,
            redirectUri: env.TWITCH_REDIRECT_URI,
          },
          steam: { apiKey: env.STEAM_API_KEY, returnUrl: env.STEAM_RETURN_URL },
        },
        options.fetchImpl,
      ),
    refreshTokenTtlMs: parseDurationMs(env.REFRESH_TOKEN_TTL),
    jwtSecret: secrets.jwtSecret,
    twoFactorTokenTtlMs: parseDurationMs(env.TWO_FACTOR_TOKEN_TTL),
    totpIssuer: env.PALANTIR_DOMAIN,
  });

  app.decorateRequest('authUser', null);
  app.decorateRequest('authSessionId', null);

  // 1. Sitzung auflösen.
  app.addHook('onRequest', async (request): Promise<void> => {
    const token = request.cookies[ACCESS_COOKIE_NAME];

    if (!token) {
      return;
    }

    const claims = await verifyAccessToken(token, { secret: secrets.jwtSecret });

    if (!claims) {
      return;
    }

    try {
      const { user, session } = await service.resolveSession(claims.sessionId);

      // Das Token muss zu derselben Sitzung **und** demselben Konto gehören.
      if (user.id !== claims.userId) {
        return;
      }

      request.authUser = user;
      request.authSessionId = session.id;
    } catch {
      // Abgelaufene, widerrufene oder gesperrte Sitzung: der Request gilt als
      // nicht angemeldet. Die betroffenen Routen antworten dann mit
      // AUTH_REQUIRED bzw. löschen beim Refresh die Cookies.
    }
  });

  // 2. CSRF-Schutz für zustandsändernde Requests (Pflichtenheft §7, §18).
  app.addHook('onRequest', async (request, reply): Promise<void> => {
    if (isSafeMethod(request.method) || CSRF_EXEMPT_PATHS.has(routePath(request))) {
      return;
    }

    if (!csrfTokenMatches(request.cookies[CSRF_COOKIE_NAME], request.headers[CSRF_HEADER_NAME])) {
      await replyWithErrorCode(reply, 'AUTH_CSRF_INVALID');
    }
  });

  // 3. Erzwungener Passwortwechsel (Lastenheft §3.1).
  app.addHook('onRequest', async (request, reply): Promise<void> => {
    if (!request.authUser || isSafeMethod(request.method)) {
      return;
    }

    if (PASSWORD_CHANGE_EXEMPT_PATHS.has(routePath(request))) {
      return;
    }

    const passwordMethod = await repository.findAuthMethod(request.authUser.id, 'password');

    if (passwordMethod?.mustChangePassword) {
      await replyWithErrorCode(reply, 'AUTH_PASSWORD_CHANGE_REQUIRED');
    }
  });

  registerAuthRoutes(app, {
    service,
    cookies,
    altcha: {
      hmacKey: secrets.altchaHmacKey,
      complexity: env.ALTCHA_COMPLEXITY,
      expirySeconds: env.ALTCHA_EXPIRY_SECONDS,
    },
    loginLimiter: createRateLimiter({
      windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
      maxAttempts: env.AUTH_RATE_LIMIT_LOGIN_MAX,
    }),
    registerLimiter: createRateLimiter({
      windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
      maxAttempts: env.AUTH_RATE_LIMIT_REGISTER_MAX,
    }),
    jwtSecret: secrets.jwtSecret,
    accessTokenTtlMs: parseDurationMs(env.JWT_ACCESS_TOKEN_TTL),
    publicWebUrl: env.PUBLIC_WEB_URL,
  });

  return service;
}
