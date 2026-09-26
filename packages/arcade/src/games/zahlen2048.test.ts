import { describe, expect, it } from 'vitest';
import {
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  ArcadeRecorder,
  runArcadeReplay,
} from '../realtime.js';
import { canMove2048, game, type Zahlen2048State } from './zahlen2048.js';

const DIRS = [ARCADE_INPUT_LEFT, ARCADE_INPUT_UP, ARCADE_INPUT_RIGHT, ARCADE_INPUT_DOWN];

function withGrid(grid: number[]): Zahlen2048State {
  const state = game.create(1);
  state.grid = [...grid];
  return state;
}

describe('2048', () => {
  it('startet mit zwei Kacheln', () => {
    const state = game.create(42);
    expect(state.grid.filter((v) => v !== 0)).toHaveLength(2);
    expect(state.grid.every((v) => v === 0 || v === 2 || v === 4)).toBe(true);
    expect(game.tickMs(state)).toBe(0);
  });

  it('verschmilzt Paare nur einmal je Zug', () => {
    const state = withGrid([2, 2, 2, 2, 4, 4, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    game.step(state, ARCADE_INPUT_LEFT);
    expect(state.grid[0]).toBe(4);
    expect(state.grid[1]).toBe(4);
    expect(state.grid[4]).toBe(8);
    expect(state.grid[5]).toBe(8);
    expect(state.score).toBe(4 + 4 + 8);
    expect(state.merged).toContain(0);
    expect(state.moves).toBe(1);
    // genau eine neue Kachel
    const tiles = state.grid.filter((v) => v !== 0).length;
    expect(tiles).toBe(5);
  });

  it('verschmilzt von der Kante aus: [2,2,2,0] nach rechts ergibt [0,0,2,4]', () => {
    const state = withGrid([2, 2, 2, 0, ...new Array<number>(12).fill(0)]);
    game.step(state, ARCADE_INPUT_RIGHT);
    expect(state.grid[3]).toBe(4);
    expect(state.grid[2]).toBe(2);
  });

  it('Leerzug erzeugt keine neue Kachel', () => {
    const state = withGrid([2, 4, 0, 0, ...new Array<number>(12).fill(0)]);
    const before = JSON.stringify(state);
    game.step(state, ARCADE_INPUT_LEFT);
    game.step(state, ARCADE_INPUT_UP);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('erkennt ein festgefahrenes Feld', () => {
    expect(canMove2048([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])).toBe(false);
    expect(canMove2048([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 4])).toBe(true);
    expect(canMove2048([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 0])).toBe(true);
  });

  it('endet in einer Zufallspartie und bleibt deterministisch', () => {
    const play = (seed: number) => {
      const state = game.create(seed);
      const rec = new ArcadeRecorder();
      let tick = 0;
      while (!game.isOver(state) && tick < 20000) {
        const input = DIRS[(tick * 7 + (tick >> 3)) % 4] as number;
        rec.record(tick, input);
        game.step(state, input);
        tick += 1;
      }
      return { state, recording: rec.finish(tick) };
    };
    const a = play(7);
    const b = play(7);
    expect(game.isOver(a.state)).toBe(true);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    const replay = runArcadeReplay(game, 7, a.recording);
    expect(replay.finished).toBe(true);
    expect(replay.score).toBe(a.state.score);
    expect(Number.isInteger(replay.score)).toBe(true);
  });

  it('ignoriert fremde Eingaben', () => {
    const state = game.create(3);
    const before = JSON.stringify(state);
    game.step(state, 0);
    game.step(state, 5);
    game.step(state, 999);
    expect(JSON.stringify(state)).toBe(before);
  });
});
