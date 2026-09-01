/**
 * Fehler der Panel-Sicherungen.
 *
 * Benannte Codes aus dem Katalog in `@palantir/contracts`, kein Freitext
 * (CLAUDE.md §5) – gleicher Aufbau wie `ResourceError` und `QuotaRequestError`.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export class PanelBackupError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'PanelBackupError';
    this.code = code;
  }
}

export function isPanelBackupError(error: unknown): error is PanelBackupError {
  return error instanceof PanelBackupError;
}
