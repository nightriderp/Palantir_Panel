import { describe, expect, it } from 'vitest';
import { liveValuesInputSchema } from './servers.js';

/**
 * Live-Steuerung (Betreiber-Wunsch 23.09.2026): nur die Form der Eingabe –
 * welche Felder live gehen, prüft das Backend gegen die Definition.
 */
describe('liveValuesInputSchema', () => {
  it('nimmt Auswahlwerte, Zahlen und Schalter', () => {
    expect(liveValuesInputSchema.safeParse({ values: { map: 'de_mirage', bots: 3 } }).success).toBe(
      true,
    );
    expect(liveValuesInputSchema.safeParse({ values: { allRounds: true } }).success).toBe(true);
  });

  it('lehnt eine leere Änderung ab', () => {
    expect(liveValuesInputSchema.safeParse({ values: {} }).success).toBe(false);
  });

  it('lehnt Listen, Objekte und null ab', () => {
    expect(liveValuesInputSchema.safeParse({ values: { map: ['a'] } }).success).toBe(false);
    expect(liveValuesInputSchema.safeParse({ values: { map: { a: 1 } } }).success).toBe(false);
    expect(liveValuesInputSchema.safeParse({ values: { map: null } }).success).toBe(false);
  });

  it('lehnt zu lange Werte und zu viele Felder ab', () => {
    expect(liveValuesInputSchema.safeParse({ values: { map: 'x'.repeat(129) } }).success).toBe(
      false,
    );

    const viele = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${String(i)}`, 1]));
    expect(liveValuesInputSchema.safeParse({ values: viele }).success).toBe(false);
  });

  it('lehnt unendliche Zahlen ab', () => {
    expect(
      liveValuesInputSchema.safeParse({ values: { bots: Number.POSITIVE_INFINITY } }).success,
    ).toBe(false);
  });
});
