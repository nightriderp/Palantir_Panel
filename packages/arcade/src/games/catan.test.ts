import { describe, expect, it } from 'vitest';
import { createRng, rollDie } from '../rng.js';
import { type BotLevel, type SeatController, createMatch, runBots, stepBot } from '../turn.js';
import { GEO, pips, redNeighbors } from './catan-board.js';
import { type CatanMove, type CatanOptions, type CatanState, game } from './catan.js';

const OPTS: CatanOptions = { layout: 'einsteiger', targetVp: 10, maxRounds: 0 };

function bots(n: number, level: BotLevel = 'mittel'): SeatController[] {
  return Array.from({ length: n }, () => ({ type: 'bot', level }) as SeatController);
}

function apply(s: CatanState, seat: number, move: CatanMove): CatanState {
  const r = game.applyMove(s, seat, move);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Gründung per Bot erledigen, danach steht Sitz 0 vor dem Würfeln. */
function afterSetup(players: number, seed = 7, options: CatanOptions = OPTS): CatanState {
  let match = createMatch(game, seed, options, bots(players));
  while (match.state.phase === 'setup') {
    const next = stepBot(game, match);
    if (!next) throw new Error('Bot hängt');
    match = next;
  }
  return match.state;
}

/** Würfel so stellen, dass der nächste Wurf `total` ergibt. */
function forceRoll(s: CatanState, total: number): CatanState {
  const copy = structuredClone(s);
  for (let k = 0; k < 100_000; k += 1) {
    const probe = createRng(k);
    if (rollDie(probe) + rollDie(probe) === total) {
      copy.rng = createRng(k);
      return copy;
    }
  }
  throw new Error('kein Startwert gefunden');
}

describe('catan – Brett', () => {
  it('hat 19 Felder, 54 Kreuzungen, 72 Kanten und 30 Küstenkanten', () => {
    expect(GEO.hexes).toHaveLength(19);
    expect(GEO.vertices).toHaveLength(54);
    expect(GEO.edges).toHaveLength(72);
    expect(GEO.coast).toHaveLength(30);
    expect(new Set(GEO.spiral).size).toBe(19);
    for (const ns of GEO.vertexNeighbors) expect(ns.length === 2 || ns.length === 3).toBe(true);
  });

  it('Einsteiger-Aufbau: richtige Mengen, keine roten Nachbarn, neun Häfen', () => {
    const s = game.setup({ players: 3, seed: 1, options: OPTS });
    const counts = [0, 0, 0, 0, 0];
    for (const r of s.hexRes) if (r >= 0) counts[r] = (counts[r] ?? 0) + 1;
    expect(counts).toEqual([4, 3, 4, 4, 3]);
    expect(s.hexRes.filter((r) => r === -1)).toHaveLength(1);
    expect(redNeighbors(s.hexNum)).toBe(false);
    expect(s.ports).toHaveLength(9);
    expect(s.ports.filter((p) => p.kind === -1)).toHaveLength(4);
    const portVertices = s.ports.flatMap((p) => GEO.edges[p.edge] ?? []);
    expect(new Set(portVertices).size).toBe(18);
    expect(s.hexRes[s.robber]).toBe(-1);
  });

  it('Zufalls-Aufbau hält die roten Zahlen auseinander', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const s = game.setup({ players: 4, seed, options: { ...OPTS, layout: 'zufall' } });
      expect(redNeighbors(s.hexNum)).toBe(false);
      expect(s.hexNum.filter((n) => n > 0).sort((a, b) => a - b)).toEqual([
        2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
      ]);
      expect(s.hexNum.reduce((a, n) => a + pips(n), 0)).toBe(58);
    }
  });
});

