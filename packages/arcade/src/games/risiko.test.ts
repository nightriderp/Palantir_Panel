import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS,
  type BotLevel,
  type SeatController,
  type TurnMatch,
  applyRawMove,
  createMatch,
  runBots,
  stepBot,
} from '../turn.js';
import { createRng } from '../rng.js';
import {
  game,
  isValidSet,
  tradeValue,
  baseIncome,
  type RisikoOptions,
  type RisikoState,
} from './risiko.js';
import { ADJACENCY, CONTINENTS, TERRITORY_COUNT } from './risiko-karte.js';

const OPTS: RisikoOptions = { autoPlace: true, quick: false, roundLimit: 0 };

function fresh(players = 3, options: Partial<RisikoOptions> = {}, seed = 7): RisikoState {
  return game.setup({ players, seed, options: { ...OPTS, ...options } });
}

function apply(s: RisikoState, seat: number, move: unknown): RisikoState {
  const parsed = game.parseMove(move);
  if (!parsed) throw new Error(`nicht lesbar: ${JSON.stringify(move)}`);
  const r = game.applyMove(s, seat, parsed);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Zustand von Hand zurechtlegen: Sitz 0 besitzt alles außer den angegebenen Ländern. */
function arranged(
  others: Record<number, [number, number]>,
  mine: Record<number, number> = {},
): RisikoState {
  const s = structuredClone(fresh(2));
  s.owner = s.owner.map(() => 0);
  s.armies = s.armies.map(() => 1);
  for (const [t, [o, a]] of Object.entries(others)) {
    s.owner[Number(t)] = o;
    s.armies[Number(t)] = a;
  }
  for (const [t, a] of Object.entries(mine)) s.armies[Number(t)] = a;
  s.current = 0;
  s.phase = 'attack';
  s.reinforcements = 0;
  return s;
}

describe('Risiko – Karte', () => {
  it('hat 42 Länder, sechs Kontinente mit klassischen Boni und symmetrische Nachbarschaften', () => {
    expect(TERRITORY_COUNT).toBe(42);
    expect(CONTINENTS.map((c) => c.members.length)).toEqual([9, 4, 7, 6, 12, 4]);
    expect(CONTINENTS.map((c) => c.bonus)).toEqual([5, 2, 5, 3, 7, 2]);
    let edges = 0;
    ADJACENCY.forEach((list, a) => {
      for (const b of list) {
        expect(ADJACENCY[b]).toContain(a);
        edges += 1;
      }
    });
    expect(edges / 2).toBe(83);
    // Alaska – Kamtschatka über die Beringstraße.
    expect(ADJACENCY[0]).toContain(30);
  });
});

describe('Risiko – Aufbau', () => {
  it('verteilt alle Länder und die Startarmeen je nach Spielerzahl', () => {
    for (const [players, start] of [
      [2, 40],
      [3, 35],
      [4, 30],
      [5, 25],
      [6, 20],
    ] as const) {
      const s = fresh(players);
      expect(s.owner.every((o) => o >= 0 && o < players)).toBe(true);
      for (let p = 0; p < players; p += 1) {
        const total = s.owner.reduce((sum, o, t) => sum + (o === p ? (s.armies[t] ?? 0) : 0), 0);
        expect(total).toBe(start);
      }
      expect(s.phase).toBe('reinforce');
    }
  });

  it('lässt die Startarmeen ohne Automatik reihum einzeln setzen', () => {
    let s = fresh(3, { autoPlace: false });
    expect(s.phase).toBe('setup');
    const first = s.current;
    const own = s.owner.indexOf(first);
    expect(game.applyMove(s, first, { type: 'place', t: own, n: 2 }).ok).toBe(false);
    s = apply(s, first, { type: 'place', t: own, n: 1 });
    expect(s.current).not.toBe(first);
    s = apply(s, s.current, { type: 'autoSetup' });
    expect(s.phase).toBe('setup');
  });

  it('ist deterministisch', () => {
    expect(fresh(4, {}, 99)).toEqual(fresh(4, {}, 99));
  });
});

describe('Risiko – Regeln', () => {
  it('berechnet die Verstärkung aus Ländern und Kontinenten', () => {
    const owner = new Array<number>(42).fill(1);
    for (const t of [38, 39, 40, 41]) owner[t] = 0; // Australien
    expect(baseIncome(owner, 0)).toBe(3 + 2);
    for (let t = 0; t < 12; t += 1) owner[t] = 0; // + Nord- und Südamerika bis Brasilien
    expect(baseIncome(owner, 0)).toBe(Math.floor(16 / 3) + 2 + 5);
  });

  it('kennt die Tauschsätze und steigenden Belohnungen', () => {
    expect(
      isValidSet([
        { t: 0, k: 0 },
        { t: 1, k: 0 },
        { t: 2, k: 0 },
      ]),
    ).toBe(true);
    expect(
      isValidSet([
        { t: 0, k: 0 },
        { t: 1, k: 1 },
        { t: 2, k: 2 },
      ]),
    ).toBe(true);
    expect(
      isValidSet([
        { t: 0, k: 0 },
        { t: 1, k: 0 },
        { t: -1, k: 3 },
      ]),
    ).toBe(true);
    expect(
      isValidSet([
        { t: 0, k: 0 },
        { t: 1, k: 0 },
        { t: 2, k: 1 },
      ]),
    ).toBe(false);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(tradeValue)).toEqual([4, 6, 8, 10, 12, 15, 20, 25]);
  });

  it('erzwingt den Tausch ab fünf Karten und gibt +2 auf ein eigenes Land', () => {
    const s = structuredClone(fresh(2));
    const seat = s.current;
    const own = s.owner.indexOf(seat);
    s.hands[seat] = [
      { t: own, k: 0 },
      { t: 0, k: 0 },
      { t: 1, k: 0 },
      { t: 2, k: 1 },
      { t: 3, k: 2 },
    ];
    expect(game.applyMove(s, seat, { type: 'place', t: own, n: 1 }).ok).toBe(false);
    const before = s.armies[own] ?? 0;
    const r = apply(s, seat, { type: 'trade', cards: [0, 1, 2] });
    expect(r.reinforcements).toBe(s.reinforcements + 4);
    expect(r.hands[seat]).toHaveLength(2);
    expect(r.armies[own]).toBe(before + 2);
    expect(r.trades).toBe(1);
    expect(game.applyMove(s, seat, { type: 'trade', cards: [0, 1, 3] }).ok).toBe(false);
  });

  it('prüft Angriffe: Nachbarschaft, eigene Länder, zwei Armeen', () => {
    const s = arranged({ 1: [1, 3], 41: [1, 1] }, { 0: 5 });
    expect(game.applyMove(s, 0, { type: 'attack', from: 0, to: 41 }).ok).toBe(false); // nicht benachbart
    expect(game.applyMove(s, 0, { type: 'attack', from: 2, to: 1 }).ok).toBe(false); // nur 1 Armee
    expect(game.applyMove(s, 0, { type: 'attack', from: 1, to: 0 }).ok).toBe(false); // fremdes Land
    expect(game.applyMove(s, 1, { type: 'attack', from: 1, to: 0 }).ok).toBe(false); // nicht am Zug
    const r = apply(s, 0, { type: 'attack', from: 0, to: 1, dice: 3 });
    const rep = r.lastAttack;
    expect(rep).not.toBeNull();
    expect(rep?.atk).toHaveLength(3);
    expect(rep?.def).toHaveLength(2);
    expect((rep?.lossA ?? 0) + (rep?.lossD ?? 0)).toBe(2);
    // Würfel sind absteigend sortiert und der Vergleich stimmt.
    const a = rep?.atk ?? [];
    const d = rep?.def ?? [];
    const expectedLossD = [0, 1].filter((i) => (a[i] ?? 0) > (d[i] ?? 0)).length;
    expect(rep?.lossD).toBe(expectedLossD);
  });

  it('Blitzangriff läuft bis zur Eroberung oder zur Schwelle, danach Nachziehen', () => {
    const s = arranged({ 1: [1, 2], 41: [1, 1] }, { 0: 30 });
    const r = apply(s, 0, { type: 'attack', from: 0, to: 1, blitz: true });
    expect(r.owner[1]).toBe(0);
    expect(r.phase).toBe('occupy');
    expect(r.occupy?.min).toBe(3);
    expect(game.applyMove(r, 0, { type: 'occupy', n: 2 }).ok).toBe(false);
    const max = (r.armies[0] ?? 0) - 1;
    const done = apply(r, 0, { type: 'occupy', n: max });
    expect(done.armies[0]).toBe(1);
    expect(done.phase).toBe('attack');
    expect(done.conqueredThisTurn).toBe(true);

    const weak = arranged({ 1: [1, 40] }, { 0: 10 });
    const stopped = apply(weak, 0, { type: 'attack', from: 0, to: 1, blitz: true, stopAt: 4 });
    expect(stopped.armies[0]).toBeLessThanOrEqual(4);
    expect(stopped.owner[1]).toBe(1);
  });

  it('Eliminierung gibt die Karten an den Sieger, Weltherrschaft beendet die Partie', () => {
    const s = arranged({ 1: [1, 1] }, { 0: 50 });
    s.hands[1] = [{ t: 5, k: 2 }];
    const r = apply(s, 0, { type: 'attack', from: 0, to: 1, blitz: true });
    expect(r.eliminated[1]).toBe(true);
    expect(r.hands[0]).toHaveLength(1);
    expect(r.phase).toBe('over');
    const out = game.outcome(r);
    expect(out?.winners).toEqual([0]);
    expect(out?.scores).toEqual([42, 0]);
  });

  it('schnelles Spiel endet bei 70 % der Länder', () => {
    const others: Record<number, [number, number]> = {};
    for (let t = 29; t < 42; t += 1) others[t] = [1, 1];
    const s = arranged(others, { 28: 40 });
    s.options.quick = true;
    // Sitz 0 hält 29 Länder; Jakutien (28) greift Kamtschatka (30) an.
    const r = apply(s, 0, { type: 'attack', from: 28, to: 30, blitz: true });
    expect(r.phase).toBe('over');
    expect(game.outcome(r)?.winners).toEqual([0]);
  });

  it('befestigt nur über verbundene eigene Länder und beendet den Zug mit Karte', () => {
    // Siam gehört Sitz 1 und trennt Australien vom Rest.
    const s = arranged({ 37: [1, 3], 38: [0, 1] }, { 0: 6 });
    s.owner[38] = 0;
    s.conqueredThisTurn = true;
    const deck = s.deck.length;
    expect(game.applyMove(s, 0, { type: 'fortify', from: 0, to: 38, n: 2 }).ok).toBe(false);
    expect(game.applyMove(s, 0, { type: 'fortify', from: 0, to: 1, n: 6 }).ok).toBe(false);
    const r = apply(s, 0, { type: 'fortify', from: 0, to: 1, n: 5 });
    expect(r.armies[1]).toBe(6);
    expect(r.current).toBe(1);
    expect(r.phase).toBe('reinforce');
    expect(r.hands[0]).toHaveLength(1);
    expect(r.deck.length).toBe(deck - 1);
  });

  it('Rundenlimit: meiste Länder gewinnt', () => {
    let s = fresh(2, { roundLimit: 1 });
    for (let i = 0; i < 2; i += 1) {
      const seat = s.current;
      const own = s.owner.indexOf(seat);
      s = apply(s, seat, { type: 'place', t: own, n: s.reinforcements });
      s = apply(s, seat, { type: 'endTurn' });
    }
    expect(s.phase).toBe('over');
    expect(game.outcome(s)?.scores).toEqual([21, 21]);
  });
});

