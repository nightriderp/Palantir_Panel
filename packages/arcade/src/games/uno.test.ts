import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type BotLevel, type SeatController, createMatch, runBots, stepBot } from '../turn.js';
import { type UnoCard, type UnoState, cardPoints, game } from './uno.js';

function setup(players: number, seed = 1, options = game.defaultOptions): UnoState {
  return game.setup({ players, seed, options });
}

function card(id: number, farbe: UnoCard['farbe'], art: UnoCard['art'], zahl = -1): UnoCard {
  return { id, farbe, art, zahl };
}

/** Handgebauter Zustand: Sitz 0 am Zug, Rot 5 oben. */
function fixed(hands: UnoCard[][], extra: Partial<UnoState> = {}): UnoState {
  const s = setup(hands.length);
  return {
    ...s,
    hands,
    ablage: [card(200, 'rot', 'zahl', 5)],
    stapel: [
      card(300, 'gelb', 'zahl', 1),
      card(301, 'gelb', 'zahl', 2),
      card(302, 'gelb', 'zahl', 3),
      card(303, 'gelb', 'zahl', 4),
      card(304, 'gelb', 'zahl', 6),
    ],
    farbe: 'rot',
    am: 0,
    richtung: 1,
    phase: 'legen',
    gezogen: null,
    strafe: 0,
    uno: null,
    ...extra,
  };
}

function apply(s: UnoState, seat: number, raw: unknown): UnoState {
  const move = game.parseMove(raw);
  if (!move) throw new Error('unlesbar');
  const r = game.applyMove(s, seat, move);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('UNO – Aufbau', () => {
  it('gibt 7 Karten je Sitz und zählt 108 Karten', () => {
    const s = setup(4, 42);
    for (const h of s.hands) expect(h.length === 7 || h.length === 9).toBe(true);
    const total = s.hands.reduce((a, h) => a + h.length, 0) + s.stapel.length + s.ablage.length;
    expect(total).toBe(108);
    const ids = new Set([...s.hands.flat(), ...s.stapel, ...s.ablage].map((c) => c.id));
    expect(ids.size).toBe(108);
  });

  it('legt nie eine +4 als Startkarte', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      expect(setup(3, seed).ablage[0]?.art).not.toBe('plus4');
    }
  });

  it('ist deterministisch', () => {
    expect(setup(5, 9)).toEqual(setup(5, 9));
  });
});

