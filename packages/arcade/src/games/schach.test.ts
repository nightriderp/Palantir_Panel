import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type SeatController, createMatch, runBots } from '../turn.js';
import { game, type SchachMove, type SchachState } from './schach.js';
import { LEVEL_CONFIG, Position, chooseMove, perft } from './schach-engine.js';

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

/** Feldnummer aus „e4". */
function sq(name: string): number {
  return (Number(name[1]) - 1) * 8 + 'abcdefgh'.indexOf(name[0]!);
}

function play(state: SchachState, moves: string[]): SchachState {
  let s = state;
  for (const text of moves) {
    const [from, to, promo] = [text.slice(0, 2), text.slice(2, 4), text[4]];
    const move: SchachMove = { type: 'zug', from: sq(from), to: sq(to) };
    if (promo) move.promotion = promo as 'q';
    const r = game.applyMove(s, s.side, move);
    if (!r.ok) throw new Error(`${text}: ${r.error}`);
    s = r.state;
  }
  return s;
}

/** Zustand aus FEN (nur für Tests). */
function fromFen(fen: string): SchachState {
  const pos = Position.fromFen(fen)!;
  const base = game.setup({ players: 2, seed: 1, options: {} });
  return {
    ...base,
    board: pos.boardString(),
    side: pos.side,
    castling: pos.castle,
    ep: pos.ep,
    halfmove: pos.half,
    fullmove: pos.full,
    keys: [pos.key()],
  };
}

describe('schach – Zuggenerator (Perft)', () => {
  it('Grundstellung Tiefe 1–3', () => {
    const pos = Position.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')!;
    expect(perft(pos, 1)).toBe(20);
    expect(perft(pos, 2)).toBe(400);
    expect(perft(pos, 3)).toBe(8902);
  });

  it('Kiwipete Tiefe 1–2 (Rochade, en passant, Umwandlung)', () => {
    const pos = Position.fromFen(KIWIPETE)!;
    expect(perft(pos, 1)).toBe(48);
    expect(perft(pos, 2)).toBe(2039);
    // Die Stellung bleibt nach dem Zurücknehmen unverändert.
    expect(pos.boardString()).toBe(Position.fromFen(KIWIPETE)!.boardString());
  });

  it('Stellung 3 Tiefe 1–3 (en passant mit Fesselung)', () => {
    const pos = Position.fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1')!;
    expect(perft(pos, 1)).toBe(14);
    expect(perft(pos, 2)).toBe(191);
    expect(perft(pos, 3)).toBe(2812);
  });
});

