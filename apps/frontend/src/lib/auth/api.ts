import {
  type AccountDto,
  type AltchaChallenge,
  type ApiResponse,
  type AuthMethodType,
  type LoginResult,
  type TwoFactorSetupDto,
} from '@palantir/contracts';
import {
  type ChangePasswordInput,
  type ConfirmTwoFactorInput,
  type DisableTwoFactorInput,
  type LinkPasswordInput,
  type LoginInput,
  type RegisterInput,
  type TwoFactorInput,
  accountDtoSchema,
  altchaChallengeSchema,
  apiResponseSchema,
  loginResultSchema,
  twoFactorSetupSchema,
} from '@palantir/validation';
import { z } from 'zod';

import { AuthRequestError, NETWORK_ERROR_MESSAGE, UNKNOWN_ERROR_MESSAGE } from './errors';

/**
 * REST-Aufrufe der Anmeldung (Pflichtenheft §5.1, §5.3 und §7).
 *
 * Jede Antwort läuft durch den Response-Envelope und zusätzlich durch das
 * Zod-Schema aus `@palantir/validation` – das Frontend vertraut der API nicht
 * blind. Fehler kommen als `AuthRequestError` mit dem Code aus dem Katalog
 * heraus; übersetzt wird erst in der Oberfläche (siehe `errors.ts`).
 */

/**
 * Endpunkte, die das Backend-Arbeitspaket B1 bereitstellen muss.
 *
 * Bewusst an einer Stelle gesammelt: solange B1 nicht existiert, ist das hier
 * die einzige Datei, die bei einer abweichenden Pfadwahl anzupassen ist. Die
 * OAuth-Pfade folgen den Redirect-URIs aus `.env.example` §5
 * (`…/auth/<provider>/callback`).
 */
export const AUTH_ENDPOINTS = {
  login: '/auth/login',
  twoFactor: '/auth/login/2fa',
  register: '/auth/register',
  session: '/auth/session',
  logout: '/auth/logout',
  altchaChallenge: '/auth/altcha/challenge',
  /**
   * Startet den Redirect-Ablauf beim Provider (kein `fetch`, echte Navigation).
   *
   * `returnTo` steuert, wohin die Verknüpfung aus dem eingeloggten Zustand
   * zurückkehrt (das Backend prüft den Wert gegen eine Allowlist). Ohne Angabe
   * bleibt es beim Standardziel.
   */
  oauthStart: (provider: string, returnTo?: string) =>
    returnTo === undefined
      ? `/auth/${provider}/start`
      : `/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`,
  /** Verknüpftes Anmeldeverfahren trennen (Pflichtenheft §7). */
  method: (type: string) => `/auth/methods/${type}`,
  passwordLink: '/auth/password/link',
  passwordChange: '/auth/password/change',
  twoFactorSetup: '/auth/2fa/setup',
  twoFactorConfirm: '/auth/2fa/confirm',
  twoFactorDisable: '/auth/2fa/disable',
} as const;

/**
 * Basisadresse der Backend-API.
 *
 * `NEXT_PUBLIC_API_URL` trägt denselben Wert wie `PUBLIC_API_URL` aus der
 * zentralen `.env` (Pflichtenheft §12.1); nur `NEXT_PUBLIC_`-Variablen erreichen
 * den Browser. Gesetzt wird die Variable nicht von Hand, sondern in
 * `next.config.mjs` aus `PUBLIC_API_URL` bzw. `PALANTIR_DOMAIN` abgeleitet –
 * dort steht auch, warum der Wert absolut sein muss.
 */
export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
}

