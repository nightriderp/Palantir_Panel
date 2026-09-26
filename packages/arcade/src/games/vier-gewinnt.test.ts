import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type SeatController, createMatch, runBots } from '../turn.js';
import { type VierGewinntState, chooseColumn, game } from './vier-gewinnt.js';

function play(columns: number[]): VierGewinntState {
  let s = game.setup({ players: 2, seed: 1, options: {} });
  for (const column of columns) {
    const r = game.applyMove(s, s.side, { column });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

describe('vier-gewinnt – Regeln', () => {
  it('Stein fällt nach unten', () => {
    const s = play([3, 3]);
    expect(s.board[3]).toBe('0');
    expect(s.board[10]).toBe('1');
    expect(s.lastCell).toBe(10);
  });

  it('waagrecht, senkrecht und diagonal gewinnen', () => {
    const h = play([0, 0, 1, 1, 2, 2, 3]);
    expect(game.outcome(h)?.winners).toEqual([0]);
    expect(h.winLine).toEqual([0, 1, 2, 3]);
    const v = play([0, 1, 0, 1, 0, 1, 0]);
    expect(game.outcome(v)?.winners).toEqual([0]);
    // Diagonale von unten links nach oben rechts für Rot.
    const d = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(game.outcome(d)?.winners).toEqual([0]);
    expect(d.winLine).toEqual([0, 8, 16, 24]);
    expect(game.activeSeats(d)).toEqual([]);
  });

  it('volle Spalte und falscher Sitz werden abgelehnt', () => {
    const s = play([0, 0, 0, 0, 0, 0]);
    expect(game.applyMove(s, 0, { column: 0 }).ok).toBe(false);
    expect(game.applyMove(s, 1, { column: 1 }).ok).toBe(false);
    expect(game.view(s, 0).playable).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('volles Brett ohne Reihe ist Remis', () => {
    // Spaltenweise im Muster, das keine Vierer zulässt.
    const order = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2];
    const rest = [4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6];
    const s = play([...order, ...rest]);
    expect(game.outcome(s)).toEqual({ winners: [], summary: 'Das Brett ist voll – Remis.' });
  });

  it('parseMove lehnt Unfug ab, applyMove verändert nichts', () => {
    for (const raw of [null, 3, '3', { column: 7 }, { column: -1 }, { column: 2.5 }, {}]) {
      expect(game.parseMove(raw)).toBeNull();
    }
    expect(game.parseMove({ column: 6 })).toEqual({ column: 6 });
    const s = play([3]);
    const copy = JSON.stringify(s);
    game.applyMove(s, 1, { column: 4 });
    expect(JSON.stringify(s)).toBe(copy);
    expect(JSON.parse(JSON.stringify(game.view(s, 0)))).toEqual(game.view(s, 0));
  });
});

describe('vier-gewinnt – Computer', () => {
  it('gewinnt sofort und blockt auf mittel und schwer', () => {
    const win = play([0, 6, 1, 6, 2, 5]);
    for (const level of ['leicht', 'mittel', 'schwer'] as const) {
      expect(game.bot!(win, 0, level, createRng(1))).toEqual({ column: 3 });
    }
    const block = play([0, 6, 1, 6, 2]);
    for (const level of ['mittel', 'schwer'] as const) {
      expect(game.bot!(block, 1, level, createRng(1))).toEqual({ column: 3 });
    }
  });

  it('bleibt im Knotenbudget und ist deterministisch', () => {
    const s = play([3]);
    const a = chooseColumn(s.board, 1, 'schwer', createRng(9));
    expect(a).toEqual(chooseColumn(s.board, 1, 'schwer', createRng(9)));
    expect(a.nodes).toBeLessThanOrEqual(90_001);
  });

  it('Bot gegen Bot endet, schwer schlägt leicht', () => {
    const pairs: [SeatController, SeatController][] = [
      [
        { type: 'bot', level: 'schwer' },
        { type: 'bot', level: 'leicht' },
      ],
      [
        { type: 'bot', level: 'mittel' },
        { type: 'bot', level: 'mittel' },
      ],
    ];
    for (const [i, seats] of pairs.entries()) {
      const match = runBots(game, createMatch(game, 50 + i, {}, seats));
      const outcome = game.outcome(match.state);
      expect(outcome).not.toBeNull();
      if (i === 0) expect(outcome?.winners).toEqual([0]);
    }
  }, 60_000);
});
