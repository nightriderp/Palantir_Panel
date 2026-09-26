/**
 * Tetris („blockstapel") – ein Schritt alle 16 ms, alles in Schritten gezählt.
 *
 * Schwerkraft, Lock-Delay und die automatische Wiederholung beim Halten von
 * Links/Rechts (DAS/ARR) laufen über Zähler im Zustand statt über die Uhr.
 * Deshalb braucht die Oberfläche das Loslassen der Tasten als eigene Eingabe
 * (`RELEASE + Taste`): Nur so weiß die Logik, wie lange gehalten wurde.
 *
 * Belegung: Links/Rechts schieben, UP dreht rechts herum, eigene Eingabe
 * `BLOCK_INPUT_ROTATE_CCW` dreht links herum, DOWN ist weicher Fall solange
 * gehalten, ACTION harter Fall, ACTION2 halten.
 */

import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_ACTION2,
  ARCADE_INPUT_CUSTOM,
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RELEASE,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  type ArcadeInput,
  type RealtimeGame,
} from '../realtime.js';
import { createRng, shuffled, type RngState } from '../rng.js';

export const BOARD_COLS = 10;
/** 20 sichtbare Reihen plus zwei verdeckte darüber, in denen die Steine erscheinen. */
export const BOARD_ROWS = 22;
export const HIDDEN_ROWS = 2;

export const BLOCK_INPUT_ROTATE_CCW = ARCADE_INPUT_CUSTOM;

/** Steinarten 1–7; 0 ist ein leeres Feld. */
export const PIECE_NAMES = ['', 'I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

/** Grundlage jeder Steinart: Kastengröße und Felder in Lage 0. */
const SHAPES: readonly { n: number; cells: readonly (readonly [number, number])[] }[] = [
  { n: 0, cells: [] },
  {
    n: 4,
    cells: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  },
  {
    n: 2,
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
];

/** Felder einer Steinart in Lage `rot` (0–3), relativ zur Kastenecke. */
export function pieceCells(type: number, rot: number): [number, number][] {
  const shape = SHAPES[type];
  if (!shape) return [];
  let cells = shape.cells.map(([x, y]) => [x, y] as [number, number]);
  const turns = ((rot % 4) + 4) % 4;
  for (let t = 0; t < turns; t += 1) {
    // Rechtsdrehung im Kasten: (x, y) → (n-1-y, x).
    cells = cells.map(([x, y]) => [shape.n - 1 - y, x] as [number, number]);
  }
  return cells;
}

/*
 * Wandkicks nach dem verbreiteten Rotationssystem, y zeigt hier nach unten
 * (in der üblichen Schreibweise zeigt es nach oben, daher die Vorzeichen).
 */
type Kick = readonly [number, number];
const KICKS_JLSTZ: Record<string, readonly Kick[]> = {
  '01': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '10': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '12': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '21': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '23': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '32': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '30': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '03': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
};
const KICKS_I: Record<string, readonly Kick[]> = {
  '01': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2],
  ],
  '10': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2],
  ],
  '12': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1],
  ],
  '21': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1],
  ],
  '23': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2],
  ],
  '32': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2],
  ],
  '30': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1],
  ],
  '03': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1],
  ],
};

/** Schritte je Reihe Fall, nach Level (1-basiert); danach 1. */
const GRAVITY = [48, 42, 36, 30, 25, 20, 16, 12, 9, 7, 6, 5, 5, 4, 4, 3, 3, 2, 2, 2];
/** Weicher Fall: eine Reihe alle so viele Schritte. */
const SOFT_DROP_FRAMES = 2;
/** Verzögerung bis zur automatischen Wiederholung und deren Abstand, in Schritten. */
export const DAS_FRAMES = 10;
export const ARR_FRAMES = 2;
/** Zeit am Boden, bevor der Stein festsitzt. */
export const LOCK_DELAY = 30;
/** So oft darf Bewegen am Boden die Frist neu starten – sonst ließe sich ewig schieben. */
const MAX_LOCK_RESETS = 15;
/** Dauer des Aufleuchtens voller Reihen. */
export const CLEAR_FRAMES = 18;
const LINE_POINTS = [0, 100, 300, 500, 800];

