/**
 * Fehler des Erfolgs-Moduls (Betreiber-Wunsch 21.09.2026).
 *
 * Aufbau analog zu `ArcadeError`: eine eigene Klasse auf Basis von
 * {@link AppError}, deren Code aus dem Katalog in `@palantir/contracts` stammt –
 * kein Freitext (Entwicklungsregeln §5).
 *
 * Geworfen wird ausschließlich bei der Titel-Wahl. Das **Vergeben** von
 * Abzeichen wirft bewusst nie: Es hängt an einem fremden Vorgang (ein Server
 * wird angelegt, eine Sicherung läuft), und dieser Vorgang darf nicht daran
 * scheitern, dass ein Abzeichen sich nicht eintragen ließ – siehe `service.ts`.
 */

import { type ErrorCode } from '@palantir/contracts';
import { AppError } from '../../lib/app-error.js';

export class AchievementError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'AchievementError';
  }
}
