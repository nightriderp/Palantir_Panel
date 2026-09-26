/**
 * Risiko – Weltherrschaft auf 42 Ländern, 2–6 Spieler, mit Computergegnern.
 *
 * Ablauf eines Zugs: Verstärken (Länder/3, mindestens 3, plus Kontinente und
 * Kartentausch) → beliebig oft angreifen → nach einer Eroberung Armeen
 * nachziehen → einmal befestigen → Zugende. Wer im Zug mindestens ein Land
 * erobert, zieht am Ende eine Karte.
 *
 * Bewusste Vereinfachungen gegenüber dem Brettspiel:
 *   - Zwei Spieler spielen ohne neutrale Armeen: je 40 Armeen, die Länder
 *     werden 21:21 verteilt.
 *   - Der Verteidiger würfelt automatisch mit so vielen Würfeln wie möglich
 *     (höchstens zwei). Das ist fast immer die beste Wahl und erspart eine
 *     Rückfrage mitten im Zug des Gegners – online wäre das ein zweiter
 *     aktiver Sitz.
 *   - Der +2-Bonus beim Tausch landet automatisch auf dem ersten eigenen Land
 *     unter den getauschten Karten.
 *   - Tauschen geht nur in der Verstärkungsphase; nach dem Setzen der letzten
 *     Armee beginnt der Angriff von selbst.
 */

import {
  type BotLevel,
  type MoveResult,
  type TurnGame,
  type TurnLogEntry,
  type TurnOutcome,
  cloneState,
  intIn,
  isRecord,
  pushLog,
} from '../turn.js';
import { type RngState, createRng, nextInt, nextRandom, rollDie, shuffled } from '../rng.js';
import {
  ADJACENCY,
  CONTINENTS,
  TERRITORY_CONTINENT,
  TERRITORY_COUNT,
  TERRITORY_NAMES,
  type RisikoContinent,
} from './risiko-karte.js';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** 0 Infanterie, 1 Kavallerie, 2 Artillerie, 3 Joker. */
export type RisikoCardKind = 0 | 1 | 2 | 3;

export interface RisikoCard {
  /** Land auf der Karte; −1 beim Joker. */
  t: number;
  k: RisikoCardKind;
}

export interface RisikoOptions {
  /** Startarmeen sofort zufällig verteilen statt reihum setzen. */
  autoPlace: boolean;
  /** Schnelles Spiel: 70 % der Länder genügen zum Sieg. */
  quick: boolean;
  /** Nach so vielen Runden gewinnt, wer die meisten Länder hält; 0 = aus. */
  roundLimit: number;
}

export type RisikoPhase = 'setup' | 'reinforce' | 'attack' | 'occupy' | 'fortify' | 'over';

export interface RisikoAttackReport {
  /** Laufende Nummer – die Oberfläche erkennt daran einen neuen Wurf. */
  seq: number;
  seat: number;
  defender: number;
  from: number;
  to: number;
  /** Würfel des letzten Wurfs, absteigend. */
  atk: number[];
  def: number[];
  lossA: number;
  lossD: number;
  /** Anzahl Würfe (Blitzangriff > 1). */
  rolls: number;
  conquered: boolean;
}

export interface RisikoState {
  version: 1;
  players: number;
  options: RisikoOptions;
  rng: RngState;
  owner: number[];
  armies: number[];
  phase: RisikoPhase;
  current: number;
  startSeat: number;
  round: number;
  /** Noch zu setzende Startarmeen je Sitz. */
  setupPool: number[];
  /** Noch zu setzende Verstärkung des Sitzes am Zug. */
  reinforcements: number;
  occupy: { from: number; to: number; min: number } | null;
  conqueredThisTurn: boolean;
  hands: RisikoCard[][];
  deck: RisikoCard[];
  discard: RisikoCard[];
  trades: number;
  eliminated: boolean[];
  lastAttack: RisikoAttackReport | null;
  lastFortify: { from: number; to: number; n: number } | null;
  lastPlace: { t: number; n: number } | null;
  attackSeq: number;
  winners: number[] | null;
  summary: string;
  log: TurnLogEntry[];
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
      /** Blitzangriff hört auf, sobald das Ausgangsland höchstens so viele Armeen hat. */
      stopAt?: number;
      /** Nachziehen gleich mitgeben (Bots), sonst folgt die Phase „occupy". */
      moveIn?: 'min' | 'max' | 'half';
    }
  | { type: 'occupy'; n: number }
  | { type: 'endAttack' }
  | { type: 'fortify'; from: number; to: number; n: number }
  | { type: 'endTurn' };

export interface RisikoMapInfo {
  names: readonly string[];
  continentOf: readonly number[];
  adjacency: readonly (readonly number[])[];
  continents: readonly RisikoContinent[];
}

export interface RisikoView {
  me: number | null;
  players: number;
  options: RisikoOptions;
  map: RisikoMapInfo;
  owner: number[];
  armies: number[];
  phase: RisikoPhase;
  current: number;
  round: number;
  setupPool: number[];
  reinforcements: number;
  occupy: { from: number; to: number; min: number; max: number } | null;
  conqueredThisTurn: boolean;
  /** Eigene Handkarten; `null` für Zuschauer. */
  hand: RisikoCard[] | null;
  handCounts: number[];
  deckCount: number;
  trades: number;
  nextTradeValue: number;
  /** Verstärkung, die der Sitz am Zug ohne Karten bekäme (für die Anzeige). */
  income: number[];
  eliminated: boolean[];
  lastAttack: RisikoAttackReport | null;
  lastFortify: { from: number; to: number; n: number } | null;
  lastPlace: { t: number; n: number } | null;
  winners: number[] | null;
  summary: string;
}

// ---------------------------------------------------------------------------
// Konstanten und kleine Hilfen
// ---------------------------------------------------------------------------

const MAP_INFO: RisikoMapInfo = {
  names: TERRITORY_NAMES,
  continentOf: TERRITORY_CONTINENT,
  adjacency: ADJACENCY,
  continents: CONTINENTS,
};

