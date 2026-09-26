/**
 * Catan – Computergegner.
 *
 * Kein Suchbaum: Catan hat zu viel Zufall und zu viele Handzüge, als dass sich
 * Vorausrechnen im Budget lohnte. Der Bot bewertet stattdessen Bauplätze nach
 * Ertragspunkten, Vielfalt und Häfen und verfolgt ein Bauziel (Stadt vor
 * Siedlung vor Entwicklungskarte vor Straße). Die Stufen unterscheiden sich
 * darin, wie genau er wählt, ob er Karten gezielt ausspielt und ob er mit
 * Mitspielern verhandelt.
 *
 * Fair: Er nutzt nur, was sein Sitz sehen kann – eigene Hand, öffentliche
 * Siegpunkte, Kartenzahlen der anderen, das Brett.
 */

import { type RngState, nextRandom, pick } from '../rng.js';
import { type BotLevel } from '../turn.js';
import { DESERT, GEO, RES_COUNT, at, pips, portsAtVertex } from './catan-board.js';
import {
  COST_CITY,
  COST_DEV,
  COST_ROAD,
  COST_SETTLEMENT,
  DEV_INVENTION,
  DEV_KNIGHT,
  DEV_MONOPOLY,
  DEV_ROADS,
  type CatanMove,
  type CatanState,
  bankRates,
  canPay,
  legalCities,
  legalRoads,
  legalSettlements,
  robberVictims,
  sum,
  victoryPoints,
} from './catan-core.js';

/** Grundgewicht je Rohstoff: früh zählen Holz und Lehm, später Getreide und Erz. */
const RES_WEIGHT = [1.0, 1.0, 0.8, 1.1, 1.05];

/** Ertragspunkte je Rohstoff aus den eigenen Gebäuden. */
function production(s: CatanState, seat: number): number[] {
  const prod = Array<number>(RES_COUNT).fill(0);
  s.vOwner.forEach((o, v) => {
    if (o !== seat) return;
    for (const h of at(GEO.vertexHexes, v)) {
      const res = at(s.hexRes, h);
      if (res === DESERT) continue;
      prod[res] = at(prod, res) + pips(at(s.hexNum, h)) * (s.vCity[v] ? 2 : 1);
    }
  });
  return prod;
}

/** Wert einer Kreuzung als künftiger Siedlungsplatz für `seat`. */
function vertexValue(s: CatanState, seat: number, v: number, level: BotLevel): number {
  const prod = production(s, seat);
  let value = 0;
  const seen = new Set<number>();
  for (const h of at(GEO.vertexHexes, v)) {
    const res = at(s.hexRes, h);
    if (res === DESERT) continue;
    let p = pips(at(s.hexNum, h));
    if (h === s.robber) p *= 0.5;
    value += p * (level === 'leicht' ? 1 : at(RES_WEIGHT, res));
    // Vielfalt: Ein Rohstoff, den man noch gar nicht bekommt, ist mehr wert.
    if (level !== 'leicht' && at(prod, res) === 0 && !seen.has(res))
      value += level === 'schwer' ? 2.5 : 1.5;
    seen.add(res);
  }
  if (level !== 'leicht') {
    for (const kind of portsAtVertex(s.ports, v)) {
      if (kind === -1) value += 1;
      else value += Math.min(3, at(prod, kind) / 3 + (seen.has(kind) ? 1 : 0.3));
    }
  }
  return value;
}

function free(s: CatanState, v: number): boolean {
  return s.vOwner[v] === -1 && at(GEO.vertexNeighbors, v).every((n) => s.vOwner[n] === -1);
}

/** Beste Straße: die, über die man am schnellsten an einen guten freien Bauplatz kommt. */
function bestRoad(
  s: CatanState,
  seat: number,
  level: BotLevel,
  rng: RngState,
): { e: number; score: number } | null {
  const edges = legalRoads(s, seat);
  if (edges.length === 0) return null;
  if (level === 'leicht' && nextRandom(rng) < 0.4)
    return { e: pick(rng, edges) ?? at(edges, 0), score: 1 };
  let best: { e: number; score: number } | null = null;
  for (const e of edges) {
    let score = 0;
    for (const w of at(GEO.edges, e)) {
      // Zwei Schritte weit schauen: direkt am neuen Ende und eine Kante dahinter.
      if (free(s, w)) score = Math.max(score, vertexValue(s, seat, w, level));
      for (const x of at(GEO.vertexNeighbors, w)) {
        if (free(s, x)) score = Math.max(score, vertexValue(s, seat, x, level) * 0.6);
      }
    }
    score += nextRandom(rng) * 0.1;
    if (!best || score > best.score) best = { e, score };
  }
  return best;
}

function missing(hand: readonly number[], cost: readonly number[]): number[] {
  return cost.map((c, i) => Math.max(0, c - at(hand, i)));
}

