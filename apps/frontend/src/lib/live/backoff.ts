/**
 * Wartezeit zwischen zwei Verbindungsversuchen des Live-Kanals.
 *
 * Exponentiell mit Obergrenze, dazu ein Zufallsanteil („Jitter"), damit nicht
 * alle offenen Browserfenster nach einem Backend-Neustart gleichzeitig
 * anklopfen. Gleiches Vorgehen wie beim Agent (Arbeitspaket A1), hier aber
 * bewusst mit kürzerem Start: ein Mensch sitzt davor und wartet.
 */

export const INITIAL_RECONNECT_DELAY_MS = 500;
export const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * Wartezeit für den `attempt`-ten Versuch (0-basiert).
 *
 * `random` ist der Zufallsanteil aus `[0, 1)`; er ist Parameter statt
 * eingebautem `Math.random()`, damit die Funktion prüfbar bleibt.
 */
export function reconnectDelayMs(attempt: number, random: number): number {
  const exponent = Math.max(0, Math.trunc(attempt));
  const base = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** exponent, MAX_RECONNECT_DELAY_MS);
  // Bis zu 20 % Aufschlag, nie weniger als die Grundwartezeit.
  return Math.round(base * (1 + Math.min(Math.max(random, 0), 1) * 0.2));
}
