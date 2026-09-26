import { describe, expect, it } from 'vitest';
import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RELEASE,
  ARCADE_INPUT_RIGHT,
  ArcadeRecorder,
  runArcadeReplay,
  type ArcadeInput,
} from '../realtime.js';
import {
  BREAKOUT_BALL_R,
  BREAKOUT_LEVELS,
  BREAKOUT_COLS,
  BREAKOUT_PADDLE_Y,
  CAPSULE_LIFE,
  CAPSULE_MULTI,
  CAPSULE_WIDE,
  STEEL,
  ballSpeed,
  game,
  paddleWidth,
  type BreakoutState,
} from './steinbrecher.js';

/** Autopilot: fährt den Schläger unter den tiefsten Ball und schießt ab. */
function autopilot(state: BreakoutState): ArcadeInput {
  if (state.stuck) return state.tick % 30 === 0 ? ARCADE_INPUT_ACTION : 0;
  let target = state.paddleX;
  let lowest = -Infinity;
  for (const ball of state.balls) {
    if (ball.y > lowest) {
      lowest = ball.y;
      target = ball.x + (state.tick % 7) - 3;
    }
  }
  const wantLeft = target < state.paddleX - 4;
  const wantRight = target > state.paddleX + 4;
  if (wantLeft && !state.left) return ARCADE_INPUT_LEFT;
  if (!wantLeft && state.left) return ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE;
  if (wantRight && !state.right) return ARCADE_INPUT_RIGHT;
  if (!wantRight && state.right) return ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE;
  return 0;
}

function play(seed: number, ticks: number, pilot: (s: BreakoutState) => ArcadeInput) {
  const state = game.create(seed);
  const recorder = new ArcadeRecorder();
  let tick = 0;
  for (; tick < ticks && !game.isOver(state); tick += 1) {
    const input = pilot(state);
    if (input !== 0) recorder.record(tick, input);
    game.step(state, input);
  }
  return { state, recording: recorder.finish(tick) };
}

describe('Breakout', () => {
  it('hat mindestens fünf eigene Level in voller Breite', () => {
    expect(BREAKOUT_LEVELS.length).toBeGreaterThanOrEqual(5);
    for (const level of BREAKOUT_LEVELS) {
      for (const row of level) expect(row).toHaveLength(BREAKOUT_COLS);
    }
  });

  it('startet mit drei Leben und liegendem Ball, erst ACTION schießt ab', () => {
    const state = game.create(3);
    expect(state.lives).toBe(3);
    expect(state.stuck).toBe(true);
    for (let i = 0; i < 50; i += 1) game.step(state, 0);
    expect(state.stuck).toBe(true);
    expect(state.balls[0]?.y).toBe(BREAKOUT_PADDLE_Y - BREAKOUT_BALL_R - 1);
    game.step(state, ARCADE_INPUT_ACTION);
    expect(state.stuck).toBe(false);
    expect(state.balls[0]?.dy).toBeLessThan(0);
    expect(game.tickMs(state)).toBe(16);
  });

  it('bewegt den Schläger, solange die Taste gehalten wird', () => {
    const state = game.create(1);
    const start = state.paddleX;
    game.step(state, ARCADE_INPUT_LEFT);
    game.step(state, 0);
    expect(state.paddleX).toBeLessThan(start - 10);
    const held = state.paddleX;
    game.step(state, ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE);
    game.step(state, 0);
    expect(state.paddleX).toBe(held);
    // Der liegende Ball fährt mit.
    expect(state.balls[0]?.x).toBe(state.paddleX);
  });

  it('lenkt den Ball je nach Trefferpunkt am Schläger', () => {
    const state = game.create(1);
    game.step(state, ARCADE_INPUT_ACTION);
    const ball = state.balls[0];
    if (!ball) throw new Error('kein Ball');
    ball.x = state.paddleX + paddleWidth(state) / 2 - 2;
    ball.y = BREAKOUT_PADDLE_Y - BREAKOUT_BALL_R - 1;
    ball.dx = 0;
    ball.dy = 1;
    game.step(state, 0);
    expect(ball.dy).toBeLessThan(0);
    expect(ball.dx).toBeGreaterThan(0.5);
  });

  it('Steine mit mehreren Trefferpunkten brauchen mehrere Treffer', () => {
    const state = game.create(1);
    const brick = state.bricks.find((b) => b.max === 2);
    if (!brick) throw new Error('kein Stein mit 2 Treffern');
    state.stuck = false;
    const ball = state.balls[0];
    if (!ball) throw new Error('kein Ball');
    const place = () => {
      ball.x = 12 + brick.c * 28 + 14;
      ball.y = 60 + brick.r * 14 + 14 + BREAKOUT_BALL_R + 1;
      ball.dx = 0;
      ball.dy = -1;
    };
    place();
    game.step(state, 0);
    expect(brick.hp).toBe(1);
    place();
    game.step(state, 0);
    expect(brick.hp).toBe(0);
  });

  it('Extras wirken: breiter Schläger, Mehrfachball, Extraleben', () => {
    const state = game.create(1);
    game.step(state, ARCADE_INPUT_ACTION);
    const drop = (kind: number) => {
      state.capsules = [{ x: state.paddleX, y: BREAKOUT_PADDLE_Y - 7, kind }];
      game.step(state, 0);
    };
    drop(CAPSULE_WIDE);
    expect(paddleWidth(state)).toBeGreaterThan(60);
    drop(CAPSULE_MULTI);
    expect(state.balls.length).toBe(3);
    drop(CAPSULE_LIFE);
    expect(state.lives).toBe(4);
    const fast = ballSpeed(state);
    state.slowTicks = 10;
    expect(ballSpeed(state)).toBeLessThan(fast);
  });

  it('ein Level ist geschafft, wenn nur Hartsteine übrig sind', () => {
    const state = game.create(1);
    state.level = 2;
    state.bricks = [
      { c: 0, r: 0, hp: 1, max: STEEL },
      { c: 5, r: 3, hp: 1, max: 1 },
    ];
    game.step(state, ARCADE_INPUT_ACTION);
    const brick = state.bricks[1];
    const ball = state.balls[0];
    if (!brick || !ball) throw new Error('Aufbau');
    ball.x = 12 + 5 * 28 + 14;
    ball.y = 60 + 3 * 14 + 14 + BREAKOUT_BALL_R + 1;
    ball.dx = 0;
    ball.dy = -1;
    game.step(state, 0);
    expect(state.level).toBe(3);
    expect(state.stuck).toBe(true);
    expect(state.bricks.length).toBeGreaterThan(10);
  });

  it('endet nach drei verlorenen Bällen', () => {
    let state = game.create(9);
    let ticks = 0;
    while (!game.isOver(state) && ticks < 20_000) {
      state = game.step(state, state.stuck ? ARCADE_INPUT_ACTION : 0);
      ticks += 1;
    }
    expect(game.isOver(state)).toBe(true);
    expect(state.livesLost).toBe(3);
    expect(game.score(state)).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(game.score(state))).toBe(true);
  });

  it('ist deterministisch und lässt sich nachrechnen', () => {
    const a = play(1234, 12_000, autopilot);
    const b = play(1234, 12_000, autopilot);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.state.bricksBroken).toBeGreaterThan(20);
    const replay = runArcadeReplay(game, 1234, a.recording);
    expect(replay.score).toBe(a.state.score);
    expect(replay.finished).toBe(game.isOver(a.state));
    // Der Zustand bleibt reines JSON.
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
  });
});