type Target = 'city' | 'settlement' | 'road' | 'dev' | 'none';

const COSTS: Record<Exclude<Target, 'none'>, readonly number[]> = {
  city: COST_CITY,
  settlement: COST_SETTLEMENT,
  road: COST_ROAD,
  dev: COST_DEV,
};

/** Worauf spart der Bot gerade hin? */
function chooseTarget(s: CatanState, seat: number, hand: readonly number[]): Target {
  const cityOk = at(s.citiesLeft, seat) > 0 && legalCities(s, seat).length > 0;
  const settleOk = at(s.settlementsLeft, seat) > 0 && legalSettlements(s, seat, false).length > 0;
  const cityMiss = cityOk ? sum(missing(hand, COST_CITY)) : 99;
  const settleMiss = settleOk ? sum(missing(hand, COST_SETTLEMENT)) : 99;
  if (cityOk || settleOk) return cityMiss <= settleMiss ? 'city' : 'settlement';
  if (
    at(s.roadsLeft, seat) > 0 &&
    at(s.settlementsLeft, seat) > 0 &&
    legalRoads(s, seat).length > 0
  )
    return 'road';
  if (s.devDeck.length > 0) return 'dev';
  return 'none';
}

function publicVp(s: CatanState, seat: number): number {
  return victoryPoints(s, seat, false);
}

// ---------------------------------------------------------------------------
// Phasen
// ---------------------------------------------------------------------------

function setupMove(s: CatanState, seat: number, level: BotLevel, rng: RngState): CatanMove {
  if (s.setupVertex === -1) {
    const spots = legalSettlements(s, seat, true);
    const scored = spots
      .map((v) => ({
        v,
        score: vertexValue(s, seat, v, level) + nextRandom(rng) * (level === 'schwer' ? 0.2 : 1.5),
      }))
      .sort((a, b) => b.score - a.score);
    const pool = level === 'leicht' ? scored.slice(0, 8) : scored.slice(0, 1);
    return { t: 'settlement', v: (pick(rng, pool) ?? at(scored, 0)).v };
  }
  const edges = legalRoads(s, seat);
  let bestEdge = at(edges, 0);
  let bestScore = -1;
  for (const e of edges) {
    const [a, b] = at(GEO.edges, e);
    const w = a === s.setupVertex ? b : a;
    let score = nextRandom(rng) * 0.5;
    for (const x of at(GEO.vertexNeighbors, w)) {
      if (x !== s.setupVertex && free(s, x))
        score = Math.max(score, vertexValue(s, seat, x, level));
    }
    if (score > bestScore) {
      bestScore = score;
      bestEdge = e;
    }
  }
  return { t: 'road', e: bestEdge };
}

function discardMove(s: CatanState, seat: number): CatanMove {
  const hand = [...at(s.hands, seat)];
  const cost = COSTS[chooseTargetSafe(s, seat, hand)];
  const cards = Array<number>(RES_COUNT).fill(0);
  for (let n = at(s.discard, seat); n > 0; n -= 1) {
    // Zuerst das, was über das Bauziel hinaus am reichlichsten da ist.
    let bestRes = -1;
    let bestSpare = -Infinity;
    for (let r = 0; r < RES_COUNT; r += 1) {
      if (at(hand, r) <= 0) continue;
      const spare = at(hand, r) - at(cost, r) + at(hand, r) * 0.01;
      if (spare > bestSpare) {
        bestSpare = spare;
        bestRes = r;
      }
    }
    hand[bestRes] = at(hand, bestRes) - 1;
    cards[bestRes] = at(cards, bestRes) + 1;
  }
  return { t: 'discard', cards };
}

function chooseTargetSafe(
  s: CatanState,
  seat: number,
  hand: readonly number[],
): Exclude<Target, 'none'> {
  const t = chooseTarget(s, seat, hand);
  return t === 'none' ? 'dev' : t;
}

