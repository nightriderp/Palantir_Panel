/**
 * Mensch ärgere dich nicht – klassisches Kreuzbrett mit 40 Laufeldern.
 *
 * Eine Figur merkt sich nur ihren Fortschritt ab dem eigenen Startfeld:
 * -1 im Haus, 0–39 auf der Laufbahn, 40–43 im Ziel. Das absolute Feld ergibt
 * sich aus der Ecke des Sitzes. Bei zwei Spielern sitzen sie sich gegenüber
 * (Ecken 0 und 2), damit beide gleich weit voneinander entfernt starten.
 *
 * Hausregeln (auch in der Anleitung):
 *   - Mit einer 6 muss eine Figur heraus, solange das Startfeld frei ist.
 *   - Das Startfeld muss geräumt werden, solange noch Figuren im Haus warten.
 *   - Im Ziel wird nicht übersprungen.
 *   - Drei Versuche, wenn keine Figur auf der Laufbahn steht und die Figuren im
 *     Ziel lückenlos ganz hinten stehen.
 *   - Wer zuerst alle vier im Ziel hat, gewinnt; die Partie endet dann.
 *   - Gibt es genau einen möglichen Zug, führt ihn das Spiel selbst aus.
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

export const TRACK = 40;
const GOAL_START = 40;
const GOAL_END = 43;
/** Sicherheitsnetz gegen endlose Bot-Partien (MAX_BOT_CHAIN liegt bei 2000). */
const PLY_LIMIT = 1_600;

export interface MaednOptions {
  /** Wer schlagen kann, muss schlagen. */
  schlagpflicht: boolean;
}

export type MaednMove = { type: 'wuerfeln' } | { type: 'figur'; piece: number };

export interface MaednChoice {
  piece: number;
  from: number;
  to: number;
  /** Sitz, dessen Figur geschlagen wird. */
  captures: number | null;
}

export interface MaednState {
  version: 1;
  players: number;
  schlagpflicht: boolean;
  /** Fortschritt je Sitz und Figur. */
  pieces: number[][];
  turn: number;
  phase: 'wuerfeln' | 'ziehen';
  die: number;
  /** Fehlwürfe im Drei-Versuche-Modus. */
  attempts: number;
  rng: RngState;
  plies: number;
  lastMove: { seat: number; piece: number; from: number; to: number } | null;
  result: { winners: number[]; summary: string } | null;
  log: TurnLogEntry[];
}

export interface MaednView {
  players: number;
  /** Ecke je Sitz (0–3, im Uhrzeigersinn ab oben links). */
  corners: number[];
  pieces: number[][];
  turn: number;
  phase: 'wuerfeln' | 'ziehen';
  /** Letzter Wurf (0 = noch keiner). */
  die: number;
  attempts: number;
  /** Darf im Drei-Versuche-Modus gewürfelt werden? */
  threeTries: boolean;
  legal: MaednChoice[];
  lastMove: { seat: number; piece: number; from: number; to: number } | null;
  schlagpflicht: boolean;
  finished: boolean;
}

export const COLOR_NAMES = ['Rot', 'Blau', 'Grün', 'Gelb'];

export function cornersFor(players: number): number[] {
  return players === 2 ? [0, 2] : players === 3 ? [0, 1, 2] : [0, 1, 2, 3];
}

/** Absolutes Laufeld einer Figur auf der Bahn. */
export function absField(corner: number, rel: number): number {
  return (corner * 10 + rel) % TRACK;
}

function occupantAt(state: MaednState, field: number): { seat: number; piece: number } | null {
  const corners = cornersFor(state.players);
  for (let s = 0; s < state.players; s += 1) {
    const pcs = state.pieces[s] ?? [];
    for (let i = 0; i < pcs.length; i += 1) {
      const rel = pcs[i]!;
      if (rel >= 0 && rel < TRACK && absField(corners[s]!, rel) === field)
        return { seat: s, piece: i };
    }
  }
  return null;
}

/** Figuren im Ziel stehen lückenlos ganz hinten – dann kann keine mehr ziehen. */
function packed(pcs: readonly number[]): boolean {
  const inGoal = pcs.filter((r) => r >= GOAL_START).sort((a, b) => b - a);
  return inGoal.every((r, i) => r === GOAL_END - i);
}

