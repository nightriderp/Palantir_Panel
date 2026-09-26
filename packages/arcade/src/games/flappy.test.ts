import { describe, expect, it } from 'vitest';
import {
  ARCADE_INPUT_ACTION,
  ArcadeRecorder,
  runArcadeReplay,
  type ArcadeInput,
} from '../realtime.js';
import { FLAPPY_BIRD_X, FLAPPY_GROUND_Y, FLAPPY_PIPE_W, game, type FlappyState } from './flappy.js';

/** Autopilot: schlägt, sobald der Vogel unter die Mitte der nächsten Lücke sinkt. */
function autopilot(state: FlappyState): ArcadeInput {
  if (state.phase === 'ready') return ARCADE_INPUT_ACTION;
  const next = state.pipes.find((p) => p.x + FLAPPY_PIPE_W > FLAPPY_BIRD_X - 12);
  const target = next ? next.gapY + 14 : FLAPPY_GROUND_Y / 2;
  return state.y > target && state.vy > -1 ? ARCADE_INPUT_ACTION : 0;
}

function play(seed: number, ticks: number, pilot: (s: FlappyState) => ArcadeInput) {
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

describe('Flappy Bird', () => {
  it('schwebt, bis der erste Flügelschlag kommt', () => {
    const state = game.create(1);
    const y = state.y;
    for (let i = 0; i < 100; i += 1) game.step(state, 0);
    expect(state.phase).toBe('ready');
    expect(state.y).toBe(y);
    game.step(state, ARCADE_INPUT_ACTION);
    expect(state.phase).toBe('play');
    expect(state.vy).toBeLessThan(0);
    expect(state.pipes.length).toBe(1);
    expect(game.tickMs(state)).toBe(16);
  });

  it('fällt ohne Flügelschlag zu Boden und die Partie endet', () => {
    const state = game.create(1);
    game.step(state, ARCADE_INPUT_ACTION);
    let ticks = 0;
    while (!game.isOver(state) && ticks < 1000) {
      game.step(state, 0);
      ticks += 1;
    }
    expect(game.isOver(state)).toBe(true);
    expect(game.score(state)).toBe(0);
  });

  it('zählt einen Punkt je passierter Röhre', () => {
    const state = game.create(1);
    game.step(state, ARCADE_INPUT_ACTION);
    state.pipes = [{ x: FLAPPY_BIRD_X - 80, gapY: 200, gap: 400, passed: false }];
    game.step(state, 0);
    expect(state.score).toBe(1);
  });

  it('eine Röhre beendet den Flug', () => {
    const state = game.create(1);
    game.step(state, ARCADE_INPUT_ACTION);
    state.pipes = [{ x: FLAPPY_BIRD_X - 10, gapY: 380, gap: 40, passed: false }];
    game.step(state, 0);
    expect(state.phase === 'dead' || state.phase === 'over').toBe(true);
    // Tote Vögel schlagen nicht mehr mit den Flügeln.
    const vy = state.vy;
    game.step(state, ARCADE_INPUT_ACTION);
    expect(state.vy).toBeGreaterThanOrEqual(vy);
  });

  it('Lücken bleiben im Feld', () => {
    const { state } = play(99, 40_000, autopilot);
    for (const pipe of state.pipes) {
      expect(pipe.gapY - pipe.gap / 2).toBeGreaterThan(0);
      expect(pipe.gapY + pipe.gap / 2).toBeLessThan(FLAPPY_GROUND_Y);
    }
  });

  it('ist deterministisch und lässt sich nachrechnen', () => {
    const a = play(2024, 20_000, autopilot);
    const b = play(2024, 20_000, autopilot);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.state.score).toBeGreaterThan(3);
    const replay = runArcadeReplay(game, 2024, a.recording);
    expect(replay.score).toBe(a.state.score);
    expect(replay.finished).toBe(game.isOver(a.state));
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
  });
});
