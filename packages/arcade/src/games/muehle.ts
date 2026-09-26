/**
 * Mühle (Neun-Männer-Morris).
 *
 * 24 Punkte auf drei ineinanderliegenden Quadraten. Nummerierung je Ring im
 * Uhrzeigersinn ab der linken oberen Ecke: außen 0–7, Mitte 8–15, innen 16–23.
 * Ungerade Punkte sind die Seitenmitten, nur sie verbinden die Ringe.
 *
 * Das Wegnehmen nach einer Mühle ist **Teil des Zuges** (`remove`). So bleibt
 * ein Zug ein Zug, der Verlauf liest sich in einer Zeile, und die Suche des
 * Computergegners muss keinen halben Zustand kennen. Die Oberfläche fragt den
 * zu nehmenden Stein erst ab, wenn die Mühle geschlossen ist.
 */

import { type RngState, nextInt } from '../rng.js';
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

export const POINTS = 24;
const STONES = 9;
/** Züge ohne Schlagen in der Zugphase, danach Remis (je Seite 50). */
const QUIET_LIMIT = 100;
/** Harte Obergrenze an Halbzügen – schützt Bot-gegen-Bot-Partien. */
const PLY_LIMIT = 600;

/** Alle 16 Mühlen. */
export const MILLS: readonly (readonly [number, number, number])[] = (() => {
  const mills: [number, number, number][] = [];
  for (let r = 0; r < 3; r += 1) {
    const b = r * 8;
    mills.push([b, b + 1, b + 2], [b + 2, b + 3, b + 4], [b + 4, b + 5, b + 6], [b + 6, b + 7, b]);
  }
  for (const k of [1, 3, 5, 7]) mills.push([k, k + 8, k + 16]);
  return mills;
})();

/** Nachbarn je Punkt. */
export const NEIGHBORS: readonly (readonly number[])[] = (() => {
  const adj: number[][] = Array.from({ length: POINTS }, () => []);
  const link = (a: number, b: number): void => {
    adj[a]?.push(b);
    adj[b]?.push(a);
  };
  for (let r = 0; r < 3; r += 1) {
    for (let i = 0; i < 8; i += 1) link(r * 8 + i, r * 8 + ((i + 1) % 8));
  }
  for (const k of [1, 3, 5, 7]) {
    link(k, k + 8);
    link(k + 8, k + 16);
  }
  return adj;
})();

const MILLS_OF: readonly (readonly (readonly [number, number, number])[])[] = Array.from(
  { length: POINTS },
  (_, p) => MILLS.filter((m) => m.includes(p)),
);

/** Klassische Brettkoordinaten (a1 … g7) für den Verlauf. */
const COORDS = [
  'a7',
  'd7',
  'g7',
  'g4',
  'g1',
  'd1',
  'a1',
  'a4',
  'b6',
  'd6',
  'f6',
  'f4',
  'f2',
  'd2',
  'b2',
  'b4',
  'c5',
  'd5',
  'e5',
  'e4',
  'e3',
  'd3',
  'c3',
  'c4',
];

export function coord(p: number): string {
  return COORDS[p] ?? '?';
}

export interface MuehleOptions {
  /** Mit drei Steinen darf man springen (Standard). */
  springen: boolean;
}

export interface MuehleMove {
  /** Fehlt in der Setzphase. */
  from?: number;
  to: number;
  /** Gegnerischer Stein, der nach einer geschlossenen Mühle fällt. */
  remove?: number;
}

export interface MuehleState {
  version: 1;
  springen: boolean;
  /** -1 = leer, sonst Sitz 0/1. */
  board: number[];
  /** Noch zu setzende Steine je Sitz. */
  inHand: [number, number];
  turn: number;
  plies: number;
  /** Halbzüge seit dem letzten Schlagen (nur Zugphase zählt). */
  quiet: number;
  /** Stellungsschlüssel seit dem letzten Schlagen – für die Wiederholung. */
  history: string[];
  lastMove: MuehleMove | null;
  lastSeat: number | null;
  result: { winners: number[]; summary: string } | null;
  log: TurnLogEntry[];
}

export interface MuehleView {
  board: number[];
  inHand: [number, number];
  onBoard: [number, number];
  turn: number;
  springen: boolean;
  lastMove: MuehleMove | null;
  lastSeat: number | null;
  /** Alle legalen Züge des Sitzes am Zug (leer bei Partieende). */
  legal: MuehleMove[];
  finished: boolean;
}

const COLOR_NAMES = ['Rot', 'Blau'];

function countStones(board: readonly number[], seat: number): number {
  let n = 0;
  for (const v of board) if (v === seat) n += 1;
  return n;
}