describe('schach – Regeln', () => {
  it('Narrenmatt mit Kurznotation', () => {
    const s = play(game.setup({ players: 2, seed: 1, options: {} }), [
      'f2f3',
      'e7e5',
      'g2g4',
      'd8h4',
    ]);
    expect(s.san).toEqual(['f3', 'e5', 'g4', 'Dh4#']);
    expect(game.outcome(s)).toEqual({ winners: [1], summary: 'Schachmatt – Schwarz gewinnt.' });
    expect(game.activeSeats(s)).toEqual([]);
  });

  it('Rochade durch ein angegriffenes Feld ist verboten', () => {
    // Schwarzer Läufer auf c4 greift f1 an.
    const s = fromFen('r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1');
    expect(game.applyMove(s, 0, { type: 'zug', from: sq('e1'), to: sq('g1') }).ok).toBe(false);
    const long = game.applyMove(s, 0, { type: 'zug', from: sq('e1'), to: sq('c1') });
    expect(long.ok && long.state.san.at(-1)).toBe('O-O-O');
    if (long.ok) expect(long.state.board[sq('d1')]).toBe('R');
  });

  it('en passant', () => {
    const s = play(game.setup({ players: 2, seed: 1, options: {} }), [
      'e2e4',
      'a7a6',
      'e4e5',
      'd7d5',
      'e5d6',
    ]);
    expect(s.san.at(-1)).toBe('exd6');
    expect(s.board[sq('d5')]).toBe('.');
    expect(s.captured[0]).toBe('p');
  });

  it('Umwandlung verlangt eine Wahl und notiert sie', () => {
    const s = fromFen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
    const noChoice = game.applyMove(s, 0, { type: 'zug', from: sq('e7'), to: sq('e8') });
    expect(noChoice.ok).toBe(false);
    const r = game.applyMove(s, 0, { type: 'zug', from: sq('e7'), to: sq('e8'), promotion: 'n' });
    expect(r.ok && r.state.board[sq('e8')]).toBe('N');
    expect(r.ok && r.state.san.at(-1)).toBe('e8=S');
  });

  it('Patt', () => {
    const s = fromFen('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
    const r = game.applyMove(s, 0, { type: 'zug', from: sq('f1'), to: sq('f7') });
    expect(r.ok && r.state.result?.summary).toBe('Patt – Remis.');
  });

  it('ungenügendes Material nach dem Schlag', () => {
    const s = fromFen('8/8/8/3k4/3n4/4K3/8/8 w - - 0 1');
    const r = game.applyMove(s, 0, { type: 'zug', from: sq('e3'), to: sq('d4') });
    // Der Springer ist vom schwarzen König gedeckt.
    expect(r.ok).toBe(false);
    const s2 = fromFen('8/8/8/8/3n4/4K3/8/7k w - - 0 1');
    const r2 = game.applyMove(s2, 0, { type: 'zug', from: sq('e3'), to: sq('d4') });
    expect(r2.ok && r2.state.result?.summary).toBe('Ungenügendes Material – Remis.');
  });

  it('dreifache Stellungswiederholung', () => {
    const s = play(game.setup({ players: 2, seed: 1, options: {} }), [
      'g1f3',
      'g8f6',
      'f3g1',
      'f6g8',
      'g1f3',
      'g8f6',
      'f3g1',
      'f6g8',
    ]);
    expect(s.result?.summary).toBe('Dreifache Stellungswiederholung – Remis.');
  });

  it('50-Züge-Regel', () => {
    const s = fromFen('8/8/8/3k4/8/8/R7/4K3 w - - 99 80');
    const r = game.applyMove(s, 0, { type: 'zug', from: sq('a2'), to: sq('a3') });
    expect(r.ok && r.state.result?.summary).toBe('50-Züge-Regel – Remis.');
  });

  it('Aufgeben und Remisangebot', () => {
    const s = game.setup({ players: 2, seed: 1, options: {} });
    const give = game.applyMove(s, 0, { type: 'aufgeben' });
    expect(give.ok && give.state.result?.winners).toEqual([1]);
    const offer = game.applyMove(s, 0, { type: 'remis-anbieten' });
    expect(offer.ok).toBe(true);
    if (!offer.ok) return;
    const after = play(offer.state, ['e2e4']);
    expect(after.drawOffer).toBe(0);
    const accept = game.applyMove(after, 1, { type: 'remis-annehmen' });
    expect(accept.ok && accept.state.result?.winners).toEqual([]);
    // Ein Zug statt Annahme lehnt ab.
    const declined = play(after, ['e7e5']);
    expect(declined.drawOffer).toBeNull();
    expect(game.applyMove(declined, 0, { type: 'remis-annehmen' }).ok).toBe(false);
  });

  it('falscher Sitz und illegale Züge werden abgelehnt', () => {
    const s = game.setup({ players: 2, seed: 1, options: {} });
    expect(game.applyMove(s, 1, { type: 'zug', from: sq('e7'), to: sq('e5') }).ok).toBe(false);
    expect(game.applyMove(s, 0, { type: 'zug', from: sq('e2'), to: sq('e5') }).ok).toBe(false);
    expect(game.applyMove(s, 0, { type: 'zug', from: sq('e7'), to: sq('e5') }).ok).toBe(false);
  });

  it('applyMove verändert den Zustand nicht', () => {
    const s = game.setup({ players: 2, seed: 1, options: {} });
    const copy = JSON.stringify(s);
    game.applyMove(s, 0, { type: 'zug', from: sq('e2'), to: sq('e4') });
    game.applyMove(s, 0, { type: 'aufgeben' });
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe('schach – parseMove und Sicht', () => {
  it('lehnt Unfug ab', () => {
    for (const raw of [
      null,
      42,
      'e2e4',
      [],
      { type: 'zug' },
      { type: 'zug', from: -1, to: 3 },
      { type: 'zug', from: 1.5, to: 3 },
      { type: 'zug', from: 12, to: 64 },
      { type: 'zug', from: 12, to: 12 },
      { type: 'zug', from: 52, to: 60, promotion: 'k' },
      { type: 'schummeln' },
    ]) {
      expect(game.parseMove(raw)).toBeNull();
    }
    expect(game.parseMove({ type: 'zug', from: 12, to: 28 })).toEqual({
      type: 'zug',
      from: 12,
      to: 28,
    });
    expect(game.parseMove({ type: 'aufgeben', extra: 1 })).toEqual({ type: 'aufgeben' });
    expect(game.parseOptions('x')).toBeNull();
  });

  it('Sicht zeigt legale Züge, Schach und ist reines JSON', () => {
    const s = play(game.setup({ players: 2, seed: 1, options: {} }), ['e2e4', 'f7f6', 'd1h5']);
    const v = game.view(s, 1);
    expect(v.checkSquare).toBe(sq('e8'));
    expect(v.legal).toEqual(expect.arrayContaining([[sq('g7'), sq('g6')]]));
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(game.view(s, null)).toEqual(v);
  });
});

describe('schach – Computer', () => {
  it('findet Matt in eins auf allen Stufen', () => {
    // Weiß: Dh5xf7# (Schäfermatt-Stellung).
    const s = play(game.setup({ players: 2, seed: 1, options: {} }), [
      'e2e4',
      'e7e5',
      'f1c4',
      'b8c6',
      'd1h5',
      'g8f6',
    ]);
    for (const level of ['leicht', 'mittel', 'schwer'] as const) {
      const move = game.bot!(s, 0, level, createRng(7));
      expect(move).toEqual({ type: 'zug', from: sq('h5'), to: sq('f7') });
    }
  });

  it('bleibt im Knotenbudget', () => {
    const pos = Position.fromFen(KIWIPETE)!;
    for (const level of ['leicht', 'mittel', 'schwer'] as const) {
      const { nodes } = chooseMove(pos, level, createRng(3));
      expect(nodes).toBeLessThanOrEqual(LEVEL_CONFIG[level].budget + 1);
    }
  });

  it('ist deterministisch', () => {
    const s = game.setup({ players: 2, seed: 1, options: {} });
    expect(game.bot!(s, 0, 'schwer', createRng(5))).toEqual(
      game.bot!(s, 0, 'schwer', createRng(5)),
    );
  });

  it('Bot gegen Bot endet', () => {
    const pairs: [SeatController, SeatController][] = [
      [
        { type: 'bot', level: 'leicht' },
        { type: 'bot', level: 'leicht' },
      ],
      [
        { type: 'bot', level: 'mittel' },
        { type: 'bot', level: 'leicht' },
      ],
    ];
    for (const [i, seats] of pairs.entries()) {
      const match = runBots(game, createMatch(game, 100 + i, {}, seats));
      expect(game.outcome(match.state)).not.toBeNull();
    }
  }, 120_000);
});