function threeTriesMode(pcs: readonly number[]): boolean {
  return pcs.every((r) => r < 0 || r >= GOAL_START) && packed(pcs);
}

function rawChoices(state: MaednState, seat: number, die: number): MaednChoice[] {
  const corner = cornersFor(state.players)[seat]!;
  const pcs = state.pieces[seat]!;
  const out: MaednChoice[] = [];
  for (let i = 0; i < pcs.length; i += 1) {
    const rel = pcs[i]!;
    let to: number;
    if (rel < 0) {
      if (die !== 6) continue;
      to = 0;
    } else {
      to = rel + die;
      if (to > GOAL_END) continue;
    }
    if (to >= GOAL_START) {
      // Im Ziel wird nicht übersprungen: alle Zielfelder bis einschließlich
      // Ziel müssen frei sein.
      let blocked = false;
      for (let g = Math.max(rel + 1, GOAL_START); g <= to; g += 1)
        if (pcs.includes(g)) blocked = true;
      if (blocked) continue;
      out.push({ piece: i, from: rel, to, captures: null });
      continue;
    }
    const occ = occupantAt(state, absField(corner, to));
    if (occ && occ.seat === seat) continue;
    out.push({ piece: i, from: rel, to, captures: occ ? occ.seat : null });
  }
  return out;
}

/** Legale Züge nach allen Pflichten. */
export function choicesFor(state: MaednState, seat: number, die: number): MaednChoice[] {
  let list = rawChoices(state, seat, die);
  const pcs = state.pieces[seat]!;
  const inHouse = pcs.some((r) => r < 0);
  const onStart = pcs.indexOf(0);
  if (inHouse && die === 6) {
    const out = list.filter((c) => c.from < 0);
    if (out.length > 0) list = out;
  }
  if (inHouse && onStart >= 0) {
    const clear = list.filter((c) => c.piece === onStart);
    if (clear.length > 0) list = clear;
  }
  if (state.schlagpflicht) {
    const hits = list.filter((c) => c.captures !== null);
    if (hits.length > 0) list = hits;
  }
  return list;
}

function nextSeat(state: MaednState): number {
  return (state.turn + 1) % state.players;
}

function progress(pcs: readonly number[]): number {
  return pcs.reduce((sum, r) => sum + r + 1, 0);
}

function describe(choice: MaednChoice, die: number): string {
  const target =
    choice.from < 0
      ? 'aufs Startfeld'
      : choice.to >= GOAL_START
        ? `ins Ziel (Feld ${choice.to - GOAL_START + 1})`
        : `${die} Felder vor`;
  const hit = choice.captures !== null ? ` und schlägt ${COLOR_NAMES[choice.captures]}` : '';
  return `würfelt ${die} und zieht Figur ${choice.piece + 1} ${target}${hit}.`;
}

function withLimit(state: MaednState): MaednState {
  if (state.result || state.plies < PLY_LIMIT) return state;
  let best = -1;
  let winners: number[] = [];
  for (let s = 0; s < state.players; s += 1) {
    const p = progress(state.pieces[s]!);
    if (p > best) {
      best = p;
      winners = [s];
    } else if (p === best) winners.push(s);
  }
  const summary = `Zuglimit erreicht – ${winners.map((w) => COLOR_NAMES[w]).join(' und ')} ${winners.length > 1 ? 'liegen' : 'liegt'} vorn.`;
  return {
    ...state,
    result: { winners, summary },
    log: pushLog(state.log, { seat: null, text: summary }),
  };
}

/** Zug ausführen – gemeinsam für menschliche Wahl und Automatik. */
function execute(state: MaednState, seat: number, choice: MaednChoice): MaednState {
  const pieces = state.pieces.map((p) => [...p]);
  if (choice.captures !== null) {
    const corner = cornersFor(state.players)[seat]!;
    const occ = occupantAt(state, absField(corner, choice.to));
    if (occ) pieces[occ.seat]![occ.piece] = -1;
  }
  pieces[seat]![choice.piece] = choice.to;
  let log = pushLog(state.log, { seat, text: describe(choice, state.die) });
  const lastMove = { seat, piece: choice.piece, from: choice.from, to: choice.to };
  if (pieces[seat]!.every((r) => r >= GOAL_START)) {
    const summary = `${COLOR_NAMES[seat]} hat alle vier Figuren im Ziel und gewinnt.`;
    log = pushLog(log, { seat: null, text: summary });
    return {
      ...state,
      pieces,
      lastMove,
      log,
      phase: 'wuerfeln',
      result: { winners: [seat], summary },
    };
  }
  const again = state.die === 6;
  return {
    ...state,
    pieces,
    lastMove,
    log,
    phase: 'wuerfeln',
    attempts: 0,
    turn: again ? seat : (seat + 1) % state.players,
  };
}

