import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type SeatController, createMatch, runBots } from '../turn.js';
import { type MuehleState, MILLS, game, legalMoves } from './muehle.js';

function empty(): MuehleState {
  return game.setup({ players: 2, seed: 1, options: game.defaultOptions });
}

/** Stellung in der Zugphase aus zwei Punktlisten. */
function position(red: number[], blue: number[], turn = 0): MuehleState {
  const s = empty();
  const board = Array.from({ length: 24 }, () => -1);
  for (const p of red) board[p] = 0;
  for (const p of blue) board[p] = 1;
  return { ...s, board, inHand: [0, 0], turn };
}

describe('muehle', () => {
  it('hat 16 Mühlen und setzt in der Setzphase auf jeden freien Punkt', () => {
    expect(MILLS).toHaveLength(16);
    expect(legalMoves(empty())).toHaveLength(24);
  });

  it('verlangt beim Schließen einer Mühle das Wegnehmen und schützt Steine in Mühlen', () => {
    // Rot hat 0 und 1, setzt auf 2. Blau: 8, 9, 10 (Mühle) und 20.
    const s = { ...position([0, 1], [8, 9, 10, 20]), inHand: [5, 5] as [number, number] };
    const moves = legalMoves(s).filter((m) => m.to === 2);
    expect(moves.map((m) => m.remove).sort()).toEqual([20]);
    expect(game.applyMove(s, 0, { to: 2 }).ok).toBe(false);
    const r = game.applyMove(s, 0, { to: 2, remove: 20 });
    expect(r.ok && r.state.board[20]).toBe(-1);
  });

  it('erlaubt das Nehmen aus einer Mühle, wenn alle Steine in Mühlen stehen', () => {
    const s = { ...position([0, 1], [8, 9, 10]), inHand: [5, 5] as [number, number] };
    expect(
      legalMoves(s)
        .filter((m) => m.to === 2)
        .map((m) => m.remove)
        .sort(),
    ).toEqual([10, 8, 9].sort());
  });

  it('zieht nur zu Nachbarn und springt mit drei Steinen', () => {
    const s = position([0, 4, 12, 20], [2, 6, 14, 22]);
    expect(game.applyMove(s, 0, { from: 0, to: 18 }).ok).toBe(false);
    const three = position([0, 4, 12], [2, 6, 14, 22, 23]);
    expect(legalMoves(three).some((m) => m.from === 0 && m.to === 18)).toBe(true);
    const noJump = { ...three, springen: false };
    expect(legalMoves(noJump).some((m) => m.from === 0 && m.to === 18)).toBe(false);
  });

  it('beendet die Partie, wenn der Gegner unter drei Steine fällt', () => {
    // Rot springt (3 Steine) von 16 nach 2 und schließt 0-1-2.
    const s = position([0, 1, 16], [8, 12, 20]);
    const r = game.applyMove(s, 0, { from: 16, to: 2, remove: 20 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(game.outcome(r.state)?.winners).toEqual([0]);
  });

  it('wertet einen blockierten Gegner als Niederlage', () => {
    // Blau steht auf 0, 2, 4, 5; Rot stellt mit 12→13 den letzten Ausweg zu.
    const blocked = position([1, 7, 3, 10, 13, 6], [0, 2, 4, 5], 1);
    expect(legalMoves(blocked)).toHaveLength(0);
    const pre = position([1, 7, 3, 10, 12, 6], [0, 2, 4, 5], 0);
    const r2 = game.applyMove(pre, 0, { from: 12, to: 13 });
    expect(r2.ok && game.outcome(r2.state)?.winners).toEqual([0]);
  });

  it('lehnt Unfug in parseMove und parseOptions ab', () => {
    expect(game.parseMove(null)).toBeNull();
    expect(game.parseMove({ to: 24 })).toBeNull();
    expect(game.parseMove({ to: 3, from: -1 })).toBeNull();
    expect(game.parseMove({ to: 1.5 })).toBeNull();
    expect(game.parseMove({ to: 3, remove: 'x' })).toBeNull();
    expect(game.parseMove({ to: 3 })).toEqual({ to: 3 });
    expect(game.parseOptions({ springen: 'ja' })).toBeNull();
    expect(game.parseOptions({})).toEqual({ springen: true });
  });

  it('lehnt fremde Züge ab und verändert den Zustand nicht', () => {
    const s = empty();
    const before = JSON.stringify(s);
    expect(game.applyMove(s, 1, { to: 0 }).ok).toBe(false);
    expect(game.applyMove(s, 0, { to: 0 }).ok).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('Bot schwer schließt eine offene Mühle und bleibt im Budget', () => {
    const s = { ...position([0, 1], [8, 9, 20]), inHand: [5, 5] as [number, number] };
    const t0 = performance.now();
    const m = game.bot!(s, 0, 'schwer', createRng(3));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(m.to).toBe(2);
  });

  it('Bot gegen Bot endet auf allen Stufen', () => {
    for (const level of ['leicht', 'mittel', 'schwer'] as const) {
      const seats: SeatController[] = [
        { type: 'bot', level },
        { type: 'bot', level: 'mittel' },
      ];
      const match = runBots(game, createMatch(game, 42, game.defaultOptions, seats));
      expect(game.outcome(match.state)).not.toBeNull();
      expect(JSON.parse(JSON.stringify(match.state))).toEqual(match.state);
    }
  }, 60_000);
});
