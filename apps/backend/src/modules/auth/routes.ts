/**
 * HTTP-Schicht von Auth & Identity (Pflichtenheft §5.1 und §7).
 *
 * Zuständig für: Eingaben validieren (Zod-Schemas aus `@palantir/validation`),
 * Cookies setzen und löschen, Rate-Limit und ALTCHA vorschalten und das Ergebnis
 * in den Response-Envelope aus Pflichtenheft §5.1 packen. Jede fachliche Regel
 * liegt im Service.
 *
 * Fehler tragen ausschließlich benannte Codes aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5).
 */

import {
  type AccountDto,
  type AltchaChallenge,
  type ApiResponse,
  AUTH_METHOD_TYPES,
  type ErrorCode,
  type LoginResult,
  type PasswordResetResultDto,
  type SessionDto,
  type TwoFactorSetupDto,
  isOAuthProvider,
  ok,
} from '@palantir/contracts';
import {
  changePasswordInputSchema,
  confirmTwoFactorInputSchema,
  deleteAccountInputSchema,
  disableTwoFactorInputSchema,
  linkPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  twoFactorInputSchema,
  updateProfileInputSchema,
} from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { replyWithErrorCode, requirePermission } from '../rbac/index.js';
import {
  type AltchaOptions,
  type AltchaSolutionLedger,
  createAltchaChallenge,
  verifyAltchaSolution,
} from './altcha.js';
import {
  type CookieSettings,
  OAUTH_STATE_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  clearOAuthStateCookie,
  clearSessionCookies,
  setAccessCookie,
  setCsrfCookie,
  setOAuthStateCookie,
  setRefreshCookie,
} from './cookies.js';
import { createCsrfToken } from './csrf.js';
import { AuthError, isAuthError } from './errors.js';
import type { PendingAuthorization } from './providers.js';
import { type RateLimiter, rateLimitKey } from './rate-limit.js';
import { describeDevice, toIpHint } from './request-context.js';
import type { AuthService, IssuedSession, RequestContext } from './service.js';
import { signAccessToken } from './tokens.js';

export interface AuthRouteOptions {
  readonly service: AuthService;
  readonly cookies: CookieSettings;
  readonly altcha: AltchaOptions;
  /**
   * Verzeichnis eingelöster Nachweise – von Registrierung und Login geteilt,
   * damit derselbe Proof-of-Work an keiner der beiden Routen ein zweites Mal
   * zählt (Pflichtenheft §7).
   */
  readonly altchaLedger: AltchaSolutionLedger;
  readonly loginLimiter: RateLimiter;
  readonly registerLimiter: RateLimiter;
  readonly jwtSecret: string;
  readonly accessTokenTtlMs: number;
  /** Ziel des Rücksprungs nach einem Anbieter-Login. */
  readonly publicWebUrl: string | undefined;
}

/**
 * Ziele im Frontend, die nach einem Provider-Ablauf angesteuert werden.
 *
 * Die Pfade stammen aus `AUTH_ROUTES` bzw. `DASHBOARD_HOME` in
 * `apps/frontend/src/lib/auth/routes.ts` (F1). Sie stehen bewusst hier als
 * Konstanten und nicht im Vertrag: es sind Seitenadressen des Frontends, keine
 * Datenstrukturen – und das Backend braucht sie nur an dieser einen Stelle.
 */
const FRONTEND_LOGIN_PATH = '/login';
const FRONTEND_PENDING_PATH = '/pending';
const FRONTEND_HOME_PATH = '/servers';

/**
 * Interne Ziele, auf die eine Provider-Verknüpfung zurückkehren darf.
 *
 * Bewusst eine feste Allowlist statt einer freien Pfadprüfung: `frontendRedirect`
 * baut die Zieladresse über `new URL(path, base)` – ein von aussen gesetzter
 * absoluter Wert (`https://…`) wäre dort ein Open-Redirect. Nur die Seiten, die
 * eine Verknüpfung anstossen, kommen als Rücksprungziel in Frage; alles andere
 * fällt auf die Übersicht zurück.
 */
export const LINK_RETURN_PATHS: readonly string[] = ['/profil', '/einstellungen'];

export function sanitizeReturnTo(value: unknown): string {
  return typeof value === 'string' && LINK_RETURN_PATHS.includes(value)
    ? value
    : FRONTEND_HOME_PATH;
}

