/**
 * Tests der Kapazitätsprüfung (CLAUDE.md §4 – zwingend für diese Logik).
 *
 * Die Rahmenwerte der Node entsprechen der Hardware aus Lastenheft §5
 * (32 GB RAM, 16 Threads, 2 TB nutzbar), stehen hier aber als Testdaten und
 * nicht als Konstante im Code – im Betrieb kommen sie aus `HostNode`.
 */

import { NO_USER_RESOURCE_LIMITS, type UserResourceLimits } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type CapacityCheckInput, checkCapacity } from './capacity.js';

const NODE_ID = 'a1e5b6c2-0000-4000-8000-000000000001';
const AT = new Date('2026-08-26T12:00:00.000Z');

/** Node mit den Werten aus Lastenheft §5, standardmäßig leer. */
function input(overrides: {
  requested?: Partial<CapacityCheckInput['requested']>;
  userLimits?: UserResourceLimits;
  userUsage?: Partial<CapacityCheckInput['userUsage']>;
  nodeTotal?: Partial<CapacityCheckInput['node']['total']>;
  nodeUsage?: Partial<CapacityCheckInput['node']['usage']>;
  thresholds?: Partial<CapacityCheckInput['thresholds']>;
}): CapacityCheckInput {
  return {
    requested: { ramMb: 4096, cpuCores: 2, diskMb: 20_480, ...overrides.requested },
    userLimits: overrides.userLimits ?? NO_USER_RESOURCE_LIMITS,
    userUsage: {
      runningRamMb: 0,
      runningCpuCores: 0,
      allocatedDiskMb: 0,
      runningServers: 0,
      totalServers: 0,
      ...overrides.userUsage,
    },
    node: {
      nodeId: NODE_ID,
      total: { ramMb: 32_768, cpuCores: 16, diskMb: 2_097_152, ...overrides.nodeTotal },
      usage: {
        runningRamMb: 0,
        runningCpuCores: 0,
        allocatedDiskMb: 0,
        runningServers: 0,
        totalServers: 0,
        ...overrides.nodeUsage,
      },
    },
    thresholds: { nodePercent: 85, serverPercent: 90, ...overrides.thresholds },
    at: AT,
  };
}

describe('checkCapacity – kein Nutzer-Kontingent gesetzt', () => {
  it('erlaubt den Start, wenn die Node Platz hat', () => {
    const result = checkCapacity(input({}));

    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('prüft die Node trotzdem – ein Konto ohne Limit umgeht sie nicht', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 8192 },
        nodeUsage: { runningRamMb: 30_000 },
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.violations).toEqual([
      {
        scope: 'node',
        resource: 'ram',
        unit: 'mb',
        limit: 32_768,
        used: 30_000,
        requested: 8192,
      },
    ]);
  });

  it('behandelt einzelne null-Felder wie „kein Limit" und prüft die übrigen', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 16_384, cpuCores: 1 },
        userLimits: {
          maxRamMb: null,
          maxCpuCores: 4,
          maxDiskMb: null,
          maxConcurrentServers: null,
        },
        userUsage: { runningRamMb: 60_000, runningCpuCores: 1 },
        nodeUsage: { runningRamMb: 20_000 },
      }),
    );

    // RAM ist beim Nutzer unbegrenzt – nur die Node-Grenze schlägt an,
    // das CPU-Kontingent (1 + 1 <= 4) nicht.
    expect(result.violations.map((v) => `${v.scope}.${v.resource}`)).toEqual(['node.ram']);
  });
});

describe('checkCapacity – Limit exakt erreicht', () => {
  it('erlaubt den Start, wenn das Nutzer-Kontingent punktgenau aufgeht', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 2048, cpuCores: 1.5, diskMb: 10_240 },
        userLimits: {
          maxRamMb: 8192,
          maxCpuCores: 4,
          maxDiskMb: 51_200,
          maxConcurrentServers: 3,
        },
        userUsage: {
          runningRamMb: 6144,
          runningCpuCores: 2.5,
          allocatedDiskMb: 40_960,
          runningServers: 2,
        },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('erlaubt den Start, wenn die Node punktgenau aufgeht', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 2768, cpuCores: 4, diskMb: 152 },
        nodeUsage: { runningRamMb: 30_000, runningCpuCores: 12, allocatedDiskMb: 2_097_000 },
      }),
    );

    expect(result.allowed).toBe(true);
  });

  it('lehnt ab, sobald ein einziges MiB darüber liegt', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 2049 },
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxRamMb: 8192 },
        userUsage: { runningRamMb: 6144 },
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.violations).toEqual([
      { scope: 'user', resource: 'ram', unit: 'mb', limit: 8192, used: 6144, requested: 2049 },
    ]);
  });

  it('rechnet CPU-Bruchteile ohne Fließkomma-Artefakt', () => {
    // 0.1 + 0.2 > 0.3 ist in IEEE-754 wahr – ohne Toleranz schlüge das fehl.
    const result = checkCapacity(
      input({
        requested: { cpuCores: 0.2 },
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxCpuCores: 0.3 },
        userUsage: { runningCpuCores: 0.1 },
      }),
    );

    expect(result.violations.filter((v) => v.resource === 'cpu')).toEqual([]);
  });
});

