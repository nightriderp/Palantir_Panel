/**
 * Sicht und Züge von Catan, wie die Regel sie liefert bzw. annimmt.
 *
 * Gespiegelt aus `packages/arcade/src/games/catan.ts`: Das Paket exportiert
 * nur das Register, nicht die Typen einzelner Spiele. Ändert sich die Sicht
 * dort, muss sie hier nachgezogen werden.
 */

export type Phase =
  'setup' | 'roll' | 'discard' | 'robber' | 'main' | 'roadBuilding' | 'trade' | 'over';

export interface TradeOffer {
  from: number;
  give: number[];
  get: number[];
  /** Je Sitz: 0 offen, 1 angenommen, 2 abgelehnt. */
  answers: number[];
}

export interface LastBuilt {
  kind: 'settlement' | 'city' | 'road' | 'robber';
  at: number;
  seat: number;
}

export interface CatanSeatView {
  cards: number;
  devCards: number;
  knights: number;
  vp: number;
  roadLength: number;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  discard: number;
}

export interface CatanLegal {
  settlements: number[];
  cities: number[];
  roads: number[];
  robberVictims: number[][];
  bankRates: number[];
  canBuy: { road: boolean; settlement: boolean; city: boolean; dev: boolean };
  playableDev: number[];
}

export interface CatanView {
  me: number | null;
  players: number;
  phase: Phase;
  current: number;
  round: number;
  targetVp: number;
  maxRounds: number;
  geo: {
    hexes: { q: number; r: number }[];
    hexVertices: number[][];
    vertices: { x: number; y: number }[];
    edges: [number, number][];
  };
  hexRes: number[];
  hexNum: number[];
  ports: { edge: number; kind: number }[];
  robber: number;
  vOwner: number[];
  vCity: boolean[];
  eOwner: number[];
  bank: number[];
  deckCount: number;
  seats: CatanSeatView[];
  longestHolder: number;
  armyHolder: number;
  dice: number[];
  rolled: boolean;
  hand: number[] | null;
  devHand: number[] | null;
  devNew: number[] | null;
  devPlayed: boolean;
  trade: TradeOffer | null;
  offersLeft: number;
  roadBuildLeft: number;
  setupVertex: number;
  lastBuilt: LastBuilt[];
  mySteal: { role: 'thief' | 'victim'; other: number; res: number } | null;
  legal: CatanLegal | null;
  winners: number[] | null;
}

export type CatanMove =
  | { t: 'roll' }
  | { t: 'settlement'; v: number }
  | { t: 'city'; v: number }
  | { t: 'road'; e: number }
  | { t: 'buy' }
  | { t: 'dev'; card: number; a: number; b: number }
  | { t: 'robber'; hex: number; victim: number }
  | { t: 'discard'; cards: number[] }
  | { t: 'bank'; give: number; get: number }
  | { t: 'offer'; give: number[]; get: number[] }
  | { t: 'respond'; accept: boolean }
  | { t: 'accept'; seat: number }
  | { t: 'cancel' }
  | { t: 'done' }
  | { t: 'end' };

export const RES_NAMES = ['Holz', 'Lehm', 'Wolle', 'Getreide', 'Erz'] as const;
export const DEV_NAMES = ['Ritter', 'Siegpunkt', 'Straßenbau', 'Erfindung', 'Monopol'] as const;
export const DEV_HINTS = [
  'Räuber versetzen und eine Karte ziehen.',
  'Zählt verdeckt einen Siegpunkt.',
  'Zwei Straßen kostenlos bauen.',
  'Zwei Rohstoffe nach Wahl aus der Bank.',
  'Alle geben dir einen Rohstoff deiner Wahl.',
] as const;

export const COSTS = {
  road: [1, 1, 0, 0, 0],
  settlement: [1, 1, 1, 1, 0],
  city: [0, 0, 0, 2, 3],
  dev: [0, 0, 1, 1, 1],
} as const;
