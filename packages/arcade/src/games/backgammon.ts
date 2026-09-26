/**
 * Backgammon ohne Verdopplungswürfel.
 *
 * Koordinaten sind absolut aus Sicht von Sitz 0: Punkte 1–24, Sitz 0 zieht
 * abwärts ins Heimfeld 1–6, Sitz 1 aufwärts ins Heimfeld 19–24. Die Werte 0
 * und 25 stehen je nach Sitz für Bar oder Auswürfeln: Sitz 0 kommt von der Bar
 * auf 25 und würfelt nach 0 hinaus, Sitz 1 umgekehrt. So ist jeder Einzelschritt
 * ein schlichtes `{ from, to }`, und die Würfelzahl ist immer der Abstand.
 *
 * `points[i]` zählt vorzeichenbehaftet: positiv Steine von Sitz 0, negativ von
 * Sitz 1.
 */

import { type RngState, nextInt, rollDie } from '../rng.js';
import {
  type BotLevel,
  type MoveResult,
  type TurnGame,
  type TurnLogEntry,
  type TurnOutcome,
  isRecord,
  intIn,
  pushLog,
} from '../turn.js';

const CHECKERS = 15;
/** Sicherheitsnetz gegen Endlosschleifen in Bot-Partien; wird praktisch nie erreicht. */
const PLY_LIMIT = 1_600;

export interface BgStep {
  from: number;
  to: number;
}

export type BackgammonMove = { type: 'wuerfeln' } | { type: 'ziehen'; steps: BgStep[] };

export interface BackgammonState {
  version: 1;
  /** Index 0 und 25 bleiben leer; Bar und Ausgewürfeltes stehen getrennt. */
  points: number[];
  bar: [number, number];
  off: [number, number];
  turn: number;
  phase: 'wuerfeln' | 'ziehen';
  /** Gewürfelte Augen dieses Zuges (Pasch: vier Einträge). */
  dice: number[];
  rng: RngState;
  plies: number;
  lastSteps: BgStep[];
  lastSeat: number | null;
  result: { winners: number[]; summary: string } | null;
  log: TurnLogEntry[];
}

export interface BackgammonView {
  points: number[];
  bar: [number, number];
  off: [number, number];
  turn: number;
  phase: 'wuerfeln' | 'ziehen';
  dice: number[];
  pips: [number, number];
  lastSteps: BgStep[];
  lastSeat: number | null;
  /**
   * Legale Zugfolgen des Sitzes am Zug, eine je Endstellung. Die Oberfläche
   * baut daraus die Hervorhebung Schritt für Schritt; der Server prüft den
   * abgeschickten Zug trotzdem selbst.
   */
  choices: BgStep[][];
  finished: boolean;
}

const COLOR_NAMES = ['Rot', 'Blau'];

// ---------------------------------------------------------------------------
// Stellung und Einzelschritte
// ---------------------------------------------------------------------------

interface Pos {
  points: number[];
  bar: number[];
  off: number[];
}

function copyPos(p: Pos): Pos {
  return { points: [...p.points], bar: [...p.bar], off: [...p.off] };
}

const sign = (seat: number): number => (seat === 0 ? 1 : -1);
const barPoint = (seat: number): number => (seat === 0 ? 25 : 0);
const offPoint = (seat: number): number => (seat === 0 ? 0 : 25);

function mine(pos: Pos, seat: number, point: number): number {
  const v = pos.points[point] ?? 0;
  return seat === 0 ? Math.max(0, v) : Math.max(0, -v);
}

function theirs(pos: Pos, seat: number, point: number): number {
  return mine(pos, 1 - seat, point);
}

function allHome(pos: Pos, seat: number): boolean {
  if (pos.bar[seat]! > 0) return false;
  for (let p = 1; p <= 24; p += 1) {
    const home = seat === 0 ? p <= 6 : p >= 19;
    if (!home && mine(pos, seat, p) > 0) return false;
  }
  return true;
}

/** Abstand eines Punktes zum Ausgang (1 … 6 im Heimfeld). */
function distanceHome(seat: number, point: number): number {
  return seat === 0 ? point : 25 - point;
}

