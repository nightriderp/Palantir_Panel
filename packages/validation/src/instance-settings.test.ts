import { describe, expect, it } from 'vitest';
import { instanceSettingsInputSchema } from './auth.js';

/**
 * Spieltypen, deren Server beim Start kein Update holen (Betreiber-Wunsch
 * 22.09.2026).
 *
 * Dieselbe Form wie `disabledGameTypes`: eine Liste von Kennungen, optional,
 * ohne Prüfung gegen den Katalog. Geprüft wird, dass sie genauso streng bleibt
 * wie ihr Vorbild – eine Liste, die hier durchrutscht, landet ungeprüft in der
 * Datenbank.
 */
describe('instanceSettingsInputSchema – heldUpdateGameTypes', () => {
  const basis = { selfRegistrationEnabled: false };

  it('nimmt eine Liste von Kennungen', () => {
    const ergebnis = instanceSettingsInputSchema.safeParse({
      ...basis,
      heldUpdateGameTypes: ['cs2'],
    });

    expect(ergebnis.success).toBe(true);
  });

  it('bleibt optional – ohne Feld gelten Updates wie bisher', () => {
    expect(instanceSettingsInputSchema.safeParse(basis).success).toBe(true);
  });

  it('nimmt die leere Liste', () => {
    expect(
      instanceSettingsInputSchema.safeParse({ ...basis, heldUpdateGameTypes: [] }).success,
    ).toBe(true);
  });

  it('lehnt eine leere Kennung ab', () => {
    expect(
      instanceSettingsInputSchema.safeParse({ ...basis, heldUpdateGameTypes: [''] }).success,
    ).toBe(false);
  });

  it('lehnt eine überlange Kennung ab', () => {
    expect(
      instanceSettingsInputSchema.safeParse({ ...basis, heldUpdateGameTypes: ['x'.repeat(65)] })
        .success,
    ).toBe(false);
  });

  it('lehnt eine Liste ohne Ende ab', () => {
    const lang = Array.from({ length: 201 }, (_, index) => `spiel-${String(index)}`);

    expect(
      instanceSettingsInputSchema.safeParse({ ...basis, heldUpdateGameTypes: lang }).success,
    ).toBe(false);
  });

  it('lehnt etwas ab, das keine Liste ist', () => {
    expect(
      instanceSettingsInputSchema.safeParse({ ...basis, heldUpdateGameTypes: 'cs2' }).success,
    ).toBe(false);
  });
});
