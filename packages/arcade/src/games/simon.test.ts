import { describe, expect, it } from 'vitest';
import {
  ARCADE_INPUT_CUSTOM,
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  ArcadeRecorder,
  runArcadeReplay,
} from '../realtime.js';
import { game, type SimonState } from './simon.js';

const KEYS = [ARCADE_INPUT_UP, ARCADE_INPUT_RIGHT, ARCADE_INPUT_DOWN, ARCADE_INPUT_LEFT];

/** Spielt bis zur Eingabephase durch und sammelt die gezeigten Felder. */
function watch(state: SimonState, rec: ArcadeRecorder | null, tick: { n: number }): number[] {
  const shown: number[] = [];
  let lastFlashes = state.flashes;
  while (state.phase === 'show') {
    game.step(state, 0);
    tick.n += 1;
    if (state.flashes !== lastFlashes) {
      shown.push(state.lit);
      lastFlashes = state.flashes;
    }
  }
  void rec;
  return shown;
}

describe('Simon', () => {
  it('zeigt die Folge und nimmt sie in der Eingabephase an', () => {
    const state = game.create(11);
    const tick = { n: 0 };
    for (let round = 0; round < 5; round += 1) {
      const shown = watch(state, null, tick);
      expect(shown).toEqual(state.seq);
      expect(state.phase).toBe('input');
      for (const pad of shown) game.step(state, ARCADE_INPUT_CUSTOM + pad);
    }
    expect(state.rounds).toBe(5);
    expect(game.score(state)).toBe(50);
    expect(state.seq).toHaveLength(6);
  });

  it('Tasten entsprechen den Feldern oben, rechts, unten, links', () => {
    const state = game.create(12);
    watch(state, null, { n: 0 });
    game.step(state, KEYS[state.seq[0] as number] as number);
    expect(state.rounds).toBe(1);
  });

  it('ein falscher Tipp beendet die Partie', () => {
    const state = game.create(13);
    watch(state, null, { n: 0 });
    const wrong = ((state.seq[0] as number) + 1) % 4;
    game.step(state, ARCADE_INPUT_CUSTOM + wrong);
    expect(game.isOver(state)).toBe(true);
    expect(state.reason).toBe('falsch');
    expect(game.score(state)).toBe(0);
    expect(game.tickMs(state)).toBe(0);
  });

  it('Tipps während des Vorspielens zählen nicht', () => {
    const state = game.create(14);
    game.step(state, ARCADE_INPUT_CUSTOM + 3);
    game.step(state, ARCADE_INPUT_CUSTOM + 2);
    expect(state.phase).toBe('show');
    expect(state.presses).toBe(0);
  });

  it('Zeitablauf in der Eingabephase beendet die Partie', () => {
    const state = game.create(15);
    watch(state, null, { n: 0 });
    for (let i = 0; i < 200 && !game.isOver(state); i += 1) game.step(state, 0);
    expect(state.reason).toBe('zeit');
  });

  it('ist deterministisch und lässt sich nachrechnen', () => {
    const play = () => {
      const state = game.create(99);
      const rec = new ArcadeRecorder();
      let tick = 0;
      for (let round = 0; round < 4; round += 1) {
        while (state.phase === 'show') {
          game.step(state, 0);
          tick += 1;
        }
        for (const pad of state.seq) {
          rec.record(tick, ARCADE_INPUT_CUSTOM + pad);
          game.step(state, ARCADE_INPUT_CUSTOM + pad);
          tick += 1;
          if (state.phase !== 'input') break;
          game.step(state, 0);
          tick += 1;
        }
      }
      while (state.phase === 'show') {
        game.step(state, 0);
        tick += 1;
      }
      const wrong = ((state.seq[0] as number) + 2) % 4;
      rec.record(tick, ARCADE_INPUT_CUSTOM + wrong);
      game.step(state, ARCADE_INPUT_CUSTOM + wrong);
      tick += 1;
      return { state, recording: rec.finish(tick) };
    };
    const a = play();
    const b = play();
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.state.rounds).toBe(4);
    const replay = runArcadeReplay(game, 99, a.recording);
    expect(replay).toEqual({ score: 40, ticks: a.recording.totalTicks, finished: true });
  });
});