/**
 * Welcher Würfel einen Schritt trägt – oder `null`, wenn keiner passt.
 * Beim Auswürfeln darf ein höherer Würfel nur genutzt werden, wenn kein Stein
 * weiter hinten steht.
 */
function dieFor(pos: Pos, seat: number, step: BgStep, dice: readonly number[]): number | null {
  const s = sign(seat);
  const bar = barPoint(seat);
  const off = offPoint(seat);
  if (step.from === off || step.to === bar) return null;
  if (pos.bar[seat]! > 0 && step.from !== bar) return null;
  if (step.from === bar ? pos.bar[seat]! === 0 : mine(pos, seat, step.from) === 0) return null;
  const dist = (step.from - step.to) * s;
  if (dist <= 0) return null;
  if (step.to === off) {
    if (!allHome(pos, seat)) return null;
    if (dice.includes(dist)) return dist;
    // Höherer Würfel nur, wenn hinter dem Stein keiner mehr steht.
    for (let d = distanceHome(seat, step.from) + 1; d <= 6; d += 1) {
      const p = seat === 0 ? d : 25 - d;
      if (mine(pos, seat, p) > 0) return null;
    }
    const bigger = dice.filter((d) => d > dist).sort((a, b) => a - b);
    return bigger[0] ?? null;
  }
  if (step.to < 1 || step.to > 24) return null;
  if (!dice.includes(dist)) return null;
  if (theirs(pos, seat, step.to) >= 2) return null;
  return dist;
}

function applyStep(pos: Pos, seat: number, step: BgStep): boolean {
  const s = sign(seat);
  if (step.from === barPoint(seat)) pos.bar[seat] = pos.bar[seat]! - 1;
  else pos.points[step.from] = pos.points[step.from]! - s;
  if (step.to === offPoint(seat)) {
    pos.off[seat] = pos.off[seat]! + 1;
    return false;
  }
  let hit = false;
  if (theirs(pos, seat, step.to) === 1) {
    pos.points[step.to] = 0;
    pos.bar[1 - seat] = pos.bar[1 - seat]! + 1;
    hit = true;
  }
  pos.points[step.to] = pos.points[step.to]! + s;
  return hit;
}

function singleSteps(
  pos: Pos,
  seat: number,
  dice: readonly number[],
): { step: BgStep; die: number }[] {
  const out: { step: BgStep; die: number }[] = [];
  const s = sign(seat);
  const froms = pos.bar[seat]! > 0 ? [barPoint(seat)] : [];
  if (froms.length === 0)
    for (let p = 1; p <= 24; p += 1) if (mine(pos, seat, p) > 0) froms.push(p);
  const uniq = [...new Set(dice)];
  for (const from of froms) {
    const targets = new Set<number>();
    for (const d of uniq) {
      let to = from - d * s;
      if (to <= 0 || to >= 25) to = offPoint(seat);
      targets.add(to);
    }
    for (const to of targets) {
      const step = { from, to };
      const die = dieFor(pos, seat, step, dice);
      if (die !== null) out.push({ step, die });
    }
  }
  return out;
}

function posKey(pos: Pos): string {
  return `${pos.points.join(',')}|${pos.bar.join(',')}|${pos.off.join(',')}`;
}

function removeDie(dice: readonly number[], die: number): number[] {
  const i = dice.indexOf(die);
  return i < 0 ? [...dice] : [...dice.slice(0, i), ...dice.slice(i + 1)];
}

interface Plan {
  steps: BgStep[];
  dice: number[];
  pos: Pos;
}

/**
 * Alle legalen Zugfolgen, eine je Endstellung.
 *
 * Pflicht: möglichst viele Würfel nutzen; geht nur einer, dann der höhere,
 * sofern er sich spielen lässt. Zwischenstände werden gemerkt, damit ein Pasch
 * mit vielen beweglichen Steinen nicht in alle Reihenfolgen zerfällt.
 */
