import { describe, expect, it } from 'vitest';
import {
  cpuCoresSchema,
  nodeResourcesSchema,
  resourceWarningThresholdsSchema,
  userResourceLimitsInputSchema,
} from './resources.js';

describe('cpuCoresSchema', () => {
  it('erlaubt Bruchteile von Kernen bis zu zwei Nachkommastellen', () => {
    expect(cpuCoresSchema.parse(1.5)).toBe(1.5);
    expect(cpuCoresSchema.parse(0.07)).toBe(0.07);
    expect(cpuCoresSchema.parse(8)).toBe(8);
  });

  it('lehnt feinere Nachkommastellen und negative Werte ab', () => {
    expect(cpuCoresSchema.safeParse(1.234).success).toBe(false);
    expect(cpuCoresSchema.safeParse(-1).success).toBe(false);
  });
});

describe('userResourceLimitsInputSchema', () => {
  it('nimmt ein Teil-Update entgegen – nicht genannte Felder bleiben unberührt', () => {
    const parsed = userResourceLimitsInputSchema.parse({ maxRamMb: 8192 });

    expect(parsed).toEqual({ maxRamMb: 8192 });
    expect('maxCpuCores' in parsed).toBe(false);
  });

  it('unterscheidet „nicht genannt" von ausdrücklichem null (Limit aufheben)', () => {
    const parsed = userResourceLimitsInputSchema.parse({ maxCpuCores: null });

    expect(parsed).toEqual({ maxCpuCores: null });
  });

  it('erlaubt 0 als ausdrückliche Sperre', () => {
    expect(userResourceLimitsInputSchema.parse({ maxConcurrentServers: 0 })).toEqual({
      maxConcurrentServers: 0,
    });
  });

  it('lehnt eine leere Eingabe ab', () => {
    expect(userResourceLimitsInputSchema.safeParse({}).success).toBe(false);
  });

  it('lehnt negative und nicht ganzzahlige Speichermengen ab', () => {
    expect(userResourceLimitsInputSchema.safeParse({ maxRamMb: -1 }).success).toBe(false);
    expect(userResourceLimitsInputSchema.safeParse({ maxDiskMb: 1.5 }).success).toBe(false);
  });
});

describe('nodeResourcesSchema', () => {
  it('nimmt die Rahmenwerte aus Lastenheft §5 an', () => {
    expect(nodeResourcesSchema.parse({ ramMb: 32768, cpuCores: 16, diskMb: 2_097_152 })).toEqual({
      ramMb: 32768,
      cpuCores: 16,
      diskMb: 2_097_152,
    });
  });
});

describe('resourceWarningThresholdsSchema', () => {
  it('lässt nur Prozentwerte zwischen 1 und 100 zu', () => {
    expect(resourceWarningThresholdsSchema.parse({ nodePercent: 85, serverPercent: 90 })).toEqual({
      nodePercent: 85,
      serverPercent: 90,
    });
    expect(
      resourceWarningThresholdsSchema.safeParse({ nodePercent: 0, serverPercent: 90 }).success,
    ).toBe(false);
    expect(
      resourceWarningThresholdsSchema.safeParse({ nodePercent: 85, serverPercent: 101 }).success,
    ).toBe(false);
  });
});
