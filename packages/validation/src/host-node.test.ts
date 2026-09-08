import { describe, expect, it } from 'vitest';
import { createHostNodeInputSchema, updateHostNodeInputSchema } from './host-node.js';

/**
 * Node-Eingaben (Lastenheft §3.7).
 *
 * Der Schwerpunkt liegt auf dem Bearbeiten: Der Zustand einer Node wird nie von
 * Hand gesetzt, von Hand steuerbar ist nur die Wartung. Vorher trug das Schema
 * ein `status`-Feld mit `maintenance`/`offline`, der Kommentar daneben behauptete
 * aber, das Backend lehne genau das ab. Diese Tests halten die neue, ehrliche
 * Fassung fest.
 */
describe('updateHostNodeInputSchema', () => {
  it('nimmt die Wartung als Ja/Nein entgegen', () => {
    expect(updateHostNodeInputSchema.parse({ maintenance: true })).toEqual({ maintenance: true });
    expect(updateHostNodeInputSchema.parse({ maintenance: false })).toEqual({ maintenance: false });
  });

  it('lässt `statusMessage` unverändert zu – auch als ausdrückliches null', () => {
    expect(
      updateHostNodeInputSchema.parse({ maintenance: true, statusMessage: 'Plattentausch' }),
    ).toEqual({ maintenance: true, statusMessage: 'Plattentausch' });
    expect(updateHostNodeInputSchema.parse({ statusMessage: null })).toEqual({
      statusMessage: null,
    });
  });

  it('lehnt ein `status`-Feld ab, statt es still zu entfernen', () => {
    for (const status of ['online', 'offline', 'maintenance', 'degraded']) {
      const result = updateHostNodeInputSchema.safeParse({ status });

      expect(result.success).toBe(false);
    }
  });

  it('lehnt `status` auch neben einem gültigen Feld ab', () => {
    const result = updateHostNodeInputSchema.safeParse({ maintenance: false, status: 'online' });

    expect(result.success).toBe(false);
  });

  it('lehnt eine leere Änderung ab', () => {
    expect(updateHostNodeInputSchema.safeParse({}).success).toBe(false);
  });

  it('nimmt weiterhin Name, Adresse und Ressourcen entgegen', () => {
    const parsed = updateHostNodeInputSchema.parse({
      name: 'Zweitserver',
      wireguardIp: '10.10.0.3',
      totalResources: { ramMb: 16_384, cpuCores: 4, diskMb: 500_000 },
    });

    expect(parsed).toEqual({
      name: 'Zweitserver',
      wireguardIp: '10.10.0.3',
      totalResources: { ramMb: 16_384, cpuCores: 4, diskMb: 500_000 },
    });
  });

  it('lehnt einen nicht-booleschen Wartungswert ab', () => {
    expect(updateHostNodeInputSchema.safeParse({ maintenance: 'true' }).success).toBe(false);
  });
});

describe('createHostNodeInputSchema', () => {
  it('kennt keinen Zustand – eine neue Node startet unverbunden', () => {
    const parsed = createHostNodeInputSchema.parse({
      name: 'Homeserver',
      wireguardIp: '10.10.0.2',
      totalResources: { ramMb: 32_768, cpuCores: 8, diskMb: 2_000_000 },
    });

    expect('status' in parsed).toBe(false);
    expect('maintenance' in parsed).toBe(false);
  });
});