export function legalPlans(start: Pos, seat: number, dice: readonly number[]): Plan[] {
  const seen = new Set<string>();
  const finals = new Map<string, Plan>();
  let best = 0;
  const walk = (pos: Pos, left: number[], steps: BgStep[], used: number[]): void => {
    const key = `${posKey(pos)}#${[...left].sort().join('')}`;
    if (seen.has(key)) return;
    seen.add(key);
    const next = left.length > 0 ? singleSteps(pos, seat, left) : [];
    if (next.length === 0) {
      if (steps.length < best) return;
      if (steps.length > best) {
        best = steps.length;
        finals.clear();
      }
      const fk = posKey(pos);
      if (!finals.has(fk)) finals.set(fk, { steps, dice: used, pos });
      return;
    }
    for (const { step, die } of next) {
      const p = copyPos(pos);
      applyStep(p, seat, step);
      walk(p, removeDie(left, die), [...steps, step], [...used, die]);
    }
  };
  walk(copyPos(start), [...dice], [], []);
  let plans = [...finals.values()].filter((p) => p.steps.length === best);
  if (best === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const high = Math.max(...dice);
    if (plans.some((p) => p.dice[0] === high)) plans = plans.filter((p) => p.dice[0] === high);
  }
  if (best === 0) return [];
  return plans;
}

function posOf(state: BackgammonState): Pos {
  return { points: [...state.points], bar: [...state.bar], off: [...state.off] };
}

function pipCount(pos: Pos, seat: number): number {
  let n = pos.bar[seat]! * 25;
  for (let p = 1; p <= 24; p += 1) n += mine(pos, seat, p) * distanceHome(seat, p);
  return n;
}

function pointName(seat: number, p: number): string {
  if (p === barPoint(seat)) return 'Bar';
  if (p === offPoint(seat)) return 'raus';
  // Im Verlauf zählt jeder Sitz aus eigener Sicht, wie am echten Brett.
  return String(distanceHome(seat, p));
}

function describeSteps(seat: number, steps: readonly BgStep[]): string {
  return steps.map((s) => `${pointName(seat, s.from)}→${pointName(seat, s.to)}`).join(', ');
}

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------

function initialPoints(): number[] {
  const pts = Array.from({ length: 26 }, () => 0);
  pts[24] = 2;
  pts[13] = 5;
  pts[8] = 3;
  pts[6] = 5;
  pts[1] = -2;
  pts[12] = -5;
  pts[17] = -3;
  pts[19] = -5;
  return pts;
}

function setup({ seed }: { seed: number }): BackgammonState {
  const rng: RngState = { s: seed >>> 0 };
  let log: TurnLogEntry[] = [];
  // Eröffnungswurf: jeder einen Würfel, der Höhere beginnt mit beiden Augen.
  let a = rollDie(rng);
  let b = rollDie(rng);
  while (a === b) {
    log = pushLog(log, { seat: null, text: `Eröffnungswurf ${a}:${b} – noch einmal.` });
    a = rollDie(rng);
    b = rollDie(rng);
  }
  const turn = a > b ? 0 : 1;
  log = pushLog(log, {
    seat: null,
    text: `Eröffnungswurf Rot ${a}, Blau ${b} – ${COLOR_NAMES[turn]} beginnt mit ${Math.max(a, b)} und ${Math.min(a, b)}.`,
  });
  const state: BackgammonState = {
    version: 1,
    points: initialPoints(),
    bar: [0, 0],
    off: [0, 0],
    turn,
    phase: 'ziehen',
    dice: [a, b],
    rng,
    plies: 0,
    lastSteps: [],
    lastSeat: null,
    result: null,
    log,
  };
  return state;
}

/** Nach dem Würfeln: gibt es gar keinen Zug, ist sofort der andere dran. */
function afterRoll(state: BackgammonState): BackgammonState {
  if (legalPlans(posOf(state), state.turn, state.dice).length > 0) return state;
  return {
    ...state,
    log: pushLog(state.log, { seat: state.turn, text: 'kann nicht ziehen.' }),
    turn: 1 - state.turn,
    phase: 'wuerfeln',
    dice: [],
  };
}