function robberMove(s: CatanState, seat: number, level: BotLevel, rng: RngState): CatanMove {
  const hexes = GEO.hexes.map((_, h) => h).filter((h) => h !== s.robber);
  const ownOn = (h: number): boolean => at(GEO.hexVertices, h).some((v) => s.vOwner[v] === seat);
  let hex: number;
  if (level === 'leicht') {
    const pool = hexes.filter((h) => !ownOn(h));
    hex = pick(rng, pool.length > 0 ? pool : hexes) ?? at(hexes, 0);
  } else {
    const vps = Array.from({ length: s.players }, (_, p) => publicVp(s, p));
    const leader = Math.max(...vps.filter((_, p) => p !== seat));
    let best = -Infinity;
    hex = at(hexes, 0);
    for (const h of hexes) {
      let score = nextRandom(rng) * 0.1;
      const p = s.hexRes[h] === DESERT ? 0 : pips(at(s.hexNum, h));
      for (const v of at(GEO.hexVertices, h)) {
        const o = at(s.vOwner, v);
        if (o < 0) continue;
        const weight = s.vCity[v] ? 2 : 1;
        if (o === seat) score -= 10 * weight;
        else {
          // Den Führenden trifft der Räuber am liebsten.
          const lead = at(vps, o) === leader ? (level === 'schwer' ? 2 : 1.4) : 1;
          score += p * weight * lead + (sum(at(s.hands, o)) > 0 ? 1 : 0);
        }
      }
      if (score > best) {
        best = score;
        hex = h;
      }
    }
  }
  const victims = robberVictims(s, seat, hex);
  let victim = -1;
  if (victims.length > 0) {
    victim =
      level === 'leicht'
        ? (pick(rng, victims) ?? at(victims, 0))
        : ([...victims].sort(
            (a, b) => publicVp(s, b) - publicVp(s, a) || sum(at(s.hands, b)) - sum(at(s.hands, a)),
          )[0] ?? -1);
  }
  return { t: 'robber', hex, victim };
}

function respondMove(s: CatanState, seat: number, level: BotLevel, rng: RngState): CatanMove {
  const offer = s.trade;
  const hand = at(s.hands, seat);
  if (!offer || !canPay(hand, offer.get)) return { t: 'respond', accept: false };
  if (level === 'leicht') return { t: 'respond', accept: nextRandom(rng) < 0.35 };
  // Wer kurz vor dem Sieg steht, bekommt nichts.
  if (publicVp(s, offer.from) >= s.options.targetVp - (level === 'schwer' ? 3 : 2)) {
    return { t: 'respond', accept: false };
  }
  const after = hand.map((n, i) => n - at(offer.get, i) + at(offer.give, i));
  const cost = COSTS[chooseTargetSafe(s, seat, hand)];
  const before = sum(missing(hand, cost));
  const later = sum(missing(after, cost));
  const accept = later < before || (later === before && sum(offer.give) > sum(offer.get));
  return { t: 'respond', accept };
}

function devMove(s: CatanState, seat: number, level: BotLevel, target: Target): CatanMove | null {
  if (s.devPlayed) return null;
  const playable = (k: number): boolean =>
    at(at(s.devHand, seat), k) - at(at(s.devNew, seat), k) > 0;
  const blocked = at(GEO.hexVertices, s.robber).some((v) => s.vOwner[v] === seat);
  if (playable(DEV_KNIGHT)) {
    const armyChance =
      level !== 'leicht' &&
      s.armyHolder !== seat &&
      at(s.knights, seat) + 1 >= 3 &&
      (s.armyHolder < 0 || at(s.knights, seat) + 1 > at(s.knights, s.armyHolder));
    if (blocked || armyChance || (level === 'schwer' && s.rolled))
      return { t: 'dev', card: DEV_KNIGHT, a: 0, b: 0 };
  }
  // Leicht spielt nur Ritter, und nur, wenn der Räuber das eigene Land blockiert.
  if (level === 'leicht' || !s.rolled) return null;
  const hand = at(s.hands, seat);
  if (playable(DEV_ROADS) && at(s.roadsLeft, seat) >= 2 && legalRoads(s, seat).length > 0) {
    return { t: 'dev', card: DEV_ROADS, a: 0, b: 0 };
  }
  if (target === 'none') return null;
  const miss = missing(hand, COSTS[target]);
  if (playable(DEV_INVENTION) && sum(miss) >= 1 && sum(miss) <= 2) {
    const want: number[] = [];
    miss.forEach((m, r) => {
      for (let i = 0; i < m; i += 1) want.push(r);
    });
    const a = at(want, 0);
    const b = want[1] ?? a;
    const bank = [...s.bank];
    bank[a] = at(bank, a) - 1;
    if (at(bank, a) >= 0 && at(bank, b) >= 1) return { t: 'dev', card: DEV_INVENTION, a, b };
  }
  if (playable(DEV_MONOPOLY) && sum(miss) >= 1) {
    // Den Rohstoff, der am meisten fehlt; die Hände der anderen kennt der Bot nicht.
    let res = 0;
    miss.forEach((m, r) => {
      if (m > at(miss, res)) res = r;
    });
    const others = s.hands.reduce((acc, h, p) => (p === seat ? acc : acc + sum(h)), 0);
    if (others >= 6) return { t: 'dev', card: DEV_MONOPOLY, a: res, b: 0 };
  }
  return null;
}

