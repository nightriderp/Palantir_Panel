/**
 * Vier gewinnt – 7 Spalten × 6 Reihen, Sitz 0 beginnt.
 *
 * Feld `i = reihe * 7 + spalte`, Reihe 0 ist unten. Ein Zug ist nur die
 * Spalte; wohin der Stein fällt, ergibt sich aus der Füllhöhe.
 */

import { type RngState, nextRandom } from '../rng.js';
import {
  type BotLevel,
  type MoveResult,
  type TurnGame,
  type TurnLogEntry,
  type TurnOutcome,
  intIn,
  isRecord,
  pushLog,
} from '../turn.js';

export const COLS = 7;
export const ROWS = 6;

export interface VierGewinntMove {
  column: number;
}

export interface VierGewinntState {
  version: 1;
  /** 42 Zeichen: `.` leer, `0`/`1` Stein des Sitzes. */
  board: string;
  side: 0 | 1;
  lastCell: number | null;
  winLine: number[] | null;
  result: TurnOutcome | null;
  log: TurnLogEntry[];
}

export interface VierGewinntView {
  board: string;
  side: 0 | 1;
  /** Spalten, in die noch ein Stein passt. */
  playable: number[];
  lastCell: number | null;
  winLine: number[] | null;
  result: TurnOutcome | null;
}

type Options = Record<string, never>;

const COLOR_NAME = ['Rot', 'Blau'];

/** Alle 69 Viererfenster – einmal berechnet, für Siegprüfung und Bewertung. */
const WINDOWS: number[][] = [];
for (let r = 0; r < ROWS; r += 1) {
  for (let c = 0; c < COLS; c += 1) {
    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const ec = c + dc * 3;
      const er = r + dr * 3;
      if (ec < 0 || ec >= COLS || er >= ROWS) continue;
      WINDOWS.push([0, 1, 2, 3].map((k) => (r + dr * k) * COLS + c + dc * k));
    }
  }
}
/** Dieselben Fenster flach hintereinander – die Bewertung läuft in der Suche sehr oft. */
const FLAT = Int8Array.from(WINDOWS.flat());

/** Fenster, die ein Feld enthalten – für die schnelle Siegprüfung nach einem Zug. */
const WINDOWS_AT: number[][][] = Array.from({ length: ROWS * COLS }, () => []);
for (const w of WINDOWS) for (const cell of w) WINDOWS_AT[cell]!.push(w);

/** Füllt `cells` (0 leer, 1 Sitz 0, 2 Sitz 1) und Höhen aus dem Text. */
function decode(board: string): { cells: Int8Array; heights: number[] } {
  const cells = new Int8Array(ROWS * COLS);
  const heights = Array.from({ length: COLS }, () => 0);
  for (let i = 0; i < ROWS * COLS; i += 1) {
    const ch = board[i];
    cells[i] = ch === '0' ? 1 : ch === '1' ? 2 : 0;
    if (cells[i]) heights[i % COLS] = Math.max(heights[i % COLS]!, Math.floor(i / COLS) + 1);
  }
  return { cells, heights };
}

function winningLine(cells: Int8Array, cell: number): number[] | null {
  const v = cells[cell];
  if (!v) return null;
  for (const w of WINDOWS_AT[cell]!) if (w.every((i) => cells[i] === v)) return w;
  return null;
}

// ---------------------------------------------------------------------------
// Computer
// ---------------------------------------------------------------------------

/** Schnelle Siegprüfung für die Suche: Lauflänge in vier Richtungen zählen. */
function winsAt(cells: Int8Array, cell: number, v: number): boolean {
  const r0 = (cell / COLS) | 0;
  const c0 = cell - r0 * COLS;
  for (let d = 0; d < 4; d += 1) {
    const dc = d === 1 ? 0 : d === 3 ? -1 : 1;
    const dr = d === 0 ? 0 : 1;
    let n = 1;
    for (let c = c0 + dc, r = r0 + dr; c >= 0 && c < COLS && r < ROWS; c += dc, r += dr) {
      if (cells[r * COLS + c] !== v) break;
      n += 1;
    }
    for (let c = c0 - dc, r = r0 - dr; c >= 0 && c < COLS && r >= 0; c -= dc, r -= dr) {
      if (cells[r * COLS + c] !== v) break;
      n += 1;
    }
    if (n >= 4) return true;
  }
  return false;
}

const WIN = 100_000;
const ORDER = [3, 2, 4, 1, 5, 0, 6];

/** Bewertung aus Sicht des Steins `me` (1 oder 2): offene Zweier und Dreier, Mitte. */
function evaluate(cells: Int8Array, me: number): number {
  let s = 0;
  for (let k = 0; k < FLAT.length; k += 4) {
    let mine = 0;
    let theirs = 0;
    for (let j = k; j < k + 4; j += 1) {
      const v = cells[FLAT[j]!];
      if (v === me) mine += 1;
      else if (v) theirs += 1;
    }
    if (theirs === 0) s += mine === 3 ? 40 : mine === 2 ? 6 : mine;
    else if (mine === 0) s -= theirs === 3 ? 44 : theirs === 2 ? 6 : theirs;
  }
  for (let r = 0; r < ROWS; r += 1) {
    const v = cells[r * COLS + 3];
    if (v === me) s += 4;
    else if (v) s -= 4;
  }
  return s;
}

interface Budget {
  nodes: number;
  limit: number;
  aborted: boolean;
}