/**
 * Baut ein Rücksprung-Ziel im Frontend.
 *
 * Ohne gesetzte `PUBLIC_WEB_URL` wird relativ weitergeleitet – dann liegen
 * Frontend und API hinter demselben Reverse Proxy (Pflichtenheft §12.1).
 */
function frontendRedirect(
  options: AuthRouteOptions,
  path: string,
  params: Record<string, string> = {},
): string {
  const base = options.publicWebUrl ?? 'http://localhost';
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return options.publicWebUrl ? url.toString() : `${url.pathname}${url.search}`;
}

/**
 * Wohin ein Konto nach erfolgreicher Anmeldung gehört.
 *
 * Bildet `landingPathForAccount()` aus F1 nach – gesperrte Konten zurück zur
 * Anmeldung, noch nicht freigeschaltete auf den Gast-Wartebildschirm.
 */
function landingPath(account: AccountDto): string {
  if (account.banned) {
    return FRONTEND_LOGIN_PATH;
  }

  return account.awaitingApproval ? FRONTEND_PENDING_PATH : FRONTEND_HOME_PATH;
}

/** Ableitungen aus dem Request, die an einer neuen Sitzung hängen. */
function contextOf(request: FastifyRequest): RequestContext {
  return {
    deviceInfo: describeDevice(request.headers['user-agent']),
    ipHint: toIpHint(request.ip),
  };
}

/**
 * Setzt Access-, Refresh- und CSRF-Cookie für eine frisch erzeugte Sitzung.
 *
 * Das CSRF-Token wird bei jeder neuen Sitzung neu gezogen – ein Token aus einer
 * abgemeldeten Sitzung soll nicht weitergelten.
 */
async function issueCookies(
  reply: FastifyReply,
  userId: string,
  session: IssuedSession,
  options: AuthRouteOptions,
): Promise<void> {
  const accessToken = await signAccessToken(
    { userId, sessionId: session.sessionId },
    { secret: options.jwtSecret, ttlMs: options.accessTokenTtlMs },
  );

  setAccessCookie(reply, accessToken, options.accessTokenTtlMs, options.cookies);
  setRefreshCookie(reply, session.refreshToken, session.expiresAt, options.cookies);
  setCsrfCookie(reply, createCsrfToken(), options.cookies);
}

/**
 * Validiert einen Request-Body und wirft bei Fehlern einen benannten Code.
 *
 * `fieldCodes` erlaubt, einzelne Felder abweichend zu beantworten: ein
 * fehlender ALTCHA-Nachweis beim Login ist kein Zugangsdaten-Fehler, sondern
 * `AUTH_CAPTCHA_INVALID` – sonst bekäme das Formular eine Meldung, die auf das
 * falsche Feld zeigt.
 */
function parseBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  body: unknown,
  code: ErrorCode = 'AUTH_PASSWORD_TOO_WEAK',
  fieldCodes: Record<string, ErrorCode> = {},
): z.infer<TSchema> {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    // Die erste Meldung des Schemas ist bereits auf Deutsch und für die
    // Oberfläche gedacht; der Code kommt aus dem Katalog.
    const issue = parsed.error.issues[0];
    const field = typeof issue?.path[0] === 'string' ? issue.path[0] : null;

    throw new AuthError((field !== null ? fieldCodes[field] : undefined) ?? code, issue?.message);
  }

  return parsed.data as z.infer<TSchema>;
}

/** Prüft Rate-Limit und ALTCHA vor Registrierung und Login (Pflichtenheft §7). */
function guardPublicAttempt(
  request: FastifyRequest,
  limiter: RateLimiter,
  scope: string,
  altchaPayload: string,
  altcha: AltchaOptions,
  ledger: AltchaSolutionLedger,
): void {
  const decision = limiter.consume(rateLimitKey(scope, request.ip));

  if (!decision.allowed) {
    throw new AuthError(
      'AUTH_RATE_LIMITED',
      `Zu viele Versuche. Bitte in ${String(decision.retryAfterSeconds)} Sekunden erneut versuchen.`,
    );
  }

  // Prüft und löst den Nachweis zugleich ein: ein bereits verwendeter zählt
  // nicht erneut und ist von einem gefälschten nicht zu unterscheiden.
  if (!verifyAltchaSolution(altchaPayload, altcha, ledger)) {
    throw new AuthError('AUTH_CAPTCHA_INVALID');
  }
}