describe('Risiko – fremde Daten', () => {
  it('lehnt unsinnige Züge ab', () => {
    for (const raw of [
      null,
      42,
      'attack',
      [],
      {},
      { type: 'fly' },
      { type: 'place', t: 42, n: 1 },
      { type: 'place', t: 0, n: 0 },
      { type: 'place', t: 1.5, n: 1 },
      { type: 'trade', cards: [0, 1] },
      { type: 'trade', cards: [0, 1, 'x'] },
      { type: 'attack', from: 0 },
      { type: 'attack', from: 0, to: 1, dice: 4 },
      { type: 'attack', from: 0, to: 1, blitz: 'ja' },
      { type: 'attack', from: 0, to: 1, moveIn: 'alles' },
      { type: 'occupy', n: -1 },
      { type: 'fortify', from: 0, to: 1 },
    ]) {
      expect(game.parseMove(raw), JSON.stringify(raw)).toBeNull();
    }
    expect(game.parseMove({ type: 'endTurn', extra: 1 })).toEqual({ type: 'endTurn' });
  });

  it('prüft Einstellungen', () => {
    expect(game.parseOptions({})).toEqual({ autoPlace: false, quick: false, roundLimit: 0 });
    expect(game.parseOptions({ quick: true, roundLimit: 30 })).toEqual({
      autoPlace: false,
      quick: true,
      roundLimit: 30,
    });
    expect(game.parseOptions({ quick: 'ja' })).toBeNull();
    expect(game.parseOptions({ roundLimit: 9999 })).toBeNull();
    expect(game.parseOptions([])).toBeNull();
  });
});

