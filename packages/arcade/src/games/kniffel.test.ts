import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type BotLevel, type SeatController, createMatch, runBots } from '../turn.js';
import { type KniffelState, game, scoreField, totals } from './kniffel.js';

function setup(players: number, seed = 1, extraKniffel = false): KniffelState {
  return game.setup({ players, seed, options: { extraKniffel } });
}

function withDice(s: KniffelState, wuerfel: number[], wuerfe = 1): KniffelState {
  return { ...s, wuerfel, wuerfe };
}

describe('Kniffel – Wertung', () => {
  it('wertet alle Felder richtig', () => {
    expect(scoreField([1, 1, 2, 3, 1], 0)).toBe(3);
    expect(scoreField([6, 6, 2, 6, 1], 5)).toBe(18);
    expect(scoreField([3, 3, 3, 2, 1], 6)).toBe(12);
    expect(scoreField([3, 3, 2, 2, 1], 6)).toBe(0);
    expect(scoreField([4, 4, 4, 4, 1], 7)).toBe(17);
    expect(scoreField([4, 4, 4, 1, 1], 7)).toBe(0);
    expect(scoreField([2, 2, 5, 5, 5], 8)).toBe(25);
    expect(scoreField([5, 5, 5, 5, 5], 8)).toBe(0);
    expect(scoreField([1, 2, 3, 4, 6], 9)).toBe(30);
    expect(scoreField([3, 4, 5, 6, 6], 9)).toBe(30);
    expect(scoreField([1, 2, 3, 5, 6], 9)).toBe(0);
    expect(scoreField([2, 3, 4, 5, 6], 10)).toBe(40);
    expect(scoreField([1, 2, 3, 4, 6], 10)).toBe(0);
    expect(scoreField([6, 6, 6, 6, 6], 11)).toBe(50);
    expect(scoreField([6, 6, 6, 6, 5], 11)).toBe(0);
    expect(scoreField([6, 6, 6, 6, 5], 12)).toBe(29);
  });

  it('gibt den Bonus ab 63 oben', () => {
    const sheet = [3, 6, 9, 12, 15, 18, null, null, null, null, null, null, null];
    expect(totals(sheet, 0)).toMatchObject({ oben: 63, bonus: 35, gesamt: 98 });
    sheet[5] = 12;
    expect(totals(sheet, 0).bonus).toBe(0);
    expect(totals(sheet, 2).extra).toBe(200);
  });
});