describe('catan – Gründung', () => {
  it('läuft als Schlange und gibt für die zweite Siedlung Erträge', () => {
    let s = game.setup({ players: 2, seed: 3, options: OPTS });
    const order: number[] = [];
    // Plätze fest wählen: jeweils der erste freie Platz.
    while (s.phase === 'setup') {
      const seat = game.activeSeats(s)[0] ?? -1;
      order.push(seat);
      const v = game.view(s, seat).legal?.settlements[0] ?? -1;
      s = apply(s, seat, { t: 'settlement', v });
      const e = game.view(s, seat).legal?.roads[0] ?? -1;
      s = apply(s, seat, { t: 'road', e });
    }
    expect(order).toEqual([0, 1, 1, 0]);
    expect(s.phase).toBe('roll');
    expect(s.hands.every((h) => h.reduce((a, b) => a + b, 0) > 0)).toBe(true);
  });

  it('verbietet Nachbarplätze (Abstandsregel) und lose Straßen', () => {
    let s = game.setup({ players: 2, seed: 3, options: OPTS });
    s = apply(s, 0, { t: 'settlement', v: 10 });
    const far = GEO.edges.findIndex(([a, b]) => a !== 10 && b !== 10);
    expect(game.applyMove(s, 0, { t: 'road', e: far }).ok).toBe(false);
    const near = GEO.edges.findIndex(([a, b]) => a === 10 || b === 10);
    s = apply(s, 0, { t: 'road', e: near });
    const neighbor = GEO.vertexNeighbors[10]?.[0] ?? -1;
    expect(game.applyMove(s, 1, { t: 'settlement', v: neighbor }).ok).toBe(false);
    expect(game.applyMove(s, 0, { t: 'settlement', v: 40 }).ok).toBe(false);
  });
});