function finish(state: BackgammonState, seat: number): BackgammonState {
  const loser = 1 - seat;
  const pos = posOf(state);
  let kind = 'einfacher Sieg';
  if (state.off[loser] === 0) {
    let stuck = (state.bar[loser] ?? 0) > 0;
    for (let p = 1; p <= 24; p += 1) {
      const winnersHome = seat === 0 ? p <= 6 : p >= 19;
      if (winnersHome && mine(pos, loser, p) > 0) stuck = true;
    }
    kind = stuck ? 'Backgammon' : 'Gammon';
  }
  const summary = `${COLOR_NAMES[seat]} hat alle Steine hinausgewürfelt – ${kind}.`;
  return {
    ...state,
    phase: 'wuerfeln',
    dice: [],
    result: { winners: [seat], summary },
    log: pushLog(state.log, { seat: null, text: summary }),
  };
}

function parseMove(raw: unknown): BackgammonMove | null {
  if (!isRecord(raw)) return null;
  if (raw['type'] === 'wuerfeln') return { type: 'wuerfeln' };
  if (raw['type'] !== 'ziehen') return null;
  const stepsRaw = raw['steps'];
  if (!Array.isArray(stepsRaw) || stepsRaw.length > 4) return null;
  const steps: BgStep[] = [];
  for (const s of stepsRaw) {
    if (!isRecord(s)) return null;
    const from = intIn(s['from'], 0, 25);
    const to = intIn(s['to'], 0, 25);
    if (from === null || to === null) return null;
    steps.push({ from, to });
  }
  return { type: 'ziehen', steps };
}

function applyMove(
  state: BackgammonState,
  seat: number,
  move: BackgammonMove,
): MoveResult<BackgammonState> {
  if (state.result) return { ok: false, error: 'Die Partie ist bereits vorbei.' };
  if (seat !== state.turn) return { ok: false, error: 'Du bist gerade nicht am Zug.' };
  if (move.type === 'wuerfeln') {
    if (state.phase !== 'wuerfeln') return { ok: false, error: 'Du hast schon gewürfelt.' };
    const rng = { s: state.rng.s };
    const a = rollDie(rng);
    const b = rollDie(rng);
    const dice = a === b ? [a, a, a, a] : [a, b];
    const rolled: BackgammonState = {
      ...state,
      rng,
      dice,
      phase: 'ziehen',
      plies: state.plies + 1,
      log: pushLog(state.log, {
        seat,
        text: a === b ? `würfelt einen Pasch ${a}.` : `würfelt ${a} und ${b}.`,
      }),
    };
    return { ok: true, state: checkLimit(afterRoll(rolled)) };
  }
  if (state.phase !== 'ziehen') return { ok: false, error: 'Erst würfeln.' };
  const pos = posOf(state);
  let dice = [...state.dice];
  let hits = 0;
  for (const step of move.steps) {
    const die = dieFor(pos, seat, step, dice);
    if (die === null)
      return { ok: false, error: 'Dieser Schritt passt nicht zu Würfeln und Brett.' };
    if (applyStep(pos, seat, step)) hits += 1;
    dice = removeDie(dice, die);
  }
  const plans = legalPlans(posOf(state), seat, state.dice);
  const target = posKey(pos);
  if (!plans.some((p) => posKey(p.pos) === target)) {
    const best = plans[0]?.steps.length ?? 0;
    if (move.steps.length < best) {
      return {
        ok: false,
        error: `Du musst ${best === 4 ? 'alle vier' : best === 2 ? 'beide' : best} Würfel nutzen, wenn es geht.`,
      };
    }
    return { ok: false, error: 'Geht nur ein Würfel, musst du den höheren spielen.' };
  }
  const text =
    move.steps.length === 0
      ? 'kann nicht ziehen.'
      : `zieht ${describeSteps(seat, move.steps)}${hits > 0 ? ` und schlägt ${hits === 1 ? 'einen Stein' : `${hits} Steine`}` : ''}.`;
  let next: BackgammonState = {
    ...state,
    points: pos.points,
    bar: [pos.bar[0]!, pos.bar[1]!],
    off: [pos.off[0]!, pos.off[1]!],
    turn: 1 - seat,
    phase: 'wuerfeln',
    dice: [],
    plies: state.plies + 1,
    lastSteps: move.steps.map((s) => ({ ...s })),
    lastSeat: seat,
    log: pushLog(state.log, { seat, text }),
  };
  if (next.off[seat] === CHECKERS) next = finish(next, seat);
  return { ok: true, state: checkLimit(next) };
}