/** Vollständige URL zu einem API-Pfad. */
export function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path}`;
}

/**
 * CSRF-Token für zustandsändernde Requests (Pflichtenheft §7).
 *
 * Das Backend legt es als lesbares Cookie ab (im Gegensatz zum Refresh-Token,
 * das httpOnly bleibt); der Browser schickt es hier als Header zurück. Fehlt es,
 * wird der Header weggelassen und das Backend antwortet mit seinem eigenen
 * Fehler – ein stiller Bypass entsteht dadurch nicht.
 */
export const CSRF_COOKIE_NAME = 'palantir_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function readCsrfToken(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE_NAME && rest.length > 0) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function currentCsrfToken(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return readCsrfToken(document.cookie);
}

/**
 * Führt einen API-Aufruf aus und liefert die geprüften Nutzdaten.
 *
 * `credentials: 'include'` ist nötig, weil Sitzung und CSRF-Token als Cookies
 * transportiert werden (Pflichtenheft §7) und die API unter einer eigenen
 * Subdomain liegen kann.
 */
async function request<TSchema extends z.ZodTypeAny>(
  path: string,
  dataSchema: TSchema,
  init: RequestInit = {},
): Promise<z.infer<TSchema>> {
  const csrfToken = currentCsrfToken();
  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrfToken === null ? {} : { [CSRF_HEADER_NAME]: csrfToken }),
        ...init.headers,
      },
    });
  } catch {
    // Netzwerkabbruch, DNS-Fehler, abgelehnte Verbindung – kein Fehlercode.
    throw new AuthRequestError(NETWORK_ERROR_MESSAGE, null);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthRequestError(UNKNOWN_ERROR_MESSAGE, null);
  }

  const parsed = apiResponseSchema(dataSchema).safeParse(body);
  if (!parsed.success) {
    throw new AuthRequestError(UNKNOWN_ERROR_MESSAGE, null);
  }

  /*
   * Die Prüfung oben ist die vollständige – hier wird nur der Typ nachgezogen.
   * Zod verliert bei einem generisch übergebenen Daten-Schema die Unterscheidung
   * der beiden Envelope-Zweige; `ApiResponse<T>` aus `@palantir/contracts` hält
   * genau die Form fest, die `apiResponseSchema` zur Laufzeit erzwingt.
   */
  const envelope = parsed.data as ApiResponse<z.infer<TSchema>>;

  if (!envelope.success) {
    throw new AuthRequestError(envelope.error.message, envelope.error.code);
  }

  return envelope.data;
}

/** Erster Anmeldeschritt (Pflichtenheft §7). */
export function login(input: LoginInput): Promise<LoginResult> {
  return request(AUTH_ENDPOINTS.login, loginResultSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Zweiter Anmeldeschritt – TOTP oder Backup-Code (Pflichtenheft §7). */
export function verifyTwoFactor(input: TwoFactorInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.twoFactor, z.object({ account: accountDtoSchema }), {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Registrierung eines Passwort-Kontos (Lastenheft §3.1). */
export function register(input: RegisterInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.register, z.object({ account: accountDtoSchema }), {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Bestehende Sitzung wiederherstellen; wirft `AUTH_REQUIRED`, wenn keine da ist. */
export function fetchSession(): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.session, z.object({ account: accountDtoSchema }), {
    method: 'GET',
  }).then((result) => result.account);
}

/** Neue Proof-of-Work-Aufgabe für die Registrierung (Pflichtenheft §3). */
export function fetchAltchaChallenge(): Promise<AltchaChallenge> {
  return request(AUTH_ENDPOINTS.altchaChallenge, altchaChallengeSchema, { method: 'GET' });
}

/** Meldet die aktuelle Sitzung ab (Gast-Wartebildschirm, Pflichtenheft §7). */
export function logout(): Promise<null> {
  return request(AUTH_ENDPOINTS.logout, z.null(), { method: 'POST' });
}

// -- Kontoverwaltung (Profil & Einstellungen) -------------------------------
// Jede Aktion liefert das aktualisierte Konto zurück, sodass die Ansicht den
// neuen Stand ohne zweiten Ladeaufruf uebernehmen kann.

const accountEnvelopeSchema = z.object({ account: accountDtoSchema });

/** Ein verknuepftes Anmeldeverfahren wieder trennen (Discord/Steam/Twitch/Passwort). */
export function unlinkMethod(type: AuthMethodType): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.method(type), accountEnvelopeSchema, {
    method: 'DELETE',
  }).then((result) => result.account);
}

/** Ein Passwort-Verfahren nachtraeglich anlegen (Konto ohne Passwort). */
export function linkPassword(input: LinkPasswordInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.passwordLink, accountEnvelopeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Das eigene Passwort aendern (Pflichtenheft §7). */
export function changePassword(input: ChangePasswordInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.passwordChange, accountEnvelopeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Beginnt die 2FA-Einrichtung und liefert Geheimnis samt `otpauth`-URI. */
export function beginTwoFactorSetup(): Promise<TwoFactorSetupDto> {
  return request(AUTH_ENDPOINTS.twoFactorSetup, twoFactorSetupSchema, { method: 'POST' });
}

/** Schliesst die 2FA-Einrichtung mit dem ersten gueltigen Code ab. */
export function confirmTwoFactor(input: ConfirmTwoFactorInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.twoFactorConfirm, accountEnvelopeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Deaktiviert 2FA (verlangt Passwort und aktuellen Code). */
export function disableTwoFactor(input: DisableTwoFactorInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.twoFactorDisable, accountEnvelopeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}
