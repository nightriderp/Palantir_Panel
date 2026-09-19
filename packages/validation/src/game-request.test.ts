import { describe, expect, it } from 'vitest';
import {
  createGameRequestInputSchema,
  decideGameRequestInputSchema,
  gameRequestQuerySchema,
} from './game-request.js';

/**
 * Ein Wunsch braucht einen Namen, sonst nichts – das ist der ganze
 * Unterschied zur Kontingent-Anfrage, und deshalb steht er hier als Test.
 */
describe('createGameRequestInputSchema', () => {
  it('nimmt einen Wunsch ohne Begründung an', () => {
    const result = createGameRequestInputSchema.safeParse({ game: 'Terraria' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.game).toBe('Terraria');
  });

  it('schneidet Leerraum ab und nimmt kurze Namen wie „7D"', () => {
    const result = createGameRequestInputSchema.safeParse({ game: '  7D  ', reason: '  bald?  ' });

    expect(result.success && result.data.game).toBe('7D');
    expect(result.success && result.data.reason).toBe('bald?');
  });

  it('lehnt einen leeren oder zu langen Namen ab', () => {
    expect(createGameRequestInputSchema.safeParse({ game: ' ' }).success).toBe(false);
    expect(createGameRequestInputSchema.safeParse({ game: 'x'.repeat(81) }).success).toBe(false);
  });

  it('lehnt eine zu lange Begründung ab', () => {
    const result = createGameRequestInputSchema.safeParse({
      game: 'Terraria',
      reason: 'x'.repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it('lässt keine unbekannten Felder durch', () => {
    const result = createGameRequestInputSchema.safeParse({ game: 'Terraria', status: 'approved' });

    expect(result.success).toBe(false);
  });
});

describe('decideGameRequestInputSchema / gameRequestQuerySchema', () => {
  it('nimmt einen Bescheid ohne Anmerkung an', () => {
    expect(decideGameRequestInputSchema.safeParse({}).success).toBe(true);
  });

  it('kennt nur die vier Zustände als Filter', () => {
    expect(gameRequestQuerySchema.safeParse({ status: 'pending' }).success).toBe(true);
    expect(gameRequestQuerySchema.safeParse({ status: 'erledigt' }).success).toBe(false);
  });
});
