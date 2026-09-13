import { type Tone } from '../primitives/Badge';

/**
 * Farbzuordnung der Kennzahlen – einmal für das ganze Panel.
 *
 * Bis hierher rechnete jede Ansicht ihre Schwellen selbst: Die Kachel der
 * Übersicht färbte ab 75 % rot, die Detailseite färbte gar nicht. Damit hieß
 * derselbe Messwert je nach Seite etwas anderes. Die Schwellen stehen deshalb
 * an genau einer Stelle, wie die Farbtokens selbst.
 */

/** Auslastung (CPU, RAM, Platte) in eine Ampel-Farbe übersetzen. */
export function lastTon(percent: number | null | undefined): Tone | undefined {
  if (percent == null) return undefined;
  if (percent >= 82) return 'danger';
  if (percent >= 55) return 'warning';
  return 'success';
}

/** Umlaufzeit in eine Ampel-Farbe übersetzen. */
export function pingTon(pingMs: number | null | undefined): Tone | undefined {
  if (pingMs == null) return undefined;
  if (pingMs > 60) return 'danger';
  if (pingMs > 35) return 'warning';
  return 'success';
}
