/**
 * Fehler der Backup-Verwaltung.
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithErrorCode()` aus dem RBAC-Modul in den Response-Envelope aus
 * Pflichtenheft §5.1 um. Aufbau bewusst analog zu `RbacError`.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export class BackupError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'BackupError';
    this.code = code;
  }
}

export function isBackupError(error: unknown): error is BackupError {
  return error instanceof BackupError;
}

/**
 * Fehler bei der Auswertung eines Zeitplans.
 *
 * Eigene Klasse, damit `cron.ts` ohne Kenntnis der Backup-Verwaltung
 * auskommt – andere Arbeitspakete mit geplanten Aufgaben (B3) nutzen dieselbe
 * Auswertung und denselben Fehler.
 */
export class ScheduleError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'ScheduleError';
    this.code = code;
  }
}

export function isScheduleError(error: unknown): error is ScheduleError {
  return error instanceof ScheduleError;
}