/** Zuglimit: Wer weniger Augen bis zum Ziel hat, gewinnt. */
function checkLimit(state: BackgammonState): BackgammonState {
  if (state.result || state.plies < PLY_LIMIT) return state;
  const pos = posOf(state);
  const a = pipCount(pos, 0);
  const b = pipCount(pos, 1);
  const winners = a === b ? [] : [a < b ? 0 : 1];
  const summary =
    a === b
      ? 'Zuglimit erreicht – Gleichstand.'
      : `Zuglimit erreicht – ${COLOR_NAMES[winners[0]!]} liegt vorn.`;
  return {
    ...state,
    result: { winners, summary },
    log: pushLog(state.log, { seat: null, text: summary }),
  };
}

// ---------------------------------------------------------------------------
// Computergegner: Stellungsbewertung über alle Endstellungen
// ---------------------------------------------------------------------------

/** Wie viele der 36 Würfe treffen einen Stein, der `distance` Augen vor dem Gegner steht? */
const HIT_CHANCE = [
  0, 11, 12, 14, 15, 15, 17, 6, 6, 5, 3, 2, 3, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1,
];

function evaluate(pos: Pos, seat: number): number {
  const other = 1 - seat;
  let score = (pipCount(pos, other) - pipCount(pos, seat)) * 1.0;
  score += (pos.off[seat]! - pos.off[other]!) * 6;
  score += pos.bar[other]! * 14 - pos.bar[seat]! * 14;
  // Laufrennen: sobald sich niemand mehr begegnen kann, zählen nur Augen und Auswürfeln.
  let myBack = 0;
  let theirBack = 25;
  for (let p = 1; p <= 24; p += 1) {
    const d = distanceHome(seat, p);
    if (mine(pos, seat, p) > 0) myBack = Math.max(myBack, d);
    if (theirs(pos, seat, p) > 0) theirBack = Math.min(theirBack, d);
  }
  const contact = pos.bar[0]! > 0 || pos.bar[1]! > 0 || myBack > theirBack;
  if (!contact) return score * 2;

  return score + structure(pos, seat) - structure(pos, other);
}

/**
 * Stellungsbild einer Seite: gebaute Punkte, Blockaden und gefährdete
 * Einzelsteine. Symmetrisch angewandt, damit der Bot auch die Schwächen des
 * Gegners sieht – sonst taugt der Blick einen Wurf voraus wenig.
 */
function structure(pos: Pos, seat: number): number {
  const other = 1 - seat;
  let score = 0;
  // Gegnerische Steine in meiner Zählung; sie laufen zu höheren Zahlen, die Bar liegt bei 0.
  const attackers: number[] = [];
  for (let p = 1; p <= 24; p += 1)
    if (theirs(pos, seat, p) > 0) attackers.push(distanceHome(seat, p));
  if (pos.bar[other]! > 0) attackers.push(0);
  let prime = 0;
  let run = 0;
  for (let p = 1; p <= 24; p += 1) {
    const n = mine(pos, seat, p);
    const d = distanceHome(seat, p);
    if (n >= 2) {
      // Gebaute Punkte, im Heimfeld und davor am wertvollsten.
      score += d <= 6 ? 7 : d <= 9 ? 5 : d >= 19 ? 3 : 2.5;
      if (n > 3) score -= (n - 3) * 1.5;
      run += 1;
      prime = Math.max(prime, run);
    } else {
      run = 0;
    }
    if (n === 1) {
      // Einzelner Stein: Trefferchance mal das, was ein Treffer kostet
      // (zurückgelegter Weg plus Zeit auf der Bar).
      let risk = 0;
      for (const at of attackers) {
        const dist = d - at;
        if (dist > 0 && dist < HIT_CHANCE.length) risk += HIT_CHANCE[dist] ?? 0;
      }
      if (risk > 0) score -= (Math.min(36, risk) / 36) * (25 - d + 12);
    }
  }
  score += prime >= 3 ? prime * prime * 1.2 : 0;
  return score;
}

