/**
 * Spiegel der Sicht und der Legalitätsregeln aus `@palantir/arcade`.
 *
 * Das Paket exportiert nur die Regel-Objekte, nicht deren Zustandstypen. Das
 * Brett braucht die Regeln trotzdem selbst, um mögliche Ziele vorab
 * hervorzuheben – entschieden wird weiterhin von `applyMove`.
 */

export type Pile = 'w' | 'f0' | 'f1' | 'f2' | 'f3' | 't0' | 't1' | 't2' | 't3' | 't4' | 't5' | 't6';

export type SolitaerMove =
  | { type: 'ziehen' }
  | { type: 'verschieben'; from: Pile; to: Pile; count: number }
  | { type: 'vervollstaendigen' }
  | { type: 'aufgeben' };

export interface SolitaerView {
  draw: 1 | 3;
  stockCount: number;
  wasteTop: number[];
  wasteCount: number;
  foundations: number[][];
  tableau: { down: number; up: number[] }[];
  score: number;
  moves: number;
  over: boolean;
  won: boolean;
  bonus: number;
  canAutoComplete: boolean;
  last: { from: Pile | 'stock'; to: Pile | 'stock' } | null;
}

export const suitOf = (card: number): number => Math.floor(card / 13);
export const rankOf = (card: number): number => (card % 13) + 1;
export const isRed = (card: number): boolean => suitOf(card) === 1 || suitOf(card) === 2;

export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'] as const;
export const RANK_LABELS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'B',
  'D',
  'K',
] as const;

export function canOnFoundation(card: number, foundation: readonly number[]): boolean {
  const top = foundation[foundation.length - 1];
  if (top === undefined) return rankOf(card) === 1;
  return suitOf(top) === suitOf(card) && rankOf(card) === rankOf(top) + 1;
}

export function canOnTableau(card: number, up: readonly number[], down: number): boolean {
  const top = up[up.length - 1];
  if (top === undefined) return down === 0 && rankOf(card) === 13;
  return isRed(top) !== isRed(card) && rankOf(top) === rankOf(card) + 1;
}
