/**
 * Fehler des Arcade-Moduls (F8).
 *
 * Aufbau bewusst analog zu `ChatError` und `ServerOrchestrationError`: eine
 * eigene Klasse auf Basis von {@link AppError}, deren Code aus dem Katalog in
 * `@palantir/contracts` stammt – kein Freitext (CLAUDE.md §5). Erst dadurch
 * erkennt der globale Fehler-Handler den Fehler als bewusst formulierte Antwort
 * des Backends und nicht als beliebigen Laufzeitfehler.
 *
 * Warum überhaupt eine Klasse für ein Modul mit genau einer Wurfstelle: Der
 * Datenzugriff warf dort bislang einen rohen `Error` (Audit W2-9, Fundpunkt
 * 146). Nach außen bleibt die Antwort dieselbe 500 – der Unterschied ist, dass
 * der Fall benannt ist und nicht mehr am Katalog vorbei entsteht.
 *
 * Ein `isArcadeError()` gibt es bewusst nicht: Keine Route unterscheidet diesen
 * Fehler von anderen; ein ungenutzter Prüfhelfer wäre toter Code.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class ArcadeError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'ArcadeError';
  }
}
