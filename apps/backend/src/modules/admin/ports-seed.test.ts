import { type PortProtocol } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type PortRangeSeedStore, seedDefaultPortRanges } from './ports-seed.js';

/** Bereiche im Speicher – dieselbe Schnittstelle wie die Tabelle. */
function fakeStore(vorhanden = false) {
  const angelegt: { label: string; startPort: number; endPort: number; protocol: PortProtocol }[] =
    [];

  const store: PortRangeSeedStore = {
    hasAnyRange: () => Promise.resolve(vorhanden || angelegt.length > 0),
    createRange: (data) => {
      angelegt.push(data);

      return Promise.resolve();
    },
  };

  return { store, angelegt };
}

describe('Port-Bereich der Ersteinrichtung (Gefundener Punkt 58)', () => {
  it('legt je einen Bereich für TCP und UDP an', async () => {
    const { store, angelegt } = fakeStore();

    const ergebnis = await seedDefaultPortRanges(store, { startPort: 25_000, endPort: 25_564 });

    expect(ergebnis.created).toEqual(['tcp', 'udp']);
    // Ein Spiel mit UDP-Port faende in einem reinen TCP-Bereich keinen Platz.
    expect(angelegt.map((bereich) => bereich.protocol)).toEqual(['tcp', 'udp']);
    expect(angelegt.every((bereich) => bereich.startPort === 25_000)).toBe(true);
    expect(angelegt.every((bereich) => bereich.endPort === 25_564)).toBe(true);
  });

  it('rührt eine bestehende Vergabe nicht an', async () => {
    const { store, angelegt } = fakeStore(true);

    const ergebnis = await seedDefaultPortRanges(store, { startPort: 25_000, endPort: 25_564 });

    expect(ergebnis).toEqual({ created: [], existing: true });
    expect(angelegt).toEqual([]);
  });

  it('ist beim zweiten Lauf folgenlos', async () => {
    const { store, angelegt } = fakeStore();

    await seedDefaultPortRanges(store, { startPort: 25_000, endPort: 25_564 });
    await seedDefaultPortRanges(store, { startPort: 25_000, endPort: 25_564 });

    expect(angelegt).toHaveLength(2);
  });

  it('lehnt einen verdrehten Bereich ab', async () => {
    const { store } = fakeStore();

    await expect(
      seedDefaultPortRanges(store, { startPort: 26_000, endPort: 25_000 }),
    ).rejects.toThrow();
  });
});
