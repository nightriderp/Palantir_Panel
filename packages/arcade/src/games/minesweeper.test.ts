import { describe, expect, it } from 'vitest';
import { ARCADE_INPUT_CUSTOM, ArcadeRecorder, runArcadeReplay } from '../realtime.js';
import {
  CELL_FLAG,
  CELL_HIDDEN,
  CELL_OPEN,
  MINES_COLS,
  MINES_COUNT,
  MINES_ROWS,
  game,
  neighbours,
  type MinesweeperState,
} from './minesweeper.js';

const CELLS = MINES_COLS * MINES_ROWS;
const reveal = (cell: number) => ARCADE_INPUT_CUSTOM + cell * 2;
const flag = (cell: number) => ARCADE_INPUT_CUSTOM + cell * 2 + 1;

/** Löst die Partie mit Wissen über die Minen – für Sieg und Punkte. */
function solve(state: MinesweeperState, rec?: ArcadeRecorder, startTick = 0): number {
  let tick = startTick;
  for (let i = 0; i < CELLS && !game.isOver(state); i += 1) {
    if (state.mines[i] === 1 || state.cells[i] !== CELL_HIDDEN) continue;
    rec?.record(tick, reveal(i));
    game.step(state, reveal(i));
    tick += 1;
  }
  return tick;
}

describe('Minesweeper', () => {
  it('der erste Klick ist immer sicher und öffnet eine Fläche', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const state = game.create(seed);
      const start = (seed * 13) % CELLS;
      game.step(state, reveal(start));
      expect(state.phase).toBe('play');
      expect(state.mines.reduce((a, b) => a + b, 0)).toBe(MINES_COUNT);
      expect(state.mines[start]).toBe(0);
      for (const n of neighbours(start)) expect(state.mines[n]).toBe(0);
      expect(state.counts[start]).toBe(0);
      expect(state.opened).toBeGreaterThan(1);
    }
  });

  it('Zeit läuft nur während der Partie', () => {
    const state = game.create(1);
    expect(game.tickMs(state)).toBe(0);
    game.step(state, 0);
    expect(state.ticks).toBe(0);
    game.step(state, reveal(70));
    expect(game.tickMs(state)).toBe(100);
    game.step(state, 0);
    game.step(state, 0);
    expect(state.ticks).toBe(2);
  });

  it('Fahnen setzen und entfernen, Fahne schützt vor Aufdecken', () => {
    const state = game.create(2);
    game.step(state, reveal(0));
    const hidden = state.cells.findIndex((c) => c === CELL_HIDDEN);
    game.step(state, flag(hidden));
    expect(state.cells[hidden]).toBe(CELL_FLAG);
    expect(state.flags).toBe(1);
    game.step(state, reveal(hidden));
    expect(state.cells[hidden]).toBe(CELL_FLAG);
    game.step(state, flag(hidden));
    expect(state.cells[hidden]).toBe(CELL_HIDDEN);
    expect(state.flags).toBe(0);
  });

  it('Mine aufdecken beendet die Partie ohne Punkte', () => {
    const state = game.create(3);
    game.step(state, reveal(0));
    const mine = state.mines.indexOf(1);
    game.step(state, reveal(mine));
    expect(state.phase).toBe('lost');
    expect(state.exploded).toBe(mine);
    expect(game.score(state)).toBe(0);
    expect(game.tickMs(state)).toBe(0);
  });

  it('Akkord deckt die Nachbarn einer Zahl auf', () => {
    const state = game.create(4);
    game.step(state, reveal(75));
    const numbered = state.cells.findIndex(
      (c, i) =>
        c === CELL_OPEN &&
        (state.counts[i] ?? 0) > 0 &&
        neighbours(i).some((n) => state.cells[n] === CELL_HIDDEN && state.mines[n] === 0),
    );
    expect(numbered).toBeGreaterThanOrEqual(0);
    for (const n of neighbours(numbered)) if (state.mines[n] === 1) game.step(state, flag(n));
    const before = state.opened;
    game.step(state, reveal(numbered));
    expect(state.opened).toBeGreaterThan(before);
    expect(state.phase).not.toBe('lost');
  });

  it('Sieg gibt zeitabhängige Punkte, Nachrechnen stimmt überein', () => {
    const state = game.create(5);
    const rec = new ArcadeRecorder();
    rec.record(0, reveal(65));
    game.step(state, reveal(65));
    // 30 Sekunden nachdenken
    let tick = 1;
    for (; tick < 301; tick += 1) game.step(state, 0);
    tick = solve(state, rec, tick);
    expect(state.phase).toBe('won');
    expect(game.score(state)).toBe(10000 - Math.floor(state.ticks / 10) * 20);
    expect(game.score(state)).toBeGreaterThanOrEqual(100);
    const replay = runArcadeReplay(game, 5, rec.finish(tick));
    expect(replay.finished).toBe(true);
    expect(replay.score).toBe(game.score(state));
  });

  it('ignoriert Eingaben außerhalb des Feldes', () => {
    const state = game.create(6);
    const before = JSON.stringify(state);
    game.step(state, ARCADE_INPUT_CUSTOM + CELLS * 2);
    game.step(state, 3);
    expect(JSON.stringify(state)).toBe(before);
  });
});
