/**
 * Snake („kriechpfad") – feste Schritte, ein Schritt ist genau ein Feld.
 *
 * Das Tempo steckt nicht in der Logik, sondern in `tickMs`: Je länger die
 * Schlange, desto kürzer der Schritt auf dem Bildschirm. So bleibt das
 * Nachrechnen im Backend unabhängig vom Tempo, und die Eingabe wirkt immer
 * auf den nächsten Zug.
 */

import {
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  oppositeDirection,
  type ArcadeInput,
  type RealtimeGame,
} from '../realtime.js';
import { createRng, nextInt, type RngState } from '../rng.js';

export const SNAKE_COLS = 24;
export const SNAKE_ROWS = 20;
const START_LENGTH = 4;
/** Nach so vielen normalen Häppchen taucht ein Bonus auf. */
const BONUS_EVERY = 5;
/** Lebensdauer des Bonus in Schritten. */
export const BONUS_TTL = 60;

export interface SnakeBonus {
  x: number;
  y: number;
  ttl: number;
}

export interface SnakeState {
  version: 1;
  rng: RngState;
  /** Glieder als [x, y], Kopf zuerst. */
  body: [number, number][];
  /** Aktuelle Richtung als Eingabe-Konstante (UP/RIGHT/DOWN/LEFT). */
  dir: ArcadeInput;
  food: [number, number];
  bonus: SnakeBonus | null;
  /** Ausstehendes Wachstum in Gliedern. */
  grow: number;
  score: number;
  /** Gefressene normale Häppchen (für Bonus-Takt und Geräusche). */
  eaten: number;
  /** Gefressene Boni (nur für Geräusche und Anzeige). */
  bonusEaten: number;
  /** Punkte des letzten Bonus, für die Einblendung. */
  lastBonusPoints: number;
  ticks: number;
  over: boolean;
  /** Feld voll – gewonnen statt gegen die Wand. */
  won: boolean;
}

const DELTA: Record<number, [number, number]> = {
  [ARCADE_INPUT_UP]: [0, -1],
  [ARCADE_INPUT_RIGHT]: [1, 0],
  [ARCADE_INPUT_DOWN]: [0, 1],
  [ARCADE_INPUT_LEFT]: [-1, 0],
};

function isDirection(input: ArcadeInput): boolean {
  return (
    input === ARCADE_INPUT_UP ||
    input === ARCADE_INPUT_RIGHT ||
    input === ARCADE_INPUT_DOWN ||
    input === ARCADE_INPUT_LEFT
  );
}

/** Wert eines normalen Häppchens – steigt in Stufen mit der Länge. */
export function foodValue(length: number): number {
  return 10 * (1 + Math.floor(Math.max(0, length - START_LENGTH) / 8));
}

/** Wert eines Bonus: je schneller geschnappt, desto mehr. */
export function bonusValue(ttl: number): number {
  return 30 + ttl * 2;
}

function occupied(state: SnakeState, x: number, y: number): boolean {
  for (const [bx, by] of state.body) if (bx === x && by === y) return true;
  if (state.food[0] === x && state.food[1] === y) return true;
  if (state.bonus && state.bonus.x === x && state.bonus.y === y) return true;
  return false;
}

/** Zufälliges freies Feld; `null`, wenn keins mehr frei ist. */
function freeCell(state: SnakeState): [number, number] | null {
  const free: [number, number][] = [];
  for (let y = 0; y < SNAKE_ROWS; y += 1) {
    for (let x = 0; x < SNAKE_COLS; x += 1) {
      if (!occupied(state, x, y)) free.push([x, y]);
    }
  }
  if (free.length === 0) return null;
  return free[nextInt(state.rng, free.length)] ?? null;
}

function create(seed: number): SnakeState {
  const y = Math.floor(SNAKE_ROWS / 2);
  const body: [number, number][] = [];
  for (let i = 0; i < START_LENGTH; i += 1) body.push([6 - i, y]);
  const state: SnakeState = {
    version: 1,
    rng: createRng(seed),
    body,
    dir: ARCADE_INPUT_RIGHT,
    food: [-1, -1],
    bonus: null,
    grow: 0,
    score: 0,
    eaten: 0,
    bonusEaten: 0,
    lastBonusPoints: 0,
    ticks: 0,
    over: false,
    won: false,
  };
  state.food = freeCell(state) ?? [0, 0];
  return state;
}

function step(state: SnakeState, input: ArcadeInput): SnakeState {
  if (state.over) return state;
  state.ticks += 1;

  // Wende um 180° wäre sofortiger Selbstbiss – die Eingabe verfällt einfach.
  if (isDirection(input) && input !== oppositeDirection(state.dir)) {
    state.dir = input;
  }

  const head = state.body[0];
  const delta = DELTA[state.dir];
  if (!head || !delta) {
    state.over = true;
    return state;
  }
  const nx = head[0] + delta[0];
  const ny = head[1] + delta[1];

  if (nx < 0 || ny < 0 || nx >= SNAKE_COLS || ny >= SNAKE_ROWS) {
    state.over = true;
    return state;
  }
  // Das Schwanzende rückt in diesem Schritt weiter, sofern nicht gewachsen wird.
  const checkLength = state.grow > 0 ? state.body.length : state.body.length - 1;
  for (let i = 0; i < checkLength; i += 1) {
    const cell = state.body[i];
    if (cell && cell[0] === nx && cell[1] === ny) {
      state.over = true;
      return state;
    }
  }

  state.body.unshift([nx, ny]);
  if (state.grow > 0) state.grow -= 1;
  else state.body.pop();

  if (state.bonus) {
    if (state.bonus.x === nx && state.bonus.y === ny) {
      const points = bonusValue(state.bonus.ttl);
      state.score += points;
      state.lastBonusPoints = points;
      state.bonusEaten += 1;
      state.grow += 3;
      state.bonus = null;
    } else {
      state.bonus.ttl -= 1;
      if (state.bonus.ttl <= 0) state.bonus = null;
    }
  }

  if (state.food[0] === nx && state.food[1] === ny) {
    state.score += foodValue(state.body.length);
    state.eaten += 1;
    state.grow += 1;
    state.food = [-1, -1];
    if (state.eaten % BONUS_EVERY === 0 && !state.bonus) {
      const cell = freeCell(state);
      if (cell) state.bonus = { x: cell[0], y: cell[1], ttl: BONUS_TTL };
    }
    const next = freeCell(state);
    if (next) {
      state.food = next;
    } else {
      // Kein Platz mehr fürs nächste Häppchen: Das Feld ist voll, Partie gewonnen.
      state.won = true;
      state.over = true;
      state.score += 1000;
    }
  }
  return state;
}

/** Schrittdauer: ab Länge 4 mit jedem Glied etwas schneller, bis zur Untergrenze. */
export function snakeTickMs(length: number): number {
  return Math.max(55, Math.round(135 - (length - START_LENGTH) * 2.5));
}

export const game: RealtimeGame<SnakeState> = {
  kind: 'realtime',
  id: 'kriechpfad',
  version: 1,
  create,
  step,
  isOver: (state) => state.over,
  score: (state) => Math.max(0, Math.floor(state.score)),
  tickMs: (state) => snakeTickMs(state.body.length),
};
