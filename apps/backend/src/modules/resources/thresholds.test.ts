import { describe, expect, it } from 'vitest';
import { evaluateNodeWarnings, evaluateServerWarnings, usedPercent } from './thresholds.js';

const NODE_ID = 'a1e5b6c2-0000-4000-8000-000000000001';
const SERVER_ID = 'a1e5b6c2-0000-4000-8000-000000000002';
const AT = new Date('2026-08-26T12:00:00.000Z');

describe('usedPercent', () => {
  it('rundet auf eine Nachkommastelle', () => {
    expect(usedPercent(28_096, 32_768)).toBe(85.7);
    expect(usedPercent(1, 3)).toBe(33.3);
  });

  it('behandelt eine Gesamtmenge von 0 ohne Division', () => {
    expect(usedPercent(0, 0)).toBe(0);
    expect(usedPercent(1, 0)).toBe(100);
  });
});

describe('evaluateNodeWarnings', () => {
  const total = { ramMb: 32_768, cpuCores: 16, diskMb: 2_097_152 };

  it('meldet jede Ressource über dem Schwellwert einzeln', () => {
    const warnings = evaluateNodeWarnings({
      nodeId: NODE_ID,
      total,
      usage: {
        runningRamMb: 30_000,
        runningCpuCores: 2,
        allocatedDiskMb: 2_000_000,
        runningServers: 4,
        totalServers: 9,
      },
      thresholdPercent: 85,
      at: AT,
    });

    expect(warnings.map((w) => w.resource)).toEqual(['ram', 'disk']);
    expect(warnings[0]).toEqual({
      scope: 'node',
      resource: 'ram',
      unit: 'mb',
      nodeId: NODE_ID,
      serverId: null,
      used: 30_000,
      total: 32_768,
      usedPercent: 91.6,
      thresholdPercent: 85,
      at: AT.toISOString(),
    });
  });

  it('warnt genau ab dem Schwellwert, nicht erst darüber', () => {
    const warnings = evaluateNodeWarnings({
      nodeId: NODE_ID,
      total: { ramMb: 100, cpuCores: 16, diskMb: 1000 },
      usage: {
        runningRamMb: 85,
        runningCpuCores: 0,
        allocatedDiskMb: 0,
        runningServers: 1,
        totalServers: 1,
      },
      thresholdPercent: 85,
      at: AT,
    });

    expect(warnings.map((w) => w.resource)).toEqual(['ram']);
  });

  it('schweigt unterhalb des Schwellwerts', () => {
    const warnings = evaluateNodeWarnings({
      nodeId: NODE_ID,
      total: { ramMb: 100, cpuCores: 16, diskMb: 1000 },
      usage: {
        runningRamMb: 84,
        runningCpuCores: 0,
        allocatedDiskMb: 0,
        runningServers: 1,
        totalServers: 1,
      },
      thresholdPercent: 85,
      at: AT,
    });

    expect(warnings).toEqual([]);
  });
});

describe('evaluateServerWarnings', () => {
  const limits = { ramMb: 4096, cpuCores: 2, diskMb: 20_480 };

  it('misst gegen das eigene Limit des Servers', () => {
    const warnings = evaluateServerWarnings({
      serverId: SERVER_ID,
      nodeId: NODE_ID,
      limits,
      usedRamMb: 3900,
      usedCpuCores: 0.4,
      usedDiskMb: 1024,
      thresholdPercent: 90,
      at: AT,
    });

    expect(warnings).toEqual([
      {
        scope: 'server',
        resource: 'ram',
        unit: 'mb',
        nodeId: NODE_ID,
        serverId: SERVER_ID,
        used: 3900,
        total: 4096,
        usedPercent: 95.2,
        thresholdPercent: 90,
        at: AT.toISOString(),
      },
    ]);
  });

  it('überspringt Werte, die der Agent nicht liefert', () => {
    const warnings = evaluateServerWarnings({
      serverId: SERVER_ID,
      nodeId: NODE_ID,
      limits,
      usedRamMb: null,
      usedCpuCores: null,
      usedDiskMb: 20_000,
      thresholdPercent: 90,
      at: AT,
    });

    expect(warnings.map((w) => w.resource)).toEqual(['disk']);
  });
});
