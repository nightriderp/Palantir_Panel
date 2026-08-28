import { describe, expect, it } from 'vitest';
import { ARCADE_SCORE_MAX } from '@palantir/contracts';
import { submitArcadeScoreInputSchema } from './arcade.js';

describe('submitArcadeScoreInputSchema', () => {
  it('akzeptiert eine bekannte Kennung mit ganzem, nicht-negativem Punktestand', () => {
    const result = submitArcadeScoreInputSchema.safeParse({ gameId: 'kriechpfad', score: 42 });
    expect(result.success).toBe(true);
  });

  it('weist unbekannte Spiel-Kennungen ab', () => {
    expect(submitArcadeScoreInputSchema.safeParse({ gameId: 'snake', score: 1 }).success).toBe(
      false,
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, ARCADE_SCORE_MAX + 1])(
    'weist unplausible Punktestände ab: %s',
    (score) => {
      expect(submitArcadeScoreInputSchema.safeParse({ gameId: 'ballwechsel', score }).success).toBe(
        false,
      );
    },
  );
});
