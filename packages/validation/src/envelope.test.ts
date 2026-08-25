import { fail, ok } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiResponseSchema } from './envelope.js';
import { idSchema } from './common.js';

const schema = apiResponseSchema(z.object({ status: z.string() }));

describe('Envelope-Schema (Pflichtenheft §5.1)', () => {
  it('akzeptiert eine Antwort aus ok()', () => {
    expect(schema.safeParse(ok({ status: 'ok' })).success).toBe(true);
  });

  it('akzeptiert eine Antwort aus fail()', () => {
    expect(schema.safeParse(fail('SUBDOMAIN_TAKEN')).success).toBe(true);
  });

  it('lehnt einen Fehlercode ab, der nicht im Katalog steht', () => {
    const result = schema.safeParse({
      success: false,
      data: null,
      error: { code: 'NICHT_IM_KATALOG', message: 'irgendwas' },
    });
    expect(result.success).toBe(false);
  });

  it('lehnt eine Mischform aus Erfolg und Fehler ab', () => {
    const result = schema.safeParse({
      success: true,
      data: { status: 'ok' },
      error: { code: 'SUBDOMAIN_TAKEN', message: 'belegt' },
    });
    expect(result.success).toBe(false);
  });
});

describe('ID-Format (Pflichtenheft §6)', () => {
  it('akzeptiert eine UUID und lehnt alles andere ab', () => {
    expect(idSchema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success).toBe(true);
    expect(idSchema.safeParse('42').success).toBe(false);
  });
});
