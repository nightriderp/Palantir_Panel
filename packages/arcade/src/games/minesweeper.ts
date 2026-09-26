/**
 * Minesweeper – hochkant für das Handy: 10 Spalten × 14 Zeilen, 22 Minen.
 *
 * Die Minen werden erst beim ersten Aufdecken gelegt, und zwar nie auf das
 * Startfeld oder seine Nachbarn. Der erste Tipp öffnet so immer eine Fläche,
 * und niemand verliert, bevor er überhaupt nachdenken konnte.
 *
 * Die Zeit läuft in Schritten zu 100 ms, aber nur während der Partie: Vor dem
 * ersten Tipp und nach dem Ende meldet `tickMs` 0, der Wirt steht dann still.
 * So misst das Band genau die Denkzeit, die auch das Backend nachrechnet.
 *
 * Eingabe: `ARCADE_INPUT_CUSTOM + Feld * 2 + (Fahne ? 1 : 0)`.
 */

import { ARCADE_INPUT_CUSTOM, type RealtimeGame } from '../realtime.js';
import { type RngState, createRng, nextInt } from '../rng.js';

export const MINES_COLS = 10;
export const MINES_ROWS = 14;
export const MINES_COUNT = 22;
const CELLS = MINES_COLS * MINES_ROWS;
/** Schritte je Sekunde (bei 100 ms je Schritt). */
const TICKS_PER_SECOND = 10;
/** Nach einer Stunde ist Schluss – eine Partie muss enden können. */
const MAX_PLAY_TICKS = 3600 * TICKS_PER_SECOND;

/** Feldzustand: verdeckt, aufgedeckt, mit Fahne. */
export const CELL_HIDDEN = 0;
export const CELL_OPEN = 1;
export const CELL_FLAG = 2;

export interface MinesweeperState {
  phase: 'ready' | 'play' | 'won' | 'lost';
  /** 1 = Mine. Bis zum ersten Aufdecken alles 0. */
  mines: number[];
  /** Anzahl Minen ringsum, erst nach dem Legen gefüllt. */
  counts: number[];
  cells: number[];
  rng: RngState;
  /** Spielzeit in Schritten. */
  ticks: number;
  opened: number;
  flags: number;
  /** Feld der ausgelösten Mine, -1 = keine. */
  exploded: number;
  /** Zähler wirksamer Aktionen – für Geräusche und Animation. */
  actions: number;
}

export function neighbours(cell: number): number[] {
  const x = cell % MINES_COLS;
  const y = Math.floor(cell / MINES_COLS);
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MINES_COLS || ny >= MINES_ROWS) continue;
      result.push(ny * MINES_COLS + nx);
    }
  }
  return result;
}

function layMines(state: MinesweeperState, start: number): void {
  const forbidden = new Array<boolean>(CELLS).fill(false);
  forbidden[start] = true;
  for (const n of neighbours(start)) forbidden[n] = true;
  const candidates: number[] = [];
  for (let i = 0; i < CELLS; i += 1) if (!forbidden[i]) candidates.push(i);
  for (let placed = 0; placed < MINES_COUNT && candidates.length > 0; placed += 1) {
    const k = nextInt(state.rng, candidates.length);
    const cell = candidates[k] as number;
    candidates[k] = candidates[candidates.length - 1] as number;
    candidates.pop();
    state.mines[cell] = 1;
  }
  for (let i = 0; i < CELLS; i += 1) {
    let count = 0;
    for (const n of neighbours(i)) count += state.mines[n] ?? 0;
    state.counts[i] = count;
  }
}

/** Deckt ein Feld auf und flutet leere Flächen; `false`, wenn es eine Mine war. */
function open(state: MinesweeperState, cell: number): boolean {
  if (state.cells[cell] !== CELL_HIDDEN) return true;
  if (state.mines[cell] === 1) {
    state.cells[cell] = CELL_OPEN;
    state.exploded = cell;
    return false;
  }
  // Eigener Stapel statt Rekursion: Eine große leere Fläche soll keinen tiefen Aufrufstapel bauen.
  const stack = [cell];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    if (state.cells[current] !== CELL_HIDDEN) continue;
    state.cells[current] = CELL_OPEN;
    state.opened += 1;
    if (state.counts[current] === 0) {
      for (const n of neighbours(current)) if (state.cells[n] === CELL_HIDDEN) stack.push(n);
    }
  }
  return true;
}

