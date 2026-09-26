/**
 * Dame – 8×8 auf den dunklen Feldern, Sitz 0 = Weiß (beginnt, zieht nach oben).
 *
 * Regeln: Männer ziehen diagonal vorwärts, schlagen aber vorwärts und
 * rückwärts. Schlagen ist Pflicht, ein Sprung muss bis zum Ende ausgeführt
 * werden (freie Wahl zwischen verschiedenen Schlagfolgen, keine
 * Mehrheitspflicht). Damen fliegen beliebig weit und schlagen auf Distanz.
 * Geschlagene Steine bleiben bis zum Zugende liegen und dürfen nicht zweimal
 * übersprungen werden. Erreicht ein Mann die Grundlinie, wird er Dame und der
 * Zug endet dort.
 *
 * Ein Zug ist ein Pfad von Feldern `[start, …, ziel]` – so lässt sich ein
 * Mehrfachsprung in der Oberfläche Feld für Feld tippen.
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

export interface DameMove {
  path: number[];
}

export interface DameState {
  version: 1;
  /** 64 Zeichen a1 … h8: `w`/`W` weißer Mann/Dame, `b`/`B` schwarz, `.` leer. */
  board: string;
  side: 0 | 1;
  /** Halbzüge ohne Schlag und ohne Männerzug (Remis bei {@link QUIET_LIMIT}). */
  quiet: number;
  lastPath: number[] | null;
  lastCaptured: number[];
  result: TurnOutcome | null;
  log: TurnLogEntry[];
}

export interface DameView {
  board: string;
  side: 0 | 1;
  /** Alle legalen Pfade der Seite am Zug (bei Schlagpflicht nur Schläge). */
  legal: number[][];
  mustCapture: boolean;
  lastPath: number[] | null;
  lastCaptured: number[];
  quiet: number;
  quietLimit: number;
  result: TurnOutcome | null;
}

type Options = Record<string, never>;

/** 40 Züge je Seite ohne Schlag und ohne Männerzug. */
export const QUIET_LIMIT = 80;
const MAX_PATH = 20;
const COLOR_NAME = ['Weiß', 'Schwarz'];

// Interne Brettdarstellung: +1/+2 weißer Mann/Dame, -1/-2 schwarz.
type Cells = Int8Array;

interface Move {
  path: number[];
  caps: number[];
}

const DIAG: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function toCells(board: string): Cells {
  const c = new Int8Array(64);
  for (let i = 0; i < 64; i += 1) {
    const ch = board[i];
    c[i] = ch === 'w' ? 1 : ch === 'W' ? 2 : ch === 'b' ? -1 : ch === 'B' ? -2 : 0;
  }
  return c;
}

function fromCells(c: Cells): string {
  let s = '';
  for (let i = 0; i < 64; i += 1) {
    const v = c[i]!;
    s += v === 1 ? 'w' : v === 2 ? 'W' : v === -1 ? 'b' : v === -2 ? 'B' : '.';
  }
  return s;
}

const isDark = (sq: number): boolean => (((sq >> 3) + (sq & 7)) & 1) === 0;

export function squareName(sq: number): string {
  return 'abcdefgh'[sq & 7]! + String((sq >> 3) + 1);
}

function initialBoard(): string {
  const c = new Int8Array(64);
  for (let sq = 0; sq < 64; sq += 1) {
    if (!isDark(sq)) continue;
    const r = sq >> 3;
    if (r <= 2) c[sq] = 1;
    if (r >= 5) c[sq] = -1;
  }
  return fromCells(c);
}

/** Alle Schlagfolgen eines Steins (Tiefensuche über die Sprünge). */
function captureMoves(c: Cells, start: number, sign: number, out: Move[]): void {
  const king = Math.abs(c[start]!) === 2;
  const promoRow = sign > 0 ? 7 : 0;
  const walk = (cur: number, path: number[], caps: number[]): void => {
    let extended = false;
    const f0 = cur & 7;
    const r0 = cur >> 3;
    for (const [df, dr] of DIAG) {
      let f = f0 + df;
      let r = r0 + dr;
      if (king) {
        // Leere Felder bis zum ersten Stein überfliegen.
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const sq = r * 8 + f;
          if (sq !== start && c[sq] !== 0) break;
          f += df;
          r += dr;
        }
      }
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const over = r * 8 + f;
      const v = c[over]!;
      if (v === 0 || over === start || Math.sign(v) === sign || caps.includes(over)) continue;
      let lf = f + df;
      let lr = r + dr;
      while (lf >= 0 && lf < 8 && lr >= 0 && lr < 8) {
        const land = lr * 8 + lf;
        if (land !== start && c[land] !== 0) break;
        extended = true;
        const nextPath = [...path, land];
        const nextCaps = [...caps, over];
        if (!king && lr === promoRow) out.push({ path: nextPath, caps: nextCaps });
        else walk(land, nextPath, nextCaps);
        if (!king) break;
        lf += df;
        lr += dr;
      }
    }
    if (!extended && caps.length > 0) out.push({ path, caps });
  };
  walk(start, [start], []);
}