function negamax(
  cells: Int8Array,
  heights: number[],
  me: number,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  budget: Budget,
): number {
  budget.nodes += 1;
  if (budget.nodes > budget.limit) {
    budget.aborted = true;
    return 0;
  }
  const other = 3 - me;
  let any = false;
  // Sofortiger Sieg zuerst prüfen – spart die Suche und findet schnelle Gewinne.
  for (const c of ORDER) {
    const h = heights[c]!;
    if (h >= ROWS) continue;
    any = true;
    // winsAt zählt das Feld selbst mit, es muss dafür nicht belegt werden.
    if (winsAt(cells, h * COLS + c, me)) return WIN - ply;
  }
  if (!any) return 0;
  if (depth <= 0) return evaluate(cells, me);
  let best = -Infinity;
  for (const c of ORDER) {
    const h = heights[c]!;
    if (h >= ROWS) continue;
    const cell = h * COLS + c;
    cells[cell] = me;
    heights[c] = h + 1;
    const score = -negamax(cells, heights, other, depth - 1, -beta, -alpha, ply + 1, budget);
    cells[cell] = 0;
    heights[c] = h;
    if (budget.aborted) return 0;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

const LEVELS: Record<BotLevel, { depth: number; budget: number; noise: number }> = {
  leicht: { depth: 1, budget: 2_000, noise: 60 },
  mittel: { depth: 5, budget: 15_000, noise: 6 },
  schwer: { depth: 10, budget: 90_000, noise: 0 },
};

/** Zug des Computers; `nodes` für die Budgetprüfung im Test. */
export function chooseColumn(
  board: string,
  side: 0 | 1,
  level: BotLevel,
  rng: RngState,
): { column: number; nodes: number } {
  const { cells, heights } = decode(board);
  const me = side + 1;
  const cfg = LEVELS[level];
  const cols = ORDER.filter((c) => heights[c]! < ROWS);
  if (cols.length === 0) throw new Error('Brett voll.');
  const noise = new Map(cols.map((c) => [c, (nextRandom(rng) * 2 - 1) * cfg.noise]));
  const budget: Budget = { nodes: 0, limit: cfg.budget, aborted: false };
  let best = cols[0]!;
  let order = [...cols];
  for (let depth = 1; depth <= cfg.depth; depth += 1) {
    let alpha = -Infinity;
    let iterBest = order[0]!;
    const scored: { c: number; s: number }[] = [];
    for (const c of order) {
      const h = heights[c]!;
      const cell = h * COLS + c;
      cells[cell] = me;
      heights[c] = h + 1;
      const n = noise.get(c) ?? 0;
      const s = winsAt(cells, cell, me)
        ? WIN
        : -negamax(cells, heights, 3 - me, depth - 1, -Infinity, -(alpha - n), 1, budget) + n;
      cells[cell] = 0;
      heights[c] = h;
      if (budget.aborted) break;
      scored.push({ c, s });
      if (s > alpha) {
        alpha = s;
        iterBest = c;
      }
    }
    if (budget.aborted) break;
    best = iterBest;
    // Stabile Sortierung: bei Gleichstand bleibt die Mitte vorn.
    order = scored.sort((a, b) => b.s - a.s).map((x) => x.c);
    if (Math.abs(alpha) >= WIN - 100) break;
  }
  return { column: best, nodes: budget.nodes };
}

// ---------------------------------------------------------------------------
// Spiel
// ---------------------------------------------------------------------------

export const game: TurnGame<VierGewinntState, VierGewinntMove, Options, VierGewinntView> = {
  kind: 'turn',
  id: 'vier-gewinnt',
  version: 1,
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: {},
  parseOptions: (raw) => (raw === undefined || raw === null || isRecord(raw) ? {} : null),
  hiddenInformation: false,

  setup: () => ({
    version: 1,
    board: '.'.repeat(ROWS * COLS),
    side: 0,
    lastCell: null,
    winLine: null,
    result: null,
    log: [],
  }),

  activeSeats: (s) => (s.result ? [] : [s.side]),

  parseMove(raw) {
    if (!isRecord(raw)) return null;
    const column = intIn(raw.column, 0, COLS - 1);
    return column === null ? null : { column };
  },

  applyMove(state, seat, move): MoveResult<VierGewinntState> {
    if (state.result) return { ok: false, error: 'Die Partie ist bereits vorbei.' };
    if (seat !== state.side) return { ok: false, error: 'Du bist gerade nicht am Zug.' };
    const { cells, heights } = decode(state.board);
    const h = heights[move.column]!;
    if (h >= ROWS) return { ok: false, error: 'Diese Spalte ist voll.' };
    const cell = h * COLS + move.column;
    cells[cell] = seat + 1;
    const board = state.board.slice(0, cell) + String(seat) + state.board.slice(cell + 1);
    let log = pushLog(state.log, {
      seat,
      text: `${COLOR_NAME[seat]} wirft in Spalte ${move.column + 1}.`,
    });
    const line = winningLine(cells, cell);
    let result: TurnOutcome | null = null;
    if (line)
      result = { winners: [seat], summary: `Vier in einer Reihe – ${COLOR_NAME[seat]} gewinnt.` };
    else if (!board.includes('.')) result = { winners: [], summary: 'Das Brett ist voll – Remis.' };
    if (result) log = pushLog(log, { seat: null, text: result.summary });
    return {
      ok: true,
      state: {
        ...state,
        board,
        side: seat === 0 ? 1 : 0,
        lastCell: cell,
        winLine: line,
        result,
        log,
      },
    };
  },

  outcome: (s) => s.result,

  view(s) {
    const { heights } = decode(s.board);
    return {
      board: s.board,
      side: s.side,
      playable: s.result ? [] : heights.flatMap((h, c) => (h < ROWS ? [c] : [])),
      lastCell: s.lastCell,
      winLine: s.winLine,
      result: s.result,
    };
  },

  log: (s) => s.log.slice(-50),

  bot(state, seat, level, rng) {
    return { column: chooseColumn(state.board, seat === 0 ? 0 : 1, level, rng).column };
  },
};
