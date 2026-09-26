import { describe, expect, it } from 'vitest';
import {
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  ArcadeRecorder,
  runArcadeReplay,
} from '../realtime.js';
import { BONUS_TTL, SNAKE_COLS, game, snakeTickMs, type SnakeState } from './kriechpfad.js';

function run(state: SnakeState, inputs: number[]): SnakeState {
  for (const input of inputs) game.step(state, input);
  return state;
}

describe('Snake', () => {
  it('startet mit vier Gliedern nach rechts und Futter auf freiem Feld', () => {
    const state = game.create(7);
    expect(state.body).toHaveLength(4);
    expect(state.dir).toBe(ARCADE_INPUT_RIGHT);
    expect(state.body.some(([x, y]) => x === state.food[0] && y === state.food[1])).toBe(false);
  });

  it('sperrt die Wende um 180°', () => {
    const state = game.create(1);
    const head = state.body[0]!;
    game.step(state, ARCADE_INPUT_LEFT);
    expect(state.dir).toBe(ARCADE_INPUT_RIGHT);
    expect(state.body[0]).toEqual([head[0] + 1, head[1]]);
    expect(state.over).toBe(false);
  });

  it('stirbt an der Wand', () => {
    const state = game.create(3);
    state.food = [0, 0];
    run(state, new Array<number>(SNAKE_COLS).fill(0));
    expect(state.over).toBe(true);
    expect(state.won).toBe(false);
  });

  it('stirbt am eigenen Körper', () => {
    const state = game.create(3);
    state.body = [
      [10, 10],
      [9, 10],
      [9, 11],
      [10, 11],
      [11, 11],
      [11, 10],
    ];
    state.food = [0, 0];
    game.step(state, ARCADE_INPUT_DOWN);
    expect(state.over).toBe(true);
  });

  it('darf ins frei werdende Schwanzfeld ziehen', () => {
    const state = game.create(3);
    state.body = [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 11],
    ];
    state.dir = ARCADE_INPUT_LEFT;
    state.food = [0, 0];
    game.step(state, ARCADE_INPUT_DOWN);
    expect(state.over).toBe(false);
  });

  it('wächst beim Fressen, punktet und wird schneller', () => {
    const state = game.create(5);
    const head = state.body[0]!;
    state.food = [head[0] + 1, head[1]];
    const before = game.tickMs(state);
    game.step(state, 0);
    expect(state.score).toBe(10);
    expect(state.eaten).toBe(1);
    game.step(state, 0);
    expect(state.body).toHaveLength(5);
    expect(game.tickMs(state)).toBeLessThan(before);
    expect(snakeTickMs(400)).toBe(55);
  });

  it('bringt nach fünf Häppchen einen Bonus, der verfällt', () => {
    const state = game.create(9);
    state.eaten = 4;
    const head = state.body[0]!;
    state.food = [head[0] + 1, head[1]];
    game.step(state, 0);
    expect(state.bonus).not.toBeNull();
    expect(state.bonus!.ttl).toBe(BONUS_TTL);
    state.bonus!.x = 0;
    state.bonus!.y = 0;
    state.bonus!.ttl = 2;
    game.step(state, 0);
    game.step(state, 0);
    expect(state.bonus).toBeNull();
  });

  it('wertet den Bonus nach Restzeit', () => {
    const state = game.create(9);
    const head = state.body[0]!;
    state.bonus = { x: head[0] + 1, y: head[1], ttl: 40 };
    state.food = [0, 0];
    game.step(state, 0);
    expect(state.score).toBe(30 + 40 * 2);
    expect(state.grow).toBe(3);
  });

  it('ist deterministisch und läuft im Band nach', () => {
    const inputs = [ARCADE_INPUT_UP, ARCADE_INPUT_RIGHT, ARCADE_INPUT_DOWN, ARCADE_INPUT_LEFT];
    const recorder = new ArcadeRecorder();
    const a = game.create(1234);
    const b = game.create(1234);
    let tick = 0;
    for (; tick < 2000 && !a.over; tick += 1) {
      // Erst Kreise ziehen, dann geradeaus gegen die Wand.
      const input = tick < 200 && tick % 7 === 3 ? (inputs[((tick / 7) % 4) | 0] ?? 0) : 0;
      if (input) recorder.record(tick, input);
      game.step(a, input);
      game.step(b, input);
    }
    expect(a).toEqual(b);
    expect(a.over).toBe(true);
    const result = runArcadeReplay(game, 1234, recorder.finish(tick));
    expect(result.score).toBe(game.score(a));
    expect(result.finished).toBe(true);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});
