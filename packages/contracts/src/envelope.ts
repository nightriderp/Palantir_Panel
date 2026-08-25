/**
 * Response-Envelope (Pflichtenheft §5.1).
 *
 * Jede REST-Antwort des Backends hat exakt diese Form:
 *
 * ```ts
 * { success: boolean, data: T | null, error: { code: string, message: string } | null }
 * ```
 *
 * Der Typ ist als Union aus Erfolgs- und Fehlerfall modelliert, damit
 * TypeScript nach einer `success`-Prüfung automatisch verengt. Die serialisierte
 * Form bleibt dabei unverändert die oben genannte.
 */

import { type ErrorCode, defaultMessageForErrorCode, httpStatusForErrorCode } from './errors.js';

export interface ApiErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
}

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly error: null;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly data: null;
  readonly error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Erfolgsantwort erzeugen. */
export function ok<T>(data: T): ApiSuccessResponse<T> {
  return { success: true, data, error: null };
}

/**
 * Fehlerantwort erzeugen. Ohne eigene Meldung wird die Fallback-Meldung aus dem
 * Fehlercode-Katalog verwendet.
 */
export function fail(code: ErrorCode, message?: string): ApiErrorResponse {
  return {
    success: false,
    data: null,
    error: { code, message: message ?? defaultMessageForErrorCode(code) },
  };
}

/** Passender HTTP-Status zu einer Fehlerantwort (Pflichtenheft §5.1). */
export function httpStatusForResponse(response: ApiErrorResponse): number {
  return httpStatusForErrorCode(response.error.code);
}

export function isOk<T>(response: ApiResponse<T>): response is ApiSuccessResponse<T> {
  return response.success;
}

export function isFail<T>(response: ApiResponse<T>): response is ApiErrorResponse {
  return !response.success;
}