/** Legale Züge der Seite `side` – bei Schlagpflicht nur Schläge. */
function generate(c: Cells, side: 0 | 1): Move[] {
  const sign = side === 0 ? 1 : -1;
  const caps: Move[] = [];
  for (let sq = 0; sq < 64; sq += 1) {
    if (Math.sign(c[sq]!) === sign) captureMoves(c, sq, sign, caps);
  }
  if (caps.length > 0) return caps;
  const quiet: Move[] = [];
  for (let sq = 0; sq < 64; sq += 1) {
    const v = c[sq]!;
    if (Math.sign(v) !== sign) continue;
    const king = Math.abs(v) === 2;
    for (const [df, dr] of DIAG) {
      if (!king && dr !== sign) continue;
      let f = (sq & 7) + df;
      let r = (sq >> 3) + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8 && c[r * 8 + f] === 0) {
        quiet.push({ path: [sq, r * 8 + f], caps: [] });
        if (!king) break;
        f += df;
        r += dr;
      }
    }
  }
  return quiet;
}

function applyCells(c: Cells, m: Move): Cells {
  const n = new Int8Array(c);
  const from = m.path[0]!;
  const to = m.path[m.path.length - 1]!;
  let v = n[from]!;
  n[from] = 0;
  for (const cap of m.caps) n[cap] = 0;
  if (Math.abs(v) === 1 && to >> 3 === (v > 0 ? 7 : 0)) v *= 2;
  n[to] = v;
  return n;
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// ---------------------------------------------------------------------------
// Computer
// ---------------------------------------------------------------------------

const WIN = 100_000;

/** Bewertung aus Sicht von `side`. */
function evaluate(c: Cells, side: 0 | 1): number {
  let s = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const v = c[sq]!;
    if (v === 0) continue;
    const r = sq >> 3;
    const f = sq & 7;
    const center = f >= 2 && f <= 5 && r >= 2 && r <= 5 ? 6 : 0;
    let w: number;
    if (Math.abs(v) === 2) w = 320 + center;
    else {
      const adv = v > 0 ? r : 7 - r;
      // Die Grundreihe möglichst lange halten, sonst laufen gegnerische Männer durch.
      w = 100 + adv * adv * 2 + center + (adv === 0 ? 12 : 0);
    }
    s += v > 0 ? w : -w;
  }
  return side === 0 ? s : -s;
}

interface Budget {
  nodes: number;
  limit: number;
  aborted: boolean;
}

