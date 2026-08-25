/**
 * Fehler des RBAC-Moduls.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithRbacError()` in den Response-Envelope aus Pflichtenheft §5.1 um.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export class RbacError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'RbacError';
    this.code = code;
  }
}

export function isRbacError(error: unknown): error is RbacError {
  return error instanceof RbacError;
}
