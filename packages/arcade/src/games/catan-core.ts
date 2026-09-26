/**
 * Catan – Zustand und Regeln (ohne Bot und ohne Sicht).
 *
 * Getrennt von `catan.ts`, damit der Bot dieselben Prüfungen nutzt wie die
 * Regel selbst: Was hier als legal gilt, ist genau das, was `applyMove`
 * annimmt. So kann der Bot keinen Zug vorschlagen, den die Regel ablehnt.
 */

import { type RngState, createRng, nextInt, rollDie, shuffled } from '../rng.js';
import { type TurnLogEntry, cloneState, pushLog } from '../turn.js';
import {
  DESERT,
  GEO,
  type Port,
  RES_COUNT,
  RES_NAMES,
  at,
  makeLayout,
  portsAtVertex,
} from './catan-board.js';

export type Phase =
  'setup' | 'roll' | 'discard' | 'robber' | 'main' | 'roadBuilding' | 'trade' | 'over';

export interface CatanOptions {
  layout: 'einsteiger' | 'zufall';
  /** Siegpunkte-Ziel: 10 (Grundspiel) oder 12 (längere Partie). */
  targetVp: number;
  /** 0 = ohne Grenze; sonst endet die Partie nach so vielen Runden nach Punkten. */
  maxRounds: number;
}

/** Entwicklungskarten: 0 Ritter, 1 Siegpunkt, 2 Straßenbau, 3 Erfindung, 4 Monopol. */
export const DEV_KNIGHT = 0;
export const DEV_VP = 1;
export const DEV_ROADS = 2;
export const DEV_INVENTION = 3;
export const DEV_MONOPOLY = 4;
export const DEV_NAMES = ['Ritter', 'Siegpunkt', 'Straßenbau', 'Erfindung', 'Monopol'] as const;
const DEV_DECK = [...Array<number>(14).fill(0), ...Array<number>(5).fill(1), 2, 2, 3, 3, 4, 4];

export const COST_ROAD = [1, 1, 0, 0, 0];
export const COST_SETTLEMENT = [1, 1, 1, 1, 0];
export const COST_CITY = [0, 0, 0, 2, 3];
export const COST_DEV = [0, 0, 1, 1, 1];

/** Farbnamen der Sitze – gleiche Reihenfolge wie die Sitzfarben der Oberfläche. */
export const SEAT_NAMES = ['Rot', 'Blau', 'Grün', 'Gelb'] as const;

export interface TradeOffer {
  from: number;
  give: number[];
  get: number[];
  /** Je Sitz: 0 offen, 1 angenommen, 2 abgelehnt (der Anbieter steht auf 2). */
  answers: number[];
}

export interface LastBuilt {
  kind: 'settlement' | 'city' | 'road' | 'robber';
  at: number;
  seat: number;
}