const BOT_NOISE: Record<BotLevel, number> = { leicht: 30, mittel: 10, schwer: 1 };
/** Wie viele Kandidaten „schwer" einen Wurf weiter durchrechnet (Budget statt Uhr). */
const LOOKAHEAD = 3;

/** Alle 21 Würfe mit Gewicht (Pasch 1/36, sonst 2/36). */
const ROLLS: { dice: number[]; weight: number }[] = (() => {
  const out: { dice: number[]; weight: number }[] = [];
  for (let a = 1; a <= 6; a += 1) {
    for (let b = a; b <= 6; b += 1)
      out.push(a === b ? { dice: [a, a, a, a], weight: 1 } : { dice: [a, b], weight: 2 });
  }
  return out;
})();

/**
 * Erwartungswert einer Stellung nach dem eigenen Zug: Für jeden Gegnerwurf
 * wählt der Gegner die Antwort, die für uns am schlechtesten ist.
 */
function expectedAfterReply(pos: Pos, seat: number): number {
  const other = 1 - seat;
  let total = 0;
  for (const roll of ROLLS) {
    const replies = legalPlans(pos, other, roll.dice);
    let worst = replies.length === 0 ? evaluate(pos, seat) : Infinity;
    for (const r of replies) worst = Math.min(worst, evaluate(r.pos, seat));
    total += worst * roll.weight;
  }
  return total / 36;
}

function bot(state: BackgammonState, seat: number, level: BotLevel, rng: RngState): BackgammonMove {
  if (state.phase === 'wuerfeln') return { type: 'wuerfeln' };
  const plans = legalPlans(posOf(state), seat, state.dice);
  if (plans.length === 0) return { type: 'ziehen', steps: [] };
  if (level === 'leicht' && nextInt(rng, 3) === 0) {
    return { type: 'ziehen', steps: plans[nextInt(rng, plans.length)]!.steps };
  }
  const scored = plans
    .map((plan) => ({
      plan,
      v: evaluate(plan.pos, seat) + nextInt(rng, BOT_NOISE[level] * 10) / 10,
    }))
    .sort((a, b) => b.v - a.v);
  if (level !== 'schwer' || scored.length === 1)
    return { type: 'ziehen', steps: scored[0]!.plan.steps };
  // „Schwer" rechnet die besten Kandidaten einen Gegnerwurf weiter.
  let best = scored[0]!.plan;
  let bestScore = -Infinity;
  for (const { plan } of scored.slice(0, LOOKAHEAD)) {
    const v = expectedAfterReply(plan.pos, seat);
    if (v > bestScore) {
      bestScore = v;
      best = plan;
    }
  }
  return { type: 'ziehen', steps: best.steps };
}

export const game: TurnGame<
  BackgammonState,
  BackgammonMove,
  Record<string, never>,
  BackgammonView
> = {
  kind: 'turn',
  id: 'backgammon',
  version: 1,
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: {},
  parseOptions: (raw) => (raw === undefined || raw === null || isRecord(raw) ? {} : null),
  hiddenInformation: false,
  setup,
  activeSeats: (state) => (state.result ? [] : [state.turn]),
  parseMove,
  applyMove,
  outcome: (state): TurnOutcome | null => {
    if (!state.result) return null;
    return {
      winners: state.result.winners,
      summary: state.result.summary,
      scores: [state.off[0], state.off[1]],
    };
  },
  view: (state): BackgammonView => {
    const pos = posOf(state);
    const choices =
      !state.result && state.phase === 'ziehen'
        ? legalPlans(pos, state.turn, state.dice).map((p) => p.steps)
        : [];
    // Der Zufallsgenerator bleibt draußen: Mit ihm ließen sich künftige Würfe vorhersagen.
    return {
      points: [...state.points],
      bar: [state.bar[0], state.bar[1]],
      off: [state.off[0], state.off[1]],
      turn: state.turn,
      phase: state.phase,
      dice: [...state.dice],
      pips: [pipCount(pos, 0), pipCount(pos, 1)],
      lastSteps: state.lastSteps,
      lastSeat: state.lastSeat,
      choices,
      finished: state.result !== null,
    };
  },
  log: (state) => state.log.slice(-50),
  bot,
};
