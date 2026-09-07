/**
 * Fehler des Chat-Moduls (B7).
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithErrorCode()` aus dem RBAC-Modul in den Response-Envelope aus
 * Pflichtenheft §5.1 um. Aufbau bewusst analog zu `BackupError` und `AdminError`.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class ChatError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'ChatError';
  }
}

export function isChatError(error: unknown): error is ChatError {
  return error instanceof ChatError;
}
