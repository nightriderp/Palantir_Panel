/**
 * Zod-Gegenstück zum Response-Envelope aus `@palantir/contracts`
 * (Pflichtenheft §5.1).
 *
 * Damit kann das Frontend eine API-Antwort prüfen, statt ihr blind zu vertrauen,
 * und das Backend seine Antworten in Tests validieren.
 */

import { ERROR_CODES } from '@palantir/contracts';
import { z } from 'zod';

/** Fehlercode aus dem Katalog in `@palantir/contracts` – kein Freitext. */
export const errorCodeSchema = z.enum(ERROR_CODES);

export const apiErrorBodySchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
});

/**
 * Baut das Envelope-Schema um ein Daten-Schema herum.
 *
 * ```ts
 * const schema = apiResponseSchema(z.object({ status: z.string() }));
 * ```
 */
export function apiResponseSchema<TData extends z.ZodTypeAny>(dataSchema: TData) {
  return z.union([
    z.object({ success: z.literal(true), data: dataSchema, error: z.null() }),
    z.object({ success: z.literal(false), data: z.null(), error: apiErrorBodySchema }),
  ]);
}