function negamax(
  c: Cells,
  side: 0 | 1,
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
  const moves = generate(c, side);
  if (moves.length === 0) return -WIN + ply;
  const forced = moves[0]!.caps.length > 0;
  // Schlagzwang am Horizont weiterrechnen, sonst übersieht der Bot Rückschläge.
  if (depth <= 0 && (!forced || depth < -6)) return evaluate(c, side);
  moves.sort((a, b) => b.caps.length - a.caps.length);
  let best = -Infinity;
  const other: 0 | 1 = side === 0 ? 1 : 0;
  for (const m of moves) {
    const score = -negamax(applyCells(c, m), other, depth - 1, -beta, -alpha, ply + 1, budget);
    if (budget.aborted) return 0;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

const LEVELS: Record<BotLevel, { depth: number; budget: number; noise: number }> = {
  leicht: { depth: 2, budget: 4_000, noise: 70 },
  mittel: { depth: 4, budget: 8_000, noise: 8 },
  schwer: { depth: 12, budget: 30_000, noise: 0 },
};

/** Zug des Computers; `nodes` für die Budgetprüfung im Test. */
export function chooseDameMove(
  board: string,
  side: 0 | 1,
  level: BotLevel,
  rng: RngState,
): { path: number[]; nodes: number } {
  const c = toCells(board);
  const cfg = LEVELS[level];
  const moves = generate(c, side)
    .map((m) => ({ m, k: nextRandom(rng) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.m);
  if (moves.length === 0) throw new Error('Keine legalen Züge.');
  const noise = moves.map(() => (nextRandom(rng) * 2 - 1) * cfg.noise);
  const budget: Budget = { nodes: 0, limit: cfg.budget, aborted: false };
  const other: 0 | 1 = side === 0 ? 1 : 0;
  let best = moves[0]!;
  let order = moves.map((m, i) => ({ m, i }));
  // Iterative Vertiefung; eine abgebrochene Runde zählt nicht (Determinismus ohne Uhr).
  for (let depth = 1; depth <= cfg.depth; depth += 1) {
    let alpha = -Infinity;
    let iterBest = order[0]!;
    const scored: { m: Move; i: number; s: number }[] = [];
    for (const entry of order) {
      const n = noise[entry.i] ?? 0;
      // Fenster um das Rauschen verschoben: Nur wer den bisher besten Wert
      // samt Rauschen schlagen kann, wird genau ausgerechnet.
      const s =
        -negamax(applyCells(c, entry.m), other, depth - 1, -Infinity, -(alpha - n), 1, budget) + n;
      if (budget.aborted) break;
      scored.push({ ...entry, s });
      if (s > alpha) {
        alpha = s;
        iterBest = entry;
      }
    }
    if (budget.aborted) break;
    best = iterBest.m;
    order = scored.sort((a, b) => b.s - a.s).map(({ m, i }) => ({ m, i }));
    if (alpha >= WIN - 100) break;
  }
  return { path: best.path, nodes: budget.nodes };
}

// ---------------------------------------------------------------------------
// Spiel
// ---------------------------------------------------------------------------

export const game: TurnGame<DameState, DameMove, Options, DameView> = {
  kind: 'turn',
  id: 'dame',
  version: 1,
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: {},
  parseOptions: (raw) => (raw === undefined || raw === null || isRecord(raw) ? {} : null),
  hiddenInformation: false,

  setup: () => ({
    version: 1,
    board: initialBoard(),
    side: 0,
    quiet: 0,
    lastPath: null,
    lastCaptured: [],
    result: null,
    log: [],
  }),

  activeSeats: (s) => (s.result ? [] : [s.side]),

  parseMove(raw) {
    if (!isRecord(raw) || !Array.isArray(raw.path)) return null;
    if (raw.path.length < 2 || raw.path.length > MAX_PATH) return null;
    const path: number[] = [];
    for (const v of raw.path as unknown[]) {
      const sq = intIn(v, 0, 63);
      if (sq === null || !isDark(sq)) return null;
      path.push(sq);
    }
    return { path };
  },

  applyMove(state, seat, move): MoveResult<DameState> {
    if (state.result) return { ok: false, error: 'Die Partie ist bereits vorbei.' };
    if (seat !== state.side) return { ok: false, error: 'Du bist gerade nicht am Zug.' };
    const c = toCells(state.board);
    const moves = generate(c, state.side);
    const m = moves.find((x) => samePath(x.path, move.path));
    if (!m) {
      const captureDue = moves[0] !== undefined && moves[0].caps.length > 0;
      return {
        ok: false,
        error: captureDue
          ? 'Schlagen ist Pflicht – und ein Sprung muss vollständig ausgeführt werden.'
          : 'Dieser Zug ist nicht erlaubt.',
      };
    }
    const wasMan = Math.abs(c[m.path[0]!]!) === 1;
    const next = applyCells(c, m);
    const to = m.path[m.path.length - 1]!;
    const promoted = wasMan && Math.abs(next[to]!) === 2;
    const other: 0 | 1 = state.side === 0 ? 1 : 0;
    const sep = m.caps.length > 0 ? '×' : '–';
    let text = m.path.map(squareName).join(sep);
    if (promoted) text += ' (Dame)';
    let log = pushLog(state.log, { seat, text: `${COLOR_NAME[seat]}: ${text}` });
    const quiet = m.caps.length > 0 || wasMan ? 0 : state.quiet + 1;
    let result: TurnOutcome | null = null;
    const replies = generate(next, other);
    if (replies.length === 0) {
      const hasPieces = next.some((v) => Math.sign(v) === (other === 0 ? 1 : -1));
      result = {
        winners: [seat],
        summary: hasPieces
          ? `${COLOR_NAME[other]} kann nicht mehr ziehen – ${COLOR_NAME[seat]} gewinnt.`
          : `${COLOR_NAME[seat]} hat alle Steine geschlagen und gewinnt.`,
      };
    } else if (quiet >= QUIET_LIMIT) {
      result = { winners: [], summary: 'Remis – 40 Züge je Seite ohne Schlag und Männerzug.' };
    }
    if (result) log = pushLog(log, { seat: null, text: result.summary });
    return {
      ok: true,
      state: {
        ...state,
        board: fromCells(next),
        side: other,
        quiet,
        lastPath: m.path,
        lastCaptured: m.caps,
        result,
        log,
      },
    };
  },

  outcome: (s) => s.result,

  view(s) {
    const legal = s.result ? [] : generate(toCells(s.board), s.side);
    return {
      board: s.board,
      side: s.side,
      legal: legal.map((m) => m.path),
      mustCapture: legal.length > 0 && legal[0]!.caps.length > 0,
      lastPath: s.lastPath,
      lastCaptured: s.lastCaptured,
      quiet: s.quiet,
      quietLimit: QUIET_LIMIT,
      result: s.result,
    };
  },

  log: (s) => s.log.slice(-50),

  bot(state, seat, level, rng) {
    return { path: chooseDameMove(state.board, seat === 0 ? 0 : 1, level, rng).path };
  },
};