describe('Kniffel – Züge', () => {
  it('würfelt höchstens dreimal und hält Würfel', () => {
    let s = setup(2, 5);
    expect(game.applyMove(s, 0, { type: 'eintragen', feld: 0 }).ok).toBe(false);
    const r1 = game.applyMove(s, 0, { type: 'wuerfeln', halten: [true, true, true, true, true] });
    expect(r1.ok).toBe(true); // beim ersten Wurf zählt Halten nicht
    if (!r1.ok) return;
    s = r1.state;
    const kept = s.wuerfel[0];
    const r2 = game.applyMove(s, 0, {
      type: 'wuerfeln',
      halten: [true, false, false, false, false],
    });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.wuerfel[0]).toBe(kept);
    expect(
      game.applyMove(r2.state, 0, { type: 'wuerfeln', halten: [true, true, true, true, true] }).ok,
    ).toBe(false);
    const r3 = game.applyMove(r2.state, 0, {
      type: 'wuerfeln',
      halten: [false, false, false, false, false],
    });
    if (!r3.ok) throw new Error(r3.error);
    expect(
      game.applyMove(r3.state, 0, { type: 'wuerfeln', halten: [false, false, false, false, false] })
        .ok,
    ).toBe(false);
    expect(game.applyMove(r3.state, 1, { type: 'eintragen', feld: 12 }).ok).toBe(false);
    const r4 = game.applyMove(r3.state, 0, { type: 'eintragen', feld: 12 });
    if (!r4.ok) throw new Error(r4.error);
    expect(r4.state.am).toBe(1);
    expect(r4.state.wuerfe).toBe(0);
  });

  it('lehnt belegte Felder ab und zählt Extra-Kniffel', () => {
    let s = withDice(setup(1, 1, true), [4, 4, 4, 4, 4]);
    const a = game.applyMove(s, 0, { type: 'eintragen', feld: 11 });
    if (!a.ok) throw new Error(a.error);
    s = withDice(a.state, [4, 4, 4, 4, 4]);
    expect(game.applyMove(s, 0, { type: 'eintragen', feld: 11 }).ok).toBe(false);
    const b = game.applyMove(s, 0, { type: 'eintragen', feld: 3 });
    if (!b.ok) throw new Error(b.error);
    expect(b.state.extra[0]).toBe(1);
    expect(game.view(b.state, 0).summen[0]?.gesamt).toBe(50 + 20 + 100);
  });

  it('Solo endet nach 13 Runden', () => {
    let s = setup(1, 3);
    for (let feld = 0; feld < 13; feld += 1) {
      const r = game.applyMove(s, 0, {
        type: 'wuerfeln',
        halten: [false, false, false, false, false],
      });
      if (!r.ok) throw new Error(r.error);
      const t = game.applyMove(r.state, 0, { type: 'eintragen', feld });
      if (!t.ok) throw new Error(t.error);
      s = t.state;
      if (feld < 12) expect(game.outcome(s)).toBeNull();
    }
    const out = game.outcome(s);
    expect(out?.winners).toEqual([0]);
    expect(out?.scores?.[0]).toBe(totals(s.blaetter[0] ?? [], 0).gesamt);
  });

  it('Gleichstand ergibt mehrere Gewinner', () => {
    const full = Array.from({ length: 13 }, () => 1);
    const s: KniffelState = { ...setup(2), blaetter: [full, [...full]], fertig: true };
    expect(game.outcome(s)?.winners).toEqual([0, 1]);
  });

  it('parseMove und parseOptions lehnen Unfug ab', () => {
    for (const raw of [
      null,
      [],
      { type: 'wuerfeln', halten: [true] },
      { type: 'wuerfeln', halten: [1, 0, 0, 0, 0] },
      { type: 'eintragen', feld: 13 },
      { type: 'eintragen', feld: -1 },
      { type: 'eintragen', feld: '3' },
      { type: 'schummeln' },
    ]) {
      expect(game.parseMove(raw)).toBeNull();
    }
    expect(game.parseOptions({ extraKniffel: 1 })).toBeNull();
    expect(game.parseOptions({})).toEqual({ extraKniffel: false });
  });

  it('die Vorschau zeigt nur freie Felder', () => {
    const s = withDice(setup(1), [2, 2, 2, 3, 3]);
    const v = game.view(s, 0);
    expect(v.vorschau[1]).toBe(6);
    expect(v.vorschau[8]).toBe(25);
    expect(game.view(setup(1), 0).vorschau.every((x) => x === null)).toBe(true);
  });
});

describe('Kniffel – Computergegner', () => {
  const levels: BotLevel[] = ['leicht', 'mittel', 'schwer'];

  it.each([1, 2, 4, 6])('Bot-Partie mit %i Sitzen endet', (players) => {
    const seats: SeatController[] = Array.from({ length: players }, (_, i) => ({
      type: 'bot',
      level: levels[i % 3] as BotLevel,
    }));
    const match = runBots(
      game,
      createMatch(game, 11 * players, { extraKniffel: players % 2 === 0 }, seats),
    );
    const out = game.outcome(match.state);
    expect(out).not.toBeNull();
    expect(out?.scores?.length).toBe(players);
  });

  it('„schwer" spielt im Schnitt deutlich besser als „leicht"', () => {
    const avg = (level: BotLevel): number => {
      let sum = 0;
      for (let seed = 1; seed <= 8; seed += 1) {
        const m = runBots(
          game,
          createMatch(game, seed, { extraKniffel: false }, [{ type: 'bot', level }]),
        );
        sum += game.outcome(m.state)?.scores?.[0] ?? 0;
      }
      return sum / 8;
    };
    const hard = avg('schwer');
    expect(hard).toBeGreaterThan(avg('leicht') + 20);
    expect(hard).toBeGreaterThan(190);
  });

  it('hält einen fast fertigen Kniffel', () => {
    const s = withDice(setup(1), [5, 5, 5, 5, 2]);
    const m = game.bot?.(s, 0, 'schwer', createRng(1));
    expect(m).toEqual({ type: 'wuerfeln', halten: [true, true, true, true, false] });
  });
});