function finishIfWon(state: MinesweeperState): void {
  if (state.opened === CELLS - MINES_COUNT) {
    state.phase = 'won';
    // Im Sieg setzen wir die Fahnen selbst – das Feld soll fertig aussehen.
    for (let i = 0; i < CELLS; i += 1) {
      if (state.mines[i] === 1 && state.cells[i] !== CELL_FLAG) {
        state.cells[i] = CELL_FLAG;
        state.flags += 1;
      }
    }
  }
}

function lose(state: MinesweeperState): void {
  state.phase = 'lost';
}

/** Akkord: Zahl mit passend vielen Fahnen ringsum deckt alle übrigen Nachbarn auf. */
function chord(state: MinesweeperState, cell: number): boolean {
  const count = state.counts[cell] ?? 0;
  if (count === 0) return false;
  const around = neighbours(cell);
  const flagged = around.filter((n) => state.cells[n] === CELL_FLAG).length;
  if (flagged !== count) return false;
  let acted = false;
  for (const n of around) {
    if (state.cells[n] !== CELL_HIDDEN) continue;
    acted = true;
    if (!open(state, n)) {
      lose(state);
      return true;
    }
  }
  return acted;
}

export function minesweeperScore(state: MinesweeperState): number {
  if (state.phase !== 'won') return 0;
  const seconds = Math.floor(state.ticks / TICKS_PER_SECOND);
  return Math.max(100, 10000 - seconds * 20);
}

export const game: RealtimeGame<MinesweeperState> = {
  kind: 'realtime',
  id: 'minesweeper',
  version: 1,
  create(seed) {
    return {
      phase: 'ready',
      mines: new Array<number>(CELLS).fill(0),
      counts: new Array<number>(CELLS).fill(0),
      cells: new Array<number>(CELLS).fill(CELL_HIDDEN),
      rng: createRng(seed),
      ticks: 0,
      opened: 0,
      flags: 0,
      exploded: -1,
      actions: 0,
    };
  },
  step(state, input) {
    if (state.phase === 'won' || state.phase === 'lost') return state;
    if (state.phase === 'play') {
      state.ticks += 1;
      if (state.ticks >= MAX_PLAY_TICKS) {
        lose(state);
        return state;
      }
    }
    const code = input - ARCADE_INPUT_CUSTOM;
    if (code < 0 || code >= CELLS * 2) return state;
    const cell = Math.floor(code / 2);
    const flag = code % 2 === 1;
    const current = state.cells[cell];

    if (flag) {
      if (current === CELL_HIDDEN) {
        state.cells[cell] = CELL_FLAG;
        state.flags += 1;
        state.actions += 1;
      } else if (current === CELL_FLAG) {
        state.cells[cell] = CELL_HIDDEN;
        state.flags -= 1;
        state.actions += 1;
      } else if (state.phase === 'play' && chord(state, cell)) {
        state.actions += 1;
        finishIfWon(state);
      }
      return state;
    }

    if (current === CELL_FLAG) return state;
    if (current === CELL_OPEN) {
      if (state.phase === 'play' && chord(state, cell)) {
        state.actions += 1;
        finishIfWon(state);
      }
      return state;
    }
    if (state.phase === 'ready') {
      layMines(state, cell);
      state.phase = 'play';
    }
    state.actions += 1;
    if (!open(state, cell)) {
      lose(state);
      return state;
    }
    finishIfWon(state);
    return state;
  },
  isOver: (state) => state.phase === 'won' || state.phase === 'lost',
  score: minesweeperScore,
  tickMs: (state) => (state.phase === 'play' ? 1000 / TICKS_PER_SECOND : 0),
};
