import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type SeatController, createMatch, runBots } from '../turn.js';
import { type DameState, QUIET_LIMIT, chooseDameMove, game } from './dame.js';

function sq(name: string): number {
  return (Number(name[1]) - 1) * 8 + 'abcdefgh'.indexOf(name[0]!);
}

/** Brett aus einer Liste „c3:w" usw. */
function position(pieces: string[], side: 0 | 1 = 0): DameState {
  const cells = Array.from({ length: 64 }, () => '.');
  for (const p of pieces) {
    const [name, ch] = p.split(':') as [string, string];
    cells[sq(name)] = ch;
  }
  return { ...game.setup({ players: 2, seed: 1, options: {} }), board: cells.join(''), side };
}

const path = (...names: string[]) => ({ path: names.map(sq) });

describe('dame – Regeln', () => {
  it('Aufstellung: je 12 Steine, Weiß beginnt mit 7 Zügen', () => {
    const s = game.setup({ players: 2, seed: 1, options: {} });
    expect([...s.board].filter((c) => c === 'w')).toHaveLength(12);
    expect([...s.board].filter((c) => c === 'b')).toHaveLength(12);
    expect(game.activeSeats(s)).toEqual([0]);
    expect(game.view(s, 0).legal).toHaveLength(7);
  });

  it('Männer ziehen nur vorwärts', () => {
    const s = position(['d4:w', 'h8:b']);
    expect(game.applyMove(s, 0, path('d4', 'c3')).ok).toBe(false);
    expect(game.applyMove(s, 0, path('d4', 'e5')).ok).toBe(true);
  });

  it('Schlagpflicht, auch rückwärts', () => {
    const s = position(['d4:w', 'c3:b', 'h8:b']);
    const v = game.view(s, 0);
    expect(v.mustCapture).toBe(true);
    expect(v.legal).toEqual([[sq('d4'), sq('b2')]]);
    expect(game.applyMove(s, 0, path('d4', 'e5')).ok).toBe(false);
    const r = game.applyMove(s, 0, path('d4', 'b2'));
    expect(r.ok && r.state.board[sq('c3')]).toBe('.');
  });

  it('Mehrfachsprung muss vollständig sein', () => {
    const s = position(['a1:w', 'b2:b', 'd4:b', 'h8:b']);
    expect(game.applyMove(s, 0, path('a1', 'c3')).ok).toBe(false);
    const r = game.applyMove(s, 0, path('a1', 'c3', 'e5'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.lastCaptured.sort()).toEqual([sq('b2'), sq('d4')].sort());
      expect(r.state.side).toBe(1);
    }
  });

  it('Umwandlung beendet den Zug', () => {
    // Nach dem Sprung auf f8 wäre ein weiterer Sprung über g7 möglich – als Mann nicht mehr.
    const s = position(['d6:w', 'e7:b', 'g7:b', 'a1:b']);
    const v = game.view(s, 0);
    expect(v.legal).toEqual([[sq('d6'), sq('f8')]]);
    const r = game.applyMove(s, 0, path('d6', 'f8'));
    expect(r.ok && r.state.board[sq('f8')]).toBe('W');
  });

  it('Damen fliegen und schlagen auf Distanz', () => {
    const s = position(['a1:W', 'd4:b', 'h2:b']);
    const v = game.view(s, 0);
    // Landen auf e5, f6, g7 oder h8.
    expect(v.legal).toHaveLength(4);
    const r = game.applyMove(s, 0, path('a1', 'g7'));
    expect(r.ok && r.state.board[sq('d4')]).toBe('.');
    const quiet = position(['a1:W', 'h8:b']);
    expect(game.view(quiet, 0).legal.length).toBeGreaterThan(1);
  });

  it('ein Stein wird nicht zweimal übersprungen', () => {
    // Dame auf a1 kann d4 schlagen; zurück über d4 darf sie nicht.
    const s = position(['a1:W', 'd4:b']);
    for (const p of game.view(s, 0).legal) expect(p).toHaveLength(2);
  });

  it('Sieg, wenn der Gegner keine Steine mehr hat', () => {
    const s = position(['d4:w', 'e5:b']);
    const r = game.applyMove(s, 0, path('d4', 'f6'));
    expect(r.ok && game.outcome(r.state)?.winners).toEqual([0]);
  });

  it('Sieg, wenn der Gegner blockiert ist', () => {
    // Schwarz b2 ist eingemauert: Zielfelder besetzt, Sprünge landen auf besetzten Feldern.
    const s = position(['a1:w', 'c1:w', 'a3:w', 'c3:w', 'd4:w', 'h2:w', 'b2:b'], 0);
    const r = game.applyMove(s, 0, path('h2', 'g3'));
    expect(r.ok && game.outcome(r.state)?.summary).toContain('kann nicht mehr ziehen');
  });

  it('Remis nach 40 Zügen je Seite ohne Schlag', () => {
    const s = { ...position(['a1:W', 'h8:B']), quiet: QUIET_LIMIT - 1 };
    const r = game.applyMove(s, 0, path('a1', 'b2'));
    expect(r.ok && game.outcome(r.state)?.winners).toEqual([]);
  });

  it('parseMove lehnt Unfug ab', () => {
    for (const raw of [
      null,
      'a1',
      { path: [] },
      { path: [0] },
      { path: [0, 1] }, // helles Feld
      { path: [0, 64] },
      { path: [0, 9.5] },
      { path: 'a1b2' },
      { path: Array.from({ length: 30 }, () => 0) },
    ]) {
      expect(game.parseMove(raw)).toBeNull();
    }
    expect(game.parseMove({ path: [sq('c3'), sq('d4')] })).toEqual({ path: [18, 27] });
  });

  it('applyMove verändert den Zustand nicht, falscher Sitz wird abgelehnt', () => {
    const s = game.setup({ players: 2, seed: 1, options: {} });
    const copy = JSON.stringify(s);
    expect(game.applyMove(s, 1, path('b6', 'a5')).ok).toBe(false);
    game.applyMove(s, 0, path('c3', 'd4'));
    expect(JSON.stringify(s)).toBe(copy);
    expect(JSON.parse(JSON.stringify(game.view(s, 1)))).toEqual(game.view(s, 1));
  });
});

describe('dame – Computer', () => {
  it('nimmt den Doppelsprung statt des einfachen Schlags', () => {
    const s = position(['a1:w', 'b2:b', 'd4:b', 'g3:w', 'h4:b', 'h8:b']);
    expect(game.bot!(s, 0, 'schwer', createRng(1))).toEqual(path('a1', 'c3', 'e5'));
  });

  it('bleibt im Knotenbudget und ist deterministisch', () => {
    const s = game.setup({ players: 2, seed: 1, options: {} });
    for (const level of ['leicht', 'mittel', 'schwer'] as const) {
      const a = chooseDameMove(s.board, 0, level, createRng(4));
      const b = chooseDameMove(s.board, 0, level, createRng(4));
      expect(a).toEqual(b);
      expect(a.nodes).toBeLessThanOrEqual(30_001);
    }
  });

  it('Bot gegen Bot endet', () => {
    const pairs: [SeatController, SeatController][] = [
      [
        { type: 'bot', level: 'leicht' },
        { type: 'bot', level: 'mittel' },
      ],
      [
        { type: 'bot', level: 'schwer' },
        { type: 'bot', level: 'leicht' },
      ],
    ];
    for (const [i, seats] of pairs.entries()) {
      const match = runBots(game, createMatch(game, 30 + i, {}, seats));
      expect(game.outcome(match.state)).not.toBeNull();
    }
  }, 120_000);
});
