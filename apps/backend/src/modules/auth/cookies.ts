/**
 * Cookies der Sitzung (Pflichtenheft §7 und §18).
 *
 * Drei Cookies mit klar getrennten Aufgaben:
 *
 * | Cookie | httpOnly | Pfad | Zweck |
 * |---|---|---|---|
 * | `palantir_access`  | ja   | `/`     | kurzlebiges Access-JWT |
 * | `palantir_refresh` | ja   | `/auth` | opaker Refresh-Token |
 * | `palantir_csrf`    | nein | `/`     | Double-Submit-Token |
 *
 * `SameSite=Lax` für alle drei – bewusst nicht `Strict`: `Strict` würde den
 * Cookie beim Rückkehr-Redirect von Discord/Steam/Twitch nicht mitschicken und
 * den OAuth-Login brechen (Pflichtenheft §7). Die dadurch verbleibende Lücke
 * schließt das CSRF-Token.
 *
 * Der Refresh-Token liegt auf `/auth`, weil ihn außerhalb dieser Routen niemand
 * braucht – so wird er bei gewöhnlichen API-Requests gar nicht erst mitgesendet.
 */

import { CSRF_COOKIE_NAME } from '@palantir/contracts';
import type { FastifyReply } from 'fastify';

export const ACCESS_COOKIE_NAME = 'palantir_access';
export const REFRESH_COOKIE_NAME = 'palantir_refresh';
/** Kurzlebiges Cookie für `state` und PKCE-Verifier während des Redirects. */
export const OAUTH_STATE_COOKIE_NAME = 'palantir_oauth';

/** Gültigkeitsdauer des OAuth-Zwischenzustands: lang genug für die Anmeldung
 * beim Anbieter, kurz genug, dass ein liegengebliebener Wert nicht später noch
 * verwendbar ist. */
export const OAUTH_STATE_TTL_SECONDS = 600;

export interface CookieSettings {
  readonly secure: boolean;
  /** Leer lassen, wenn die Cookies am Host des Requests hängen sollen. */
  readonly domain?: string | undefined;
}

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  domain?: string;
  maxAge?: number;
  signed?: boolean;
}

function base(settings: CookieSettings, path: string, httpOnly: boolean): CookieOptions {
  return {
    httpOnly,
    secure: settings.secure,
    // Bewusst `lax`, siehe Kopfkommentar und Pflichtenheft §7.
    sameSite: 'lax',
    path,
    ...(settings.domain ? { domain: settings.domain } : {}),
  };
}

export function setAccessCookie(
  reply: FastifyReply,
  token: string,
  ttlMs: number,
  settings: CookieSettings,
): void {
  reply.setCookie(ACCESS_COOKIE_NAME, token, {
    ...base(settings, '/', true),
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export function setRefreshCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  settings: CookieSettings,
  nowMs: number = Date.now(),
): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    ...base(settings, '/auth', true),
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - nowMs) / 1000)),
  });
}

/**
 * Setzt das CSRF-Cookie.
 *
 * Als einziges der drei **nicht** httpOnly: das Frontend muss den Wert lesen
 * können, um ihn in den Header zu schreiben. Unbedenklich, weil das Token allein
 * keine Sitzung darstellt.
 */
export function setCsrfCookie(reply: FastifyReply, token: string, settings: CookieSettings): void {
  reply.setCookie(CSRF_COOKIE_NAME, token, base(settings, '/', false));
}

export function setOAuthStateCookie(
  reply: FastifyReply,
  value: string,
  settings: CookieSettings,
): void {
  reply.setCookie(OAUTH_STATE_COOKIE_NAME, value, {
    ...base(settings, '/auth', true),
    maxAge: OAUTH_STATE_TTL_SECONDS,
    // Signiert, damit ein selbst gesetzter Wert nicht als eigener `state`
    // durchgeht (Pflichtenheft §7).
    signed: true,
  });
}

/** Entfernt alle Sitzungs-Cookies – beim Logout und bei abgelaufener Sitzung. */
export function clearSessionCookies(reply: FastifyReply, settings: CookieSettings): void {
  reply.clearCookie(ACCESS_COOKIE_NAME, base(settings, '/', true));
  reply.clearCookie(REFRESH_COOKIE_NAME, base(settings, '/auth', true));
  reply.clearCookie(CSRF_COOKIE_NAME, base(settings, '/', false));
}

export function clearOAuthStateCookie(reply: FastifyReply, settings: CookieSettings): void {
  reply.clearCookie(OAUTH_STATE_COOKIE_NAME, base(settings, '/auth', true));
}