describe('checkCapacity – Node voll trotz freiem Nutzer-Kontingent', () => {
  it('lehnt ab, obwohl das Kontingent des Nutzers reichlich Luft hat', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 8192, cpuCores: 2, diskMb: 20_480 },
        userLimits: {
          maxRamMb: 65_536,
          maxCpuCores: 32,
          maxDiskMb: 4_194_304,
          maxConcurrentServers: 50,
        },
        userUsage: { runningRamMb: 1024, runningCpuCores: 0.5, allocatedDiskMb: 4096 },
        nodeUsage: { runningRamMb: 31_000, runningCpuCores: 15.5, allocatedDiskMb: 2_090_000 },
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.violations.map((v) => v.scope)).toEqual(['node', 'node', 'node']);
    expect(result.violations.map((v) => v.resource)).toEqual(['ram', 'cpu', 'disk']);
  });

  it('nennt beide Ebenen, wenn Kontingent und Node gleichzeitig überschritten sind', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 16_384 },
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxRamMb: 8192 },
        nodeUsage: { runningRamMb: 30_000 },
      }),
    );

    expect(result.violations.map((v) => `${v.scope}.${v.resource}`)).toEqual([
      'user.ram',
      'node.ram',
    ]);
  });
});

describe('checkCapacity – Anzahl gleichzeitiger Server', () => {
  it('lehnt den Start ab, wenn die erlaubte Anzahl erreicht ist', () => {
    const result = checkCapacity(
      input({
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 2 },
        userUsage: { runningServers: 2 },
      }),
    );

    expect(result.violations).toEqual([
      { scope: 'user', resource: 'servers', unit: 'count', limit: 2, used: 2, requested: 1 },
    ]);
  });

  it('erlaubt den letzten freien Platz', () => {
    const result = checkCapacity(
      input({
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 2 },
        userUsage: { runningServers: 1 },
      }),
    );

    expect(result.allowed).toBe(true);
  });

  it('lehnt bei einem Kontingent von 0 jeden Start ab – 0 ist kein „kein Limit"', () => {
    const result = checkCapacity(
      input({ userLimits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 0 } }),
    );

    expect(result.allowed).toBe(false);
    expect(result.violations[0]?.resource).toBe('servers');
  });
});

describe('checkCapacity – Zählweise des Speicherplatzes', () => {
  it('misst Speicher gegen alle Server, nicht nur die laufenden', () => {
    const result = checkCapacity(
      input({
        requested: { diskMb: 20_480 },
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxDiskMb: 51_200 },
        // Kein laufender Server, aber drei gestoppte belegen bereits Platz.
        userUsage: { runningServers: 0, totalServers: 3, allocatedDiskMb: 40_960 },
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatchObject({ scope: 'user', resource: 'disk', used: 40_960 });
  });
});

describe('checkCapacity – Warnungen', () => {
  it('warnt, wenn der Start die Node über den Schwellwert hebt', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 4096, cpuCores: 1, diskMb: 1024 },
        nodeUsage: { runningRamMb: 24_000 },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.warnings).toEqual([
      {
        scope: 'node',
        resource: 'ram',
        unit: 'mb',
        nodeId: NODE_ID,
        serverId: null,
        used: 28_096,
        total: 32_768,
        usedPercent: 85.7,
        thresholdPercent: 85,
        at: AT.toISOString(),
      },
    ]);
  });

  it('warnt nicht unterhalb des Schwellwerts', () => {
    const result = checkCapacity(input({ nodeUsage: { runningRamMb: 1024 } }));

    expect(result.warnings).toEqual([]);
  });

  it('warnt nicht zu einem Start, der abgelehnt wird', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 40_000 },
        nodeUsage: { runningRamMb: 30_000 },
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});