describe('Risiko – Sicht', () => {
  it('zeigt nur die eigenen Karten und nicht den Stapel', () => {
    const s = structuredClone(fresh(3));
    s.hands[0] = [{ t: 4, k: 1 }];
    s.hands[1] = [
      { t: 7, k: 2 },
      { t: -1, k: 3 },
    ];
    const v = game.view(s, 0);
    expect(v.hand).toEqual([{ t: 4, k: 1 }]);
    expect(v.handCounts).toEqual([1, 2, 0]);
    const text = JSON.stringify(v);
    expect(text).not.toContain('"deck"');
    expect(text).not.toContain('"hands"');
    expect(text).not.toContain('"rng"');
    expect(game.view(s, null).hand).toBeNull();
    expect(game.hiddenInformation).toBe(true);
  });
});

describe('Risiko – Computergegner', () => {
  function playOut(match: TurnMatch<RisikoState, RisikoOptions>, cap: number) {
    let m = match;
    for (let i = 0; i < cap; i += 1) {
      const next = stepBot(game, m);
      if (next === null) break;
      m = next;
    }
    return m;
  }

  it.each(BOT_LEVELS)(
    'Bots (%s) spielen eine Partie mit Rundenlimit über runBots zu Ende',
    (level: BotLevel) => {
      const seats: SeatController[] = Array.from({ length: 4 }, () => ({ type: 'bot', level }));
      const match = createMatch(
        game,
        1234,
        { autoPlace: false, quick: false, roundLimit: 12 },
        seats,
      );
      const done = runBots(game, match);
      const out = game.outcome(done.state);
      expect(out).not.toBeNull();
      expect(out?.scores?.reduce((a, b) => a + b, 0)).toBe(42);
    },
  );

  it('gemischte Bots erobern die Welt ohne Rundenlimit', () => {
    for (const seed of [1, 2, 3]) {
      const seats: SeatController[] = [
        { type: 'bot', level: 'schwer' },
        { type: 'bot', level: 'mittel' },
        { type: 'bot', level: 'leicht' },
      ];
      const match = createMatch(
        game,
        seed,
        { autoPlace: true, quick: false, roundLimit: 0 },
        seats,
      );
      const done = playOut(match, 20_000);
      expect(game.outcome(done.state), `Startwert ${seed}`).not.toBeNull();
    }
  });

  it('schwer schlägt leicht meistens', () => {
    let wins = 0;
    for (let seed = 10; seed < 20; seed += 1) {
      const seats: SeatController[] = [
        { type: 'bot', level: 'schwer' },
        { type: 'bot', level: 'leicht' },
      ];
      const done = playOut(
        createMatch(game, seed, { autoPlace: true, quick: true, roundLimit: 40 }, seats),
        20_000,
      );
      if (game.outcome(done.state)?.winners.includes(0)) wins += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(7);
  });

  it('Bot-Züge sind deterministisch und schnell', () => {
    const seats: SeatController[] = Array.from({ length: 6 }, () => ({
      type: 'bot',
      level: 'schwer' as const,
    }));
    let m = createMatch(game, 55, { autoPlace: true, quick: false, roundLimit: 0 }, seats);
    let slowest = 0;
    for (let i = 0; i < 300 && !game.outcome(m.state); i += 1) {
      const seat = game.activeSeats(m.state)[0] ?? 0;
      const t0 = performance.now();
      const a = game.bot?.(m.state, seat, 'schwer', createRng(i));
      slowest = Math.max(slowest, performance.now() - t0);
      const b = game.bot?.(m.state, seat, 'schwer', createRng(i));
      expect(a).toEqual(b);
      const r = applyRawMove(game, m, seat, a);
      expect(r.ok).toBe(true);
      if (r.ok) m = r.state;
    }
    expect(slowest).toBeLessThan(150);
  });
});