describe('UNO – Züge', () => {
  it('erlaubt passende Farbe oder Zahl und lehnt Unpassendes ab', () => {
    const s = fixed([
      [
        card(1, 'rot', 'zahl', 2),
        card(2, 'blau', 'zahl', 5),
        card(3, 'blau', 'zahl', 7),
        card(9, 'gelb', 'zahl', 1),
      ],
      [card(4, 'gelb', 'zahl', 3), card(5, 'gelb', 'zahl', 4)],
    ]);
    expect(game.applyMove(s, 0, { type: 'legen', karte: 3, farbe: null, uno: false }).ok).toBe(
      false,
    );
    expect(game.applyMove(s, 1, { type: 'legen', karte: 4, farbe: null, uno: false }).ok).toBe(
      false,
    );
    const a = apply(s, 0, { type: 'legen', karte: 2 });
    expect(a.farbe).toBe('blau');
    expect(a.am).toBe(1);
    expect(game.view(s, 0).spielbar.sort()).toEqual([1, 2]);
  });

  it('verlangt bei Farbwahl eine Farbe', () => {
    const s = fixed([
      [card(1, 'schwarz', 'farbwahl'), card(2, 'blau', 'zahl', 7), card(3, 'blau', 'zahl', 8)],
      [card(4, 'gelb', 'zahl', 3)],
    ]);
    expect(game.applyMove(s, 0, { type: 'legen', karte: 1, farbe: null, uno: false }).ok).toBe(
      false,
    );
    expect(apply(s, 0, { type: 'legen', karte: 1, farbe: 'gruen' }).farbe).toBe('gruen');
  });

  it('Aussetzen überspringt, Richtungswechsel dreht, bei zwei Sitzen wirkt er wie Aussetzen', () => {
    const three = fixed([
      [card(1, 'rot', 'aussetzen'), card(2, 'rot', 'richtung'), card(3, 'blau', 'zahl', 1)],
      [card(4, 'gelb', 'zahl', 3)],
      [card(5, 'gelb', 'zahl', 4)],
    ]);
    expect(apply(three, 0, { type: 'legen', karte: 1 }).am).toBe(2);
    const rev = apply(three, 0, { type: 'legen', karte: 2 });
    expect(rev.richtung).toBe(-1);
    expect(rev.am).toBe(2);
    const two = fixed([
      [card(2, 'rot', 'richtung'), card(3, 'blau', 'zahl', 1)],
      [card(4, 'gelb', 'zahl', 3)],
    ]);
    expect(apply(two, 0, { type: 'legen', karte: 2, uno: true }).am).toBe(0);
  });

  it('+2 lässt den Nächsten ziehen und aussetzen', () => {
    const s = fixed([
      [card(1, 'rot', 'plus2'), card(3, 'blau', 'zahl', 1), card(6, 'blau', 'zahl', 2)],
      [card(4, 'gelb', 'zahl', 3)],
      [card(5, 'gelb', 'zahl', 4)],
    ]);
    const a = apply(s, 0, { type: 'legen', karte: 1 });
    expect(a.hands[1]?.length).toBe(3);
    expect(a.am).toBe(2);
  });

  it('stapelt +2 mit der Option und zieht die Summe', () => {
    const s = fixed(
      [
        [card(1, 'rot', 'plus2'), card(3, 'blau', 'zahl', 1), card(6, 'blau', 'zahl', 2)],
        [card(4, 'gelb', 'plus2'), card(7, 'gelb', 'zahl', 9), card(8, 'gelb', 'zahl', 8)],
        [card(5, 'gelb', 'zahl', 4), card(10, 'gelb', 'zahl', 5)],
      ],
      { options: { stapeln: true, punktspiel: false } },
    );
    const a = apply(s, 0, { type: 'legen', karte: 1 });
    expect(a.strafe).toBe(2);
    expect(a.am).toBe(1);
    const b = apply(a, 1, { type: 'legen', karte: 4 });
    expect(b.strafe).toBe(4);
    // Sitz 2 hat keine Ziehkarte: nur Ziehen bleibt.
    expect(game.view(b, 2).spielbar).toEqual([]);
    const c = apply(b, 2, { type: 'ziehen' });
    expect(c.hands[2]?.length).toBe(6);
    expect(c.strafe).toBe(0);
    expect(c.am).toBe(0);
  });

  it('nach dem Ziehen darf nur die gezogene Karte gelegt werden', () => {
    const s = fixed(
      [[card(1, 'blau', 'zahl', 1), card(2, 'blau', 'zahl', 2)], [card(4, 'gelb', 'zahl', 3)]],
      { stapel: [card(300, 'rot', 'zahl', 9)] },
    );
    const a = apply(s, 0, { type: 'ziehen' });
    expect(a.phase).toBe('gezogen');
    expect(a.am).toBe(0);
    expect(game.applyMove(a, 0, { type: 'legen', karte: 1, farbe: null, uno: false }).ok).toBe(
      false,
    );
    const b = apply(a, 0, { type: 'behalten' });
    expect(b.am).toBe(1);
  });

  it('beendet die Partie, wenn die letzte Karte liegt', () => {
    const s = fixed([
      [card(1, 'rot', 'zahl', 3)],
      [card(4, 'gelb', 'zahl', 3), card(5, 'schwarz', 'plus4')],
    ]);
    const a = apply(s, 0, { type: 'legen', karte: 1 });
    expect(game.outcome(a)?.winners).toEqual([0]);
    expect(game.activeSeats(a)).toEqual([]);
  });

  it('zählt im Punktspiel klassisch und gibt eine neue Runde', () => {
    const s = fixed(
      [
        [card(1, 'rot', 'zahl', 3)],
        [card(4, 'gelb', 'zahl', 3), card(5, 'schwarz', 'plus4'), card(6, 'blau', 'aussetzen')],
      ],
      { options: { stapeln: false, punktspiel: true } },
    );
    const a = apply(s, 0, { type: 'legen', karte: 1 });
    expect(a.punkte[0]).toBe(3 + 50 + 20);
    expect(game.outcome(a)).toBeNull();
    expect(a.runde).toBe(2);
    expect(a.hands.every((h) => h.length >= 7)).toBe(true);
    expect(cardPoints(card(0, 'schwarz', 'farbwahl'))).toBe(50);
  });
});