function formsMill(board: readonly number[], p: number, seat: number): boolean {
  for (const m of MILLS_OF[p] ?? []) {
    if (board[m[0]] === seat && board[m[1]] === seat && board[m[2]] === seat) return true;
  }
  return false;
}

/** Steine des Gegners, die nach einer Mühle genommen werden dürfen. */
function removable(board: readonly number[], victim: number): number[] {
  const all: number[] = [];
  const free: number[] = [];
  for (let p = 0; p < POINTS; p += 1) {
    if (board[p] !== victim) continue;
    all.push(p);
    if (!formsMill(board, p, victim)) free.push(p);
  }
  return free.length > 0 ? free : all;
}

/** Legale Züge – rechnet auf rohen Feldern, damit auch die Suche sie nutzen kann. */
function generate(
  board: number[],
  inHand: readonly number[],
  seat: number,
  springen: boolean,
): MuehleMove[] {
  const moves: MuehleMove[] = [];
  const other = 1 - seat;
  const withRemovals = (from: number | undefined, to: number): void => {
    if (from !== undefined) board[from] = -1;
    board[to] = seat;
    if (formsMill(board, to, seat)) {
      for (const r of removable(board, other)) {
        moves.push(from === undefined ? { to, remove: r } : { from, to, remove: r });
      }
    } else {
      moves.push(from === undefined ? { to } : { from, to });
    }
    board[to] = -1;
    if (from !== undefined) board[from] = seat;
  };
  if ((inHand[seat] ?? 0) > 0) {
    for (let p = 0; p < POINTS; p += 1) if (board[p] === -1) withRemovals(undefined, p);
    return moves;
  }
  const flying = springen && countStones(board, seat) === 3;
  for (let from = 0; from < POINTS; from += 1) {
    if (board[from] !== seat) continue;
    const targets = flying ? [...Array(POINTS).keys()] : (NEIGHBORS[from] ?? []);
    for (const to of targets) if (board[to] === -1) withRemovals(from, to);
  }
  return moves;
}

export function legalMoves(state: MuehleState): MuehleMove[] {
  if (state.result) return [];
  return generate([...state.board], state.inHand, state.turn, state.springen);
}

function positionKey(board: readonly number[], turn: number): string {
  return board.map((v) => (v === -1 ? '.' : String(v))).join('') + turn;
}

function sameMove(a: MuehleMove, b: MuehleMove): boolean {
  return a.to === b.to && a.from === b.from && a.remove === b.remove;
}

function describe(move: MuehleMove): string {
  const base =
    move.from === undefined
      ? `setzt auf ${coord(move.to)}`
      : `zieht von ${coord(move.from)} nach ${coord(move.to)}`;
  return move.remove === undefined
    ? `${base}.`
    : `${base}, schließt eine Mühle und nimmt ${coord(move.remove)}.`;
}

function parseOptions(raw: unknown): MuehleOptions | null {
  if (raw === undefined || raw === null) return { springen: true };
  if (!isRecord(raw)) return null;
  const springen = raw['springen'] === undefined ? true : raw['springen'];
  if (typeof springen !== 'boolean') return null;
  return { springen };
}

function parseMove(raw: unknown): MuehleMove | null {
  if (!isRecord(raw)) return null;
  const to = intIn(raw['to'], 0, POINTS - 1);
  if (to === null) return null;
  const move: MuehleMove = { to };
  if (raw['from'] !== undefined) {
    const from = intIn(raw['from'], 0, POINTS - 1);
    if (from === null) return null;
    move.from = from;
  }
  if (raw['remove'] !== undefined) {
    const remove = intIn(raw['remove'], 0, POINTS - 1);
    if (remove === null) return null;
    move.remove = remove;
  }
  return move;
}

