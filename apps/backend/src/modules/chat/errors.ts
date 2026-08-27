/**
 * Fehler des Chat-Moduls (B7).
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithErrorCode()` aus dem RBAC-Modul in den Response-Envelope aus
 * Pflichtenheft §5.1 um. Aufbau bewusst analog zu `BackupError` und `AdminError`.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export class ChatError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'ChatError';
    this.code = code;
  }
}

export function isChatError(error: unknown): error is ChatError {
  return error instanceof ChatError;
}
