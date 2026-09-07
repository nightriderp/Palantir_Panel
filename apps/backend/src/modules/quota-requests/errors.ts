/**
 * Fehler der Kontingent-Anfragen.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Aufbau bewusst identisch
 * zu `RbacError` und `ResourceError`, damit Routen alle gleich behandeln.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class QuotaRequestError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'QuotaRequestError';
  }
}

export function isQuotaRequestError(error: unknown): error is QuotaRequestError {
  return error instanceof QuotaRequestError;
}
