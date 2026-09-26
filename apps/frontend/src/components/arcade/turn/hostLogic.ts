import { type ArcadeMetric } from '@palantir/contracts';
import { type SeatController, type TurnOutcome } from '@palantir/arcade';

/**
 * Entscheidungen des rundenbasierten Wirts am selben Gerät – ohne React.
 *
 * Wessen Sicht zeigt der Bildschirm, wann kommt der Vorhang („Gib das Gerät
 * an …"), und wann geht eine Partie in die Bestenliste? Das sind genau die
 * Fragen, bei denen ein Fehler Handkarten verrät oder Siege verschenkt – und
 * die man beim Durchklicken leicht übersieht. Deshalb hier, mit Test.
 */

/** Sitze, auf denen ein Mensch spielt. */
export function humanSeats(seats: readonly SeatController[]): number[] {
  return seats.flatMap((seat, index) => (seat.type === 'human' ? [index] : []));
}

export interface ViewSeatInput {
  seats: readonly SeatController[];
  activeSeats: readonly number[];
  /** Zuletzt gezeigter Mensch – bleibt sichtbar, während Bots nachdenken. */
  lastHumanSeat: number | null;
  /** Vom Nutzer gewählter Sitz (Umschalter), falls mehrere Menschen gleichzeitig dran sind. */
  selectedSeat: number | null;
}

/**
 * Aus wessen Sicht gezeichnet wird.
 *
 *   - Genau ein Mensch ist dran → dessen Sitz.
 *   - Mehrere Menschen sind gleichzeitig dran (Codenames-Team, Schiffe
 *     setzen, Black Stories) → der gewählte, sonst der zuletzt ziehende,
 *     sonst der erste von ihnen.
 *   - Kein Mensch ist dran (Bots denken, Partie vorbei) → der zuletzt
 *     gezeigte Mensch, sonst der erste Mensch überhaupt.
 */
export function chooseViewSeat({
  seats,
  activeSeats,
  lastHumanSeat,
  selectedSeat,
}: ViewSeatInput): number | null {
  const humans = humanSeats(seats);
  const activeHumans = activeSeats.filter((seat) => humans.includes(seat));
  if (activeHumans.length === 1) return activeHumans[0] ?? null;
  if (activeHumans.length > 1) {
    // Beim zuletzt gewählten bzw. zuletzt ziehenden Menschen bleiben, solange er
    // dran ist – der Rätselmeister in Black Stories soll nicht nach jeder Frage
    // in eine fremde Sicht springen.
    if (selectedSeat !== null && activeHumans.includes(selectedSeat)) return selectedSeat;
    if (lastHumanSeat !== null && activeHumans.includes(lastHumanSeat)) return lastHumanSeat;
    return activeHumans[0] ?? null;
  }
  if (lastHumanSeat !== null && humans.includes(lastHumanSeat)) return lastHumanSeat;
  return humans[0] ?? null;
}

/** Aktive Menschen – für den Sitz-Umschalter. */
export function activeHumanSeats(
  seats: readonly SeatController[],
  activeSeats: readonly number[],
): number[] {
  const humans = humanSeats(seats);
  return activeSeats.filter((seat) => humans.includes(seat));
}

export interface CurtainInput {
  hiddenInformation: boolean;
  seats: readonly SeatController[];
  /** Sitz, dessen Sicht gerade aufgedeckt ist (`null` = noch keiner). */
  revealedSeat: number | null;
  viewSeat: number | null;
  finished: boolean;
}

/**
 * Muss der Bildschirm verdeckt werden, bevor `viewSeat` zu sehen ist?
 *
 * Nur bei verdeckter Information und mehr als einem Menschen – spielt einer
 * allein gegen Bots, gibt es niemanden, vor dem etwas zu verbergen wäre. Nach
 * dem Ende liegt alles offen; da braucht es keinen Vorhang mehr.
 */
export function needsCurtain({
  hiddenInformation,
  seats,
  revealedSeat,
  viewSeat,
  finished,
}: CurtainInput): boolean {
  if (!hiddenInformation || finished || viewSeat === null) return false;
  if (humanSeats(seats).length < 2) return false;
  return revealedSeat !== viewSeat;
}

export type RankingDecision =
  | { submit: true; humanSeat: number }
  | {
      submit: false;
      reason: 'mehrere-menschen' | 'kein-startwert' | 'nicht-gewonnen' | 'kein-mensch';
    };

/**
 * Geht die Partie in die Bestenliste?
 *
 * Nur mit genau einem Menschen (sonst könnte man sich am eigenen Gerät Siege
 * zuschieben) und mit einem Startwert vom Backend (sonst kann es nicht
 * nachrechnen). Bei `wins` zählt nur ein Sieg – eine Niederlage einzureichen
 * kostete das Backend Rechenzeit für nichts. Bei `score` zählt jede beendete
 * Partie.
 */
export function rankingDecision(input: {
  seats: readonly SeatController[];
  metric: ArcadeMetric;
  outcome: TurnOutcome;
  hasSeed: boolean;
}): RankingDecision {
  const humans = humanSeats(input.seats);
  if (humans.length === 0) return { submit: false, reason: 'kein-mensch' };
  if (humans.length > 1) return { submit: false, reason: 'mehrere-menschen' };
  const humanSeat = humans[0] as number;
  if (!input.hasSeed) return { submit: false, reason: 'kein-startwert' };
  if (input.metric === 'wins' && !input.outcome.winners.includes(humanSeat)) {
    return { submit: false, reason: 'nicht-gewonnen' };
  }
  return { submit: true, humanSeat };
}

export const RANKING_REASON_TEXT: Record<
  Exclude<RankingDecision, { submit: true }>['reason'],
  string
> = {
  'mehrere-menschen': 'Partien mit mehreren Menschen am selben Gerät werden nicht gewertet.',
  'kein-startwert':
    'Ohne Startwert vom Server lässt sich die Partie nicht nachrechnen – sie zählt nicht.',
  'nicht-gewonnen': 'In die Bestenliste gehen nur Siege.',
  'kein-mensch': 'Ohne menschlichen Mitspieler gibt es nichts zu werten.',
};

/** Verzögerung eines Bot-Zugs – lang genug, dass man ihn sieht, kurz genug, dass es nicht nervt. */
export function botDelayMs(random: number): number {
  return 600 + Math.round(Math.min(1, Math.max(0, random)) * 300);
}
