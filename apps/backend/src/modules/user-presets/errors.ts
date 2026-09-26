/**
 * Fehler der eigenen Profile.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (Entwicklungsregeln §5).
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class UserPresetError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'UserPresetError';
  }
}

export function isUserPresetError(error: unknown): error is UserPresetError {
  return error instanceof UserPresetError;
}