function mainMove(s: CatanState, seat: number, level: BotLevel, rng: RngState): CatanMove {
  const hand = at(s.hands, seat);
  const target = chooseTarget(s, seat, hand);

  const dev = devMove(s, seat, level, target);
  if (dev) return dev;

  // Bauen, was geht – in der Reihenfolge der Prioritäten.
  if (at(s.citiesLeft, seat) > 0 && canPay(hand, COST_CITY)) {
    const cities = legalCities(s, seat);
    if (cities.length > 0) {
      const v = [...cities].sort(
        (a, b) => vertexValue(s, seat, b, 'mittel') - vertexValue(s, seat, a, 'mittel'),
      )[0];
      if (v !== undefined) return { t: 'city', v };
    }
  }
  if (at(s.settlementsLeft, seat) > 0 && canPay(hand, COST_SETTLEMENT)) {
    const spots = legalSettlements(s, seat, false);
    if (spots.length > 0) {
      const v =
        level === 'leicht'
          ? pick(rng, spots)
          : [...spots].sort(
              (a, b) => vertexValue(s, seat, b, level) - vertexValue(s, seat, a, level),
            )[0];
      if (v !== undefined) return { t: 'settlement', v };
    }
  }
  // Entwicklungskarten nur, wenn sie das nächste Bauziel nicht auffressen.
  if (s.devDeck.length > 0 && canPay(hand, COST_DEV)) {
    const after = hand.map((n, i) => n - at(COST_DEV, i));
    const hurts =
      (target === 'city' || target === 'settlement') &&
      sum(missing(after, COSTS[target])) > sum(missing(hand, COSTS[target]));
    if (!hurts || sum(hand) > 7) return { t: 'buy' };
  }
  if (at(s.roadsLeft, seat) > 0 && canPay(hand, COST_ROAD)) {
    const needRoad = target === 'road' || legalSettlements(s, seat, false).length === 0;
    if (needRoad || sum(hand) > 7) {
      const road = bestRoad(s, seat, level, rng);
      if (road && (road.score > 0 || sum(hand) > 7)) return { t: 'road', e: road.e };
    }
  }

  // Handel mit der Bank: Überschuss gegen das, was fürs Ziel fehlt.
  if (target !== 'none') {
    const cost = COSTS[target];
    const miss = missing(hand, cost);
    if (sum(miss) > 0) {
      const rates = bankRates(s, seat);
      let get = 0;
      miss.forEach((m, r) => {
        if (m > at(miss, get) || (m === at(miss, get) && at(s.bank, r) > at(s.bank, get))) get = r;
      });
      if (at(s.bank, get) > 0) {
        for (let r = 0; r < RES_COUNT; r += 1) {
          if (r === get) continue;
          if (at(hand, r) - at(cost, r) >= at(rates, r)) return { t: 'bank', give: r, get };
        }
      }
      // Mit Mitspielern verhandeln – sparsam, damit Partien nicht in Angebotsschleifen hängen.
      const maxOffers = level === 'schwer' ? 2 : level === 'mittel' ? 1 : 0;
      if (s.offersThisTurn < maxOffers && sum(miss) <= 2) {
        let give = -1;
        for (let r = 0; r < RES_COUNT; r += 1) {
          if (at(miss, r) > 0) continue;
          const spare = at(hand, r) - at(cost, r);
          if (spare >= 1 && (give < 0 || spare > at(hand, give) - at(cost, give))) give = r;
        }
        if (give >= 0) {
          const offerGive = Array<number>(RES_COUNT).fill(0);
          const offerGet = Array<number>(RES_COUNT).fill(0);
          offerGive[give] = 1;
          offerGet[get] = 1;
          return { t: 'offer', give: offerGive, get: offerGet };
        }
      }
    }
  }
  return { t: 'end' };
}

export function botMove(s: CatanState, seat: number, level: BotLevel, rng: RngState): CatanMove {
  switch (s.phase) {
    case 'setup':
      return setupMove(s, seat, level, rng);
    case 'roll': {
      const dev = s.devPlayed ? null : devMove(s, seat, level, 'none');
      return dev && dev.t === 'dev' && dev.card === DEV_KNIGHT ? dev : { t: 'roll' };
    }
    case 'discard':
      return discardMove(s, seat);
    case 'robber':
      return robberMove(s, seat, level, rng);
    case 'roadBuilding': {
      const road = bestRoad(s, seat, level, rng);
      return road ? { t: 'road', e: road.e } : { t: 'done' };
    }
    case 'trade': {
      const offer = s.trade;
      if (offer && seat === offer.from) {
        const takers = offer.answers.map((a, p) => (a === 1 ? p : -1)).filter((p) => p >= 0);
        const partner = [...takers].sort((a, b) => publicVp(s, a) - publicVp(s, b))[0];
        return partner === undefined ? { t: 'cancel' } : { t: 'accept', seat: partner };
      }
      return respondMove(s, seat, level, rng);
    }
    case 'main':
      return mainMove(s, seat, level, rng);
    default:
      return { t: 'end' };
  }
}