function roll(state: MaednState, seat: number): MaednState {
  const rng = { s: state.rng.s };
  const die = rollDie(rng);
  const rolled: MaednState = { ...state, rng, die, plies: state.plies + 1 };
  const legal = choicesFor(rolled, seat, die);
  if (legal.length === 1) return withLimit(execute(rolled, seat, legal[0]!));
  if (legal.length > 1) return withLimit({ ...rolled, phase: 'ziehen' });
  // Kein Zug möglich.
  const pcs = state.pieces[seat]!;
  if (die === 6) {
    return withLimit({
      ...rolled,
      log: pushLog(state.log, { seat, text: 'würfelt 6, kann aber nicht ziehen – noch einmal.' }),
    });
  }
  if (threeTriesMode(pcs) && state.attempts + 1 < 3) {
    const left = 2 - state.attempts;
    return withLimit({
      ...rolled,
      attempts: state.attempts + 1,
      log: pushLog(state.log, {
        seat,
        text: `würfelt ${die} – noch ${left === 1 ? 'ein Versuch' : `${left} Versuche`}.`,
      }),
    });
  }
  return withLimit({
    ...rolled,
    attempts: 0,
    turn: nextSeat(state),
    log: pushLog(state.log, { seat, text: `würfelt ${die} – kein Zug möglich.` }),
  });
}

function parseOptions(raw: unknown): MaednOptions | null {
  if (raw === undefined || raw === null) return { schlagpflicht: false };
  if (!isRecord(raw)) return null;
  const v = raw['schlagpflicht'] === undefined ? false : raw['schlagpflicht'];
  if (typeof v !== 'boolean') return null;
  return { schlagpflicht: v };
}

function parseMove(raw: unknown): MaednMove | null {
  if (!isRecord(raw)) return null;
  if (raw['type'] === 'wuerfeln') return { type: 'wuerfeln' };
  if (raw['type'] !== 'figur') return null;
  const piece = intIn(raw['piece'], 0, 3);
  return piece === null ? null : { type: 'figur', piece };
}

function applyMove(state: MaednState, seat: number, move: MaednMove): MoveResult<MaednState> {
  if (state.result) return { ok: false, error: 'Die Partie ist bereits vorbei.' };
  if (seat !== state.turn) return { ok: false, error: 'Du bist gerade nicht am Zug.' };
  if (move.type === 'wuerfeln') {
    if (state.phase !== 'wuerfeln')
      return { ok: false, error: 'Du hast schon gewürfelt – wähle eine Figur.' };
    return { ok: true, state: roll(state, seat) };
  }
  if (state.phase !== 'ziehen') return { ok: false, error: 'Erst würfeln.' };
  const legal = choicesFor(state, seat, state.die);
  const choice = legal.find((c) => c.piece === move.piece);
  if (!choice) {
    const raw = rawChoices(state, seat, state.die).some((c) => c.piece === move.piece);
    return {
      ok: false,
      error: raw
        ? 'Eine Pflicht geht vor (Rauskommen, Startfeld räumen oder Schlagen).'
        : 'Diese Figur kann nicht ziehen.',
    };
  }
  return {
    ok: true,
    state: withLimit(execute({ ...state, plies: state.plies + 1 }, seat, choice)),
  };
}

// ---------------------------------------------------------------------------
// Computergegner
// ---------------------------------------------------------------------------

/** Gegnerische Figuren, die ein Laufeld mit einem Wurf erreichen können. */
function threatsAt(state: MaednState, seat: number, field: number): number {
  const corners = cornersFor(state.players);
  let n = 0;
  for (let s = 0; s < state.players; s += 1) {
    if (s === seat) continue;
    const pcs = state.pieces[s]!;
    for (const rel of pcs) {
      if (rel < 0 || rel >= TRACK) continue;
      const dist = (field - absField(corners[s]!, rel) + TRACK) % TRACK;
      if (dist >= 1 && dist <= 6 && rel + dist < TRACK) n += 1;
    }
    // Wer auf seinem Startfeld steht, bekommt Besuch aus dem Haus.
    if (pcs.some((r) => r < 0) && field === absField(corners[s]!, 0)) n += 1;
  }
  return n;
}

