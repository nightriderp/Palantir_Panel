/**
 * Catan – Grundspiel für 2–4 Sitze.
 *
 * Aufgeteilt in drei Dateien: `catan-board.ts` (Geometrie, Aufbau),
 * `catan-core.ts` (Zustand und Regeln) und `catan-bot.ts` (Computergegner).
 * Hier stehen nur die Stellen, an denen fremde Daten ankommen (`parseMove`,
 * `parseOptions`) oder Daten den Server verlassen (`view`).
 *
 * Die Sicht bringt die Brett-Geometrie und die gerade legalen Bauplätze mit:
 * Die Oberfläche kann die Regeln nicht importieren (das Paket exportiert nur
 * das Register) und soll sie auch nicht nachbauen. So hebt sie genau das
 * hervor, was `applyMove` annehmen wird.
 */

import { type TurnGame, cloneState, intIn, isRecord } from '../turn.js';
import { GEO, type Port, RES_COUNT, at } from './catan-board.js';
import { botMove } from './catan-bot.js';
import {
  COST_CITY,
  COST_DEV,
  COST_ROAD,
  COST_SETTLEMENT,
  type CatanMove,
  type CatanOptions,
  type CatanState,
  type LastBuilt,
  MAX_OFFERS_PER_TURN,
  type Phase,
  type TradeOffer,
  activeSeatsOf,
  applyCatanMove,
  bankRates,
  canPay,
  legalCities,
  legalRoads,
  legalSettlements,
  robberVictims,
  roadLength,
  setupState,
  sum,
  victoryPoints,
} from './catan-core.js';

export type { CatanMove, CatanOptions, CatanState } from './catan-core.js';

export interface CatanSeatView {
  cards: number;
  devCards: number;
  knights: number;
  /** Öffentliche Siegpunkte; beim eigenen Sitz inklusive verdeckter Siegpunktkarten. */
  vp: number;
  roadLength: number;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  /** Noch abzuwerfende Karten (nur in der Abwurf-Phase > 0). */
  discard: number;
}

export interface CatanLegal {
  settlements: number[];
  cities: number[];
  roads: number[];
  /** Je Feld die möglichen Opfer beim Versetzen des Räubers. */
  robberVictims: number[][];
  bankRates: number[];
  canBuy: { road: boolean; settlement: boolean; city: boolean; dev: boolean };
  /** Spielbare Entwicklungskarten je Art (ohne diesen Zug gekaufte). */
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
  ports: Port[];
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
  /** Eigene Hand; `null` für Zuschauer. */
  hand: number[] | null;
  devHand: number[] | null;
  devNew: number[] | null;
  devPlayed: boolean;
  trade: TradeOffer | null;
  offersLeft: number;
  roadBuildLeft: number;
  setupVertex: number;
  lastBuilt: LastBuilt[];
  /** Letzter Diebstahl, nur für Dieb und Bestohlenen sichtbar. */
  mySteal: { role: 'thief' | 'victim'; other: number; res: number } | null;
  /** Legale Züge für den eigenen Sitz (leer, wenn er nicht dran ist). */
  legal: CatanLegal | null;
  winners: number[] | null;
}

// ---------------------------------------------------------------------------
// Fremde Daten prüfen
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: CatanOptions = { layout: 'einsteiger', targetVp: 10, maxRounds: 0 };

function parseOptions(raw: unknown): CatanOptions | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_OPTIONS };
  if (!isRecord(raw)) return null;
  const layout = raw.layout ?? DEFAULT_OPTIONS.layout;
  if (layout !== 'einsteiger' && layout !== 'zufall') return null;
  const targetVp = raw.targetVp === undefined ? DEFAULT_OPTIONS.targetVp : raw.targetVp;
  if (targetVp !== 10 && targetVp !== 12) return null;
  const maxRounds = raw.maxRounds === undefined ? 0 : intIn(raw.maxRounds, 0, 200);
  if (maxRounds === null) return null;
  return { layout, targetVp, maxRounds };
}

function resArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== RES_COUNT) return null;
  const out: number[] = [];
  for (const n of value) {
    const v = intIn(n, 0, 19);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

function parseMove(raw: unknown): CatanMove | null {
  if (!isRecord(raw) || typeof raw.t !== 'string') return null;
  const res = (x: unknown): number | null => intIn(x, 0, RES_COUNT - 1);
  switch (raw.t) {
    case 'roll':
    case 'buy':
    case 'cancel':
    case 'done':
    case 'end':
      return { t: raw.t };
    case 'settlement':
    case 'city': {
      const v = intIn(raw.v, 0, GEO.vertices.length - 1);
      return v === null ? null : { t: raw.t, v };
    }
    case 'road': {
      const e = intIn(raw.e, 0, GEO.edges.length - 1);
      return e === null ? null : { t: 'road', e };
    }
    case 'dev': {
      const card = intIn(raw.card, 0, 4);
      const a = raw.a === undefined ? 0 : res(raw.a);
      const b = raw.b === undefined ? 0 : res(raw.b);
      return card === null || a === null || b === null ? null : { t: 'dev', card, a, b };
    }
    case 'robber': {
      const hex = intIn(raw.hex, 0, GEO.hexes.length - 1);
      const victim = intIn(raw.victim, -1, 3);
      return hex === null || victim === null ? null : { t: 'robber', hex, victim };
    }
    case 'discard': {
      const cards = resArray(raw.cards);
      return cards ? { t: 'discard', cards } : null;
    }
    case 'bank': {
      const give = res(raw.give);
      const get = res(raw.get);
      return give === null || get === null ? null : { t: 'bank', give, get };
    }
    case 'offer': {
      const give = resArray(raw.give);
      const get = resArray(raw.get);
      return give && get ? { t: 'offer', give, get } : null;
    }
    case 'respond':
      return typeof raw.accept === 'boolean' ? { t: 'respond', accept: raw.accept } : null;
    case 'accept': {
      const seat = intIn(raw.seat, 0, 3);
      return seat === null ? null : { t: 'accept', seat };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Sicht
// ---------------------------------------------------------------------------

const STATIC_GEO: CatanView['geo'] = {
  hexes: GEO.hexes.map((h) => ({ q: h.q, r: h.r })),
  hexVertices: GEO.hexVertices.map((vs) => [...vs]),
  vertices: GEO.vertices.map((p) => ({ x: p.x, y: p.y })),
  edges: GEO.edges.map(([a, b]) => [a, b] as [number, number]),
};

function legalFor(s: CatanState, seat: number): CatanLegal | null {
  if (!activeSeatsOf(s).includes(seat)) return null;
  const hand = at(s.hands, seat);
  const main = s.phase === 'main';
  const setupSettle = s.phase === 'setup' && s.setupVertex === -1;
  const setupRoad = s.phase === 'setup' && s.setupVertex !== -1;
  const canRoad =
    at(s.roadsLeft, seat) > 0 &&
    (s.phase === 'roadBuilding' || setupRoad || (main && canPay(hand, COST_ROAD)));
  const canSettle =
    at(s.settlementsLeft, seat) > 0 && (setupSettle || (main && canPay(hand, COST_SETTLEMENT)));
  const canCity = main && at(s.citiesLeft, seat) > 0 && canPay(hand, COST_CITY);
  const devOk = !s.devPlayed && (s.phase === 'roll' || main);
  return {
    settlements: canSettle ? legalSettlements(s, seat, setupSettle) : [],
    cities: canCity ? legalCities(s, seat) : [],
    roads: canRoad ? legalRoads(s, seat) : [],
    robberVictims:
      s.phase === 'robber'
        ? GEO.hexes.map((_, h) => (h === s.robber ? [] : robberVictims(s, seat, h)))
        : [],
    bankRates: bankRates(s, seat),
    canBuy: {
      road: main && at(s.roadsLeft, seat) > 0 && canPay(hand, COST_ROAD),
      settlement: main && at(s.settlementsLeft, seat) > 0 && canPay(hand, COST_SETTLEMENT),
      city: canCity,
      dev: main && s.devDeck.length > 0 && canPay(hand, COST_DEV),
    },
    playableDev: at(s.devHand, seat).map((n, k) =>
      devOk && k !== 1 ? Math.max(0, n - at(at(s.devNew, seat), k)) : 0,
    ),
  };
}

function view(s: CatanState, seat: number | null): CatanView {
  const mine = seat !== null && seat >= 0 && seat < s.players ? seat : null;
  const over = s.phase === 'over';
  let mySteal: CatanView['mySteal'] = null;
  if (mine !== null && s.lastSteal) {
    if (s.lastSteal.thief === mine)
      mySteal = { role: 'thief', other: s.lastSteal.victim, res: s.lastSteal.res };
    else if (s.lastSteal.victim === mine)
      mySteal = { role: 'victim', other: s.lastSteal.thief, res: s.lastSteal.res };
  }
  return {
    me: mine,
    players: s.players,
    phase: s.phase,
    current: s.current,
    round: s.round,
    targetVp: s.options.targetVp,
    maxRounds: s.options.maxRounds,
    geo: STATIC_GEO,
    hexRes: [...s.hexRes],
    hexNum: [...s.hexNum],
    ports: s.ports.map((p) => ({ ...p })),
    robber: s.robber,
    vOwner: [...s.vOwner],
    vCity: [...s.vCity],
    eOwner: [...s.eOwner],
    bank: [...s.bank],
    deckCount: s.devDeck.length,
    seats: Array.from({ length: s.players }, (_, p) => ({
      cards: sum(at(s.hands, p)),
      devCards: sum(at(s.devHand, p)),
      knights: at(s.knights, p),
      // Am Ende werden verdeckte Siegpunkte aufgedeckt.
      vp: victoryPoints(s, p, p === mine || over),
      roadLength: roadLength(s, p),
      roadsLeft: at(s.roadsLeft, p),
      settlementsLeft: at(s.settlementsLeft, p),
      citiesLeft: at(s.citiesLeft, p),
      discard: at(s.discard, p),
    })),
    longestHolder: s.longestHolder,
    armyHolder: s.armyHolder,
    dice: [...s.dice],
    rolled: s.rolled,
    hand: mine === null ? null : [...at(s.hands, mine)],
    devHand: mine === null ? null : [...at(s.devHand, mine)],
    devNew: mine === null ? null : [...at(s.devNew, mine)],
    devPlayed: s.devPlayed,
    trade: s.trade ? cloneState(s.trade) : null,
    offersLeft: Math.max(0, MAX_OFFERS_PER_TURN - s.offersThisTurn),
    roadBuildLeft: s.roadBuildLeft,
    setupVertex: s.setupVertex,
    lastBuilt: s.lastBuilt.map((b) => ({ ...b })),
    mySteal,
    legal: mine === null ? null : legalFor(s, mine),
    winners: s.winners ? [...s.winners] : null,
  };
}

// ---------------------------------------------------------------------------
// Spiel
// ---------------------------------------------------------------------------

export const game: TurnGame<CatanState, CatanMove, CatanOptions, CatanView> = {
  kind: 'turn',
  id: 'catan',
  version: 1,
  minPlayers: 2,
  maxPlayers: 4,
  defaultOptions: DEFAULT_OPTIONS,
  parseOptions,
  hiddenInformation: true,
  setup: ({ players, seed, options }) => setupState(players, seed, options),
  activeSeats: activeSeatsOf,
  parseMove,
  applyMove: (state, seat, move) => {
    if (seat < 0 || seat >= state.players) return { ok: false, error: 'Unbekannter Sitz.' };
    return applyCatanMove(state, seat, move);
  },
  outcome: (s) => {
    if (!s.winners) return null;
    return {
      winners: [...s.winners],
      summary: s.summary,
      scores: Array.from({ length: s.players }, (_, p) => victoryPoints(s, p, true)),
    };
  },
  view,
  log: (s) => s.log.slice(-50),
  bot: (state, seat, level, rng) => botMove(state, seat, level, rng),
};
