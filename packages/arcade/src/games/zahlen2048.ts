/**
 * 2048 – Kacheln schieben und verschmelzen.
 *
 * Eingabegetrieben (`tickMs` 0): Jeder Schritt mit einer Richtung ist ein Zug.
 * Ein Zug, der nichts bewegt, verbraucht keine neue Kachel – sonst ließe sich
 * das Feld durch Leerzüge „auffüllen" und die Partie würde vom Zufall statt
 * vom Spieler entschieden.
 *
 * Für die Zeichenschicht hält der Zustand fest, was der letzte Zug bewegt hat
 * (`slides`, `merged`, `spawned`) und zählt die Züge hoch. So kann sie
 * Gleiten und Aufploppen animieren, ohne selbst Spiellogik nachzurechnen.
 */

import {
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  type ArcadeInput,
  type RealtimeGame,
} from '../realtime.js';
import { type RngState, createRng, nextInt, nextRandom } from '../rng.js';

export const SIZE_2048 = 4;
const CELLS = SIZE_2048 * SIZE_2048;

export interface Zahlen2048State {
  /** Zeilenweise, 0 = leer, sonst der Kachelwert. */
  grid: number[];
  score: number;
  rng: RngState;
  over: boolean;
  /** Anzahl wirksamer Züge – Schlüssel für die Animation. */
  moves: number;
  /** Höchste erreichte Kachel. */
  best: number;
  /** Letzter Zug: je Kachel [von, nach, Wert vor dem Verschmelzen], flach hintereinander. */
  slides: number[];
  /** Felder, auf denen im letzten Zug etwas verschmolzen ist. */
  merged: number[];
  /** Feld der neu erschienenen Kachel, -1 = keine. */
  spawned: number;
}

function emptyCells(grid: readonly number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < grid.length; i += 1) if (grid[i] === 0) result.push(i);
  return result;
}

/** Neue Kachel: 90 % eine 2, 10 % eine 4 – wie im Original-Gefühl, aber aus dem eigenen Zufall. */
function spawn(state: Zahlen2048State): number {
  const free = emptyCells(state.grid);
  if (free.length === 0) return -1;
  const cell = free[nextInt(state.rng, free.length)] as number;
  state.grid[cell] = nextRandom(state.rng) < 0.9 ? 2 : 4;
  return cell;
}

/**
 * Die vier Zellen einer Linie, beginnend an der Kante, zu der geschoben wird.
 * Damit reicht ein einziger Verschmelze-Durchlauf für alle vier Richtungen.
 */
function line(direction: ArcadeInput, index: number): number[] {
  const cells: number[] = [];
  for (let k = 0; k < SIZE_2048; k += 1) {
    if (direction === ARCADE_INPUT_LEFT) cells.push(index * SIZE_2048 + k);
    else if (direction === ARCADE_INPUT_RIGHT) cells.push(index * SIZE_2048 + (SIZE_2048 - 1 - k));
    else if (direction === ARCADE_INPUT_UP) cells.push(k * SIZE_2048 + index);
    else cells.push((SIZE_2048 - 1 - k) * SIZE_2048 + index);
  }
  return cells;
}

interface ShiftResult {
  grid: number[];
  gained: number;
  slides: number[];
  merged: number[];
  changed: boolean;
}

function shift(grid: readonly number[], direction: ArcadeInput): ShiftResult {
  const next = new Array<number>(CELLS).fill(0);
  const slides: number[] = [];
  const merged: number[] = [];
  let gained = 0;
  let changed = false;
  for (let i = 0; i < SIZE_2048; i += 1) {
    const cells = line(direction, i);
    let target = 0;
    // Wert und Herkunft der Kachel, die gerade am Ziel liegt und noch verschmelzen darf.
    let openValue = 0;
    for (const from of cells) {
      const value = grid[from] ?? 0;
      if (value === 0) continue;
      if (openValue === value) {
        const dest = cells[target - 1] as number;
        next[dest] = value * 2;
        gained += value * 2;
        merged.push(dest);
        slides.push(from, dest, value);
        if (from !== dest) changed = true;
        openValue = 0;
      } else {
        const dest = cells[target] as number;
        next[dest] = value;
        slides.push(from, dest, value);
        if (from !== dest) changed = true;
        openValue = value;
        target += 1;
      }
    }
  }
  return { grid: next, gained, slides, merged, changed };
}

/** Gibt es überhaupt noch einen Zug? */
export function canMove2048(grid: readonly number[]): boolean {
  for (let i = 0; i < CELLS; i += 1) {
    const value = grid[i] ?? 0;
    if (value === 0) return true;
    const col = i % SIZE_2048;
    if (col < SIZE_2048 - 1 && grid[i + 1] === value) return true;
    if (i + SIZE_2048 < CELLS && grid[i + SIZE_2048] === value) return true;
  }
  return false;
}

export const game: RealtimeGame<Zahlen2048State> = {
  kind: 'realtime',
  id: 'zahlen2048',
  version: 1,
  create(seed) {
    const state: Zahlen2048State = {
      grid: new Array<number>(CELLS).fill(0),
      score: 0,
      rng: createRng(seed),
      over: false,
      moves: 0,
      best: 0,
      slides: [],
      merged: [],
      spawned: -1,
    };
    spawn(state);
    state.spawned = spawn(state);
    state.best = Math.max(...state.grid);
    return state;
  },
  step(state, input) {
    if (state.over) return state;
    if (
      input !== ARCADE_INPUT_UP &&
      input !== ARCADE_INPUT_DOWN &&
      input !== ARCADE_INPUT_LEFT &&
      input !== ARCADE_INPUT_RIGHT
    ) {
      return state;
    }
    const result = shift(state.grid, input);
    if (!result.changed) return state;
    state.grid = result.grid;
    state.score += result.gained;
    state.slides = result.slides;
    state.merged = result.merged;
    state.moves += 1;
    state.spawned = spawn(state);
    state.best = Math.max(state.best, ...state.grid);
    if (!canMove2048(state.grid)) state.over = true;
    return state;
  },
  isOver: (state) => state.over,
  score: (state) => state.score,
  tickMs: () => 0,
};
