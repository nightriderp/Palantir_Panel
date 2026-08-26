import { type ApiResponse, isErrorCode } from '@palantir/contracts';

/**
 * Zugriff auf die REST-API des Backends (Pflichtenheft §5.1).
 *
 * Jede Antwort kommt im Response-Envelope. Dieser Wrapper reicht ihn
 * unverändert nach oben durch, statt bei Fehlern zu werfen – die Ansichten
 * entscheiden selbst, ob ein Fehler als Toast, als Zeile im Dialog oder als
 * ganzer Leerzustand erscheint.
 *
 * **Transportfehler:** Ein abgebrochener Request, ein unerreichbares Backend
 * oder eine Antwort, die gar kein Envelope ist, erreichen den Aufrufer in
 * derselben Form, aber mit einem eigenen Code aus `TRANSPORT_ERROR_CODES`.
 * Diese Codes stehen bewusst **nicht** im Katalog aus `@palantir/contracts`:
 * sie entstehen im Browser und dürfen nie aus einer Backend-Route kommen.
 * Freitext-Fehler gibt es auch hier keine (CLAUDE.md §5).
 */

/** Basis-Adresse der API, z. B. `https://api.example.tld`. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

/**
 * Name des Cookies mit dem CSRF-Token (Pflichtenheft §7).
 *
 * Zustandsändernde Requests schicken den Wert zusätzlich als Kopfzeile, weil
 * das Sitzungs-Cookie `SameSite=Lax` trägt und damit allein nicht schützt.
 * Ausgestellt wird das Cookie von B1; F3 liest es nur.
 */
const CSRF_COOKIE_NAME = 'palantir_csrf';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Fehler, die im Browser entstehen, bevor eine Backend-Antwort vorliegt. */
export const TRANSPORT_ERROR_CODES = {
  /** Der Request wurde abgebrochen (Ansicht verlassen, neue Eingabe). */
  REQUEST_ABORTED: 'Die Anfrage wurde abgebrochen.',
  /** Das Backend war nicht erreichbar. */
  NETWORK_UNAVAILABLE: 'Das Backend ist gerade nicht erreichbar.',
  /** Die Antwort war kein gültiger Response-Envelope. */
  MALFORMED_RESPONSE: 'Die Antwort des Backends war unlesbar.',
} as const;

export type TransportErrorCode = keyof typeof TRANSPORT_ERROR_CODES;

export interface TransportFailure {
  readonly success: false;
  readonly data: null;
  readonly error: { readonly code: TransportErrorCode; readonly message: string };
}

/** Ergebnis eines API-Aufrufs: Envelope des Backends oder Transportfehler. */
export type ApiResult<T> = ApiResponse<T> | TransportFailure;

export function isTransportFailure<T>(result: ApiResult<T>): result is TransportFailure {
  return !result.success && result.error.code in TRANSPORT_ERROR_CODES;
}

/** Wurde der Aufruf nur abgebrochen? Dann ist er kein Anlass für eine Meldung. */
export function isAborted<T>(result: ApiResult<T>): boolean {
  return !result.success && result.error.code === 'REQUEST_ABORTED';
}

function transportFailure(code: TransportErrorCode): TransportFailure {
  return { success: false, data: null, error: { code, message: TRANSPORT_ERROR_CODES[code] } };
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Wird als JSON gesendet. Für Datei-Uploads stattdessen `body` verwenden. */
  json?: unknown;
  /** Roher Rumpf, z. B. `FormData` beim Upload im Datei-Manager. */
  body?: BodyInit;
  /** Abbruch beim Verlassen der Ansicht oder beim Wechsel des Suchbegriffs. */
  signal?: AbortSignal;
  /** Query-Parameter; `undefined`-Werte entfallen. */
  query?: Record<string, string | number | boolean | undefined>;
}

function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${CSRF_COOKIE_NAME}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function buildUrl(path: string, query: ApiRequestOptions['query']): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `${url}?${serialized}` : url;
}

/**
 * Prüft, ob eine geparste Antwort tatsächlich dem Envelope entspricht.
 *
 * Ein Zwischenstück (Proxy, Fehlerseite eines Reverse-Proxy) kann etwas
 * anderes liefern; das darf nicht als gültige Antwort durchgehen.
 */
export function isEnvelope(value: unknown): value is ApiResponse<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { success?: unknown; error?: unknown };
  if (typeof candidate.success !== 'boolean') return false;
  if (candidate.success) return true;

  const error = candidate.error as { code?: unknown; message?: unknown } | null;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof error.code === 'string' &&
    isErrorCode(error.code) &&
    typeof error.message === 'string'
  );
}

/**
 * Einen API-Aufruf ausführen.
 *
 * Endpunkte ohne Rumpf (HTTP 204, z. B. Löschen) liefern `data: null`; sie
 * werden deshalb als `apiRequest<null>(…)` aufgerufen.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const headers = new Headers();
  headers.set('Accept', 'application/json');

  let body = options.body;
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.json);
  }

  if (!SAFE_METHODS.has(method)) {
    const token = readCsrfToken();
    if (token) headers.set(CSRF_HEADER_NAME, token);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      // Sitzungs- und CSRF-Cookie gehören zur Anfrage (Pflichtenheft §7).
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return transportFailure(aborted ? 'REQUEST_ABORTED' : 'NETWORK_UNAVAILABLE');
  }

  if (response.status === 204) {
    return { success: true, data: null as T, error: null };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return transportFailure('MALFORMED_RESPONSE');
  }

  if (!isEnvelope(parsed)) {
    return transportFailure('MALFORMED_RESPONSE');
  }

  return parsed as ApiResult<T>;
}

/** Anzeigetext eines fehlgeschlagenen Aufrufs (Lastenheft §4: Deutsch). */
export function errorMessage<T>(result: ApiResult<T>): string {
  return result.success ? '' : result.error.message;
}
