import { describe, expect, it } from 'vitest';
import { applyRawMove, createMatch, replayTurnMatch, type RecordedMove } from '../turn.js';
import {
  game,
  isRed,
  rankOf,
  suitOf,
  type SolitaerMove,
  type SolitaerPile,
  type SolitaerState,
} from './solitaer.js';

const setup = (draw: 1 | 3 = 1, seed = 1) => game.setup({ players: 1, seed, options: { draw } });

function apply(state: SolitaerState, move: SolitaerMove): SolitaerState {
  const result = game.applyMove(state, 0, move);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** Einfacher gieriger Spieler: erst Ablage, dann Tableau-Züge, die aufdecken, sonst ziehen. */
function greedyMove(state: SolitaerState): SolitaerMove {
  if (game.view(state, 0).canAutoComplete) return { type: 'vervollstaendigen' };
  const sources: SolitaerPile[] = ['w', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];
  for (const from of sources) {
    for (const to of ['f0', 'f1', 'f2', 'f3'] as SolitaerPile[]) {
      const move: SolitaerMove = { type: 'verschieben', from, to, count: 1 };
      if (game.applyMove(state, 0, move).ok) return move;
    }
  }
  for (let c = 0; c < 7; c += 1) {
    const col = state.tableau[c];
    if (!col || col.down.length === 0 || col.up.length === 0) continue;
    for (let t = 0; t < 7; t += 1) {
      const move: SolitaerMove = {
        type: 'verschieben',
        from: `t${c}` as SolitaerPile,
        to: `t${t}` as SolitaerPile,
        count: col.up.length,
      };
      if (game.applyMove(state, 0, move).ok) return move;
    }
  }
  for (let t = 0; t < 7; t += 1) {
    const move: SolitaerMove = {
      type: 'verschieben',
      from: 'w',
      to: `t${t}` as SolitaerPile,
      count: 1,
    };
    if (game.applyMove(state, 0, move).ok) return move;
  }
  if (state.stock.length + state.waste.length > 0) return { type: 'ziehen' };
  return { type: 'aufgeben' };
}

describe('Solitär', () => {
  it('teilt 28 Karten ins Tableau und 24 in den Stapel', () => {
    const state = setup();
    expect(state.tableau.map((c) => c.down.length + c.up.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(state.tableau.every((c) => c.up.length === 1)).toBe(true);
    expect(state.stock).toHaveLength(24);
    const all = [...state.stock, ...state.tableau.flatMap((c) => [...c.down, ...c.up])];
    expect(new Set(all).size).toBe(52);
  });

  it('die Sicht zeigt keine verdeckten Karten', () => {
    const state = setup();
    const view = game.view(state, 0);
    const json = JSON.stringify(view);
    expect(view.stockCount).toBe(24);
    expect(view.tableau.map((c) => c.down)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Keine der verdeckten Karten taucht in der Sicht auf.
    const hidden = [...state.stock, ...state.tableau.flatMap((c) => c.down)];
    const visible = [
      ...view.wasteTop,
      ...view.foundations.flat(),
      ...view.tableau.flatMap((c) => c.up),
    ];
    for (const card of hidden) expect(visible).not.toContain(card);
    expect(json).not.toContain('stock"');
  });

  it('Ziehen mit 1 und 3 Karten, Umdrehen kostet Punkte', () => {
    let state = setup(3);
    state = apply(state, { type: 'ziehen' });
    expect(state.waste).toHaveLength(3);
    let one = setup(1);
    one.score = 200;
    for (let i = 0; i < 24; i += 1) one = apply(one, { type: 'ziehen' });
    expect(one.stock).toHaveLength(0);
    one = apply(one, { type: 'ziehen' });
    expect(one.stock).toHaveLength(24);
    expect(one.score).toBe(100);
  });

  it('prüft Legalität der Züge', () => {
    const state = setup();
    // König auf leere Reihe, sonst nichts
    const s = structuredClone(state);
    s.tableau[0] = { down: [], up: [] };
    s.waste = [5]; // Pik 6
    expect(game.applyMove(s, 0, { type: 'verschieben', from: 'w', to: 't0', count: 1 }).ok).toBe(
      false,
    );
    s.waste = [12]; // Pik König
    expect(game.applyMove(s, 0, { type: 'verschieben', from: 'w', to: 't0', count: 1 }).ok).toBe(
      true,
    );
    // Ass auf Ablage, Zwei nur passend
    s.waste = [13]; // Herz Ass
    const r = game.applyMove(s, 0, { type: 'verschieben', from: 'w', to: 'f2', count: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.score).toBe(10);
      r.state.waste = [1]; // Pik 2
      expect(
        game.applyMove(r.state, 0, { type: 'verschieben', from: 'w', to: 'f2', count: 1 }).ok,
      ).toBe(false);
    }
    expect(game.applyMove(s, 0, { type: 'verschieben', from: 't1', to: 't1', count: 1 }).ok).toBe(
      false,
    );
    expect(game.applyMove(s, 1, { type: 'ziehen' }).ok).toBe(false);
  });

  it('Farbwechsel und Aufdecken im Tableau', () => {
    const s = setup();
    s.tableau[0] = { down: [40], up: [26 + 6] }; // Karo 7
    s.tableau[1] = { down: [], up: [5] }; // Pik 6
    const r = game.applyMove(s, 0, { type: 'verschieben', from: 't1', to: 't0', count: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.tableau[0]?.up).toEqual([32, 5]);
      expect(r.state.tableau[1]?.up).toEqual([]);
    }
    s.tableau[1] = { down: [9], up: [18] }; // Herz 6 auf Karo 7: gleiche Farbe
    expect(game.applyMove(s, 0, { type: 'verschieben', from: 't1', to: 't0', count: 1 }).ok).toBe(
      false,
    );
    s.tableau[1] = { down: [9], up: [5] };
    const flip = game.applyMove(s, 0, { type: 'verschieben', from: 't1', to: 't0', count: 1 });
    expect(flip.ok && flip.state.tableau[1]?.up).toEqual([9]);
    expect(flip.ok && flip.state.score).toBe(5);
    expect(isRed(32)).toBe(true);
    expect(rankOf(32)).toBe(7);
    expect(suitOf(32)).toBe(2);
  });

  it('Auto-Vervollständigen und Sieg mit Bonus', () => {
    const s = setup();
    s.stock = [];
    s.waste = [];
    s.foundations = [[], [], [], []];
    // Vier Reihen, je eine Farbe von König bis Ass – gültig genug für die Abräum-Schleife.
    s.tableau = Array.from({ length: 7 }, (_, i) => ({
      down: [],
      up: i < 4 ? Array.from({ length: 13 }, (_, k) => i * 13 + (12 - k)) : [],
    }));
    const r = game.applyMove(s, 0, { type: 'vervollstaendigen' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.won).toBe(true);
    const out = game.outcome(r.state);
    expect(out?.winners).toEqual([0]);
    expect(out?.scores?.[0]).toBe(r.state.score);
    expect(r.state.bonus).toBeGreaterThan(0);
  });

  it('parseMove und parseOptions lehnen Unfug ab', () => {
    expect(game.parseMove(null)).toBeNull();
    expect(game.parseMove({ type: 'verschieben', from: 'x', to: 't0', count: 1 })).toBeNull();
    expect(game.parseMove({ type: 'verschieben', from: 'w', to: 't0', count: 0 })).toBeNull();
    expect(game.parseMove({ type: 'verschieben', from: 'w', to: 't0', count: 1.5 })).toBeNull();
    expect(game.parseMove({ type: 'hack' })).toBeNull();
    expect(game.parseMove({ type: 'ziehen' })).toEqual({ type: 'ziehen' });
    expect(game.parseOptions({ draw: 2 })).toBeNull();
    expect(game.parseOptions('x')).toBeNull();
    expect(game.parseOptions({ draw: 3 })).toEqual({ draw: 3 });
    expect(game.parseOptions({})).toEqual({ draw: 1 });
  });

  it('eine gespielte Partie endet und lässt sich nachrechnen', () => {
    for (const draw of [1, 3] as const) {
      const match = createMatch(game, 77, { draw }, [{ type: 'human' }]);
      let current = match;
      const moves: RecordedMove[] = [];
      for (let i = 0; i < 3000 && !game.outcome(current.state); i += 1) {
        const move = greedyMove(current.state);
        const result = applyRawMove(game, current, 0, move);
        if (!result.ok) throw new Error(result.error);
        moves.push({ seat: 0, move });
        current = result.state;
      }
      const out = game.outcome(current.state);
      expect(out).not.toBeNull();
      const replay = replayTurnMatch(game, 77, { draw }, [{ type: 'human' }], moves);
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.outcome.scores).toEqual(out?.scores);
    }
  });

  it('Aufgeben beendet ohne Sieger', () => {
    const s = apply(setup(), { type: 'aufgeben' });
    expect(game.outcome(s)?.winners).toEqual([]);
    expect(game.activeSeats(s)).toEqual([]);
  });
});
