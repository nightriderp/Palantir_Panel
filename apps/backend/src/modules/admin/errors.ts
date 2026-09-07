/**
 * Fehler des Admin-Moduls (B8).
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithAdminError()` in den Response-Envelope aus Pflichtenheft §5.1 um.
 *
 * Bewusst eine eigene Klasse neben `RbacError`: Beide Module bleiben so
 * unabhängig voneinander, und der Guard aus B2 kennt weiterhin nur seine
 * eigenen Fehler. Gemeinsam ist beiden seit Audit W2-9 lediglich die
 * Basisklasse `AppError` – sie trägt den Katalog-Code und ist das Merkmal, an
 * dem der globale Fehler-Handler eine fachliche Antwort erkennt.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class AdminError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'AdminError';
  }
}

export function isAdminError(error: unknown): error is AdminError {
  return error instanceof AdminError;
}
