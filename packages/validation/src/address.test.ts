import { describe, expect, it } from 'vitest';
import { createPortRangeInputSchema, updatePortRangeInputSchema } from './address.js';

const gueltig = {
  label: 'Standardbereich',
  startPort: 30_000,
  endPort: 30_100,
  protocol: 'udp' as const,
};

describe('Port-Bereich-Schemas (Pflichtenheft §2.4)', () => {
  it('nimmt einen gültigen Bereich an und setzt enabled auf true', () => {
    const result = createPortRangeInputSchema.parse(gueltig);

    expect(result.enabled).toBe(true);
    expect(result.startPort).toBe(30_000);
  });

  it('lehnt einen Bereich ab, dessen Anfang hinter dem Ende liegt', () => {
    const result = createPortRangeInputSchema.safeParse({
      ...gueltig,
      startPort: 30_100,
      endPort: 30_000,
    });

    expect(result.success).toBe(false);
  });

  it('lehnt reservierte Ports unterhalb von 1024 ab', () => {
    expect(createPortRangeInputSchema.safeParse({ ...gueltig, startPort: 80 }).success).toBe(false);
  });

  it('lehnt Ports oberhalb von 65535 ab', () => {
    expect(createPortRangeInputSchema.safeParse({ ...gueltig, endPort: 70_000 }).success).toBe(
      false,
    );
  });

  it('erlaubt einen Bereich aus genau einem Port', () => {
    expect(
      createPortRangeInputSchema.safeParse({ ...gueltig, startPort: 30_000, endPort: 30_000 })
        .success,
    ).toBe(true);
  });

  it('verlangt beim Teil-Update mindestens ein Feld', () => {
    expect(updatePortRangeInputSchema.safeParse({}).success).toBe(false);
    expect(updatePortRangeInputSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('prüft beim Teil-Update nur dann die Grenzen, wenn beide mitkommen', () => {
    expect(updatePortRangeInputSchema.safeParse({ startPort: 40_000 }).success).toBe(true);
    expect(
      updatePortRangeInputSchema.safeParse({ startPort: 40_000, endPort: 39_000 }).success,
    ).toBe(false);
  });
});