/** Liest den zwischengehaltenen OAuth-Zustand aus dem signierten Cookie. */
function readPendingAuthorization(request: FastifyRequest): PendingAuthorization {
  const raw = request.cookies[OAUTH_STATE_COOKIE_NAME];

  if (!raw) {
    throw new AuthError('AUTH_OAUTH_STATE_INVALID');
  }

  const unsigned = request.unsignCookie(raw);

  if (!unsigned.valid || !unsigned.value) {
    throw new AuthError('AUTH_OAUTH_STATE_INVALID');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8'));
  } catch {
    throw new AuthError('AUTH_OAUTH_STATE_INVALID');
  }

  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.state !== 'string' || typeof candidate.provider !== 'string') {
    throw new AuthError('AUTH_OAUTH_STATE_INVALID');
  }

  return {
    state: candidate.state,
    codeVerifier: typeof candidate.codeVerifier === 'string' ? candidate.codeVerifier : null,
  };
}

function pendingProvider(request: FastifyRequest): string | null {
  const raw = request.cookies[OAUTH_STATE_COOKIE_NAME];

  if (!raw) {
    return null;
  }

  const unsigned = request.unsignCookie(raw);

  if (!unsigned.valid || !unsigned.value) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as {
      provider?: unknown;
    };

    return typeof parsed.provider === 'string' ? parsed.provider : null;
  } catch {
    return null;
  }
}

/**
 * Rücksprungziel aus dem OAuth-Cookie, erneut gegen die Allowlist geprüft.
 *
 * Doppelte Prüfung mit Absicht: Der Wert wurde beim Start bereits gefiltert, hier
 * kommt er aus dem (signierten) Cookie – die zweite Prüfung stellt sicher, dass
 * auch ein manipuliertes Cookie kein fremdes Ziel erreicht.
 */
function pendingReturnTo(request: FastifyRequest): string {
  const raw = request.cookies[OAUTH_STATE_COOKIE_NAME];

  if (!raw) {
    return FRONTEND_HOME_PATH;
  }

  const unsigned = request.unsignCookie(raw);

  if (!unsigned.valid || !unsigned.value) {
    return FRONTEND_HOME_PATH;
  }

  try {
    const parsed = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')) as {
      returnTo?: unknown;
    };

    return sanitizeReturnTo(parsed.returnTo);
  } catch {
    return FRONTEND_HOME_PATH;
  }
}

/** Wandelt jeden bekannten Fehler in den Envelope aus Pflichtenheft §5.1. */
async function handle(
  reply: FastifyReply,
  work: () => Promise<void>,
  onAuthError?: (error: AuthError) => Promise<void> | void,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (isAuthError(error)) {
      await onAuthError?.(error);
      await replyWithErrorCode(reply, error.code, error.message);
      return;
    }

    throw error;
  }
}

