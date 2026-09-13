/**
 * Kurze Vibration an bedeutsamen Momenten.
 *
 * Auf Geräten ohne Vibration – also auf jedem Schreibtischrechner – passiert
 * nichts. Drei Regeln, nach denen die Aufrufe gesetzt werden:
 *
 * - **Ursache:** am tatsächlichen Auslöser, nicht auf Verdacht (die Schublade
 *   rastet ein, nicht: der Finger bewegt sich).
 * - **Gleichzeitig:** im selben Moment wie die sichtbare Änderung, kein
 *   eigener Zeitgeber daneben.
 * - **Sparsam:** nur, wo es zählt. Zu viel Rütteln stumpft ab, und dann geht
 *   auch das Wichtige unter.
 */

export type HapticName = 'tick' | 'success' | 'error';

/** Muster in Millisekunden (Zahl = ein Impuls, Liste = Vibrieren/Pause/…). */
const PATTERNS: Record<HapticName, number | number[]> = {
  tick: 8,
  success: [12, 40, 24],
  error: [40, 30, 40],
};

export function haptic(name: HapticName): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

    // Wer Bewegung im Betriebssystem abgeschaltet hat, will in aller Regel auch
    // kein Rütteln – dieselbe Rücksicht wie bei den Animationen.
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    navigator.vibrate(PATTERNS[name]);
  } catch {
    // Beiwerk: Ein Fehler hier darf die Bedienung nicht stören.
  }
}