describe('catan – Zug', () => {
  it('verändert den Zustand nicht', () => {
    const s = afterSetup(3);
    const before = JSON.stringify(s);
    game.applyMove(s, 0, { t: 'roll' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('bei einer 7 werfen große Hände ab, dann zieht der Räuber', () => {
    let s = afterSetup(3);
    s.hands[1] = [3, 3, 2, 1, 0];
    s.hands[2] = [1, 1, 1, 1, 1];
    s = forceRoll(s, 7);
    s = apply(s, 0, { t: 'roll' });
    expect(s.phase).toBe('discard');
    expect(game.activeSeats(s)).toEqual([1]);
    expect(game.applyMove(s, 1, { t: 'discard', cards: [1, 1, 1, 0, 0] }).ok).toBe(false);
    s = apply(s, 1, { t: 'discard', cards: [2, 2, 0, 0, 0] });
    expect(s.phase).toBe('robber');
    expect(game.applyMove(s, 0, { t: 'robber', hex: s.robber, victim: -1 }).ok).toBe(false);
    const target = s.vOwner.findIndex((o) => o === 1);
    const hex = GEO.vertexHexes[target]?.find((h) => h !== s.robber) ?? -1;
    const cards = s.hands[0]?.reduce((a, b) => a + b, 0) ?? 0;
    s = apply(s, 0, { t: 'robber', hex, victim: 1 });
    expect(s.hands[0]?.reduce((a, b) => a + b, 0)).toBe(cards + 1);
    expect(s.phase).toBe('main');
  });

  it('Bankhandel 4:1 und Bauen mit Kosten', () => {
    let s = afterSetup(2);
    s = forceRoll(s, 12);
    s = apply(s, 0, { t: 'roll' });
    s.hands[0] = [4, 0, 0, 0, 0];
    const rate = game.view(s, 0).legal?.bankRates[0] ?? 4;
    s.hands[0] = [rate, 0, 0, 0, 0];
    s = apply(s, 0, { t: 'bank', give: 0, get: 1 });
    expect(s.hands[0]).toEqual([0, 1, 0, 0, 0]);
    expect(game.applyMove(s, 0, { t: 'bank', give: 1, get: 1 }).ok).toBe(false);
    s.hands[0] = [1, 1, 0, 0, 0];
    const road = game.view(s, 0).legal?.roads[0] ?? -1;
    s = apply(s, 0, { t: 'road', e: road });
    expect(s.hands[0]).toEqual([0, 0, 0, 0, 0]);
    expect(game.applyMove(s, 0, { t: 'road', e: road }).ok).toBe(false);
  });

  it('Handel unter Spielern: Angebot, Antworten, Abschluss', () => {
    let s = afterSetup(3);
    s = forceRoll(s, 12);
    s = apply(s, 0, { t: 'roll' });
    s.hands = [
      [2, 0, 0, 0, 0],
      [0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0],
    ];
    s = apply(s, 0, { t: 'offer', give: [1, 0, 0, 0, 0], get: [0, 0, 0, 1, 0] });
    expect(game.activeSeats(s)).toEqual([1, 2]);
    expect(game.applyMove(s, 2, { t: 'respond', accept: true }).ok).toBe(false);
    s = apply(s, 2, { t: 'respond', accept: false });
    s = apply(s, 1, { t: 'respond', accept: true });
    expect(game.activeSeats(s)).toEqual([0]);
    expect(game.applyMove(s, 0, { t: 'accept', seat: 2 }).ok).toBe(false);
    s = apply(s, 0, { t: 'accept', seat: 1 });
    expect(s.hands[0]).toEqual([1, 0, 0, 1, 0]);
    expect(s.hands[1]).toEqual([1, 0, 0, 0, 0]);
    expect(s.phase).toBe('main');
  });

  it('Entwicklungskarten sind nicht im Kaufzug spielbar, max. eine pro Zug', () => {
    let s = afterSetup(2);
    s = forceRoll(s, 12);
    s = apply(s, 0, { t: 'roll' });
    s.devDeck.push(0);
    s.hands[0] = [0, 0, 1, 1, 1];
    s = apply(s, 0, { t: 'buy' });
    expect(game.applyMove(s, 0, { t: 'dev', card: 0, a: 0, b: 0 }).ok).toBe(false);
    s.devHand[0] = [2, 0, 1, 0, 0];
    s = apply(s, 0, { t: 'dev', card: 0, a: 0, b: 0 });
    expect(s.phase).toBe('robber');
    const hex = GEO.hexes.findIndex(
      (_, h) => h !== s.robber && game.view(s, 0).legal?.robberVictims[h]?.length === 0,
    );
    s = apply(s, 0, { t: 'robber', hex, victim: -1 });
    expect(game.applyMove(s, 0, { t: 'dev', card: 2, a: 0, b: 0 }).ok).toBe(false);
  });

  it('längste Handelsstraße ab 5, unterbrochen durch fremde Siedlung', () => {
    let s = afterSetup(2);
    s = forceRoll(s, 12);
    s = apply(s, 0, { t: 'roll' });
    // Freie Kette von Kanten suchen, die an Sitz 0 anschließt.
    const chain: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      s.hands[0] = [1, 1, 0, 0, 0];
      const edges = game.view(s, 0).legal?.roads ?? [];
      const e = edges.find((x) => !chain.includes(x)) ?? -1;
      s = apply(s, 0, { t: 'road', e });
      chain.push(e);
    }
    const len = game.view(s, 0).seats[0]?.roadLength ?? 0;
    if (len >= 5) expect(s.longestHolder).toBe(0);
    // Eine fremde Siedlung mitten auf einer Straße teilt sie.
    const own = s.eOwner.map((o, e) => (o === 0 ? e : -1)).filter((e) => e >= 0);
    const mid = own
      .flatMap((e) => GEO.edges[e] ?? [])
      .find(
        (v) =>
          s.vOwner[v] === -1 && (GEO.vertexNeighbors[v] ?? []).every((n) => s.vOwner[n] === -1),
      );
    if (mid !== undefined) {
      const broken = structuredClone(s);
      broken.vOwner[mid] = 1;
      expect(game.view(broken, 0).seats[0]?.roadLength ?? 0).toBeLessThanOrEqual(len);
    }
  });
});

describe('catan – fremde Daten und Sicht', () => {
  it('parseMove lehnt Unfug ab', () => {
    const junk: unknown[] = [
      null,
      42,
      'roll',
      {},
      { t: 'fly' },
      { t: 'road', e: 72 },
      { t: 'road', e: -1 },
      { t: 'settlement', v: 1.5 },
      { t: 'discard', cards: [1, 2, 3] },
      { t: 'discard', cards: [1, 2, 3, 4, 'x'] },
      { t: 'offer', give: [0, 0, 0, 0, 20], get: [1, 0, 0, 0, 0] },
      { t: 'dev', card: 9 },
      { t: 'robber', hex: 19, victim: -1 },
      { t: 'robber', hex: 3, victim: 7 },
      { t: 'respond', accept: 'ja' },
      { t: 'bank', give: 5, get: 0 },
    ];
    for (const raw of junk) expect(game.parseMove(raw)).toBeNull();
    expect(game.parseMove({ t: 'road', e: 5 })).toEqual({ t: 'road', e: 5 });
  });

  it('parseOptions prüft streng', () => {
    expect(game.parseOptions({})).toEqual(OPTS);
    expect(game.parseOptions({ layout: 'zufall', targetVp: 12, maxRounds: 30 })).toEqual({
      layout: 'zufall',
      targetVp: 12,
      maxRounds: 30,
    });
    expect(game.parseOptions({ layout: 'chaos' })).toBeNull();
    expect(game.parseOptions({ targetVp: 11 })).toBeNull();
    expect(game.parseOptions({ maxRounds: 999 })).toBeNull();
    expect(game.parseOptions('x')).toBeNull();
  });

  it('die Sicht verrät keine fremden Karten, keinen Stapel und keinen Zufall', () => {
    const s = afterSetup(3);
    s.hands[1] = [5, 0, 0, 0, 7];
    s.devHand[1] = [0, 3, 0, 0, 0];
    const v = game.view(s, 0);
    const text = JSON.stringify(v);
    expect(text).not.toContain('devDeck');
    expect(text).not.toContain('rng');
    expect(v.hand).toEqual(s.hands[0]);
    expect(v.seats[1]?.cards).toBe(12);
    expect(v.seats[1]?.devCards).toBe(3);
    // Verdeckte Siegpunkte des anderen zählen in seiner öffentlichen Zahl nicht mit.
    expect(v.seats[1]?.vp).toBe(2);
    expect(game.view(s, 1).seats[1]?.vp).toBe(5);
    const spectator = game.view(s, null);
    expect(spectator.hand).toBeNull();
    expect(spectator.devHand).toBeNull();
    expect(spectator.legal).toBeNull();
  });
});

describe('catan – Bots', () => {
  it.each([
    [2, 'leicht'],
    [3, 'mittel'],
    [4, 'schwer'],
    [4, 'leicht'],
  ] as const)('%i Bots (%s) spielen bis zum Ende', (players, level) => {
    let match = createMatch(game, 1000 + players, { ...OPTS, maxRounds: 60 }, bots(players, level));
    let worst = 0;
    for (let i = 0; i < 20_000 && !game.outcome(match.state); i += 1) {
      const t0 = performance.now();
      const next = stepBot(game, match);
      worst = Math.max(worst, performance.now() - t0);
      if (!next) break;
      match = next;
    }
    const outcome = game.outcome(match.state);
    expect(outcome).not.toBeNull();
    expect(outcome?.scores).toHaveLength(players);
    expect(worst).toBeLessThan(150);
  });

  it('ohne Rundenlimit erreichen schwere Bots zehn Siegpunkte', () => {
    let wins = 0;
    for (const seed of [11, 12, 13]) {
      let match = createMatch(game, seed, { ...OPTS, layout: 'zufall' }, bots(3, 'schwer'));
      for (let i = 0; i < 20_000 && !game.outcome(match.state); i += 1) {
        const next = stepBot(game, match);
        if (!next) break;
        match = next;
      }
      const outcome = game.outcome(match.state);
      if (outcome && Math.max(...(outcome.scores ?? [0])) >= 10) wins += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
  });

  it('runBots endet bei gemischter Partie am Menschen', () => {
    const seats: SeatController[] = [{ type: 'bot', level: 'schwer' }, { type: 'human' }];
    const match = runBots(game, createMatch(game, 5, OPTS, seats));
    expect(game.activeSeats(match.state)).toContain(1);
  });
});
