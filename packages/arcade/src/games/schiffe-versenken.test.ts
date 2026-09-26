import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { type SeatController, createMatch, runBots } from '../turn.js';
import {
  type SchiffeState,
  type Ship,
  fleetError,
  game,
  randomFleet,
  shipCells,
} from './schiffe-versenken.js';

const FLEET: Ship[] = [
  { x: 0, y: 0, len: 5, horizontal: true },
  { x: 0, y: 2, len: 4, horizontal: true },
  { x: 0, y: 4, len: 3, horizontal: true },
  { x: 0, y: 6, len: 3, horizontal: true },
  { x: 0, y: 8, len: 2, horizontal: true },
];

function ready(options = game.defaultOptions): SchiffeState {
  let s = game.setup({ players: 2, seed: 9, options });
  for (const seat of [0, 1]) {
    const r = game.applyMove(s, seat, { type: 'flotte', ships: FLEET });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

describe('schiffe-versenken', () => {
  it('lässt beide Sitze gleichzeitig aufbauen', () => {
    const s = game.setup({ players: 2, seed: 1, options: game.defaultOptions });
    expect(game.activeSeats(s)).toEqual([0, 1]);
    const r = game.applyMove(s, 1, { type: 'zufall' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(game.activeSeats(r.state)).toEqual([0]);
      expect(game.applyMove(r.state, 1, { type: 'zufall' }).ok).toBe(false);
      // Schießen erst, wenn beide stehen.
      expect(game.applyMove(r.state, 0, { type: 'schuss', x: 0, y: 0 }).ok).toBe(false);
    }
  });

  it('prüft die Flotte: Längen, Rand, Überlappung, Berührung', () => {
    expect(fleetError(FLEET, 'standard')).toBeNull();
    expect(fleetError(FLEET.slice(1), 'standard')).not.toBeNull();
    expect(
      fleetError([...FLEET.slice(0, 4), { x: 9, y: 9, len: 2, horizontal: true }], 'standard'),
    ).not.toBeNull();
    expect(
      fleetError([...FLEET.slice(0, 4), { x: 0, y: 0, len: 2, horizontal: false }], 'standard'),
    ).not.toBeNull();
    const touching = [...FLEET.slice(0, 4), { x: 0, y: 1, len: 2, horizontal: true }];
    expect(fleetError(touching, 'standard')).toBeNull();
    for (let seed = 1; seed < 30; seed += 1) {
      expect(fleetError(randomFleet(createRng(seed), 'klassisch'), 'klassisch')).toBeNull();
      expect(fleetError(randomFleet(createRng(seed), 'standard'), 'standard')).toBeNull();
    }
  });

  it('meldet Wasser, Treffer und versenkt und wechselt den Zug', () => {
    let s = ready();
    let r = game.applyMove(s, 0, { type: 'schuss', x: 9, y: 9 });
    expect(r.ok && r.state.lastShot?.mark).toBe(1);
    if (!r.ok) return;
    s = r.state;
    expect(s.turn).toBe(1);
    expect(game.applyMove(s, 0, { type: 'schuss', x: 1, y: 1 }).ok).toBe(false);
    r = game.applyMove(s, 1, { type: 'schuss', x: 0, y: 8 });
    expect(r.ok && r.state.lastShot?.mark).toBe(2);
    if (!r.ok) return;
    s = r.state;
    r = game.applyMove(s, 0, { type: 'schuss', x: 9, y: 9 });
    expect(r.ok).toBe(false);
    r = game.applyMove(s, 0, { type: 'schuss', x: 8, y: 9 });
    if (!r.ok) return;
    r = game.applyMove(r.state, 1, { type: 'schuss', x: 1, y: 8 });
    expect(r.ok && r.state.lastShot?.mark).toBe(3);
  });

  it('Treffer ⇒ nochmal lässt weiterschießen', () => {
    const s = ready({ flotte: 'standard', nochmal: true });
    const r = game.applyMove(s, 0, { type: 'schuss', x: 0, y: 0 });
    expect(r.ok && r.state.turn).toBe(0);
  });

  it('verrät in der Sicht keine unversenkten gegnerischen Schiffe', () => {
    const s = ready();
    const v = game.view(s, 0);
    expect(v.myFleet).toHaveLength(5);
    expect(v.enemySunk).toEqual([]);
    expect(v.revealed).toBeNull();
    const text = JSON.stringify(v);
    expect(text).not.toContain('rng');
    // Die gegnerische Flotte taucht nur als eigene Flotte auf.
    expect(JSON.stringify(game.view(s, null).myFleet)).toBe('null');
    // Nach dem Versenken des 2ers ist er sichtbar.
    let t = s;
    for (const [x, y, seat] of [
      [0, 8, 0],
      [9, 9, 1],
      [1, 8, 0],
    ] as const) {
      const r = game.applyMove(t, seat, { type: 'schuss', x, y });
      if (!r.ok) throw new Error(r.error);
      t = r.state;
    }
    expect(game.view(t, 0).enemySunk).toHaveLength(1);
  });

  it('beendet die Partie, wenn alle Schiffe versenkt sind', () => {
    let s = ready({ flotte: 'standard', nochmal: true });
    for (const ship of FLEET) {
      for (const c of shipCells(ship)) {
        const r = game.applyMove(s, 0, { type: 'schuss', x: c % 10, y: Math.floor(c / 10) });
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
    }
    expect(game.outcome(s)?.winners).toEqual([0]);
  });

  it('lehnt Unfug ab', () => {
    expect(game.parseMove({ type: 'schuss', x: 10, y: 0 })).toBeNull();
    expect(
      game.parseMove({ type: 'flotte', ships: [{ x: 0, y: 0, len: 7, horizontal: true }] }),
    ).toBeNull();
    expect(game.parseMove({ type: 'flotte', ships: Array(11).fill(FLEET[0]) })).toBeNull();
    expect(
      game.parseMove({ type: 'flotte', ships: [{ x: 0, y: 0, len: 2, horizontal: 'ja' }] }),
    ).toBeNull();
    expect(game.parseOptions({ flotte: 'riesig' })).toBeNull();
    expect(game.parseOptions({ flotte: 'klassisch' })).toEqual({
      flotte: 'klassisch',
      nochmal: false,
    });
  });

  it('Bot-Partien enden, „schwer" schlägt „leicht" meistens', () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const seats: SeatController[] = [
        { type: 'bot', level: 'schwer' },
        { type: 'bot', level: 'leicht' },
      ];
      const m = runBots(
        game,
        createMatch(
          game,
          seed,
          { flotte: seed % 2 ? 'standard' : 'klassisch', nochmal: false },
          seats,
        ),
      );
      const o = game.outcome(m.state);
      expect(o).not.toBeNull();
      if (o?.winners[0] === 0) hardWins += 1;
    }
    expect(hardWins).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
