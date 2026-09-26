/**
 * Sicht und Züge von Risiko, wie sie die Regeln liefern bzw. erwarten.
 *
 * Gespiegelt aus `packages/arcade/src/games/risiko.ts`, weil das Paket nur das
 * Register exportiert und nicht die spielinternen Typen. Ändert sich dort die
 * Sicht, muss sie hier mitziehen – der Wirt reicht sie undurchsichtig durch.
 */

export type CardKind = 0 | 1 | 2 | 3;

export interface Card {
  t: number;
  k: CardKind;
}

export type Phase = 'setup' | 'reinforce' | 'attack' | 'occupy' | 'fortify' | 'over';

export interface AttackReport {
  seq: number;
  seat: number;
  defender: number;
  from: number;
  to: number;
  atk: number[];
  def: number[];
  lossA: number;
  lossD: number;
  rolls: number;
  conquered: boolean;
}

export interface RisikoOptions {
  autoPlace: boolean;
  quick: boolean;
  roundLimit: number;
}

export interface RisikoView {
  me: number | null;
  players: number;
  options: RisikoOptions;
  map: {
    names: string[];
    continentOf: number[];
    adjacency: number[][];
    continents: { name: string; bonus: number; members: number[] }[];
  };
  owner: number[];
  armies: number[];
  phase: Phase;
  current: number;
  round: number;
  setupPool: number[];
  reinforcements: number;
  occupy: { from: number; to: number; min: number; max: number } | null;
  conqueredThisTurn: boolean;
  hand: Card[] | null;
  handCounts: number[];
  deckCount: number;
  trades: number;
  nextTradeValue: number;
  income: number[];
  eliminated: boolean[];
  lastAttack: AttackReport | null;
  lastFortify: { from: number; to: number; n: number } | null;
  lastPlace: { t: number; n: number } | null;
  winners: number[] | null;
  summary: string;
}

export type RisikoMove =
  | { type: 'place'; t: number; n: number }
  | { type: 'autoSetup' }
  | { type: 'trade'; cards: [number, number, number] }
  | {
      type: 'attack';
      from: number;
      to: number;
      dice?: number;
      blitz?: boolean;
      stopAt?: number;
    }
  | { type: 'occupy'; n: number }
  | { type: 'endAttack' }
  | { type: 'fortify'; from: number; to: number; n: number }
  | { type: 'endTurn' };

export function isValidSet(cards: readonly Card[]): boolean {
  if (cards.length !== 3) return false;
  if (cards.some((c) => c.k === 3)) return true;
  const kinds = new Set(cards.map((c) => c.k));
  return kinds.size === 1 || kinds.size === 3;
}
