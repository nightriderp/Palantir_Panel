/**
 * Farben der Sitze – einheitlich über alle rundenbasierten Spiele.
 *
 * Sitz 0 ist immer Rot, Sitz 1 immer Blau usw. Spiele mit eigener Farbordnung
 * (Schach: Weiß/Schwarz, Codenames: Teams) zeichnen ihre Figuren selbst, nutzen
 * diese Farben aber für Namensschilder und den Spielverlauf.
 */
export const SEAT_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#ec4899',
  '#64748b',
  '#84cc16',
] as const;

export function seatColor(index: number): string {
  return SEAT_COLORS[index % SEAT_COLORS.length] ?? '#64748b';
}