export interface CatanState {
  version: 1;
  players: number;
  options: CatanOptions;
  rng: RngState;
  hexRes: number[];
  hexNum: number[];
  ports: Port[];
  robber: number;
  /** Besitzer je Kreuzung, −1 = frei. */
  vOwner: number[];
  vCity: boolean[];
  /** Besitzer je Kante, −1 = frei. */
  eOwner: number[];
  hands: number[][];
  bank: number[];
  devDeck: number[];
  devHand: number[][];
  /** Diesen Zug gekaufte Karten – noch nicht spielbar. */
  devNew: number[][];
  devPlayed: boolean;
  knights: number[];
  roadsLeft: number[];
  settlementsLeft: number[];
  citiesLeft: number[];
  longestHolder: number;
  armyHolder: number;
  phase: Phase;
  current: number;
  round: number;
  rolled: boolean;
  dice: number[];
  setupStep: number;
  /** In der Gründung: Kreuzung, an die die Straße muss; −1 = erst Siedlung. */
  setupVertex: number;
  discard: number[];
  afterRobber: 'roll' | 'main';
  roadBuildLeft: number;
  roadBuildReturn: 'roll' | 'main';
  trade: TradeOffer | null;
  offersThisTurn: number;
  lastSteal: { thief: number; victim: number; res: number } | null;
  lastBuilt: LastBuilt[];
  winners: number[] | null;
  summary: string;
  log: TurnLogEntry[];
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

/** Obergrenze eigener Handelsangebote je Zug – schützt Mitspieler vor Dauerfragen. */
export const MAX_OFFERS_PER_TURN = 4;

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

export function setupState(players: number, seed: number, options: CatanOptions): CatanState {
  const rng = createRng(seed);
  const layout = makeLayout(options.layout, rng);
  const devDeck = shuffled(rng, DEV_DECK);
  const zeros = (): number[] => Array<number>(RES_COUNT).fill(0);
  const perSeat = <T>(make: () => T): T[] => Array.from({ length: players }, make);
  const robber = layout.hexRes.indexOf(DESERT);
  return {
    version: 1,
    players,
    options,
    rng,
    hexRes: layout.hexRes,
    hexNum: layout.hexNum,
    ports: layout.ports,
    robber,
    vOwner: GEO.vertices.map(() => -1),
    vCity: GEO.vertices.map(() => false),
    eOwner: GEO.edges.map(() => -1),
    hands: perSeat(zeros),
    bank: Array<number>(RES_COUNT).fill(19),
    devDeck,
    devHand: perSeat(zeros),
    devNew: perSeat(zeros),
    devPlayed: false,
    knights: perSeat(() => 0),
    roadsLeft: perSeat(() => 15),
    settlementsLeft: perSeat(() => 5),
    citiesLeft: perSeat(() => 4),
    longestHolder: -1,
    armyHolder: -1,
    phase: 'setup',
    current: 0,
    round: 0,
    rolled: false,
    dice: [],
    setupStep: 0,
    setupVertex: -1,
    discard: perSeat(() => 0),
    afterRobber: 'main',
    roadBuildLeft: 0,
    roadBuildReturn: 'main',
    trade: null,
    offersThisTurn: 0,
    lastSteal: null,
    lastBuilt: [],
    winners: null,
    summary: '',
    log: [
      {
        seat: null,
        text: 'Die Insel ist bereit. Gründung: jeder setzt zwei Siedlungen mit Straße.',
      },
    ],
  };
}

/** Sitz, der in Gründungsschritt `step` setzt (Schlange 0…n−1, n−1…0). */
export function setupSeat(players: number, step: number): number {
  return step < players ? step : 2 * players - 1 - step;
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

export function sum(list: readonly number[]): number {
  return list.reduce((a, b) => a + b, 0);
}

export function canPay(hand: readonly number[], cost: readonly number[]): boolean {
  return cost.every((c, i) => (hand[i] ?? 0) >= c);
}

function pay(s: CatanState, seat: number, cost: readonly number[]): void {
  const hand = at(s.hands, seat);
  cost.forEach((c, i) => {
    hand[i] = (hand[i] ?? 0) - c;
    s.bank[i] = (s.bank[i] ?? 0) + c;
  });
}

export function resList(cards: readonly number[]): string {
  const parts = cards.map((n, i) => (n > 0 ? `${n} ${at(RES_NAMES, i)}` : '')).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'nichts';
}

function log(s: CatanState, seat: number | null, text: string): void {
  s.log = pushLog(s.log, { seat, text });
}

export function seatName(seat: number): string {
  return SEAT_NAMES[seat] ?? `Sitz ${seat + 1}`;
}

/** Siegpunkte eines Sitzes; `hidden` zählt verdeckte Siegpunktkarten mit. */
export function victoryPoints(s: CatanState, seat: number, hidden: boolean): number {
  let vp = 0;
  s.vOwner.forEach((o, v) => {
    if (o === seat) vp += s.vCity[v] ? 2 : 1;
  });
  if (s.longestHolder === seat) vp += 2;
  if (s.armyHolder === seat) vp += 2;
  if (hidden) vp += at(s.devHand, seat)[DEV_VP] ?? 0;
  return vp;
}

/** Tauschkurs je Rohstoff mit der Bank (4, 3 oder 2). */
export function bankRates(s: CatanState, seat: number): number[] {
  const rates = Array<number>(RES_COUNT).fill(4);
  s.vOwner.forEach((o, v) => {
    if (o !== seat) return;
    for (const kind of portsAtVertex(s.ports, v)) {
      if (kind === -1) for (let i = 0; i < RES_COUNT; i += 1) rates[i] = Math.min(at(rates, i), 3);
      else rates[kind] = 2;
    }
  });
  return rates;
}

// ---------------------------------------------------------------------------
// Bauplätze
// ---------------------------------------------------------------------------

function distanceOk(s: CatanState, v: number): boolean {
  return s.vOwner[v] === -1 && at(GEO.vertexNeighbors, v).every((n) => s.vOwner[n] === -1);
}

export function canPlaceSettlement(
  s: CatanState,
  seat: number,
  v: number,
  setup: boolean,
): boolean {
  if (!distanceOk(s, v)) return false;
  if (setup) return true;
  return at(GEO.vertexEdges, v).some((e) => s.eOwner[e] === seat);
}

/** Straße an Kante `e`: frei und an eigenes Netz angeschlossen (nicht durch fremde Siedlungen). */
export function canPlaceRoad(s: CatanState, seat: number, e: number): boolean {
  if (s.eOwner[e] !== -1) return false;
  if (s.phase === 'setup') return at(GEO.edges, e).includes(s.setupVertex);
  return at(GEO.edges, e).some((v) => {
    const owner = s.vOwner[v];
    if (owner === seat) return true;
    if (owner !== -1) return false;
    return at(GEO.vertexEdges, v).some((other) => other !== e && s.eOwner[other] === seat);
  });
}

export function legalSettlements(s: CatanState, seat: number, setup: boolean): number[] {
  return GEO.vertices.map((_, v) => v).filter((v) => canPlaceSettlement(s, seat, v, setup));
}

export function legalRoads(s: CatanState, seat: number): number[] {
  return GEO.edges.map((_, e) => e).filter((e) => canPlaceRoad(s, seat, e));
}

export function legalCities(s: CatanState, seat: number): number[] {
  return GEO.vertices.map((_, v) => v).filter((v) => s.vOwner[v] === seat && !s.vCity[v]);
}

/** Mitspieler an einem Feld, die bestohlen werden können (haben Karten). */
export function robberVictims(s: CatanState, seat: number, hex: number): number[] {
  const seats = new Set<number>();
  for (const v of at(GEO.hexVertices, hex)) {
    const o = at(s.vOwner, v);
    if (o >= 0 && o !== seat && sum(at(s.hands, o)) > 0) seats.add(o);
  }
  return [...seats].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Längste Handelsstraße, größte Rittermacht, Sieg
// ---------------------------------------------------------------------------

export function roadLength(s: CatanState, seat: number): number {
  const used = s.eOwner.map(() => false);
  let best = 0;
  const walk = (v: number, len: number): void => {
    if (len > best) best = len;
    // Eine fremde Siedlung unterbricht die Straße – man kommt an, aber nicht weiter.
    const owner = at(s.vOwner, v);
    if (len > 0 && owner !== -1 && owner !== seat) return;
    for (const e of at(GEO.vertexEdges, v)) {
      if (s.eOwner[e] !== seat || used[e]) continue;
      used[e] = true;
      const [a, b] = at(GEO.edges, e);
      walk(a === v ? b : a, len + 1);
      used[e] = false;
    }
  };
  s.eOwner.forEach((o, e) => {
    if (o !== seat) return;
    const [a, b] = at(GEO.edges, e);
    walk(a, 0);
    walk(b, 0);
  });
  return best;
}

function updateLongestRoad(s: CatanState): void {
  const lengths = Array.from({ length: s.players }, (_, p) => roadLength(s, p));
  const max = Math.max(...lengths);
  const before = s.longestHolder;
  if (before >= 0 && lengths[before] === max && max >= 5) return;
  const leaders = lengths.map((l, p) => (l === max ? p : -1)).filter((p) => p >= 0);
  const next = max >= 5 && leaders.length === 1 ? at(leaders, 0) : -1;
  if (next === before) return;
  s.longestHolder = next;
  if (next >= 0) log(s, next, `hat jetzt die längste Handelsstraße (${max}).`);
  else log(s, null, 'Die längste Handelsstraße ist vakant.');
}

function updateArmy(s: CatanState, seat: number): void {
  const k = at(s.knights, seat);
  const holder = s.armyHolder;
  if (holder === seat || k < 3) return;
  if (holder >= 0 && at(s.knights, holder) >= k) return;
  s.armyHolder = seat;
  log(s, seat, `hat jetzt die größte Rittermacht (${k}).`);
}

function checkWin(s: CatanState): void {
  if (s.phase === 'setup' || s.winners) return;
  const vp = victoryPoints(s, s.current, true);
  if (vp < s.options.targetVp) return;
  s.winners = [s.current];
  s.phase = 'over';
  s.trade = null;
  s.summary = `${seatName(s.current)} erreicht ${vp} Siegpunkte und gewinnt.`;
  log(s, s.current, `erreicht ${vp} Siegpunkte und gewinnt!`);
}

function finishByRounds(s: CatanState): void {
  const scores = Array.from({ length: s.players }, (_, p) => victoryPoints(s, p, true));
  const max = Math.max(...scores);
  s.winners = scores.map((v, p) => (v === max ? p : -1)).filter((p) => p >= 0);
  s.phase = 'over';
  s.trade = null;
  const names = s.winners.map(seatName).join(' und ');
  s.summary = `Rundenlimit erreicht – ${names} ${s.winners.length > 1 ? 'teilen sich' : 'holt'} den Sieg mit ${max} Punkten.`;
  log(s, null, s.summary);
}

// ---------------------------------------------------------------------------
// Aktive Sitze
// ---------------------------------------------------------------------------

export function activeSeatsOf(s: CatanState): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'setup') return [setupSeat(s.players, s.setupStep)];
  if (s.phase === 'discard') return s.discard.map((d, p) => (d > 0 ? p : -1)).filter((p) => p >= 0);
  if (s.phase === 'trade' && s.trade) {
    const pending = s.trade.answers.map((a, p) => (a === 0 ? p : -1)).filter((p) => p >= 0);
    return pending.length > 0 ? pending : [s.current];
  }
  return [s.current];
}

// ---------------------------------------------------------------------------
// Züge
// ---------------------------------------------------------------------------

type Result = { ok: true; state: CatanState } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

function produce(s: CatanState, total: number): void {
  const gains = Array.from({ length: s.players }, () => Array<number>(RES_COUNT).fill(0));
  for (let res = 0; res < RES_COUNT; res += 1) {
    const want = Array<number>(s.players).fill(0);
    s.hexNum.forEach((num, h) => {
      if (num !== total || s.hexRes[h] !== res || h === s.robber) return;
      for (const v of at(GEO.hexVertices, h)) {
        const o = at(s.vOwner, v);
        if (o >= 0) want[o] = at(want, o) + (s.vCity[v] ? 2 : 1);
      }
    });
    const needed = sum(want);
    if (needed === 0) continue;
    const stock = at(s.bank, res);
    const takers = want.filter((w) => w > 0).length;
    // Reicht der Vorrat nicht für alle, bekommt niemand etwas – außer es ist nur einer betroffen.
    if (needed > stock && takers > 1) {
      log(
        s,
        null,
        `Der Vorrat an ${at(RES_NAMES, res)} reicht nicht – niemand erhält ${at(RES_NAMES, res)}.`,
      );
      continue;
    }
    want.forEach((w, p) => {
      const give = Math.min(w, at(s.bank, res));
      if (give <= 0) return;
      at(gains, p)[res] = give;
      at(s.hands, p)[res] = (at(s.hands, p)[res] ?? 0) + give;
      s.bank[res] = at(s.bank, res) - give;
    });
  }
  const parts = gains
    .map((g, p) => (sum(g) > 0 ? `${seatName(p)} ${resList(g)}` : ''))
    .filter(Boolean);
  if (parts.length > 0) log(s, null, `Ertrag: ${parts.join(' · ')}.`);
}

function afterSubPhase(s: CatanState, back: 'roll' | 'main'): void {
  s.phase = back;
}

function startRoadBuilding(s: CatanState, back: 'roll' | 'main'): void {
  s.roadBuildLeft = Math.min(2, at(s.roadsLeft, s.current));
  s.roadBuildReturn = back;
  s.phase = 'roadBuilding';
  if (s.roadBuildLeft === 0 || legalRoads(s, s.current).length === 0) {
    s.roadBuildLeft = 0;
    afterSubPhase(s, back);
  }
}

function endTurn(s: CatanState): void {
  const next = (s.current + 1) % s.players;
  at(s.devNew, s.current).fill(0);
  s.devPlayed = false;
  s.offersThisTurn = 0;
  s.rolled = false;
  s.current = next;
  if (next === 0) s.round += 1;
  s.lastBuilt = [];
  if (s.options.maxRounds > 0 && s.round > s.options.maxRounds) {
    finishByRounds(s);
    return;
  }
  s.phase = 'roll';
  // Ein Sieg kann außerhalb des eigenen Zugs entstehen (Straße eines anderen
  // unterbrochen) – er zählt erst hier, zu Beginn des eigenen Zugs.
  checkWin(s);
}

export function applyCatanMove(state: CatanState, seat: number, move: CatanMove): Result {
  if (state.phase === 'over') return fail('Die Partie ist vorbei.');
  if (!activeSeatsOf(state).includes(seat)) return fail('Du bist gerade nicht am Zug.');
  const s = cloneState(state);
  const hand = at(s.hands, seat);

  switch (s.phase) {
    case 'setup': {
      if (move.t === 'settlement' && s.setupVertex === -1) {
        if (!canPlaceSettlement(s, seat, move.v, true))
          return fail('Dort ist kein Platz (Abstandsregel).');
        s.vOwner[move.v] = seat;
        s.settlementsLeft[seat] = at(s.settlementsLeft, seat) - 1;
        s.setupVertex = move.v;
        s.lastBuilt = [{ kind: 'settlement', at: move.v, seat }];
        if (s.setupStep >= s.players) {
          const gain = Array<number>(RES_COUNT).fill(0);
          for (const h of at(GEO.vertexHexes, move.v)) {
            const res = at(s.hexRes, h);
            if (res === DESERT || at(s.bank, res) <= 0) continue;
            gain[res] = at(gain, res) + 1;
            hand[res] = at(hand, res) + 1;
            s.bank[res] = at(s.bank, res) - 1;
          }
          log(s, seat, `gründet die zweite Siedlung und erhält ${resList(gain)}.`);
        } else log(s, seat, 'gründet eine Siedlung.');
        return { ok: true, state: s };
      }
      if (move.t === 'road' && s.setupVertex !== -1) {
        if (!canPlaceRoad(s, seat, move.e))
          return fail('Die Straße muss an die neue Siedlung grenzen.');
        s.eOwner[move.e] = seat;
        s.roadsLeft[seat] = at(s.roadsLeft, seat) - 1;
        s.lastBuilt.push({ kind: 'road', at: move.e, seat });
        s.setupVertex = -1;
        s.setupStep += 1;
        if (s.setupStep >= 2 * s.players) {
          s.phase = 'roll';
          s.current = 0;
          s.round = 1;
          s.lastBuilt = [];
          log(s, null, 'Die Gründung ist abgeschlossen – Runde 1 beginnt.');
        } else s.current = setupSeat(s.players, s.setupStep);
        return { ok: true, state: s };
      }
      return fail(s.setupVertex === -1 ? 'Setz zuerst eine Siedlung.' : 'Setz jetzt die Straße.');
    }

    case 'roll': {
      if (move.t === 'dev') return playDev(s, seat, move);
      if (move.t !== 'roll') return fail('Zuerst würfeln.');
      const a = rollDie(s.rng);
      const b = rollDie(s.rng);
      s.dice = [a, b];
      s.rolled = true;
      s.lastSteal = null;
      const total = a + b;
      log(s, seat, `würfelt ${total}.`);
      if (total !== 7) {
        produce(s, total);
        s.phase = 'main';
        return { ok: true, state: s };
      }
      s.discard = s.hands.map((h) => (sum(h) > 7 ? Math.floor(sum(h) / 2) : 0));
      s.afterRobber = 'main';
      if (s.discard.some((d) => d > 0)) {
        s.phase = 'discard';
        const who = s.discard.map((d, p) => (d > 0 ? `${seatName(p)} ${d}` : '')).filter(Boolean);
        log(s, null, `Die 7! Abwerfen: ${who.join(', ')}.`);
      } else s.phase = 'robber';
      return { ok: true, state: s };
    }

    case 'discard': {
      if (move.t !== 'discard') return fail('Wirf zuerst die Hälfte deiner Karten ab.');
      const need = at(s.discard, seat);
      if (sum(move.cards) !== need) return fail(`Du musst genau ${need} Karten abwerfen.`);
      if (!canPay(hand, move.cards)) return fail('So viele Karten hast du nicht.');
      pay(s, seat, move.cards);
      s.discard[seat] = 0;
      log(s, seat, `wirft ${need} Karten ab.`);
      if (s.discard.every((d) => d === 0)) s.phase = 'robber';
      return { ok: true, state: s };
    }

    case 'robber': {
      if (move.t !== 'robber') return fail('Versetze zuerst den Räuber.');
      if (move.hex < 0 || move.hex >= GEO.hexes.length || move.hex === s.robber) {
        return fail('Der Räuber muss auf ein anderes Feld.');
      }
      const victims = robberVictims(s, seat, move.hex);
      if (victims.length > 0 && !victims.includes(move.victim))
        return fail('Wähle, bei wem du ziehst.');
      if (victims.length === 0 && move.victim !== -1)
        return fail('Dort gibt es niemanden zum Bestehlen.');
      s.robber = move.hex;
      s.lastBuilt = [
        ...s.lastBuilt.filter((b) => b.kind !== 'robber'),
        { kind: 'robber', at: move.hex, seat },
      ];
      if (move.victim >= 0) {
        const vHand = at(s.hands, move.victim);
        let pickIndex = nextInt(s.rng, sum(vHand));
        let res = 0;
        for (; res < RES_COUNT; res += 1) {
          if (pickIndex < at(vHand, res)) break;
          pickIndex -= at(vHand, res);
        }
        vHand[res] = at(vHand, res) - 1;
        hand[res] = at(hand, res) + 1;
        s.lastSteal = { thief: seat, victim: move.victim, res };
        log(s, seat, `versetzt den Räuber und zieht bei ${seatName(move.victim)} eine Karte.`);
      } else log(s, seat, 'versetzt den Räuber.');
      afterSubPhase(s, s.afterRobber);
      checkWin(s);
      return { ok: true, state: s };
    }

    case 'roadBuilding': {
      if (move.t === 'done') {
        s.roadBuildLeft = 0;
        afterSubPhase(s, s.roadBuildReturn);
        return { ok: true, state: s };
      }
      if (move.t !== 'road')
        return fail('Bau deine kostenlosen Straßen oder beende den Straßenbau.');
      if (!canPlaceRoad(s, seat, move.e)) return fail('Dort kann keine Straße hin.');
      s.eOwner[move.e] = seat;
      s.roadsLeft[seat] = at(s.roadsLeft, seat) - 1;
      s.roadBuildLeft -= 1;
      s.lastBuilt.push({ kind: 'road', at: move.e, seat });
      log(s, seat, 'baut eine kostenlose Straße.');
      updateLongestRoad(s);
      if (s.roadBuildLeft <= 0 || at(s.roadsLeft, seat) <= 0 || legalRoads(s, seat).length === 0) {
        s.roadBuildLeft = 0;
        afterSubPhase(s, s.roadBuildReturn);
      }
      checkWin(s);
      return { ok: true, state: s };
    }

    case 'trade': {
      const offer = s.trade;
      if (!offer) return fail('Kein Angebot offen.');
      if (seat !== offer.from) {
        if (move.t !== 'respond') return fail('Nimm das Angebot an oder lehne es ab.');
        if (move.accept && !canPay(hand, offer.get)) return fail('Dafür fehlen dir die Karten.');
        offer.answers[seat] = move.accept ? 1 : 2;
        log(s, seat, move.accept ? 'wäre dabei.' : 'lehnt ab.');
        if (offer.answers.every((a) => a !== 0) && !offer.answers.includes(1)) {
          s.trade = null;
          s.phase = 'main';
          log(s, null, 'Niemand nimmt das Angebot an.');
        }
        return { ok: true, state: s };
      }
      if (move.t === 'cancel') {
        s.trade = null;
        s.phase = 'main';
        log(s, seat, 'zieht das Angebot zurück.');
        return { ok: true, state: s };
      }
      if (move.t !== 'accept')
        return fail('Wähle einen Handelspartner oder zieh das Angebot zurück.');
      if (offer.answers[move.seat] !== 1) return fail('Dieser Sitz hat nicht angenommen.');
      const partner = at(s.hands, move.seat);
      if (!canPay(hand, offer.give) || !canPay(partner, offer.get))
        return fail('Die Karten reichen nicht mehr.');
      for (let i = 0; i < RES_COUNT; i += 1) {
        hand[i] = at(hand, i) - at(offer.give, i) + at(offer.get, i);
        partner[i] = at(partner, i) + at(offer.give, i) - at(offer.get, i);
      }
      log(
        s,
        seat,
        `tauscht mit ${seatName(move.seat)}: ${resList(offer.give)} gegen ${resList(offer.get)}.`,
      );
      s.trade = null;
      s.phase = 'main';
      return { ok: true, state: s };
    }

    case 'main':
      return applyMain(s, seat, move);

    default:
      return fail('Dieser Zug passt gerade nicht.');
  }
}

function playDev(s: CatanState, seat: number, move: Extract<CatanMove, { t: 'dev' }>): Result {
  if (s.devPlayed) return fail('Pro Zug nur eine Entwicklungskarte.');
  if (move.card === DEV_VP) return fail('Siegpunktkarten zählen von selbst.');
  const owned = at(at(s.devHand, seat), move.card) - at(at(s.devNew, seat), move.card);
  if (owned <= 0) return fail('Diese Karte hast du nicht (oder erst diesen Zug gekauft).');
  const back: 'roll' | 'main' = s.rolled ? 'main' : 'roll';
  const hand = at(s.hands, seat);

  if (move.card === DEV_INVENTION) {
    const want = Array<number>(RES_COUNT).fill(0);
    want[move.a] = at(want, move.a) + 1;
    want[move.b] = at(want, move.b) + 1;
    if (!canPay(s.bank, want)) return fail('Die Bank hat diese Rohstoffe nicht mehr.');
    for (let i = 0; i < RES_COUNT; i += 1) {
      hand[i] = at(hand, i) + at(want, i);
      s.bank[i] = at(s.bank, i) - at(want, i);
    }
    log(s, seat, `spielt Erfindung und nimmt ${resList(want)}.`);
  } else if (move.card === DEV_MONOPOLY) {
    let taken = 0;
    s.hands.forEach((h, p) => {
      if (p === seat) return;
      taken += at(h, move.a);
      h[move.a] = 0;
    });
    hand[move.a] = at(hand, move.a) + taken;
    log(s, seat, `spielt Monopol auf ${at(RES_NAMES, move.a)} und erhält ${taken}.`);
  } else if (move.card === DEV_ROADS) {
    if (at(s.roadsLeft, seat) <= 0) return fail('Du hast keine Straßen mehr im Vorrat.');
  }

  at(s.devHand, seat)[move.card] = at(at(s.devHand, seat), move.card) - 1;
  s.devPlayed = true;

  if (move.card === DEV_KNIGHT) {
    s.knights[seat] = at(s.knights, seat) + 1;
    log(s, seat, 'spielt einen Ritter.');
    updateArmy(s, seat);
    s.afterRobber = back;
    s.phase = 'robber';
    return { ok: true, state: s };
  }
  if (move.card === DEV_ROADS) {
    log(s, seat, 'spielt Straßenbau.');
    startRoadBuilding(s, back);
  }
  checkWin(s);
  return { ok: true, state: s };
}

function applyMain(s: CatanState, seat: number, move: CatanMove): Result {
  const hand = at(s.hands, seat);
  switch (move.t) {
    case 'end':
      log(s, seat, 'beendet den Zug.');
      endTurn(s);
      return { ok: true, state: s };
    case 'road': {
      if (at(s.roadsLeft, seat) <= 0) return fail('Keine Straßen mehr im Vorrat.');
      if (!canPay(hand, COST_ROAD)) return fail('Dir fehlen Holz oder Lehm.');
      if (!canPlaceRoad(s, seat, move.e)) return fail('Dort kann keine Straße hin.');
      pay(s, seat, COST_ROAD);
      s.eOwner[move.e] = seat;
      s.roadsLeft[seat] = at(s.roadsLeft, seat) - 1;
      s.lastBuilt.push({ kind: 'road', at: move.e, seat });
      log(s, seat, 'baut eine Straße.');
      updateLongestRoad(s);
      break;
    }
    case 'settlement': {
      if (at(s.settlementsLeft, seat) <= 0) return fail('Keine Siedlungen mehr im Vorrat.');
      if (!canPay(hand, COST_SETTLEMENT)) return fail('Für eine Siedlung fehlen Rohstoffe.');
      if (!canPlaceSettlement(s, seat, move.v, false)) return fail('Dort ist kein Bauplatz.');
      pay(s, seat, COST_SETTLEMENT);
      s.vOwner[move.v] = seat;
      s.settlementsLeft[seat] = at(s.settlementsLeft, seat) - 1;
      s.lastBuilt.push({ kind: 'settlement', at: move.v, seat });
      log(s, seat, 'baut eine Siedlung.');
      // Eine neue Siedlung kann eine fremde Straße unterbrechen.
      updateLongestRoad(s);
      break;
    }
    case 'city': {
      if (at(s.citiesLeft, seat) <= 0) return fail('Keine Städte mehr im Vorrat.');
      if (!canPay(hand, COST_CITY)) return fail('Für eine Stadt fehlen Rohstoffe.');
      if (s.vOwner[move.v] !== seat || s.vCity[move.v])
        return fail('Nur eigene Siedlungen werden zur Stadt.');
      pay(s, seat, COST_CITY);
      s.vCity[move.v] = true;
      s.citiesLeft[seat] = at(s.citiesLeft, seat) - 1;
      s.settlementsLeft[seat] = at(s.settlementsLeft, seat) + 1;
      s.lastBuilt.push({ kind: 'city', at: move.v, seat });
      log(s, seat, 'baut eine Stadt.');
      break;
    }
    case 'buy': {
      if (s.devDeck.length === 0) return fail('Der Kartenstapel ist leer.');
      if (!canPay(hand, COST_DEV)) return fail('Dir fehlen Wolle, Getreide oder Erz.');
      pay(s, seat, COST_DEV);
      const card = s.devDeck.pop() ?? DEV_KNIGHT;
      at(s.devHand, seat)[card] = at(at(s.devHand, seat), card) + 1;
      at(s.devNew, seat)[card] = at(at(s.devNew, seat), card) + 1;
      log(s, seat, 'kauft eine Entwicklungskarte.');
      break;
    }
    case 'dev':
      return playDev(s, seat, move);
    case 'bank': {
      if (move.give === move.get) return fail('Gleiches gegen Gleiches lohnt nicht.');
      const rate = at(bankRates(s, seat), move.give);
      if (at(hand, move.give) < rate)
        return fail(`Dafür brauchst du ${rate} ${at(RES_NAMES, move.give)}.`);
      if (at(s.bank, move.get) <= 0) return fail('Die Bank hat davon nichts mehr.');
      hand[move.give] = at(hand, move.give) - rate;
      s.bank[move.give] = at(s.bank, move.give) + rate;
      hand[move.get] = at(hand, move.get) + 1;
      s.bank[move.get] = at(s.bank, move.get) - 1;
      log(
        s,
        seat,
        `tauscht ${rate} ${at(RES_NAMES, move.give)} bei der Bank gegen 1 ${at(RES_NAMES, move.get)}.`,
      );
      return { ok: true, state: s };
    }
    case 'offer': {
      if (s.offersThisTurn >= MAX_OFFERS_PER_TURN) return fail('Für diesen Zug genug verhandelt.');
      if (sum(move.give) === 0 || sum(move.get) === 0)
        return fail('Ein Angebot braucht Geben und Nehmen.');
      if (move.give.some((g, i) => g > 0 && at(move.get, i) > 0))
        return fail('Ein Rohstoff steht auf beiden Seiten.');
      if (!canPay(hand, move.give)) return fail('So viele Karten hast du nicht.');
      s.offersThisTurn += 1;
      s.trade = {
        from: seat,
        give: [...move.give],
        get: [...move.get],
        answers: Array.from({ length: s.players }, (_, p) => (p === seat ? 2 : 0)),
      };
      s.phase = 'trade';
      log(s, seat, `bietet ${resList(move.give)} gegen ${resList(move.get)}.`);
      return { ok: true, state: s };
    }
    default:
      return fail('Dieser Zug passt gerade nicht.');
  }
  checkWin(s);
  return { ok: true, state: s };
}
