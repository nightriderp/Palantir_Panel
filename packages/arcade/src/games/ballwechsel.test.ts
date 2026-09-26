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
import { PONG_BALL_R, PONG_PLAYER_Y, PONG_TARGET, game, type PongState } from './ballwechsel.js';

/** Autopilot: folgt dem Ball mit etwas Versatz. */
function autopilot(state: PongState): ArcadeInput {
  if (state.phase === 'ready') return ARCADE_INPUT_ACTION;
  const target = state.dy > 0 ? state.ballX + ((state.tick >> 5) % 3) * 6 - 6 : 160;
  const wantLeft = target < state.playerX - 5;
  const wantRight = target > state.playerX + 5;
  if (wantLeft && !state.left) return ARCADE_INPUT_LEFT;
  if (!wantLeft && state.left) return ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE;
  if (wantRight && !state.right) return ARCADE_INPUT_RIGHT;
  if (!wantRight && state.right) return ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE;
  return 0;
}

function play(seed: number, ticks: number, pilot: (s: PongState) => ArcadeInput) {
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

describe('Pong', () => {
  it('wartet auf den ersten Tastendruck', () => {
    const state = game.create(5);
    for (let i = 0; i < 100; i += 1) game.step(state, 0);
    expect(state.phase).toBe('ready');
    game.step(state, ARCADE_INPUT_ACTION);
    expect(state.phase).toBe('serve');
    for (let i = 0; i < 80; i += 1) game.step(state, 0);
    expect(state.phase).toBe('play');
    expect(game.tickMs(state)).toBe(16);
  });

  it('eigener Treffer zählt 10 und macht den Ball schneller', () => {
    const state = game.create(5);
    state.phase = 'play';
    state.speed = 3;
    state.ballX = state.playerX + 10;
    state.ballY = PONG_PLAYER_Y - PONG_BALL_R - 1;
    state.dx = 0;
    state.dy = 1;
    game.step(state, 0);
    expect(state.score).toBe(10);
    expect(state.dy).toBeLessThan(0);
    expect(state.dx).toBeGreaterThan(0);
    expect(state.speed).toBeGreaterThan(3);
  });

  it('Punkt am Computer vorbei zählt 100, Rundensieg 1000 und stärkerer Gegner', () => {
    const state = game.create(5);
    state.phase = 'play';
    state.speed = 4;
    state.playerPoints = PONG_TARGET - 1;
    state.cpuX = 300;
    state.ballX = 20;
    state.ballY = -2;
    state.dx = 0;
    state.dy = -1;
    game.step(state, 0);
    expect(state.phase).toBe('break');
    expect(state.score).toBe(1100);
    expect(state.roundsWon).toBe(1);
    for (let i = 0; i < 200 && state.round === 1; i += 1) game.step(state, 0);
    expect(state.round).toBe(2);
    expect(state.playerPoints).toBe(0);
  });

  it('die erste verlorene Runde beendet die Partie', () => {
    let state = game.create(11);
    state = game.step(state, ARCADE_INPUT_ACTION);
    let ticks = 0;
    // Wer nichts tut, verliert – die Partie muss also enden.
    while (!game.isOver(state) && ticks < 50_000) {
      state = game.step(state, 0);
      ticks += 1;
    }
    expect(game.isOver(state)).toBe(true);
    expect(state.cpuPoints).toBe(PONG_TARGET);
  });

  it('ist deterministisch und lässt sich nachrechnen', () => {
    const a = play(777, 30_000, autopilot);
    const b = play(777, 30_000, autopilot);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.state.hits).toBeGreaterThan(10);
    const replay = runArcadeReplay(game, 777, a.recording);
    expect(replay.score).toBe(a.state.score);
    expect(replay.finished).toBe(game.isOver(a.state));
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
  });
});