function applyMove(state: MuehleState, seat: number, move: MuehleMove): MoveResult<MuehleState> {
  if (state.result) return { ok: false, error: 'Die Partie ist bereits vorbei.' };
  if (seat !== state.turn) return { ok: false, error: 'Du bist gerade nicht am Zug.' };
  const legal = legalMoves(state);
  if (!legal.some((m) => sameMove(m, move))) {
    if (state.inHand[seat]! > 0 && move.from !== undefined) {
      return { ok: false, error: 'Erst müssen alle Steine gesetzt sein.' };
    }
    const closes = legal.some(
      (m) => m.to === move.to && m.from === move.from && m.remove !== undefined,
    );
    if (closes && move.remove === undefined)
      return { ok: false, error: 'Du hast eine Mühle – nimm einen Stein weg.' };
    if (closes)
      return {
        ok: false,
        error: 'Dieser Stein steht in einer Mühle und darf nicht genommen werden.',
      };
    return { ok: false, error: 'Dieser Zug ist nicht erlaubt.' };
  }
  const board = [...state.board];
  const inHand: [number, number] = [state.inHand[0], state.inHand[1]];
  if (move.from !== undefined) board[move.from] = -1;
  else inHand[seat] = inHand[seat]! - 1;
  board[move.to] = seat;
  if (move.remove !== undefined) board[move.remove] = -1;

  const placing = inHand[0] > 0 || inHand[1] > 0;
  const captured = move.remove !== undefined;
  const turn = 1 - seat;
  const key = positionKey(board, turn);
  const history = captured || placing ? [] : [...state.history, key];
  const quiet = captured || move.from === undefined ? 0 : state.quiet + 1;
  let log = pushLog(state.log, { seat, text: describe(move) });

  const next: MuehleState = {
    ...state,
    board,
    inHand,
    turn,
    plies: state.plies + 1,
    quiet,
    history,
    lastMove: move,
    lastSeat: seat,
    result: null,
    log,
  };

  const otherLeft = countStones(board, turn) + inHand[turn]!;
  if (otherLeft < 3) {
    next.result = {
      winners: [seat],
      summary: `${COLOR_NAMES[turn]} hat nur noch zwei Steine – ${COLOR_NAMES[seat]} gewinnt.`,
    };
  } else if (generate([...board], inHand, turn, state.springen).length === 0) {
    next.result = {
      winners: [seat],
      summary: `${COLOR_NAMES[turn]} kann nicht mehr ziehen – ${COLOR_NAMES[seat]} gewinnt.`,
    };
  } else if (history.filter((k) => k === key).length >= 3) {
    next.result = { winners: [], summary: 'Dreifache Stellungswiederholung – Remis.' };
  } else if (quiet >= QUIET_LIMIT) {
    next.result = { winners: [], summary: 'Fünfzig Züge je Seite ohne Schlagen – Remis.' };
  } else if (next.plies >= PLY_LIMIT) {
    next.result = { winners: [], summary: 'Zuglimit erreicht – Remis.' };
  }
  if (next.result) {
    log = pushLog(log, { seat: null, text: next.result.summary });
    next.log = log;
  }
  return { ok: true, state: next };
}

// ---------------------------------------------------------------------------
// Computergegner: Alpha-Beta mit Knotenbudget
// ---------------------------------------------------------------------------

interface SearchNode {
  board: number[];
  inHand: number[];
}

const WIN = 100_000;

/** Bewertung aus Sicht von `seat`. */
function evaluate(node: SearchNode, seat: number, springen: boolean): number {
  const other = 1 - seat;
  const mine = countStones(node.board, seat) + node.inHand[seat]!;
  const theirs = countStones(node.board, other) + node.inHand[other]!;
  let score = (mine - theirs) * 120;
  // Offene Zweier (zwei eigene + ein leerer Punkt) sind Drohungen; geschlossene
  // Mühlen zählen etwas, weil sie sich öffnen und wieder schließen lassen.
  for (const m of MILLS) {
    let a = 0;
    let b = 0;
    let e = 0;
    for (const p of m) {
      const v = node.board[p];
      if (v === seat) a += 1;
      else if (v === other) b += 1;
      else e += 1;
    }
    if (a === 3) score += 14;
    else if (b === 3) score -= 14;
    if (a === 2 && e === 1) score += 18;
    else if (b === 2 && e === 1) score -= 18;
  }
  // Beweglichkeit zählt schon beim Setzen: Wer dort eingemauert wird, verliert
  // mit dem ersten Zug der Zugphase – das sieht die Suche sonst zu spät.
  const placing = node.inHand[0]! > 0 || node.inHand[1]! > 0;
  const mob = (s: number): number => {
    if (!placing && springen && countStones(node.board, s) === 3) return 8;
    let n = 0;
    for (let p = 0; p < POINTS; p += 1) {
      if (node.board[p] !== s) continue;
      for (const q of NEIGHBORS[p] ?? []) if (node.board[q] === -1) n += 1;
    }
    return n;
  };
  const myMob = mob(seat);
  const theirMob = mob(other);
  score += (myMob - theirMob) * (placing ? 4 : 6);
  if (myMob <= 1 && !(springen && !placing && countStones(node.board, seat) === 3))
    score -= placing ? 60 : 30;
  if (theirMob <= 1 && !(springen && !placing && countStones(node.board, other) === 3))
    score += placing ? 60 : 30;
  if (placing) {
    // Kreuzungspunkte (vier Nachbarn) sind beim Setzen die wertvollsten.
    for (const p of [9, 11, 13, 15]) {
      if (node.board[p] === seat) score += 6;
      else if (node.board[p] === other) score -= 6;
    }
  }
  return score;
}

