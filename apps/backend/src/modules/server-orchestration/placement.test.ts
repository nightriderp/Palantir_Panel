import { describe, expect, it } from 'vitest';
import { type PlacementCandidate, choosePlacementHost } from './placement.js';

/**
 * Platzierungsregel für Server ohne gewählte Node (Review 2026-09-16, Befund 2.3).
 */

function node(overrides: Partial<PlacementCandidate> & { id: string }): PlacementCandidate {
  return {
    name: overrides.id,
    status: 'online',
    totalRamMb: 32_768,
    allocatedRamMb: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('choosePlacementHost', () => {
  it('liefert null, wenn es keine Node gibt', () => {
    expect(choosePlacementHost([])).toBeNull();
  });

  it('übergeht Nodes, die keine Arbeit annehmen', () => {
    const wahl = choosePlacementHost([
      node({ id: 'wartung', status: 'maintenance', allocatedRamMb: 0 }),
      node({ id: 'offline', status: 'offline', allocatedRamMb: 0 }),
      node({ id: 'online', allocatedRamMb: 30_000 }),
    ]);

    expect(wahl?.id).toBe('online');
  });

  it('liefert null, wenn keine Node online ist', () => {
    expect(
      choosePlacementHost([
        node({ id: 'a', status: 'offline' }),
        node({ id: 'b', status: 'maintenance' }),
      ]),
    ).toBeNull();
  });

  it('nimmt die Node mit dem meisten freien RAM, nicht die mit dem größten', () => {
    const wahl = choosePlacementHost([
      node({ id: 'gross-voll', totalRamMb: 65_536, allocatedRamMb: 60_000 }),
      node({ id: 'klein-leer', totalRamMb: 16_384, allocatedRamMb: 2_048 }),
    ]);

    expect(wahl?.id).toBe('klein-leer');
  });

  it('entscheidet bei Gleichstand für die älteste Node – das bisherige Verhalten', () => {
    const wahl = choosePlacementHost([
      node({ id: 'neu', createdAt: new Date('2026-09-01T00:00:00.000Z') }),
      node({ id: 'alt', createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      node({ id: 'mittel', createdAt: new Date('2026-05-01T00:00:00.000Z') }),
    ]);

    expect(wahl?.id).toBe('alt');
  });

  it('verhält sich mit genau einer Node wie zuvor', () => {
    const einzige = node({ id: 'homeserver', allocatedRamMb: 40_000, totalRamMb: 32_768 });

    // Auch überbucht: Es gibt keine Alternative, und die harte Kapazitätsprüfung
    // (Pflichtenheft §10) läuft ohnehin erst beim Reservieren.
    expect(choosePlacementHost([einzige])?.id).toBe('homeserver');
  });
});
