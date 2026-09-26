import { describe, expect, it } from 'vitest';
import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_ACTION2,
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RELEASE,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  ArcadeRecorder,
  runArcadeReplay,
} from '../realtime.js';
import {
  BLOCK_INPUT_ROTATE_CCW,
  BOARD_COLS,
  BOARD_ROWS,
  CLEAR_FRAMES,
  DAS_FRAMES,
  LOCK_DELAY,
  dropDistance,
  game,
  pieceCells,
  type BlockState,
} from './blockstapel.js';

function run(state: BlockState, inputs: number[]): BlockState {
  for (const input of inputs) game.step(state, input);
  return state;
}

function idle(state: BlockState, n: number): BlockState {
  return run(state, new Array<number>(n).fill(0));
}

function withPiece(type: number): BlockState {
  const state = game.create(1);
  state.piece = { type, rot: 0, x: 3, y: 5 };
  return state;
}

describe('Tetris', () => {
  it('zieht jede Steinart einmal je Beutel', () => {
    const state = game.create(99);
    const seen: number[] = [state.piece!.type, ...state.queue.slice(0, 6)];
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(state.queue.length).toBeGreaterThanOrEqual(3);
  });

  it('dreht vier Mal zurück in die Ausgangslage', () => {
    for (let type = 1; type <= 7; type += 1) {
      expect(pieceCells(type, 4)).toEqual(pieceCells(type, 0));
      expect(pieceCells(type, 1)).toHaveLength(4);
    }
  });

  it('dreht mit Wandkick an der linken Wand', () => {
    const state = withPiece(3);
    // T senkrecht an der linken Wand – die Drehung passt nur mit einem Schubs nach rechts.
    state.piece = { type: 3, rot: 1, x: -1, y: 5 };
    game.step(state, ARCADE_INPUT_UP);
    expect(state.piece!.rot).toBe(2);
    expect(state.piece!.x).toBe(0);
    game.step(state, BLOCK_INPUT_ROTATE_CCW);
    expect(state.piece!.rot).toBe(1);
  });

  it('schiebt beim Halten nach Verzögerung automatisch weiter', () => {
    const state = withPiece(2);
    state.piece!.x = 4;
    game.step(state, ARCADE_INPUT_RIGHT);
    expect(state.piece!.x).toBe(5);
    idle(state, DAS_FRAMES - 2);
    expect(state.piece!.x).toBe(5);
    idle(state, 6);
    expect(state.piece!.x).toBe(8);
    game.step(state, ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE);
    expect(state.shiftDir).toBe(0);
  });

  it('weicher Fall zählt Punkte und endet beim Loslassen', () => {
    const state = withPiece(2);
    game.step(state, ARCADE_INPUT_DOWN);
    idle(state, 10);
    expect(state.score).toBeGreaterThan(0);
    game.step(state, ARCADE_INPUT_DOWN + ARCADE_INPUT_RELEASE);
    expect(state.softDrop).toBe(false);
  });

  it('harter Fall setzt sofort ab und gibt zwei Punkte je Reihe', () => {
    const state = withPiece(2);
    const d = dropDistance(state, state.piece!);
    game.step(state, ARCADE_INPUT_ACTION);
    expect(state.score).toBe(d * 2);
    expect(state.locks).toBe(1);
    expect(state.board.filter((v) => v === 2)).toHaveLength(4);
  });

  it('sitzt erst nach dem Lock-Delay fest', () => {
    const state = withPiece(2);
    state.piece!.y = dropDistance(state, state.piece!) + state.piece!.y;
    idle(state, LOCK_DELAY - 1);
    expect(state.locks).toBe(0);
    idle(state, 1);
    expect(state.locks).toBe(1);
  });

  it('räumt volle Reihen und wertet nach Level', () => {
    const state = withPiece(1);
    // Unterste Reihe voll bis auf vier Lücken, in die ein liegender I-Stein passt.
    for (let x = 0; x < BOARD_COLS; x += 1) {
      if (x < 3 || x > 6) state.board[(BOARD_ROWS - 1) * BOARD_COLS + x] = 5;
    }
    state.level = 2;
    state.piece = { type: 1, rot: 0, x: 3, y: 5 };
    const d = dropDistance(state, state.piece);
    game.step(state, ARCADE_INPUT_ACTION);
    expect(state.clearRows).toEqual([BOARD_ROWS - 1]);
    idle(state, CLEAR_FRAMES);
    expect(state.lines).toBe(1);
    expect(state.score).toBe(d * 2 + 100 * 2);
    expect(state.board.slice((BOARD_ROWS - 1) * BOARD_COLS).every((v) => v === 0)).toBe(true);
    expect(state.piece).not.toBeNull();
  });

  it('hält einmal je Stein', () => {
    const state = game.create(4);
    const first = state.piece!.type;
    const next = state.queue[0];
    game.step(state, ARCADE_INPUT_ACTION2);
    expect(state.hold).toBe(first);
    expect(state.piece!.type).toBe(next);
    game.step(state, ARCADE_INPUT_ACTION2);
    expect(state.hold).toBe(first);
    game.step(state, ARCADE_INPUT_ACTION);
    game.step(state, ARCADE_INPUT_ACTION2);
    expect(state.piece!.type).toBe(first);
  });

  it('endet, wenn der Stapel überläuft', () => {
    const state = game.create(8);
    let guard = 0;
    while (!state.over && guard < 500) {
      game.step(state, ARCADE_INPUT_ACTION);
      idle(state, 1);
      guard += 1;
    }
    expect(state.over).toBe(true);
  });

  it('ist deterministisch und läuft im Band nach', () => {
    const inputs = [
      ARCADE_INPUT_LEFT,
      ARCADE_INPUT_UP,
      ARCADE_INPUT_RIGHT,
      ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE,
      ARCADE_INPUT_ACTION,
      ARCADE_INPUT_DOWN,
      ARCADE_INPUT_DOWN + ARCADE_INPUT_RELEASE,
      ARCADE_INPUT_ACTION2,
      ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE,
    ];
    const recorder = new ArcadeRecorder();
    const a = game.create(77);
    const b = game.create(77);
    let tick = 0;
    for (; tick < 20_000 && !a.over; tick += 1) {
      const input = tick % 5 === 0 ? (inputs[(tick / 5) % inputs.length] ?? 0) : 0;
      if (input) recorder.record(tick, input);
      game.step(a, input);
      game.step(b, input);
    }
    expect(a).toEqual(b);
    expect(a.over).toBe(true);
    const result = runArcadeReplay(game, 77, recorder.finish(tick));
    expect(result).toEqual({ score: game.score(a), ticks: tick, finished: true });
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});