function play(node: SearchNode, seat: number, m: MuehleMove): SearchNode {
  const board = [...node.board];
  const inHand = [...node.inHand];
  if (m.from !== undefined) board[m.from] = -1;
  else inHand[seat] = inHand[seat]! - 1;
  board[m.to] = seat;
  if (m.remove !== undefined) board[m.remove] = -1;
  return { board, inHand };
}

interface Search {
  nodes: number;
  budget: number;
  springen: boolean;
  root: number;
}

function negamax(
  s: Search,
  node: SearchNode,
  toMove: number,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  s.nodes += 1;
  const other = 1 - toMove;
  if (countStones(node.board, toMove) + node.inHand[toMove]! < 3) return -WIN + ply;
  const moves = generate(node.board, node.inHand, toMove, s.springen);
  if (moves.length === 0) return -WIN + ply;
  if (depth <= 0 || s.nodes >= s.budget) {
    const e = evaluate(node, s.root, s.springen);
    return toMove === s.root ? e : -e;
  }
  // Schlagzüge zuerst – sie schneiden am meisten ab.
  moves.sort((a, b) => (b.remove !== undefined ? 1 : 0) - (a.remove !== undefined ? 1 : 0));
  let best = -Infinity;
  for (const m of moves) {
    const v = -negamax(s, play(node, toMove, m), other, depth - 1, -beta, -alpha, ply + 1);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

const BOT_SETTINGS: Record<BotLevel, { depth: number; budget: number; noise: number }> = {
  leicht: { depth: 1, budget: 2_000, noise: 90 },
  mittel: { depth: 3, budget: 6_000, noise: 12 },
  schwer: { depth: 6, budget: 12_000, noise: 0 },
};

function bot(state: MuehleState, seat: number, level: BotLevel, rng: RngState): MuehleMove {
  const moves = legalMoves(state);
  const fallback = moves[0];
  if (!fallback) throw new Error('muehle: Bot ohne legalen Zug.');
  const cfg = BOT_SETTINGS[level];
  const node: SearchNode = { board: [...state.board], inHand: [...state.inHand] };
  let bestMoves: MuehleMove[] = [fallback];
  // Iterative Vertiefung mit einem gemeinsamen Knotenbudget. Eine abgebrochene
  // Tiefe wird verworfen, damit eine halbe Suche nicht täuscht.
  const s: Search = { nodes: 0, budget: cfg.budget, springen: state.springen, root: seat };
  for (let depth = 1; depth <= cfg.depth; depth += 1) {
    let bestScore = -Infinity;
    let found: MuehleMove[] = [];
    for (const m of moves) {
      const noise = cfg.noise > 0 ? nextInt(rng, cfg.noise) : 0;
      const v =
        -negamax(s, play(node, seat, m), 1 - seat, depth - 1, -Infinity, Infinity, 1) + noise;
      if (v > bestScore) {
        bestScore = v;
        found = [m];
      } else if (v === bestScore) found.push(m);
    }
    if (s.nodes >= s.budget && depth > 1) break;
    bestMoves = found;
    if (bestScore >= WIN - 50) break;
  }
  return bestMoves[nextInt(rng, bestMoves.length)] ?? fallback;
}

export const game: TurnGame<MuehleState, MuehleMove, MuehleOptions, MuehleView> = {
  kind: 'turn',
  id: 'muehle',
  version: 1,
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: { springen: true },
  parseOptions,
  hiddenInformation: false,
  setup: ({ options }) => ({
    version: 1,
    springen: options.springen,
    board: Array.from({ length: POINTS }, () => -1),
    inHand: [STONES, STONES],
    turn: 0,
    plies: 0,
    quiet: 0,
    history: [],
    lastMove: null,
    lastSeat: null,
    result: null,
    log: [{ seat: null, text: 'Neue Partie – Rot beginnt mit dem Setzen.' }],
  }),
  activeSeats: (state) => (state.result ? [] : [state.turn]),
  parseMove,
  applyMove,
  outcome: (state): TurnOutcome | null => {
    if (!state.result) return null;
    return {
      winners: state.result.winners,
      summary: state.result.summary,
      scores: [
        countStones(state.board, 0) + state.inHand[0],
        countStones(state.board, 1) + state.inHand[1],
      ],
    };
  },
  view: (state): MuehleView => ({
    board: [...state.board],
    inHand: [state.inHand[0], state.inHand[1]],
    onBoard: [countStones(state.board, 0), countStones(state.board, 1)],
    turn: state.turn,
    springen: state.springen,
    lastMove: state.lastMove,
    lastSeat: state.lastSeat,
    legal: legalMoves(state),
    finished: state.result !== null,
  }),
  log: (state) => state.log.slice(-50),
  bot,
};
