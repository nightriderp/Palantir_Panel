import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_JAVA_HEAP_MB,
  MIN_JAVA_HEAP_MB,
  hardMemoryLimitBytes,
  javaHeapMib,
  nodeRamReserveMb,
} from './memory.js';

const MIB = 1024 * 1024;

describe('nodeRamReserveMb', () => {
  it('behält mindestens 2 GiB, sonst zehn Prozent', () => {
    expect(nodeRamReserveMb(8_192)).toBe(2_048);
    expect(nodeRamReserveMb(16_384)).toBe(2_048);
    expect(nodeRamReserveMb(32_768)).toBe(3_277);
  });

  it('nimmt eine ausdrückliche Rücklage, lässt aber Platz für einen Heap', () => {
    expect(nodeRamReserveMb(23_630, 4_096)).toBe(4_096);
    expect(nodeRamReserveMb(4_096, 4_000)).toBe(4_096 - MIN_JAVA_HEAP_MB);
  });
});

describe('hardMemoryLimitBytes', () => {
  it('ist die Node minus Rücklage', () => {
    expect(hardMemoryLimitBytes(23_630, 2_363)).toBe((23_630 - 2_363) * MIB);
  });

  it('fällt nie unter das Heap-Minimum', () => {
    expect(hardMemoryLimitBytes(1_024, 1_024)).toBe(MIN_JAVA_HEAP_MB * MIB);
  });
});

describe('javaHeapMib', () => {
  const node = { reserveMb: 2_363, hardLimitMb: 21_267 };

  /*
   * Der Deckel ist der Grund, warum es diese Zeilen gibt: Am 19.09.2026 ergab
   * eine leere 30-GiB-Node 20 307 MiB Heap, und die Java-Maschine starb mit
   * `AlwaysPreTouch`, bevor sie eine Zeile ausgab. Ohne ausdrückliche Angabe
   * sind acht Gibibyte Schluss.
   */
  it('deckelt den Heap, auch wenn die Node fast leer ist', () => {
    expect(javaHeapMib({ ...node, availableMb: 20_000, runningContainers: 0 })).toBe(
      DEFAULT_MAX_JAVA_HEAP_MB,
    );
    expect(
      javaHeapMib({ ...node, availableMb: 20_000, runningContainers: 0, maxHeapMb: 16_384 }),
    ).toBe(15_950);
  });

  it('teilt den Rest mit den laufenden Containern', () => {
    expect(
      javaHeapMib({ ...node, availableMb: 14_363, runningContainers: 1, maxHeapMb: 16_384 }),
    ).toBe(6_000);
    expect(
      javaHeapMib({ ...node, availableMb: 14_363, runningContainers: 2, maxHeapMb: 16_384 }),
    ).toBe(4_000);
    // Unter dem Deckel ändert er nichts: Der geteilte Rest ist kleiner.
    expect(javaHeapMib({ ...node, availableMb: 14_363, runningContainers: 1 })).toBe(6_000);
  });

  it('geht nie unter das Minimum, auch wenn nichts frei ist', () => {
    expect(javaHeapMib({ ...node, availableMb: 1_000, runningContainers: 5 })).toBe(
      MIN_JAVA_HEAP_MB,
    );
  });
});
