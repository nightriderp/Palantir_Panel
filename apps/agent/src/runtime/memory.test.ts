import { describe, expect, it } from 'vitest';
import { MIN_JAVA_HEAP_MB, hardMemoryLimitBytes, javaHeapMib, nodeRamReserveMb } from './memory.js';

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

  it('gibt dem ersten Server auf leerer Node fast alles – bis zur Heap-Obergrenze', () => {
    expect(javaHeapMib({ ...node, availableMb: 20_000, runningContainers: 0 })).toBe(15_950);
  });

  it('teilt den Rest mit den laufenden Containern', () => {
    expect(javaHeapMib({ ...node, availableMb: 14_363, runningContainers: 1 })).toBe(6_000);
    expect(javaHeapMib({ ...node, availableMb: 14_363, runningContainers: 2 })).toBe(4_000);
  });

  it('geht nie unter das Minimum, auch wenn nichts frei ist', () => {
    expect(javaHeapMib({ ...node, availableMb: 1_000, runningContainers: 5 })).toBe(
      MIN_JAVA_HEAP_MB,
    );
  });
});