const START_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
const TRADE_VALUES = [4, 6, 8, 10, 12, 15];
const COLOR_NAMES = ['Rot', 'Blau', 'Grün', 'Gelb', 'Lila', 'Orange'];
const CARD_NAMES = ['Infanterie', 'Kavallerie', 'Artillerie', 'Joker'];
/** Anteil der Länder, der im schnellen Spiel genügt. */
const QUICK_SHARE = 0.7;
const MAX_ROUND_LIMIT = 500;
const DEFAULT_OPTIONS: RisikoOptions = { autoPlace: false, quick: false, roundLimit: 0 };

export function tradeValue(tradeIndex: number): number {
  return TRADE_VALUES[tradeIndex] ?? 15 + 5 * (tradeIndex - (TRADE_VALUES.length - 1));
}

function colorName(seat: number): string {
  return COLOR_NAMES[seat] ?? `Sitz ${seat + 1}`;
}

function tName(t: number): string {
  return TERRITORY_NAMES[t] ?? `Land ${t}`;
}

function at(list: readonly number[], i: number): number {
  return list[i] ?? 0;
}

function neighbors(t: number): readonly number[] {
  return ADJACENCY[t] ?? [];
}

function landCount(s: RisikoState, seat: number): number {
  let n = 0;
  for (const o of s.owner) if (o === seat) n += 1;
  return n;
}

function armyCount(s: RisikoState, seat: number): number {
  let n = 0;
  s.owner.forEach((o, t) => {
    if (o === seat) n += at(s.armies, t);
  });
  return n;
}

function ownsContinent(owner: readonly number[], seat: number, c: RisikoContinent): boolean {
  return c.members.every((t) => owner[t] === seat);
}

/** Verstärkung ohne Karten: Länder/3 (min. 3) plus Kontinentboni. */
export function baseIncome(owner: readonly number[], seat: number): number {
  let lands = 0;
  for (const o of owner) if (o === seat) lands += 1;
  if (lands === 0) return 0;
  let income = Math.max(3, Math.floor(lands / 3));
  for (const c of CONTINENTS) if (ownsContinent(owner, seat, c)) income += c.bonus;
  return income;
}

/** Ist das ein gültiger Tauschsatz (drei gleiche, drei verschiedene oder mit Joker)? */
export function isValidSet(cards: readonly RisikoCard[]): boolean {
  if (cards.length !== 3) return false;
  if (cards.some((c) => c.k === 3)) return true;
  const kinds = new Set(cards.map((c) => c.k));
  return kinds.size === 1 || kinds.size === 3;
}

