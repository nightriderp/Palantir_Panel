import { describe, expect, it } from 'vitest';
import { createUserPresetInputSchema, updateUserPresetInputSchema } from './user-preset.js';

describe('eigene Profile – Eingaben', () => {
  it('nimmt Namen, Spieltyp und Werte der Steuerung an', () => {
    const ergebnis = createUserPresetInputSchema.safeParse({
      gameType: 'cs2',
      name: '  Mirage Smokes  ',
      values: { gameMode: 'custom', bots: 0, infiniteAmmo: true },
    });

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.data?.name).toBe('Mirage Smokes');
  });

  it('lehnt leere Namen, leere Werte und Fremdfelder ab', () => {
    const basis = { gameType: 'cs2', name: 'A', values: { bots: 1 } };

    expect(createUserPresetInputSchema.safeParse({ ...basis, name: '   ' }).success).toBe(false);
    expect(createUserPresetInputSchema.safeParse({ ...basis, values: {} }).success).toBe(false);
    expect(createUserPresetInputSchema.safeParse({ ...basis, extra: 1 }).success).toBe(false);
    expect(
      createUserPresetInputSchema.safeParse({ ...basis, values: { befehl: 'x'.repeat(200) } })
        .success,
    ).toBe(false);
  });

  it('verlangt beim Ändern Name oder Werte', () => {
    expect(updateUserPresetInputSchema.safeParse({}).success).toBe(false);
    expect(updateUserPresetInputSchema.safeParse({ name: 'Neu' }).success).toBe(true);
  });
});
