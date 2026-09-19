/**
 * Fehler der Spiel-Wünsche.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (Entwicklungsregeln §5).
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class GameRequestError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'GameRequestError';
  }
}

export function isGameRequestError(error: unknown): error is GameRequestError {
  return error instanceof GameRequestError;
}
