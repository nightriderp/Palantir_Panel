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
  INV_BUNKER_COLS,
  INV_BUNKER_ROWS,
  INV_COLS,
  INV_PLAYER_Y,
  INV_ROWS,
  alienRect,
  game,
  type InvadersState,
} from './invaders.js';

/** Autopilot: pendelt hin und her und schießt, sobald er darf. */
function autopilot(state: InvadersState): ArcadeInput {
  if (state.shot === null && state.tick % 2 === 0) return ARCADE_INPUT_ACTION;
  const phase = Math.floor(state.tick / 90) % 2;
  if (phase === 0 && !state.left) {
    return state.right ? ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE : ARCADE_INPUT_LEFT;
  }
  if (phase === 1 && !state.right) {
    return state.left ? ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE : ARCADE_INPUT_RIGHT;
  }
  return 0;
}

function play(seed: number, ticks: number, pilot: (s: InvadersState) => ArcadeInput) {
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

describe('Space Invaders', () => {
  it('beginnt mit 5 × 11 Angreifern, vier Bunkern und drei Leben', () => {
    const state = game.create(1);
    expect(state.aliens).toHaveLength(INV_COLS * INV_ROWS);
    expect(state.aliens.every((a) => a === 1)).toBe(true);
    expect(state.bunkers).toHaveLength(4);
    for (const bunker of state.bunkers) {
      expect(bunker).toHaveLength(INV_BUNKER_COLS * INV_BUNKER_ROWS);
    }
    expect(state.lives).toBe(3);
    expect(game.tickMs(state)).toBe(16);
  });

  it('erlaubt nur einen eigenen Schuss gleichzeitig', () => {
    const state = game.create(1);
    game.step(state, ARCADE_INPUT_ACTION);
    const first = state.shot;
    expect(first).not.toBeNull();
    game.step(state, ARCADE_INPUT_ACTION);
    expect(state.shotsFired).toBe(1);
  });

  it('ein Treffer entfernt den Angreifer und bringt Punkte je Reihe', () => {
    const state = game.create(1);
    const index = 0; // oberste Reihe, 30 Punkte
    const rect = alienRect(state, index);
    state.shot = { x: rect.x + rect.w / 2, y: rect.y + rect.h + 2, kind: 0 };
    game.step(state, 0);
    expect(state.aliens[index]).toBe(0);
    expect(state.score).toBe(30);
  });

  it('der Marsch wird schneller, je weniger Angreifer übrig sind', () => {
    const full = game.create(1);
    const count = (s: InvadersState) => {
      const start = s.marches;
      for (let i = 0; i < 300; i += 1) game.step(s, 0);
      return s.marches - start;
    };
    const fewState = game.create(1);
    fewState.aliens = fewState.aliens.map((_, i) => (i === 50 ? 1 : 0));
    fewState.fireWait = 100_000;
    full.fireWait = 100_000;
    expect(count(fewState)).toBeGreaterThan(count(full) * 3);
  });

  it('Schüsse fressen Löcher in die Bunker', () => {
    const state = game.create(1);
    const before = state.bunkers[0]?.reduce((a, b) => a + b, 0) ?? 0;
    state.fireWait = 100_000;
    state.shot = { x: 56, y: 352, kind: 0 };
    game.step(state, 0);
    const after = state.bunkers[0]?.reduce((a, b) => a + b, 0) ?? 0;
    expect(after).toBeLessThan(before);
    expect(state.shot).toBeNull();
  });

  it('ein Treffer kostet ein Leben, Extraleben ab 1500 Punkten', () => {
    const state = game.create(1);
    state.fireWait = 100_000;
    state.enemyShots = [{ x: state.playerX, y: INV_PLAYER_Y - 4, kind: 0 }];
    game.step(state, 0);
    expect(state.lives).toBe(2);
    expect(state.dying).toBeGreaterThan(0);
    state.score = 1490;
    state.dying = 0;
    const rect = alienRect(state, 0);
    state.shot = { x: rect.x + rect.w / 2, y: rect.y + rect.h + 2, kind: 0 };
    game.step(state, 0);
    expect(state.lives).toBe(3);
  });

  it('landen die Angreifer, ist die Partie vorbei', () => {
    const state = game.create(1);
    state.formY = INV_PLAYER_Y - 4 * 22 - 16 + 1;
    state.marchWait = 1;
    game.step(state, 0);
    expect(game.isOver(state)).toBe(true);
  });

  it('endet ohne Gegenwehr von selbst', () => {
    let state = game.create(4);
    let ticks = 0;
    while (!game.isOver(state) && ticks < 100_000) {
      state = game.step(state, 0);
      ticks += 1;
    }
    expect(game.isOver(state)).toBe(true);
  });

  it('ist deterministisch und lässt sich nachrechnen', () => {
    const a = play(4242, 20_000, autopilot);
    const b = play(4242, 20_000, autopilot);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.state.kills).toBeGreaterThan(10);
    const replay = runArcadeReplay(game, 4242, a.recording);
    expect(replay.score).toBe(a.state.score);
    expect(replay.finished).toBe(game.isOver(a.state));
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
  });
});
