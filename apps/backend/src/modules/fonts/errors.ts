/**
 * Fehler der Schriftverwaltung (Arbeitspaket S-2).
 *
 * Benannte Codes aus dem Katalog in `@palantir/contracts`, kein Freitext
 * (CLAUDE.md §5) – gleicher Aufbau wie `PanelBackupError` und `AdminError`.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class FontError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'FontError';
  }
}

export function isFontError(error: unknown): error is FontError {
  return error instanceof FontError;
}