function scoreChoice(state: MaednState, seat: number, c: MaednChoice, level: BotLevel): number {
  const corner = cornersFor(state.players)[seat]!;
  let score = c.to - Math.max(c.from, 0);
  if (c.captures !== null) {
    const victim = occupantAt(state, absField(corner, c.to));
    const victimRel = victim ? state.pieces[victim.seat]![victim.piece]! : 0;
    score += 40 + victimRel * (level === 'schwer' ? 0.8 : 0.3);
  }
  if (c.from < 0) score += 30;
  if (c.to >= GOAL_START) score += 35 + (c.to - GOAL_START) * 2;
  if (c.from >= 0 && c.from < TRACK) {
    score +=
      threatsAt(state, seat, absField(corner, c.from)) *
      (level === 'schwer' ? 14 : 8) *
      (1 + c.from / 40);
  }
  if (c.to < TRACK) {
    score -=
      threatsAt(state, seat, absField(corner, c.to)) *
      (level === 'schwer' ? 16 : 9) *
      (1 + c.to / 40);
    // Vor fremden Startfeldern stehen bleiben ist gefährlich.
    if (level === 'schwer') {
      const corners = cornersFor(state.players);
      for (let s = 0; s < state.players; s += 1) {
        if (
          s !== seat &&
          absField(corners[s]!, 0) === absField(corner, c.to) &&
          state.pieces[s]!.some((r) => r < 0)
        ) {
          score -= 12;
        }
      }
    }
  }
  return score;
}

function bot(state: MaednState, seat: number, level: BotLevel, rng: RngState): MaednMove {
  if (state.phase === 'wuerfeln') return { type: 'wuerfeln' };
  const legal = choicesFor(state, seat, state.die);
  if (legal.length === 0) return { type: 'wuerfeln' };
  if (level === 'leicht') return { type: 'figur', piece: legal[nextInt(rng, legal.length)]!.piece };
  let best = legal[0]!;
  let bestScore = -Infinity;
  for (const c of legal) {
    const v =
      scoreChoice(state, seat, c, level) +
      (level === 'mittel' ? nextInt(rng, 8) : nextInt(rng, 2) / 10);
    if (v > bestScore) {
      bestScore = v;
      best = c;
    }
  }
  return { type: 'figur', piece: best.piece };
}

export const game: TurnGame<MaednState, MaednMove, MaednOptions, MaednView> = {
  kind: 'turn',
  id: 'mensch-aergere-dich-nicht',
  version: 1,
  minPlayers: 2,
  maxPlayers: 4,
  defaultOptions: { schlagpflicht: false },
  parseOptions,
  hiddenInformation: false,
  setup: ({ players, seed, options }) => ({
    version: 1,
    players,
    schlagpflicht: options.schlagpflicht,
    pieces: Array.from({ length: players }, () => [-1, -1, -1, -1]),
    turn: 0,
    phase: 'wuerfeln',
    die: 0,
    attempts: 0,
    rng: { s: seed >>> 0 },
    plies: 0,
    lastMove: null,
    result: null,
    log: [{ seat: null, text: 'Neue Partie – Rot würfelt zuerst.' }],
  }),
  activeSeats: (state) => (state.result ? [] : [state.turn]),
  parseMove,
  applyMove,
  outcome: (state): TurnOutcome | null => {
    if (!state.result) return null;
    return {
      winners: state.result.winners,
      summary: state.result.summary,
      scores: state.pieces.map((p) => p.filter((r) => r >= GOAL_START).length),
    };
  },
  view: (state): MaednView => ({
    players: state.players,
    corners: cornersFor(state.players),
    pieces: state.pieces.map((p) => [...p]),
    turn: state.turn,
    phase: state.phase,
    die: state.die,
    attempts: state.attempts,
    threeTries: threeTriesMode(state.pieces[state.turn] ?? []),
    legal:
      !state.result && state.phase === 'ziehen' ? choicesFor(state, state.turn, state.die) : [],
    lastMove: state.lastMove,
    schlagpflicht: state.schlagpflicht,
    finished: state.result !== null,
  }),
  log: (state) => state.log.slice(-50),
  bot,
};