/** Eigene Länder, die über eigene Länder mit `from` verbunden sind. */
function connectedOwn(s: RisikoState, from: number): Set<number> {
  const seat = s.owner[from];
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const t = queue.pop() as number;
    for (const n of neighbors(t)) {
      if (!seen.has(n) && s.owner[n] === seat) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

function log(s: RisikoState, seat: number | null, text: string): void {
  s.log = pushLog(s.log, { seat, text });
}

function drawCard(s: RisikoState): RisikoCard | null {
  if (s.deck.length === 0 && s.discard.length > 0) {
    s.deck = shuffled(s.rng, s.discard);
    s.discard = [];
  }
  return s.deck.pop() ?? null;
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

function finish(s: RisikoState, winners: number[], summary: string): void {
  s.phase = 'over';
  s.winners = winners;
  s.summary = summary;
  s.occupy = null;
  log(s, null, summary);
}

/** Sieg durch Weltherrschaft oder (schnelles Spiel) 70 % der Länder. */
function checkVictory(s: RisikoState, seat: number): boolean {
  const lands = landCount(s, seat);
  if (lands === TERRITORY_COUNT) {
    finish(s, [seat], `Weltherrschaft – ${colorName(seat)} gewinnt.`);
    return true;
  }
  if (s.options.quick && lands >= Math.ceil(TERRITORY_COUNT * QUICK_SHARE)) {
    finish(
      s,
      [seat],
      `${colorName(seat)} hält ${lands} von ${TERRITORY_COUNT} Ländern und gewinnt.`,
    );
    return true;
  }
  return false;
}

/** Rundenlimit erreicht: meiste Länder, bei Gleichstand meiste Armeen. */
function finishByLimit(s: RisikoState): void {
  let best: number[] = [];
  let bestKey = -1;
  for (let seat = 0; seat < s.players; seat += 1) {
    if (s.eliminated[seat]) continue;
    const key = landCount(s, seat) * 10_000 + armyCount(s, seat);
    if (key > bestKey) {
      bestKey = key;
      best = [seat];
    } else if (key === bestKey) {
      best.push(seat);
    }
  }
  const names = best.map(colorName).join(' und ');
  finish(
    s,
    best,
    `Rundenlimit erreicht – ${names} ${best.length > 1 ? 'teilen sich' : 'holt'} den Sieg.`,
  );
}

function beginTurn(s: RisikoState, seat: number): void {
  s.current = seat;
  s.phase = 'reinforce';
  s.reinforcements = baseIncome(s.owner, seat);
  s.conqueredThisTurn = false;
  s.occupy = null;
  s.lastFortify = null;
  s.lastPlace = null;
}

function endTurn(s: RisikoState): void {
  const seat = s.current;
  if (s.conqueredThisTurn) {
    const card = drawCard(s);
    if (card) {
      s.hands[seat]?.push(card);
      log(s, seat, 'zieht eine Karte.');
    }
  }
  let next = seat;
  let wrapped = false;
  for (let i = 0; i < s.players; i += 1) {
    next = (next + 1) % s.players;
    if (next === s.startSeat) wrapped = true;
    if (!s.eliminated[next]) break;
  }
  if (wrapped) {
    s.round += 1;
    if (s.options.roundLimit > 0 && s.round > s.options.roundLimit) {
      finishByLimit(s);
      return;
    }
  }
  beginTurn(s, next);
}

/** Nächster Sitz im Aufbau, der noch Startarmeen hat; sonst beginnt das Spiel. */
function advanceSetup(s: RisikoState): void {
  for (let i = 1; i <= s.players; i += 1) {
    const seat = (s.current + i) % s.players;
    if (at(s.setupPool, seat) > 0) {
      s.current = seat;
      return;
    }
  }
  log(s, null, 'Alle Startarmeen stehen – das Spiel beginnt.');
  beginTurn(s, s.startSeat);
}

/** Restliche Startarmeen eines Sitzes zufällig auf seine Grenzländer verteilen. */
function autoDistribute(s: RisikoState, seat: number): void {
  const own: number[] = [];
  s.owner.forEach((o, t) => {
    if (o === seat) own.push(t);
  });
  const border = own.filter((t) => neighbors(t).some((n) => s.owner[n] !== seat));
  const pool = border.length > 0 ? border : own;
  let left = at(s.setupPool, seat);
  while (left > 0 && pool.length > 0) {
    const t = pool[nextInt(s.rng, pool.length)] as number;
    s.armies[t] = at(s.armies, t) + 1;
    left -= 1;
  }
  s.setupPool[seat] = 0;
}

/** Nach einer Eroberung (und dem Nachziehen): Tauschpflicht oder weiter angreifen. */
function afterOccupy(s: RisikoState): void {
  s.occupy = null;
  const hand = s.hands[s.current] ?? [];
  s.phase = hand.length >= 5 ? 'reinforce' : 'attack';
  if (s.phase === 'reinforce') {
    s.reinforcements = 0;
    log(s, s.current, 'hat fünf oder mehr Karten und muss tauschen.');
  }
}

function doOccupy(s: RisikoState, n: number): void {
  const occ = s.occupy;
  if (!occ) return;
  s.armies[occ.from] = at(s.armies, occ.from) - n;
  s.armies[occ.to] = at(s.armies, occ.to) + n;
  log(s, s.current, `zieht ${n} ${n === 1 ? 'Armee' : 'Armeen'} nach ${tName(occ.to)}.`);
  afterOccupy(s);
}

function occupyAmount(s: RisikoState, policy: 'min' | 'max' | 'half'): number {
  const occ = s.occupy;
  if (!occ) return 0;
  const max = at(s.armies, occ.from) - 1;
  if (policy === 'min') return occ.min;
  if (policy === 'max') return max;
  return Math.min(max, Math.max(occ.min, Math.ceil(max / 2)));
}

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

function setup(players: number, seed: number, options: RisikoOptions): RisikoState {
  const rng = createRng(seed);
  const order = shuffled(
    rng,
    Array.from({ length: TERRITORY_COUNT }, (_, i) => i),
  );
  const startSeat = nextInt(rng, players);
  const owner = new Array<number>(TERRITORY_COUNT).fill(0);
  const armies = new Array<number>(TERRITORY_COUNT).fill(1);
  const start = START_ARMIES[players] ?? 20;
  const setupPool = new Array<number>(players).fill(start);
  // Reihum ab dem Startspieler verteilen, damit bei ungerader Teilung nicht immer Sitz 0 vorn liegt.
  order.forEach((t, i) => {
    const seat = (startSeat + i) % players;
    owner[t] = seat;
    setupPool[seat] = at(setupPool, seat) - 1;
  });
  const cards: RisikoCard[] = [];
  for (let t = 0; t < TERRITORY_COUNT; t += 1) cards.push({ t, k: (t % 3) as RisikoCardKind });
  cards.push({ t: -1, k: 3 }, { t: -1, k: 3 });
  const s: RisikoState = {
    version: 1,
    players,
    options,
    rng,
    owner,
    armies,
    phase: 'setup',
    current: startSeat,
    startSeat,
    round: 1,
    setupPool,
    reinforcements: 0,
    occupy: null,
    conqueredThisTurn: false,
    hands: Array.from({ length: players }, () => []),
    deck: shuffled(rng, cards),
    discard: [],
    trades: 0,
    eliminated: new Array<boolean>(players).fill(false),
    lastAttack: null,
    lastFortify: null,
    lastPlace: null,
    attackSeq: 0,
    winners: null,
    summary: '',
    log: [],
  };
  log(s, null, `Die Länder sind verteilt, ${colorName(startSeat)} beginnt.`);
  if (options.autoPlace) {
    for (let seat = 0; seat < players; seat += 1) autoDistribute(s, seat);
    log(s, null, 'Die Startarmeen wurden automatisch verteilt.');
    beginTurn(s, startSeat);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Züge
// ---------------------------------------------------------------------------

function fail(error: string): MoveResult<RisikoState> {
  return { ok: false, error };
}

function applyTrade(s: RisikoState, seat: number, idx: readonly number[]): string | null {
  const hand = s.hands[seat] ?? [];
  if (new Set(idx).size !== 3 || idx.some((i) => i >= hand.length)) {
    return 'Wähle drei verschiedene Karten aus deiner Hand.';
  }
  const cards = idx.map((i) => hand[i] as RisikoCard);
  if (!isValidSet(cards)) {
    return 'Tauschen geht nur mit drei gleichen, drei verschiedenen oder einem Joker.';
  }
  const value = tradeValue(s.trades);
  s.trades += 1;
  s.reinforcements += value;
  s.hands[seat] = hand.filter((_, i) => !idx.includes(i));
  s.discard.push(...cards);
  let text = `tauscht ${cards.map((c) => CARD_NAMES[c.k]).join(', ')} gegen ${value} Armeen`;
  const bonusLand = cards.find((c) => c.t >= 0 && s.owner[c.t] === seat);
  if (bonusLand) {
    s.armies[bonusLand.t] = at(s.armies, bonusLand.t) + 2;
    text += ` und bekommt 2 extra auf ${tName(bonusLand.t)}`;
  }
  log(s, seat, `${text}.`);
  return null;
}

function applyAttack(
  s: RisikoState,
  seat: number,
  m: Extract<RisikoMove, { type: 'attack' }>,
): string | null {
  const { from, to } = m;
  if (s.owner[from] !== seat) return 'Angreifen kannst du nur aus einem eigenen Land.';
  if (s.owner[to] === seat) return 'Das Ziel gehört dir schon.';
  if (!neighbors(from).includes(to)) return 'Die Länder grenzen nicht aneinander.';
  if (at(s.armies, from) < 2) return 'Zum Angreifen braucht das Land mindestens zwei Armeen.';
  const stopAt = Math.max(1, m.stopAt ?? 1);
  if (m.blitz && at(s.armies, from) <= stopAt) return 'Das Land hat die Schwelle schon erreicht.';
  const defender = s.owner[to] ?? 0;
  let lossA = 0;
  let lossD = 0;
  let rolls = 0;
  let atk: number[] = [];
  let def: number[] = [];
  let usedDice = 1;
  for (;;) {
    const aDice = Math.min(m.blitz ? 3 : (m.dice ?? 3), at(s.armies, from) - 1);
    const dDice = Math.min(2, at(s.armies, to));
    atk = Array.from({ length: aDice }, () => rollDie(s.rng)).sort((x, y) => y - x);
    def = Array.from({ length: dDice }, () => rollDie(s.rng)).sort((x, y) => y - x);
    usedDice = aDice;
    rolls += 1;
    for (let i = 0; i < Math.min(aDice, dDice); i += 1) {
      if (at(atk, i) > at(def, i)) {
        s.armies[to] = at(s.armies, to) - 1;
        lossD += 1;
      } else {
        s.armies[from] = at(s.armies, from) - 1;
        lossA += 1;
      }
    }
    if (!m.blitz || at(s.armies, to) === 0 || at(s.armies, from) <= stopAt) break;
  }
  const conquered = at(s.armies, to) === 0;
  s.attackSeq += 1;
  s.lastAttack = {
    seq: s.attackSeq,
    seat,
    defender,
    from,
    to,
    atk,
    def,
    lossA,
    lossD,
    rolls,
    conquered,
  };
  const how =
    rolls > 1 ? `im Blitzangriff (${rolls} Würfe)` : `mit ${atk.join('-')} gegen ${def.join('-')}`;
  log(
    s,
    seat,
    `greift ${tName(to)} (${colorName(defender)}) von ${tName(from)} aus an ${how}: verliert ${lossA}, ${colorName(defender)} verliert ${lossD}.`,
  );
  if (!conquered) return null;

  s.owner[to] = seat;
  s.conqueredThisTurn = true;
  log(s, seat, `erobert ${tName(to)}.`);
  if (landCount(s, defender) === 0) {
    s.eliminated[defender] = true;
    const loot = s.hands[defender] ?? [];
    s.hands[seat]?.push(...loot);
    s.hands[defender] = [];
    log(
      s,
      seat,
      `wirft ${colorName(defender)} aus dem Spiel${loot.length > 0 ? ` und übernimmt ${loot.length} ${loot.length === 1 ? 'Karte' : 'Karten'}` : ''}.`,
    );
  }
  if (checkVictory(s, seat)) {
    // Die letzte Eroberung soll auf der Karte trotzdem besetzt aussehen.
    s.armies[to] = usedDice;
    s.armies[from] = Math.max(1, at(s.armies, from) - usedDice);
    return null;
  }
  const max = at(s.armies, from) - 1;
  const min = Math.min(usedDice, max);
  s.occupy = { from, to, min };
  if (min === max) {
    doOccupy(s, max);
  } else if (m.moveIn) {
    doOccupy(s, occupyAmount(s, m.moveIn));
  } else {
    s.phase = 'occupy';
  }
  return null;
}

function applyFortify(
  s: RisikoState,
  seat: number,
  from: number,
  to: number,
  n: number,
): string | null {
  if (s.owner[from] !== seat || s.owner[to] !== seat)
    return 'Befestigen geht nur zwischen eigenen Ländern.';
  if (from === to) return 'Wähle zwei verschiedene Länder.';
  if (n < 1 || n > at(s.armies, from) - 1) return 'Mindestens eine Armee bleibt im Ausgangsland.';
  if (!connectedOwn(s, from).has(to)) return 'Die Länder sind nicht über eigene Länder verbunden.';
  s.armies[from] = at(s.armies, from) - n;
  s.armies[to] = at(s.armies, to) + n;
  s.lastFortify = { from, to, n };
  log(
    s,
    seat,
    `verlegt ${n} ${n === 1 ? 'Armee' : 'Armeen'} von ${tName(from)} nach ${tName(to)}.`,
  );
  return null;
}

function applyMove(state: RisikoState, seat: number, move: RisikoMove): MoveResult<RisikoState> {
  if (state.phase === 'over') return fail('Die Partie ist vorbei.');
  if (seat !== state.current) return fail('Du bist gerade nicht am Zug.');
  const s = cloneState(state);
  const inRange = (t: number) => t >= 0 && t < TERRITORY_COUNT;

  switch (move.type) {
    case 'place': {
      if (!inRange(move.t)) return fail('Unbekanntes Land.');
      if (s.owner[move.t] !== seat) return fail('Setzen kannst du nur auf eigene Länder.');
      if (s.phase === 'setup') {
        if (move.n !== 1) return fail('Im Aufbau wird reihum je eine Armee gesetzt.');
        s.armies[move.t] = at(s.armies, move.t) + 1;
        s.setupPool[seat] = at(s.setupPool, seat) - 1;
        s.lastPlace = { t: move.t, n: 1 };
        advanceSetup(s);
        return { ok: true, state: s };
      }
      if (s.phase !== 'reinforce') return fail('Armeen setzt du nur beim Verstärken.');
      if ((s.hands[seat]?.length ?? 0) >= 5)
        return fail('Mit fünf oder mehr Karten musst du erst tauschen.');
      if (move.n < 1 || move.n > s.reinforcements)
        return fail('So viele Armeen hast du nicht zu setzen.');
      s.armies[move.t] = at(s.armies, move.t) + move.n;
      s.reinforcements -= move.n;
      s.lastPlace = { t: move.t, n: move.n };
      log(s, seat, `setzt ${move.n} ${move.n === 1 ? 'Armee' : 'Armeen'} nach ${tName(move.t)}.`);
      if (s.reinforcements === 0) s.phase = 'attack';
      return { ok: true, state: s };
    }
    case 'autoSetup': {
      if (s.phase !== 'setup') return fail('Automatisch verteilen geht nur im Aufbau.');
      autoDistribute(s, seat);
      log(s, seat, 'verteilt die restlichen Startarmeen automatisch.');
      advanceSetup(s);
      return { ok: true, state: s };
    }
    case 'trade': {
      if (s.phase !== 'reinforce') return fail('Karten tauschst du beim Verstärken.');
      const error = applyTrade(s, seat, move.cards);
      if (error) return fail(error);
      // Nach einem Pflichttausch mitten im Angriff kann nichts mehr zu setzen sein.
      if (s.reinforcements === 0 && (s.hands[seat]?.length ?? 0) < 5) s.phase = 'attack';
      return { ok: true, state: s };
    }
    case 'attack': {
      if (s.phase !== 'attack') return fail('Angreifen geht erst nach dem Verstärken.');
      if (!inRange(move.from) || !inRange(move.to)) return fail('Unbekanntes Land.');
      const error = applyAttack(s, seat, move);
      if (error) return fail(error);
      return { ok: true, state: s };
    }
    case 'occupy': {
      if (s.phase !== 'occupy' || !s.occupy) return fail('Gerade gibt es nichts nachzuziehen.');
      const max = at(s.armies, s.occupy.from) - 1;
      if (move.n < s.occupy.min || move.n > max) {
        return fail(`Ziehe zwischen ${s.occupy.min} und ${max} Armeen nach.`);
      }
      doOccupy(s, move.n);
      return { ok: true, state: s };
    }
    case 'endAttack': {
      if (s.phase !== 'attack') return fail('Du bist nicht in der Angriffsphase.');
      s.phase = 'fortify';
      return { ok: true, state: s };
    }
    case 'fortify': {
      if (s.phase !== 'attack' && s.phase !== 'fortify')
        return fail('Befestigen geht erst nach dem Angriff.');
      if (!inRange(move.from) || !inRange(move.to)) return fail('Unbekanntes Land.');
      const error = applyFortify(s, seat, move.from, move.to, move.n);
      if (error) return fail(error);
      endTurn(s);
      return { ok: true, state: s };
    }
    case 'endTurn': {
      if (s.phase !== 'attack' && s.phase !== 'fortify')
        return fail('Beende erst das Verstärken bzw. Nachziehen.');
      endTurn(s);
      return { ok: true, state: s };
    }
  }
}

// ---------------------------------------------------------------------------
// Prüfen fremder Daten
// ---------------------------------------------------------------------------

function parseOptions(raw: unknown): RisikoOptions | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_OPTIONS };
  if (!isRecord(raw)) return null;
  const out: RisikoOptions = { ...DEFAULT_OPTIONS };
  if (raw.autoPlace !== undefined) {
    if (typeof raw.autoPlace !== 'boolean') return null;
    out.autoPlace = raw.autoPlace;
  }
  if (raw.quick !== undefined) {
    if (typeof raw.quick !== 'boolean') return null;
    out.quick = raw.quick;
  }
  if (raw.roundLimit !== undefined) {
    const limit = intIn(raw.roundLimit, 0, MAX_ROUND_LIMIT);
    if (limit === null) return null;
    out.roundLimit = limit;
  }
  return out;
}

const T_MAX = TERRITORY_COUNT - 1;

function parseMove(raw: unknown): RisikoMove | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'place': {
      const t = intIn(raw.t, 0, T_MAX);
      const n = intIn(raw.n, 1, 10_000);
      return t === null || n === null ? null : { type: 'place', t, n };
    }
    case 'autoSetup':
    case 'endAttack':
    case 'endTurn':
      return { type: raw.type };
    case 'trade': {
      if (!Array.isArray(raw.cards) || raw.cards.length !== 3) return null;
      const [a, b, c] = (raw.cards as unknown[]).map((x) => intIn(x, 0, 200));
      if (a == null || b == null || c == null) return null;
      return { type: 'trade', cards: [a, b, c] };
    }
    case 'attack': {
      const from = intIn(raw.from, 0, T_MAX);
      const to = intIn(raw.to, 0, T_MAX);
      if (from === null || to === null) return null;
      const move: RisikoMove = { type: 'attack', from, to };
      if (raw.dice !== undefined) {
        const dice = intIn(raw.dice, 1, 3);
        if (dice === null) return null;
        move.dice = dice;
      }
      if (raw.blitz !== undefined) {
        if (typeof raw.blitz !== 'boolean') return null;
        move.blitz = raw.blitz;
      }
      if (raw.stopAt !== undefined) {
        const stopAt = intIn(raw.stopAt, 1, 10_000);
        if (stopAt === null) return null;
        move.stopAt = stopAt;
      }
      if (raw.moveIn !== undefined) {
        if (raw.moveIn !== 'min' && raw.moveIn !== 'max' && raw.moveIn !== 'half') return null;
        move.moveIn = raw.moveIn;
      }
      return move;
    }
    case 'occupy': {
      const n = intIn(raw.n, 1, 10_000);
      return n === null ? null : { type: 'occupy', n };
    }
    case 'fortify': {
      const from = intIn(raw.from, 0, T_MAX);
      const to = intIn(raw.to, 0, T_MAX);
      const n = intIn(raw.n, 1, 10_000);
      return from === null || to === null || n === null ? null : { type: 'fortify', from, to, n };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Sicht, Verlauf, Ergebnis
// ---------------------------------------------------------------------------

function view(s: RisikoState, seat: number | null): RisikoView {
  const mine = seat !== null && seat >= 0 && seat < s.players;
  return {
    me: mine ? seat : null,
    players: s.players,
    options: { ...s.options },
    map: MAP_INFO,
    owner: [...s.owner],
    armies: [...s.armies],
    phase: s.phase,
    current: s.current,
    round: s.round,
    setupPool: [...s.setupPool],
    reinforcements: s.reinforcements,
    occupy: s.occupy ? { ...s.occupy, max: at(s.armies, s.occupy.from) - 1 } : null,
    conqueredThisTurn: s.conqueredThisTurn,
    hand: mine ? (s.hands[seat] ?? []).map((c) => ({ ...c })) : null,
    handCounts: s.hands.map((h) => h.length),
    deckCount: s.deck.length,
    trades: s.trades,
    nextTradeValue: tradeValue(s.trades),
    income: Array.from({ length: s.players }, (_, p) => baseIncome(s.owner, p)),
    eliminated: [...s.eliminated],
    lastAttack: s.lastAttack
      ? { ...s.lastAttack, atk: [...s.lastAttack.atk], def: [...s.lastAttack.def] }
      : null,
    lastFortify: s.lastFortify ? { ...s.lastFortify } : null,
    lastPlace: s.lastPlace ? { ...s.lastPlace } : null,
    winners: s.winners ? [...s.winners] : null,
    summary: s.summary,
  };
}

function outcome(s: RisikoState): TurnOutcome | null {
  if (s.phase !== 'over' || !s.winners) return null;
  return {
    winners: [...s.winners],
    summary: s.summary,
    scores: Array.from({ length: s.players }, (_, p) => landCount(s, p)),
  };
}

// ---------------------------------------------------------------------------
// Computergegner
// ---------------------------------------------------------------------------

/**
 * Die Bots rechnen mit einfachen Kennzahlen statt mit Suche: Risiko hat einen
 * riesigen Zugbaum mit Würfelzufall, eine Suche bliebe im Budget ohnehin flach.
 * Jede Entscheidung ist ein linearer Durchlauf über höchstens 42 Länder bzw.
 * die Angriffspaare – weit unter einer Millisekunde.
 */

function enemyNeighbors(s: RisikoState, t: number, seat: number): number[] {
  return neighbors(t).filter((n) => s.owner[n] !== seat);
}

function ownLands(s: RisikoState, seat: number): number[] {
  const out: number[] = [];
  s.owner.forEach((o, t) => {
    if (o === seat) out.push(t);
  });
  return out;
}

/** Druck auf ein Grenzland: gegnerische Armeen ringsum minus eigene. */
function threat(s: RisikoState, t: number, seat: number): number {
  let enemy = 0;
  for (const n of enemyNeighbors(s, t, seat)) enemy = Math.max(enemy, at(s.armies, n));
  return enemy - at(s.armies, t);
}

/** Kontinent, auf den sich der Bot konzentriert: viel eigener Anteil, wenig Gegenwehr. */
function targetContinent(s: RisikoState, seat: number, level: BotLevel): number {
  let best = 0;
  let bestScore = -Infinity;
  CONTINENTS.forEach((c, ci) => {
    if (ownsContinent(s.owner, seat, c)) return;
    let mine = 0;
    let myArmies = 0;
    let enemyArmies = 0;
    for (const t of c.members) {
      if (s.owner[t] === seat) {
        mine += 1;
        myArmies += at(s.armies, t);
      } else {
        enemyArmies += at(s.armies, t);
      }
    }
    // Ohne eigenes Land dort zählt der Kontinent nur, wenn er von außen erreichbar ist.
    const reachable = c.members.some(
      (t) => s.owner[t] === seat || neighbors(t).some((n) => s.owner[n] === seat),
    );
    if (!reachable) return;
    let score = (mine / c.members.length) * 6 - enemyArmies / (myArmies + 3);
    if (level === 'schwer') score += (c.bonus / c.members.length) * 4 - c.members.length * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = ci;
    }
  });
  return best;
}

/** Bestes Aufmarschland: grenzt an Gegner, bevorzugt im bzw. am Zielkontinent. */
function stagingTerritory(s: RisikoState, seat: number, level: BotLevel, rng: RngState): number {
  const own = ownLands(s, seat);
  const border = own.filter((t) => enemyNeighbors(s, t, seat).length > 0);
  const pool = border.length > 0 ? border : own;
  if (level === 'leicht') return pool[nextInt(rng, pool.length)] as number;
  const goal = targetContinent(s, seat, level);
  let best = pool[0] as number;
  let bestScore = -Infinity;
  for (const t of pool) {
    const enemies = enemyNeighbors(s, t, seat);
    const inGoal = enemies.filter((n) => TERRITORY_CONTINENT[n] === goal);
    let score = at(s.armies, t) * 0.5;
    if (inGoal.length > 0) {
      const weakest = Math.min(...inGoal.map((n) => at(s.armies, n)));
      score += 20 - weakest;
    }
    if (TERRITORY_CONTINENT[t] === goal) score += 3;
    score += nextRandom(rng) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Bester Tauschsatz aus der Hand (Joker spart der Bot sich auf). */
function bestSet(s: RisikoState, seat: number): [number, number, number] | null {
  const hand = s.hands[seat] ?? [];
  let best: [number, number, number] | null = null;
  let bestScore = -Infinity;
  for (let a = 0; a < hand.length; a += 1) {
    for (let b = a + 1; b < hand.length; b += 1) {
      for (let c = b + 1; c < hand.length; c += 1) {
        const cards = [hand[a], hand[b], hand[c]] as RisikoCard[];
        if (!isValidSet(cards)) continue;
        let score = -cards.filter((x) => x.k === 3).length * 2;
        if (cards.some((x) => x.t >= 0 && s.owner[x.t] === seat)) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = [a, b, c];
        }
      }
    }
  }
  return best;
}

/**
 * Chance, einen Blitzangriff mit `a` angreifenden Armeen (ohne die eine, die
 * zurückbleibt) gegen `d` Verteidiger zu gewinnen. Einmal beim Laden exakt
 * über alle Würfelkombinationen gerechnet; „schwer" plant damit, statt mit
 * Faustregeln zu raten.
 */
const WIN_MAX = 40;
const WIN_TABLE: number[][] = (() => {
  // Verlustverteilung je Würfelzahl: [Angreifer-Würfel][Verteidiger-Würfel] → [[lossA, lossD, p]]
  const outcomes: Array<Array<Array<[number, number, number]>>> = [];
  for (let ad = 1; ad <= 3; ad += 1) {
    outcomes[ad] = [];
    for (let dd = 1; dd <= 2; dd += 1) {
      const counts = new Map<string, number>();
      const total = 6 ** (ad + dd);
      for (let code = 0; code < total; code += 1) {
        const dice: number[] = [];
        let c = code;
        for (let i = 0; i < ad + dd; i += 1) {
          dice.push((c % 6) + 1);
          c = Math.floor(c / 6);
        }
        const atk = dice.slice(0, ad).sort((x, y) => y - x);
        const def = dice.slice(ad).sort((x, y) => y - x);
        let la = 0;
        let ld = 0;
        for (let i = 0; i < Math.min(ad, dd); i += 1) {
          if (at(atk, i) > at(def, i)) ld += 1;
          else la += 1;
        }
        const key = `${la},${ld}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      (outcomes[ad] as Array<Array<[number, number, number]>>)[dd] = [...counts].map(([key, n]) => {
        const [la, ld] = key.split(',').map(Number);
        return [la ?? 0, ld ?? 0, n / total];
      });
    }
  }
  const p: number[][] = [];
  for (let a = 0; a <= WIN_MAX; a += 1) {
    const row: number[] = [];
    p.push(row);
    for (let d = 0; d <= WIN_MAX; d += 1) {
      if (d === 0) row.push(1);
      else if (a === 0) row.push(0);
      else {
        let sum = 0;
        for (const [la, ld, q] of outcomes[Math.min(3, a)]?.[Math.min(2, d)] ?? []) {
          sum += q * (p[Math.max(0, a - la)]?.[Math.max(0, d - ld)] ?? 0);
        }
        row.push(sum);
      }
    }
  }
  return p;
})();

export function winChance(a: number, d: number): number {
  if (a <= 0) return 0;
  if (d <= 0) return 1;
  const scale = Math.max(a, d) > WIN_MAX ? WIN_MAX / Math.max(a, d) : 1;
  const sa = Math.max(1, Math.round(a * scale));
  const sd = Math.max(1, Math.round(d * scale));
  return WIN_TABLE[sa]?.[sd] ?? 0;
}

/** Was eine Eroberung von `to` dem Sitz bringt – in groben „Armeen-Äquivalenten". */
function conquestGain(s: RisikoState, seat: number, to: number, goal: number): number {
  const defender = s.owner[to] ?? 0;
  const ci = TERRITORY_CONTINENT[to] ?? 0;
  const cont = CONTINENTS[ci];
  let gain = 1;
  if (!s.conqueredThisTurn) gain += 3;
  if (ci === goal) gain += 1.5;
  if (cont && ownsContinent(s.owner, defender, cont)) gain += cont.bonus * 1.5;
  if (cont && cont.members.every((t) => t === to || s.owner[t] === seat)) gain += cont.bonus * 2;
  if (landCount(s, defender) === 1) gain += 6 + (s.hands[defender]?.length ?? 0) * 2;
  return gain;
}

/** Bester geplanter Angriff aus `from`, wenn dort `extra` Armeen dazukämen. */
function bestPlannedAttack(
  s: RisikoState,
  seat: number,
  from: number,
  extra: number,
  goal: number,
): number {
  let best = 0;
  for (const to of enemyNeighbors(s, from, seat)) {
    const p = winChance(at(s.armies, from) - 1 + extra, at(s.armies, to));
    best = Math.max(best, p * conquestGain(s, seat, to, goal));
  }
  return best;
}

function botReinforce(s: RisikoState, seat: number, level: BotLevel, rng: RngState): RisikoMove {
  const handSize = s.hands[seat]?.length ?? 0;
  if (handSize >= 5 || (level !== 'leicht' && handSize >= 3)) {
    const set = bestSet(s, seat);
    if (set) return { type: 'trade', cards: set };
  }
  if (s.reinforcements === 0) return { type: 'endTurn' }; // kommt nicht vor: dann wäre schon Angriff
  if (level === 'schwer') {
    // Erst eigene Kontinente an der gefährdetsten Grenze halten, dann aufmarschieren.
    let worst = -1;
    let worstNeed = 0;
    for (const c of CONTINENTS) {
      if (!ownsContinent(s.owner, seat, c)) continue;
      for (const t of c.members) {
        const need = threat(s, t, seat) + 2;
        if (enemyNeighbors(s, t, seat).length > 0 && need > worstNeed) {
          worstNeed = need;
          worst = t;
        }
      }
    }
    if (worst >= 0) {
      const n = Math.min(s.reinforcements, worstNeed, Math.max(1, Math.ceil(s.reinforcements / 2)));
      return { type: 'place', t: worst, n };
    }
  }
  if (level === 'schwer') {
    // Dorthin setzen, wo die Verstärkung den wertvollsten Angriff möglich macht.
    const goal = targetContinent(s, seat, level);
    let bestT = -1;
    let bestValue = 0.5;
    for (const t of ownLands(s, seat)) {
      const value = bestPlannedAttack(s, seat, t, s.reinforcements, goal);
      if (value > bestValue) {
        bestValue = value;
        bestT = t;
      }
    }
    if (bestT >= 0) return { type: 'place', t: bestT, n: s.reinforcements };
  }
  return { type: 'place', t: stagingTerritory(s, seat, level, rng), n: s.reinforcements };
}

interface AttackOption {
  from: number;
  to: number;
  score: number;
  eliminates: boolean;
}

function attackOptions(s: RisikoState, seat: number, level: BotLevel): AttackOption[] {
  const goal = targetContinent(s, seat, level);
  // Mit jeder Runde etwas mutiger – sonst stauen sich Armeen, und Bot-Partien enden nie.
  const courage = Math.min(2, Math.max(0, (s.round - 12) * 0.1));
  const alive = s.eliminated.filter((e) => !e).length;
  const out: AttackOption[] = [];
  for (const from of ownLands(s, seat)) {
    const a = at(s.armies, from) - 1;
    if (a < 1) continue;
    for (const to of enemyNeighbors(s, from, seat)) {
      const d = at(s.armies, to);
      const defender = s.owner[to] ?? 0;
      const eliminates = landCount(s, defender) === 1;
      if (level === 'schwer') {
        const gain = conquestGain(s, seat, to, goal);
        const p = winChance(a, d);
        // Im Duell lohnt Druck, in der Runde zu dritt und mehr schwächt jeder Fehlschlag gegen alle.
        const threshold = alive > 2 ? (gain >= 6 ? 0.5 : 0.72) : gain >= 6 ? 0.4 : 0.55;
        if (p < threshold - courage * 0.05) continue;
        out.push({ from, to, score: p * gain - (1 - p) * 1.5, eliminates });
        continue;
      }
      let ok: boolean;
      if (level === 'leicht') ok = a > d - courage;
      else ok = a >= d + 2 - courage;
      // Eine Eroberung pro Zug bringt eine Karte – dafür darf es knapper sein.
      if (!ok && level !== 'leicht' && !s.conqueredThisTurn && a >= 2 && a >= d + 1) ok = true;
      if (!ok) continue;
      let score = a - d;
      if (level !== 'leicht') {
        const c = TERRITORY_CONTINENT[to] ?? 0;
        if (c === goal) score += 4;
        const cont = CONTINENTS[c];
        if (cont && ownsContinent(s.owner, defender, cont)) score += 4 + cont.bonus;
        if (cont && cont.members.every((t) => t === to || s.owner[t] === seat))
          score += 6 + cont.bonus;
        if (eliminates) score += 10 + (s.hands[defender]?.length ?? 0) * 2;
      }
      out.push({ from, to, score, eliminates });
    }
  }
  return out;
}

function botAttack(s: RisikoState, seat: number, level: BotLevel, rng: RngState): RisikoMove {
  const options = attackOptions(s, seat, level);
  if (options.length > 0 && !(level === 'leicht' && nextRandom(rng) < 0.2)) {
    let choice: AttackOption;
    if (level === 'leicht') {
      // Leicht greift planlos an, aber nicht völlig blind: eines der drei günstigsten Ziele.
      const top = [...options].sort((x, y) => y.score - x.score).slice(0, 3);
      choice = top[nextInt(rng, top.length)] as AttackOption;
    } else {
      choice = options.reduce((best, o) => (o.score > best.score ? o : best));
    }
    const armies = at(s.armies, choice.from);
    const stopAt =
      level === 'leicht' || choice.eliminates ? 1 : Math.max(1, Math.floor(armies / 4));
    // Nachziehen: Wer hinten keinen Feind mehr hat, zieht alles nach vorn.
    const backEnemies = enemyNeighbors(s, choice.from, seat).filter((n) => n !== choice.to).length;
    const frontEnemies = neighbors(choice.to).filter(
      (n) => n !== choice.from && s.owner[n] !== seat,
    ).length;
    const moveIn: 'min' | 'max' | 'half' =
      backEnemies === 0 ? 'max' : frontEnemies === 0 ? 'min' : 'half';
    if (armies > stopAt) {
      return { type: 'attack', from: choice.from, to: choice.to, blitz: true, stopAt, moveIn };
    }
  }
  return botFortify(s, seat, level);
}

function botFortify(s: RisikoState, seat: number, level: BotLevel): RisikoMove {
  let bestFrom = -1;
  let bestTo = -1;
  let bestScore = -Infinity;
  for (const from of ownLands(s, seat)) {
    const movable = at(s.armies, from) - 1;
    if (movable < 1 || enemyNeighbors(s, from, seat).length > 0) continue;
    for (const to of connectedOwn(s, from)) {
      if (to === from || enemyNeighbors(s, to, seat).length === 0) continue;
      const score =
        movable * 2 +
        (level === 'schwer' ? threat(s, to, seat) : enemyNeighbors(s, to, seat).length);
      if (score > bestScore) {
        bestScore = score;
        bestFrom = from;
        bestTo = to;
      }
    }
  }
  if (bestFrom < 0) return { type: 'endTurn' };
  return { type: 'fortify', from: bestFrom, to: bestTo, n: at(s.armies, bestFrom) - 1 };
}

function bot(state: RisikoState, seat: number, level: BotLevel, rng: RngState): RisikoMove {
  const s = state;
  switch (s.phase) {
    case 'setup':
      return { type: 'place', t: stagingTerritory(s, seat, level, rng), n: 1 };
    case 'reinforce':
      return botReinforce(s, seat, level, rng);
    case 'attack':
      return botAttack(s, seat, level, rng);
    case 'occupy':
      return { type: 'occupy', n: s.occupy ? at(s.armies, s.occupy.from) - 1 : 1 };
    case 'fortify':
      return botFortify(s, seat, level);
    case 'over':
      return { type: 'endTurn' };
  }
}

// ---------------------------------------------------------------------------

export const game: TurnGame<RisikoState, RisikoMove, RisikoOptions, RisikoView> = {
  kind: 'turn',
  id: 'risiko',
  version: 1,
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: DEFAULT_OPTIONS,
  parseOptions,
  hiddenInformation: true,
  setup: ({ players, seed, options }) => setup(players, seed, options),
  activeSeats: (s) => (s.phase === 'over' ? [] : [s.current]),
  parseMove,
  applyMove,
  outcome,
  view,
  log: (s) => s.log.slice(-50),
  bot,
};