function requireUserId(request: FastifyRequest): string {
  if (!request.authUser) {
    throw new AuthError('AUTH_REQUIRED');
  }

  return request.authUser.id;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { service } = options;

  // -- Öffentliche Vorstufen ------------------------------------------------

  /**
   * Neue Proof-of-Work-Aufgabe (Pflichtenheft §3).
   *
   * Der Pfad folgt `AUTH_ENDPOINTS.altchaChallenge` aus dem Client in F1.
   * Der Aufruf setzt zugleich das CSRF-Cookie: die Registrierungsseite holt die
   * Challenge ohnehin, bevor irgendetwas abgeschickt wird, und braucht danach
   * ein Token für die zustandsändernden Requests (Double-Submit, §7).
   */
  app.get(
    '/auth/altcha/challenge',
    async (_request, reply): Promise<ApiResponse<AltchaChallenge>> => {
      setCsrfCookie(reply, createCsrfToken(), options.cookies);

      return ok(createAltchaChallenge(options.altcha));
    },
  );

  // -- Registrierung & Login ------------------------------------------------

  app.post('/auth/register', async (request, reply) => {
    await handle(reply, async () => {
      const input = parseBody(registerInputSchema, request.body);

      guardPublicAttempt(
        request,
        options.registerLimiter,
        'register',
        input.altcha,
        options.altcha,
        options.altchaLedger,
      );

      const { account, session } = await service.register(input, contextOf(request));

      await issueCookies(reply, account.id, session, options);
      // Der Client in F1 erwartet die Hülle `{ account }`.
      await reply.status(201).send(ok({ account }));
    });
  });

  app.post('/auth/login', async (request, reply) => {
    await handle(reply, async () => {
      const input = parseBody(loginInputSchema, request.body, 'AUTH_INVALID_CREDENTIALS', {
        altcha: 'AUTH_CAPTCHA_INVALID',
      });

      // Pflichtenheft §7 und §18 verlangen den Spam-Schutz auch beim Login,
      // nicht nur bei der Registrierung. Ein fehlendes Feld fängt bereits das
      // Schema oben ab; hier wird der Nachweis selbst geprüft und eingelöst.
      guardPublicAttempt(
        request,
        options.loginLimiter,
        'login',
        input.altcha,
        options.altcha,
        options.altchaLedger,
      );

      const outcome = await service.login(input, contextOf(request));

      if (outcome.session && outcome.result.status === 'authenticated') {
        // Nach erfolgreichem Login das Limit zurücksetzen: ein paar Vertipper
        // sollen nicht dazu führen, dass die nächste Anmeldung blockiert ist.
        options.loginLimiter.reset(rateLimitKey('login', request.ip));
        await issueCookies(reply, outcome.result.account.id, outcome.session, options);
      }

      const payload: LoginResult = outcome.result;

      await reply.send(ok(payload));
    });
  });

  /**
   * Zweiter Anmeldeschritt (Pflichtenheft §7).
   *
   * Nimmt den Zwischen-Token aus dem ersten Schritt und den TOTP-Code entgegen.
   * Erst hier entsteht die Sitzung. Das Rate-Limit teilt sich den Zähler mit
   * dem Login – sonst ließe sich der zweite Faktor unbegrenzt durchprobieren.
   */
  app.post('/auth/login/2fa', async (request, reply) => {
    await handle(reply, async () => {
      const input = parseBody(twoFactorInputSchema, request.body, 'AUTH_TWO_FACTOR_INVALID');
      const decision = options.loginLimiter.consume(rateLimitKey('login', request.ip));

      if (!decision.allowed) {
        throw new AuthError(
          'AUTH_RATE_LIMITED',
          `Zu viele Versuche. Bitte in ${String(decision.retryAfterSeconds)} Sekunden erneut versuchen.`,
        );
      }

      const outcome = await service.completeTwoFactorLogin(
        input.twoFactorToken,
        input.code,
        contextOf(request),
      );

      options.loginLimiter.reset(rateLimitKey('login', request.ip));
      await issueCookies(reply, outcome.account.id, outcome.session, options);
      await reply.send(ok({ account: outcome.account }));
    });
  });

  /**
   * Tauscht den Refresh-Token gegen einen neuen (Rotation, Pflichtenheft §7).
   *
   * Schlägt der Tausch fehl, werden die Sitzungs-Cookies gelöscht – sonst würde
   * der Browser es mit demselben ungültigen Token endlos erneut versuchen.
   */
  app.post('/auth/refresh', async (request, reply) => {
    await handle(
      reply,
      async () => {
        const token = request.cookies[REFRESH_COOKIE_NAME];

        if (!token) {
          throw new AuthError('AUTH_SESSION_EXPIRED');
        }

        const { account, session } = await service.refresh(token, contextOf(request));

        await issueCookies(reply, account.id, session, options);
        await reply.send(ok({ account }));
      },
      () => {
        clearSessionCookies(reply, options.cookies);
      },
    );
  });

  app.post('/auth/logout', async (request, reply) => {
    await handle(reply, async () => {
      if (request.authSessionId) {
        await service.logout(request.authSessionId);
      }

      clearSessionCookies(reply, options.cookies);
      await reply.send(ok(null));
    });
  });

  // -- Konto & Sitzungen ----------------------------------------------------

  app.get('/auth/session', async (request, reply) => {
    await handle(reply, async () => {
      const user = request.authUser;

      if (!user) {
        throw new AuthError('AUTH_REQUIRED');
      }

      const account: AccountDto = await service.loadAccount(user);

      await reply.send(ok({ account }));
    });
  });

  app.get('/auth/sessions', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const sessions: SessionDto[] = await service.listSessions(userId, request.authSessionId);

      await reply.send(ok(sessions));
    });
  });

  app.delete<{ Params: { sessionId: string } }>(
    '/auth/sessions/:sessionId',
    async (request, reply) => {
      await handle(reply, async () => {
        const userId = requireUserId(request);

        await service.revokeSession(userId, request.params.sessionId);

        // Wer die eigene Sitzung abmeldet, soll auch die Cookies loswerden.
        if (request.params.sessionId === request.authSessionId) {
          clearSessionCookies(reply, options.cookies);
        }

        await reply.send(ok(null));
      });
    },
  );

  // -- Anbieter-Login und Verknüpfung ---------------------------------------

  /**
   * Startet den Redirect zum Provider.
   *
   * Antwortet mit einer echten Weiterleitung statt mit JSON: der Client in F1
   * navigiert hierher (`OAuthButtons` setzt die Adresse als Link-Ziel), er ruft
   * sie nicht per `fetch` ab. Im eingeloggten Zustand wird das Verfahren später
   * mit dem bestehenden Konto verknüpft, sonst angemeldet oder registriert
   * (Lastenheft §3.1).
   */
  app.get<{ Params: { provider: string }; Querystring: { returnTo?: string } }>(
    '/auth/:provider/start',
    async (request, reply) => {
      const provider = request.params.provider;

      try {
        if (!isOAuthProvider(provider)) {
          throw new AuthError('AUTH_PROVIDER_NOT_CONFIGURED');
        }

        // Nur beim Verknüpfen aus dem eingeloggten Zustand relevant: Wohin es
        // nach der Rückkehr geht. Gegen die Allowlist geprüft, damit kein
        // fremdes Ziel eingeschleust werden kann.
        const returnTo = sanitizeReturnTo(request.query.returnTo);

        const { authorizationUrl, pending } = service.startProviderLogin(provider);
        const cookieValue = Buffer.from(
          JSON.stringify({
            provider,
            state: pending.state,
            codeVerifier: pending.codeVerifier,
            returnTo,
          }),
          'utf8',
        ).toString('base64url');

        setOAuthStateCookie(reply, cookieValue, options.cookies);

        await reply.redirect(authorizationUrl, 303);
      } catch (error) {
        if (isAuthError(error)) {
          // Auch hier landet der Nutzer im Browser, nicht in einem fetch-Aufruf –
          // deshalb zurück ins Frontend statt in eine JSON-Antwort.
          await reply.redirect(
            frontendRedirect(options, FRONTEND_LOGIN_PATH, { error: error.code }),
            303,
          );
          return;
        }

        throw error;
      }
    },
  );

  /**
   * Rückkehr vom Anbieter.
   *
   * Antwortet mit einem Redirect ins Frontend statt mit JSON: Der Browser kommt
   * hier über eine Weiterleitung an, nicht über einen fetch-Aufruf.
   *
   * Erfolgreiche Anmeldungen landen dort, wo das Konto hingehört
   * (Wartebildschirm oder Übersicht); ein fehlgeschlagener Versuch geht auf
   * `/login?error=<CODE>` – ein Code aus dem Katalog, kein Freitext. Beides
   * folgt dem, was F1 erwartet (WORK_STATUS.md, Gefundener Punkt 27).
   */
  app.get<{ Params: { provider: string } }>('/auth/:provider/callback', async (request, reply) => {
    const provider = request.params.provider;

    try {
      if (!isOAuthProvider(provider)) {
        throw new AuthError('AUTH_PROVIDER_NOT_CONFIGURED');
      }

      const pending = readPendingAuthorization(request);

      // Der Zwischenzustand gilt genau für den Anbieter, für den er gesetzt
      // wurde – sonst ließe sich ein Discord-`state` an der Twitch-Rückkehr
      // einsetzen.
      if (pendingProvider(request) !== provider) {
        throw new AuthError('AUTH_OAUTH_STATE_INVALID');
      }

      clearOAuthStateCookie(reply, options.cookies);

      const query = request.query as Record<string, string | string[] | undefined>;

      if (request.authUser) {
        await service.completeProviderLink(provider, query, pending, request.authUser.id);

        // Verknüpfen passiert aus dem eingeloggten Zustand heraus – zurück auf
        // die Seite, von der aus verknüpft wurde (Profil/Einstellungen), mit
        // Hinweis auf das ergänzte Verfahren.
        await reply.redirect(
          frontendRedirect(options, pendingReturnTo(request), { linked: provider }),
          303,
        );
        return;
      }

      const outcome = await service.completeProviderLogin(
        provider,
        query,
        pending,
        contextOf(request),
      );

      await issueCookies(reply, outcome.account.id, outcome.session, options);
      await reply.redirect(
        frontendRedirect(options, landingPath(outcome.account), {
          [outcome.created ? 'registered' : 'signedIn']: provider,
        }),
        303,
      );
    } catch (error) {
      clearOAuthStateCookie(reply, options.cookies);

      if (isAuthError(error)) {
        await reply.redirect(
          frontendRedirect(options, FRONTEND_LOGIN_PATH, { error: error.code }),
          303,
        );
        return;
      }

      throw error;
    }
  });

  app.delete<{ Params: { type: string } }>('/auth/methods/:type', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const type = request.params.type;

      if (!(AUTH_METHOD_TYPES as readonly string[]).includes(type)) {
        throw new AuthError('AUTH_METHOD_NOT_FOUND');
      }

      const account: AccountDto = await service.unlinkMethod(
        userId,
        type as (typeof AUTH_METHOD_TYPES)[number],
      );

      await reply.send(ok({ account }));
    });
  });

  // -- Passwort -------------------------------------------------------------

  app.post('/auth/password/link', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const input = parseBody(linkPasswordInputSchema, request.body);
      const account: AccountDto = await service.linkPassword(userId, input);

      await reply.status(201).send(ok({ account }));
    });
  });

  app.post('/auth/password/change', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const input = parseBody(changePasswordInputSchema, request.body);
      const account: AccountDto = await service.changePassword(
        userId,
        input,
        request.authSessionId,
      );

      await reply.send(ok({ account }));
    });
  });

  // -- 2FA ------------------------------------------------------------------

  app.post('/auth/2fa/setup', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const setup: TwoFactorSetupDto = await service.beginTwoFactorSetup(userId);

      await reply.send(ok(setup));
    });
  });

  app.post('/auth/2fa/confirm', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const input = parseBody(confirmTwoFactorInputSchema, request.body, 'AUTH_TWO_FACTOR_INVALID');
      const account: AccountDto = await service.confirmTwoFactor(userId, input.code);

      await reply.send(ok({ account }));
    });
  });

  app.post('/auth/2fa/disable', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const input = parseBody(disableTwoFactorInputSchema, request.body, 'AUTH_TWO_FACTOR_INVALID');
      const account: AccountDto = await service.disableTwoFactor(userId, input);

      await reply.send(ok({ account }));
    });
  });

  // -- Eigenes Profil -------------------------------------------------------

  app.patch('/auth/account', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const input = parseBody(updateProfileInputSchema, request.body);
      const account: AccountDto = await service.updateProfile(userId, input);

      await reply.send(ok({ account }));
    });
  });

  // -- Konto-Löschung -------------------------------------------------------

  app.delete('/auth/account', async (request, reply) => {
    await handle(reply, async () => {
      const userId = requireUserId(request);
      const input = parseBody(deleteAccountInputSchema, request.body, 'AUTH_INVALID_CREDENTIALS');

      await service.deleteAccount(userId, input);

      clearSessionCookies(reply, options.cookies);
      await reply.send(ok(null));
    });
  });

  // -- Admin-Eingriffe (Lastenheft §3.1) ------------------------------------
  // Beide verlangen `user.manage`; geprüft über den Guard aus B2.

  app.post<{ Params: { userId: string } }>(
    '/auth/admin/users/:userId/password-reset',
    { preHandler: requirePermission('user.manage') },
    async (request, reply) => {
      await handle(reply, async () => {
        const result: PasswordResetResultDto = await service.resetPasswordAsAdmin(
          request.params.userId,
        );

        await reply.send(ok(result));
      });
    },
  );

  app.delete<{ Params: { userId: string } }>(
    '/auth/admin/users/:userId/2fa',
    { preHandler: requirePermission('user.manage') },
    async (request, reply) => {
      await handle(reply, async () => {
        await service.disableTwoFactorAsAdmin(request.params.userId);

        await reply.send(ok(null));
      });
    },
  );
}
