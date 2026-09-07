/**
 * Fehler des Auth-Moduls.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithErrorCode()` aus dem RBAC-Modul in den Response-Envelope aus
 * Pflichtenheft §5.1 um; dieselbe Stelle, die auch RBAC-Fehler beantwortet.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class AuthError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'AuthError';
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
