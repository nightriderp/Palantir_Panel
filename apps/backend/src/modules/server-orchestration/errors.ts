/**
 * Fehler der Server-Orchestrierung (B3).
 *
 * Jeder Fehler trägt einen benannten Code aus dem Katalog in
 * `@palantir/contracts` – kein Freitext (CLAUDE.md §5). Routen wandeln ihn über
 * `replyWithOrchestrationError()` in den Response-Envelope aus
 * Pflichtenheft §5.1 um.
 *
 * Aufbau bewusst wie `RbacError` in `../rbac/errors.ts`: zwei parallele
 * Fehlerhierarchien mit unterschiedlichem Verhalten wären in einem Backend, das
 * einen gemeinsamen Katalog führt, nur eine Fehlerquelle.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export class ServerOrchestrationError extends Error {
  readonly code: ErrorCode;

  /**
   * Zusatzangaben für das Log – niemals für die Antwort an den Aufrufer.
   *
   * Ein Fehler des Agents nennt hier z. B. seine Korrelations-ID, damit sich
   * Backend-Log und Agent-Log zusammenführen lassen.
   */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message?: string, details: Record<string, unknown> = {}) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = 'ServerOrchestrationError';
    this.code = code;
    this.details = details;
  }
}

export function isServerOrchestrationError(error: unknown): error is ServerOrchestrationError {
  return error instanceof ServerOrchestrationError;
}