describe('UNO – Ruf und Erwischen', () => {
  const base = (): UnoState =>
    fixed([
      [card(1, 'rot', 'zahl', 2), card(2, 'blau', 'zahl', 7)],
      [card(4, 'gelb', 'zahl', 3), card(8, 'gelb', 'zahl', 8)],
      [card(5, 'gelb', 'zahl', 4), card(9, 'gelb', 'zahl', 9)],
    ]);

  it('mit Ruf ist niemand angreifbar', () => {
    const a = apply(base(), 0, { type: 'legen', karte: 1, uno: true });
    expect(a.uno).toBeNull();
    expect(game.view(a, 1).gerufen[0]).toBe(true);
    expect(game.activeSeats(a)).toEqual([1]);
  });

  it('vergessener Ruf öffnet das Fenster für alle anderen', () => {
    const a = apply(base(), 0, { type: 'legen', karte: 1 });
    expect(game.activeSeats(a).sort()).toEqual([1, 2]);
    expect(game.view(a, 2).darfErwischen).toBe(true);
    expect(game.view(a, 0).darfErwischen).toBe(false);
    const b = apply(a, 2, { type: 'erwischt' });
    expect(b.hands[0]?.length).toBe(3);
    expect(b.am).toBe(1);
    expect(game.activeSeats(b)).toEqual([1]);
  });

  it('der nächste reguläre Zug schließt das Fenster', () => {
    const a = apply(base(), 0, { type: 'legen', karte: 1 });
    const b = apply(a, 1, { type: 'ziehen' });
    expect(b.uno).toBeNull();
    expect(game.applyMove(b, 2, { type: 'erwischt' }).ok).toBe(false);
  });

  it('„weiter" nimmt einen Sitz aus dem Fenster', () => {
    const a = apply(base(), 0, { type: 'legen', karte: 1 });
    const b = apply(a, 2, { type: 'weiter' });
    expect(game.activeSeats(b)).toEqual([1]);
    expect(game.applyMove(a, 1, { type: 'weiter' }).ok).toBe(false);
  });
});

describe('UNO – fremde Daten und Sicht', () => {
  it('parseMove lehnt Unfug ab', () => {
    for (const raw of [
      null,
      42,
      'legen',
      { type: 'legen' },
      { type: 'legen', karte: -1 },
      { type: 'legen', karte: 500 },
      { type: 'legen', karte: 1.5 },
      { type: 'legen', karte: 1, farbe: 'lila' },
      { type: 'legen', karte: 1, uno: 'ja' },
      { type: 'mogeln' },
    ]) {
      expect(game.parseMove(raw)).toBeNull();
    }
    expect(game.parseOptions({ stapeln: 'ja' })).toBeNull();
    expect(game.parseOptions({ punktspiel: true })).toEqual({ stapeln: false, punktspiel: true });
  });

  it('die Sicht verrät keine fremden Karten und keinen Stapel', () => {
    const s = setup(4, 7);
    const v = game.view(s, 1);
    const text = JSON.stringify(v);
    expect(v.hand).toEqual(s.hands[1]);
    for (const other of [0, 2, 3]) {
      for (const c of s.hands[other] ?? []) expect(text).not.toContain(`"id":${c.id},`);
    }
    for (const c of s.stapel) expect(text).not.toContain(`"id":${c.id},`);
    expect(game.view(s, null).hand).toEqual([]);
  });
});

describe('UNO – Computergegner', () => {
  const levels: BotLevel[] = ['leicht', 'mittel', 'schwer'];

  it.each([2, 3, 5, 8])('Bot-Partie mit %i Sitzen endet', (players) => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const seats: SeatController[] = Array.from({ length: players }, (_, i) => ({
        type: 'bot',
        level: levels[(i + seed) % 3] as BotLevel,
      }));
      const stapeln = seed % 2 === 0;
      const match = runBots(
        game,
        createMatch(game, seed * 17, { stapeln, punktspiel: false }, seats),
      );
      expect(game.outcome(match.state)).not.toBeNull();
    }
  });

  it('Punktspiel unter Bots endet', () => {
    const seats: SeatController[] = [
      { type: 'bot', level: 'schwer' },
      { type: 'bot', level: 'leicht' },
      { type: 'bot', level: 'mittel' },
    ];
    let match = createMatch(game, 99, { stapeln: true, punktspiel: true }, seats);
    for (let i = 0; i < 20_000; i += 1) {
      const next = stepBot(game, match);
      if (!next) break;
      match = next;
    }
    const out = game.outcome(match.state);
    expect(out).not.toBeNull();
    expect(out?.scores?.length).toBe(3);
  });

  it('„schwer" erwischt einen vergessenen Ruf', () => {
    const s = fixed([
      [card(1, 'rot', 'zahl', 2), card(2, 'blau', 'zahl', 7)],
      [card(4, 'gelb', 'zahl', 3), card(8, 'gelb', 'zahl', 8)],
    ]);
    const a = apply(s, 0, { type: 'legen', karte: 1 });
    expect(game.bot?.(a, 1, 'schwer', createRng(1))).toEqual({ type: 'erwischt' });
    expect(game.bot?.(a, 1, 'mittel', createRng(1)).type).not.toBe('erwischt');
  });

  it('mittel und schwer rufen immer UNO', () => {
    const s = fixed([
      [card(1, 'rot', 'zahl', 2), card(2, 'blau', 'zahl', 7)],
      [card(4, 'gelb', 'zahl', 3)],
    ]);
    for (let seed = 0; seed < 20; seed += 1) {
      const m = game.bot?.(s, 0, 'mittel', createRng(seed));
      expect(m).toMatchObject({ type: 'legen', uno: true });
    }
  });
});
