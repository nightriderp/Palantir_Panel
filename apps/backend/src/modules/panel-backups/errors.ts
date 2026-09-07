/**
 * Fehler der Panel-Sicherungen.
 *
 * Benannte Codes aus dem Katalog in `@palantir/contracts`, kein Freitext
 * (CLAUDE.md §5) – gleicher Aufbau wie `ResourceError` und `QuotaRequestError`.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class PanelBackupError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'PanelBackupError';
  }
}

export function isPanelBackupError(error: unknown): error is PanelBackupError {
  return error instanceof PanelBackupError;
}
