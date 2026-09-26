import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type SeatController, createMatch, runBots } from '../turn.js';
import { type BackgammonState, game, legalPlans } from './backgammon.js';

function base(): BackgammonState {
  return game.setup({ players: 2, seed: 7, options: {} });
}

/** Stellung aus einer Punkteliste (positiv Rot, negativ Blau). */
function position(entries: Record<number, number>, dice: number[], turn = 0): BackgammonState {
  const points = Array.from({ length: 26 }, () => 0);
  for (const [p, n] of Object.entries(entries)) points[Number(p)] = n;
  let red = 0;
  let blue = 0;
  for (const v of points) {
    if (v > 0) red += v;
    else blue -= v;
  }
  return {
    ...base(),
    points,
    bar: [0, 0],
    off: [15 - red, 15 - blue],
    turn,
    phase: 'ziehen',
    dice,
  };
}

describe('backgammon', () => {
  it('stellt die Standardaufstellung auf und beginnt mit dem Eröffnungswurf', () => {
    const s = base();
    expect(s.points.filter((v) => v > 0).reduce((a, b) => a + b, 0)).toBe(15);
    expect(s.points.filter((v) => v < 0).reduce((a, b) => a - b, 0)).toBe(15);
    expect(s.phase).toBe('ziehen');
    expect(s.dice).toHaveLength(2);
    expect(s.dice[0]).not.toBe(s.dice[1]);
    const v = game.view(s, 0);
    expect(v.pips).toEqual([167, 167]);
    expect(v.choices.length).toBeGreaterThan(0);
    expect(JSON.stringify(v)).not.toContain('"rng"');
  });

  it('verlangt beide Würfel, wenn möglich', () => {
    const s = position({ 13: 2, 1: -2 }, [3, 1]);
    expect(game.applyMove(s, 0, { type: 'ziehen', steps: [{ from: 13, to: 10 }] }).ok).toBe(false);
    const r = game.applyMove(s, 0, {
      type: 'ziehen',
      steps: [
        { from: 13, to: 10 },
        { from: 10, to: 9 },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('muss den höheren Würfel spielen, wenn nur einer geht', () => {
    // Rot: ein Stein auf 10. Blau sperrt 4 und 7 bzw. 9 so, dass nur ein Würfel geht.
    // Würfel 6/3: 10→4 gesperrt, 10→7 frei, danach 7→1 gesperrt; 10→7 dann 7→4 gesperrt.
    const s = position({ 10: 1, 4: -2, 1: -2, 9: 0 }, [6, 3]);
    const plans = legalPlans({ points: s.points, bar: [0, 0], off: s.off }, 0, s.dice);
    expect(plans.every((p) => p.steps.length === 1)).toBe(true);
    // 6 ist blockiert (10→4), also bleibt nur die 3.
    expect(plans.map((p) => p.steps[0])).toEqual([{ from: 10, to: 7 }]);

    // Geht die 6 und die 3 jeweils einzeln, aber nicht beide: dann die 6.
    const t = position({ 10: 1, 1: -2, 7: -2, 5: 0 }, [6, 3]);
    // 10→4 (6) frei, danach 4→1 gesperrt; 10→7 gesperrt.
    const plans2 = legalPlans({ points: t.points, bar: [0, 0], off: t.off }, 0, t.dice);
    expect(plans2.map((p) => p.steps)).toEqual([[{ from: 10, to: 4 }]]);
  });

  it('bringt Steine von der Bar zuerst ein und schlägt einzelne Steine', () => {
    const s = { ...position({ 6: 5, 20: -1, 19: -2 }, [5, 2]), bar: [1, 0] as [number, number] };
    // Ohne Bar-Einstieg kein anderer Zug.
    expect(
      game.applyMove(s, 0, {
        type: 'ziehen',
        steps: [
          { from: 6, to: 1 },
          { from: 6, to: 4 },
        ],
      }).ok,
    ).toBe(false);
    const r = game.applyMove(s, 0, {
      type: 'ziehen',
      steps: [
        { from: 25, to: 20 },
        { from: 20, to: 18 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.bar).toEqual([0, 1]);
      expect(r.state.points[18]).toBe(1);
    }
    // 19 ist ein Block (zwei Steine) – dort darf niemand landen.
    expect(game.applyMove(s, 0, { type: 'ziehen', steps: [{ from: 25, to: 19 }] }).ok).toBe(false);
  });

  it('würfelt korrekt aus, auch mit höherem Würfel nur ohne Steine dahinter', () => {
    const s = position({ 4: 1, 2: 1, 20: -1 }, [6, 1]);
    // 4 mit der 6 hinaus (kein Stein höher als 4), dann 2→1.
    const r = game.applyMove(s, 0, {
      type: 'ziehen',
      steps: [
        { from: 4, to: 0 },
        { from: 2, to: 1 },
      ],
    });
    expect(r.ok).toBe(true);
    // 2 mit der 6 hinaus ist verboten, solange auf 4 noch ein Stein steht.
    expect(
      game.applyMove(s, 0, {
        type: 'ziehen',
        steps: [
          { from: 2, to: 0 },
          { from: 4, to: 3 },
        ],
      }).ok,
    ).toBe(false);
    // Auswürfeln nur, wenn alle im Heimfeld sind.
    const t = position({ 8: 1, 2: 1, 20: -1 }, [6, 2]);
    expect(
      game.applyMove(t, 0, {
        type: 'ziehen',
        steps: [
          { from: 2, to: 0 },
          { from: 8, to: 2 },
        ],
      }).ok,
    ).toBe(false);
  });

  it('erkennt Sieg und Gammon', () => {
    const s = { ...position({ 1: 1, 20: -15 }, [3, 2]), off: [14, 0] as [number, number] };
    const r = game.applyMove(s, 0, { type: 'ziehen', steps: [{ from: 1, to: 0 }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const o = game.outcome(r.state);
      expect(o?.winners).toEqual([0]);
      expect(o?.summary).toContain('Gammon');
    }
  });

  it('Pasch ergibt vier Züge, würfeln nur in der Würfelphase', () => {
    const s = { ...position({ 13: 4, 1: -2 }, []), phase: 'wuerfeln' as const };
    expect(game.applyMove(s, 0, { type: 'ziehen', steps: [] }).ok).toBe(false);
    const plans = legalPlans({ points: s.points, bar: [0, 0], off: s.off }, 0, [2, 2, 2, 2]);
    expect(plans.every((p) => p.steps.length === 4)).toBe(true);
    const r = game.applyMove(s, 0, { type: 'wuerfeln' });
    expect(r.ok && r.state.dice.length >= 2).toBe(true);
    expect(game.applyMove(s, 1, { type: 'wuerfeln' }).ok).toBe(false);
  });

  it('lehnt Unfug in parseMove ab', () => {
    expect(game.parseMove({ type: 'ziehen', steps: [{ from: 26, to: 1 }] })).toBeNull();
    expect(game.parseMove({ type: 'ziehen', steps: 'x' })).toBeNull();
    expect(game.parseMove({ type: 'ziehen', steps: Array(5).fill({ from: 3, to: 1 }) })).toBeNull();
    expect(game.parseMove({ type: 'wurf' })).toBeNull();
    expect(game.parseMove({ type: 'wuerfeln' })).toEqual({ type: 'wuerfeln' });
    expect(game.parseOptions('x')).toBeNull();
  });

  it('Bot liefert legale Züge und Bot-Partien enden', () => {
    const s = base();
    const move = game.bot!(s, s.turn, 'schwer', createRng(1));
    expect(game.applyMove(s, s.turn, move).ok).toBe(true);
    for (const [a, b] of [
      ['schwer', 'leicht'],
      ['mittel', 'schwer'],
    ] as const) {
      for (const seed of [1, 2]) {
        const seats: SeatController[] = [
          { type: 'bot', level: a },
          { type: 'bot', level: b },
        ];
        const m = runBots(game, createMatch(game, seed, {}, seats));
        expect(game.outcome(m.state)).not.toBeNull();
      }
    }
  }, 60_000);
});
