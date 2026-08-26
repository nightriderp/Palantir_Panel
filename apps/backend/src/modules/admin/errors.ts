/**
 * Fehler des Admin-Moduls (B8).
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithAdminError()` in den Response-Envelope aus Pflichtenheft §5.1 um.
 *
 * Bewusst eine eigene Klasse statt einer gemeinsamen Basisklasse mit
 * `RbacError`: Beide Module bleiben so unabhängig voneinander, und der Guard
 * aus B2 kennt weiterhin nur seine eigenen Fehler.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export class AdminError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'AdminError';
    this.code = code;
  }
}

export function isAdminError(error: unknown): error is AdminError {
  return error instanceof AdminError;
}
