/**
 * Gemeinsame Basisklasse der fachlichen Fehler des Backends (Audit W2-9,
 * `backend-core-03`).
 *
 * Jedes Modul behält seine eigene Fehlerklasse (`AuthError`, `BackupError`,
 * ...) – daran ändert sich nichts, und die Module prüfen weiterhin mit
 * `isAuthError()` & Co. auf *ihre* Fehler. Diese Basisklasse ergänzt nur den
 * gemeinsamen Nenner: „dieser Fehler ist eine bewusst formulierte fachliche
 * Antwort mit einem Code aus dem Katalog und einer Meldung, die nach außen
 * darf".
 *
 * Warum: Der globale Fehler-Handler erkannte einen fachlichen Fehler bisher am
 * bloßen Vorhandensein eines `code`-Felds mit passendem Namen (Duck-Typing).
 * Ein fremder Fehler – Treiber, Bibliothek, künftige Abhängigkeit – mit einem
 * `code`, der zufällig einem Katalog-Namen gleicht, wäre damit samt seiner
 * Meldung nach außen gegangen (Pflichtenheft §7). Mit `instanceof AppError`
 * hängt der Durchgriff an der eigenen Klasse statt an einem Namen.
 */

import { type ErrorCode, defaultMessageForErrorCode } from '@palantir/contracts';

export abstract class AppError extends Error {
  /** Benannter Code aus dem Katalog in `@palantir/contracts` (CLAUDE.md §5). */
  readonly code: ErrorCode;

  protected constructor(code: ErrorCode, message?: string) {
    super(message ?? defaultMessageForErrorCode(code));
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * Ist der Fehler eine fachliche Antwort des Backends?
 *
 * Einziger erlaubter Weg, einen Fehler unbekannter Herkunft als „darf mit Code
 * und Meldung nach außen" einzustufen.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
