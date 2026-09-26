import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type SeatController, createMatch, runBots } from '../turn.js';
import { type MaednState, absField, choicesFor, game } from './mensch-aergere-dich-nicht.js';

function fresh(players = 2, schlagpflicht = false): MaednState {
  return game.setup({ players, seed: 5, options: { schlagpflicht } });
}

function withPieces(pieces: number[][], die: number, players = pieces.length): MaednState {
  return { ...fresh(players), pieces, phase: 'ziehen', die };
}

describe('mensch-aergere-dich-nicht', () => {
  it('bringt mit einer 6 eine Figur heraus (Pflicht)', () => {
    const s = withPieces(
      [
        [5, -1, -1, -1],
        [-1, -1, -1, -1],
      ],
      6,
    );
    const legal = choicesFor(s, 0, 6);
    expect(legal.every((c) => c.from === -1)).toBe(true);
    expect(game.applyMove(s, 0, { type: 'figur', piece: 0 }).ok).toBe(false);
  });

  it('räumt das Startfeld, solange Figuren im Haus warten', () => {
    const s = withPieces(
      [
        [0, 12, -1, -1],
        [-1, -1, -1, -1],
      ],
      3,
    );
    expect(choicesFor(s, 0, 3).map((c) => c.piece)).toEqual([0]);
  });

  it('schlägt fremde Figuren und schickt sie ins Haus', () => {
    // Sitz 1 sitzt bei zwei Spielern in Ecke 2 (Startfeld 20). Rot auf 17, Blau auf Feld 20 (rel 0).
    const s = withPieces(
      [
        [17, 30, 35, 38],
        [0, -1, -1, -1],
      ],
      3,
    );
    const c = choicesFor(s, 0, 3).find((x) => x.piece === 0);
    expect(c?.captures).toBe(1);
    const r = game.applyMove(s, 0, { type: 'figur', piece: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.pieces[1]![0]).toBe(-1);
      expect(r.state.turn).toBe(1);
    }
  });

  it('überspringt im Ziel keine Figur und landet nicht auf eigenen Figuren', () => {
    const s = withPieces(
      [
        [38, 41, -1, -1],
        [-1, -1, -1, -1],
      ],
      4,
    );
    // 38+4 = 42 würde über 41 springen.
    expect(choicesFor(s, 0, 4).some((c) => c.piece === 0)).toBe(false);
    expect(choicesFor(s, 0, 2).find((c) => c.piece === 0)?.to).toBe(40);
    expect(choicesFor(s, 0, 3).some((c) => c.piece === 0)).toBe(false);
    // Über das Zielende hinaus geht nicht.
    expect(choicesFor(s, 0, 3).some((c) => c.piece === 1)).toBe(false);
    expect(choicesFor(s, 0, 2).find((c) => c.piece === 1)?.to).toBe(43);
  });

  it('gibt drei Versuche, wenn keine Figur ziehen kann', () => {
    // Suche einen Startwert, der dreimal keine 6 würfelt.
    for (let seed = 1; seed < 200; seed += 1) {
      let s = game.setup({ players: 2, seed, options: { schlagpflicht: false } });
      const dice: number[] = [];
      for (let i = 0; i < 3 && s.turn === 0; i += 1) {
        const r = game.applyMove(s, 0, { type: 'wuerfeln' });
        if (!r.ok) throw new Error(r.error);
        s = r.state;
        dice.push(s.die);
      }
      if (dice.every((d) => d !== 6)) {
        expect(dice).toHaveLength(3);
        expect(s.turn).toBe(1);
        return;
      }
    }
    throw new Error('kein passender Startwert');
  });

  it('eine 6 lässt nochmal würfeln', () => {
    const s = withPieces(
      [
        [10, 20, -1, -1],
        [-1, -1, -1, -1],
      ],
      6,
    );
    const r = game.applyMove(s, 0, { type: 'figur', piece: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.turn).toBe(0);
      expect(r.state.phase).toBe('wuerfeln');
    }
  });

  it('Schlagpflicht beschränkt auf Schlagzüge', () => {
    const base = withPieces(
      [
        [17, 5, 30, 33],
        [0, -1, -1, -1],
      ],
      3,
    );
    expect(choicesFor(base, 0, 3).length).toBeGreaterThan(1);
    const forced = { ...base, schlagpflicht: true };
    expect(choicesFor(forced, 0, 3).map((c) => c.piece)).toEqual([0]);
  });

  it('erkennt den Sieg', () => {
    const s = withPieces(
      [
        [41, 42, 43, 37],
        [-1, -1, -1, -1],
      ],
      3,
    );
    const r = game.applyMove(s, 0, { type: 'figur', piece: 3 });
    expect(r.ok && game.outcome(r.state)?.winners).toEqual([0]);
  });

  it('rechnet absolute Felder je Ecke', () => {
    expect(absField(0, 0)).toBe(0);
    expect(absField(3, 15)).toBe(5);
  });

  it('lehnt Unfug ab und verrät keinen Zufall', () => {
    expect(game.parseMove({ type: 'figur', piece: 4 })).toBeNull();
    expect(game.parseMove({ type: 'figur' })).toBeNull();
    expect(game.parseMove('wuerfeln')).toBeNull();
    expect(game.parseOptions({ schlagpflicht: 1 })).toBeNull();
    expect(JSON.stringify(game.view(fresh(), 0))).not.toContain('rng');
  });

  it('Bot-Partien mit 2 bis 4 Sitzen enden', () => {
    for (const players of [2, 3, 4]) {
      const seats: SeatController[] = Array.from({ length: players }, (_, i) => ({
        type: 'bot',
        level: (['leicht', 'mittel', 'schwer'] as const)[i % 3]!,
      }));
      const m = runBots(
        game,
        createMatch(game, 11 + players, { schlagpflicht: players === 3 }, seats),
      );
      expect(game.outcome(m.state)).not.toBeNull();
    }
    const s = fresh();
    expect(game.bot!(s, 0, 'schwer', createRng(1))).toEqual({ type: 'wuerfeln' });
  }, 60_000);
});
