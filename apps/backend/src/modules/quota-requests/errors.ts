/**
 * Fehler der Kontingent-Anfragen.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Aufbau bewusst identisch
 * zu `RbacError` und `ResourceError`, damit Routen alle gleich behandeln.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export class QuotaRequestError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'QuotaRequestError';
    this.code = code;
  }
}

export function isQuotaRequestError(error: unknown): error is QuotaRequestError {
  return error instanceof QuotaRequestError;
}