export interface ActivePiece {
  type: number;
  rot: number;
  x: number;
  y: number;
}

export interface BlockState {
  version: 1;
  rng: RngState;
  /** Feld zeilenweise, `BOARD_COLS * BOARD_ROWS`, 0 leer, sonst Steinart. */
  board: number[];
  piece: ActivePiece | null;
  /** Kommende Steine (mindestens sieben vorrätig). */
  queue: number[];
  hold: number;
  /** Halten ist einmal je Stein erlaubt. */
  holdUsed: boolean;
  score: number;
  lines: number;
  level: number;
  gravityCounter: number;
  softDrop: boolean;
  /** -1 links, 1 rechts, 0 keine Richtung gehalten. */
  shiftDir: number;
  shiftTimer: number;
  lockTimer: number;
  lockResets: number;
  /** Reihen, die gerade aufleuchten, bevor sie verschwinden. */
  clearRows: number[];
  clearTimer: number;
  over: boolean;
  ticks: number;
  // Zähler für Geräusche und Einblendungen der Oberfläche.
  locks: number;
  clears: number;
  lastClear: number;
  hardDrops: number;
  rotations: number;
}

function refillQueue(state: BlockState): void {
  while (state.queue.length < 7) {
    state.queue.push(...shuffled(state.rng, [1, 2, 3, 4, 5, 6, 7]));
  }
}

function cellAt(state: BlockState, x: number, y: number): number {
  if (x < 0 || x >= BOARD_COLS || y >= BOARD_ROWS) return 8;
  if (y < 0) return 0;
  return state.board[y * BOARD_COLS + x] ?? 8;
}

export function fits(state: BlockState, piece: ActivePiece): boolean {
  for (const [cx, cy] of pieceCells(piece.type, piece.rot)) {
    if (cellAt(state, piece.x + cx, piece.y + cy) !== 0) return false;
  }
  return true;
}

function spawnX(type: number): number {
  return type === 2 ? 4 : 3;
}

/** Nächsten Stein ins Feld setzen. Passt er nicht mehr hinein, ist die Partie aus. */
function spawn(state: BlockState, type?: number): void {
  let next = type;
  if (next === undefined) {
    refillQueue(state);
    next = state.queue.shift() ?? 1;
    refillQueue(state);
  }
  const piece: ActivePiece = { type: next, rot: 0, x: spawnX(next), y: 0 };
  state.lockTimer = 0;
  state.lockResets = 0;
  state.gravityCounter = 0;
  if (!fits(state, piece)) {
    state.piece = null;
    state.over = true;
    return;
  }
  // Gleich eine Reihe tiefer, damit der Stein sofort sichtbar ist – wenn Platz ist.
  const lower = { ...piece, y: 1 };
  state.piece = fits(state, lower) ? lower : piece;
}

function gravityFrames(level: number): number {
  return GRAVITY[level - 1] ?? 1;
}

function grounded(state: BlockState, piece: ActivePiece): boolean {
  return !fits(state, { ...piece, y: piece.y + 1 });
}

/** Erfolgreiche Bewegung am Boden verlängert die Frist – begrenzt oft. */
function afterMove(state: BlockState): void {
  const piece = state.piece;
  if (!piece) return;
  if (grounded(state, piece) && state.lockResets < MAX_LOCK_RESETS) {
    state.lockTimer = 0;
    state.lockResets += 1;
  }
}

function tryShift(state: BlockState, dx: number): boolean {
  const piece = state.piece;
  if (!piece) return false;
  const moved = { ...piece, x: piece.x + dx };
  if (!fits(state, moved)) return false;
  state.piece = moved;
  afterMove(state);
  return true;
}

