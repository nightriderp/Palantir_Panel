/**
 * Fehler der Notification-Engine.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithErrorCode()` aus dem RBAC-Modul in den Response-Envelope aus
 * Pflichtenheft §5.1 um. Aufbau bewusst analog zu `BackupError` und `RbacError`.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export class NotificationError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'NotificationError';
    this.code = code;
  }
}

export function isNotificationError(error: unknown): error is NotificationError {
  return error instanceof NotificationError;
}