function tryRotate(state: BlockState, dir: 1 | -1): boolean {
  const piece = state.piece;
  if (!piece || piece.type === 2) return false;
  const to = (((piece.rot + dir) % 4) + 4) % 4;
  const table = piece.type === 1 ? KICKS_I : KICKS_JLSTZ;
  const kicks = table[`${piece.rot}${to}`] ?? [[0, 0]];
  for (const [kx, ky] of kicks) {
    const moved = { type: piece.type, rot: to, x: piece.x + kx, y: piece.y + ky };
    if (fits(state, moved)) {
      state.piece = moved;
      state.rotations += 1;
      afterMove(state);
      return true;
    }
  }
  return false;
}

/** Tiefste Lage, in der der Stein noch passt (auch für den Schatten). */
export function dropDistance(state: BlockState, piece: ActivePiece): number {
  let d = 0;
  while (fits(state, { ...piece, y: piece.y + d + 1 })) d += 1;
  return d;
}

function lockPiece(state: BlockState): void {
  const piece = state.piece;
  if (!piece) return;
  let visible = false;
  for (const [cx, cy] of pieceCells(piece.type, piece.rot)) {
    const x = piece.x + cx;
    const y = piece.y + cy;
    if (y >= 0 && y < BOARD_ROWS && x >= 0 && x < BOARD_COLS) {
      state.board[y * BOARD_COLS + x] = piece.type;
    }
    if (y >= HIDDEN_ROWS) visible = true;
  }
  state.piece = null;
  state.locks += 1;
  state.holdUsed = false;
  // Ganz über dem Sichtfeld abgelegt: Der Stapel ist übergelaufen.
  if (!visible) {
    state.over = true;
    return;
  }
  const full: number[] = [];
  for (let y = 0; y < BOARD_ROWS; y += 1) {
    let complete = true;
    for (let x = 0; x < BOARD_COLS; x += 1) {
      if ((state.board[y * BOARD_COLS + x] ?? 0) === 0) {
        complete = false;
        break;
      }
    }
    if (complete) full.push(y);
  }
  if (full.length > 0) {
    state.score += (LINE_POINTS[full.length] ?? 800) * state.level;
    state.clearRows = full;
    state.clearTimer = CLEAR_FRAMES;
    state.clears += 1;
    state.lastClear = full.length;
    return;
  }
  spawn(state);
}

function collapseRows(state: BlockState): void {
  const rows = new Set(state.clearRows);
  const kept: number[] = [];
  for (let y = 0; y < BOARD_ROWS; y += 1) {
    if (rows.has(y)) continue;
    for (let x = 0; x < BOARD_COLS; x += 1) kept.push(state.board[y * BOARD_COLS + x] ?? 0);
  }
  const empty = new Array<number>(rows.size * BOARD_COLS).fill(0);
  state.board = [...empty, ...kept];
  state.lines += rows.size;
  state.level = 1 + Math.floor(state.lines / 10);
  state.clearRows = [];
}

function hardDrop(state: BlockState): void {
  const piece = state.piece;
  if (!piece) return;
  const d = dropDistance(state, piece);
  state.piece = { ...piece, y: piece.y + d };
  state.score += d * 2;
  state.hardDrops += 1;
  lockPiece(state);
}

function holdPiece(state: BlockState): void {
  const piece = state.piece;
  if (!piece || state.holdUsed) return;
  const previous = state.hold;
  state.hold = piece.type;
  state.holdUsed = true;
  if (previous === 0) spawn(state);
  else spawn(state, previous);
  // `spawn` setzt nichts zurück, was Halten betrifft – einmal je Stein bleibt einmal.
  state.holdUsed = true;
}

/** Tasteneingaben; Drücken und Loslassen der Schiebetasten gelten auch in der Aufleuchtpause. */
function handleInput(state: BlockState, input: ArcadeInput): void {
  const active = state.piece !== null;
  switch (input) {
    case ARCADE_INPUT_LEFT:
    case ARCADE_INPUT_RIGHT: {
      const dx = input === ARCADE_INPUT_LEFT ? -1 : 1;
      state.shiftDir = dx;
      state.shiftTimer = 0;
      if (active) tryShift(state, dx);
      return;
    }
    case ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE:
      if (state.shiftDir === -1) state.shiftDir = 0;
      return;
    case ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE:
      if (state.shiftDir === 1) state.shiftDir = 0;
      return;
    case ARCADE_INPUT_DOWN:
      state.softDrop = true;
      return;
    case ARCADE_INPUT_DOWN + ARCADE_INPUT_RELEASE:
      state.softDrop = false;
      return;
    case ARCADE_INPUT_UP:
      if (active) tryRotate(state, 1);
      return;
    case BLOCK_INPUT_ROTATE_CCW:
      if (active) tryRotate(state, -1);
      return;
    case ARCADE_INPUT_ACTION:
      if (active) hardDrop(state);
      return;
    case ARCADE_INPUT_ACTION2:
      if (active) holdPiece(state);
      return;
    default:
      return;
  }
}

function create(seed: number): BlockState {
  const state: BlockState = {
    version: 1,
    rng: createRng(seed),
    board: new Array<number>(BOARD_COLS * BOARD_ROWS).fill(0),
    piece: null,
    queue: [],
    hold: 0,
    holdUsed: false,
    score: 0,
    lines: 0,
    level: 1,
    gravityCounter: 0,
    softDrop: false,
    shiftDir: 0,
    shiftTimer: 0,
    lockTimer: 0,
    lockResets: 0,
    clearRows: [],
    clearTimer: 0,
    over: false,
    ticks: 0,
    locks: 0,
    clears: 0,
    lastClear: 0,
    hardDrops: 0,
    rotations: 0,
  };
  spawn(state);
  return state;
}

function step(state: BlockState, input: ArcadeInput): BlockState {
  if (state.over) return state;
  state.ticks += 1;

  handleInput(state, input);
  if (state.over) return state;

  if (state.clearTimer > 0) {
    state.clearTimer -= 1;
    if (state.clearTimer === 0) {
      collapseRows(state);
      spawn(state);
    }
    return state;
  }

  const piece0 = state.piece;
  if (!piece0) return state;

  // Automatische Wiederholung: erste Bewegung kam mit dem Drücken, dann warten, dann rasch.
  if (state.shiftDir !== 0 && input !== ARCADE_INPUT_LEFT && input !== ARCADE_INPUT_RIGHT) {
    state.shiftTimer += 1;
    if (state.shiftTimer >= DAS_FRAMES && (state.shiftTimer - DAS_FRAMES) % ARR_FRAMES === 0) {
      tryShift(state, state.shiftDir);
    }
  }

  const frames = state.softDrop
    ? Math.min(SOFT_DROP_FRAMES, gravityFrames(state.level))
    : gravityFrames(state.level);
  state.gravityCounter += 1;
  if (state.gravityCounter >= frames) {
    state.gravityCounter = 0;
    const current = state.piece;
    if (current && !grounded(state, current)) {
      state.piece = { ...current, y: current.y + 1 };
      if (state.softDrop) state.score += 1;
    }
  }

  const current = state.piece;
  if (!current) return state;
  if (grounded(state, current)) {
    state.lockTimer += 1;
    if (state.lockTimer >= LOCK_DELAY) lockPiece(state);
  } else {
    state.lockTimer = 0;
  }
  return state;
}

export const game: RealtimeGame<BlockState> = {
  kind: 'realtime',
  id: 'blockstapel',
  version: 1,
  create,
  step,
  isOver: (state) => state.over,
  score: (state) => Math.max(0, Math.floor(state.score)),
  tickMs: () => 16,
};
