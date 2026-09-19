/**
 * Prüfregeln der Spiel-Wünsche (Contracts: `game-request.ts`).
 *
 * Aufgebaut wie `quota-request.ts`, nur schlanker: Ein Wunsch braucht einen
 * Namen, alles Weitere ist freiwillig.
 */

import { z } from 'zod';
import { GAME_REQUEST_STATUSES, type GameRequestStatus } from '@palantir/contracts';

/**
 * Der gewünschte Spielname.
 *
 * Freier Text mit engen Grenzen: Zwei Zeichen reichen für „7D", achtzig enden
 * vor dem Punkt, an dem jemand die Begründung in das Namensfeld schreibt.
 */
const gameNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Bitte nenne das Spiel beim Namen.' })
  .max(80, { message: 'Das ist kein Spielname mehr (höchstens 80 Zeichen).' });

export const createGameRequestInputSchema = z
  .object({
    game: gameNameSchema,
    /*
     * Die Begründung ist freiwillig – anders als bei der Kontingent-Anfrage.
     * Dort entscheidet ein Mensch über eine Zahl und braucht den Grund; hier
     * ist der Wunsch selbst schon die ganze Auskunft. Ein Pflichtfeld brächte
     * nur „weil ichs spielen will".
     */
    reason: z
      .string()
      .trim()
      .max(500, { message: 'Bitte fasse dich kürzer (höchstens 500 Zeichen).' })
      .nullish(),
  })
  .strict();

/** Entscheidung des Administrators; die Anmerkung ist freiwillig. */
export const decideGameRequestInputSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const gameRequestStatusSchema: z.ZodType<GameRequestStatus> = z.enum(
  GAME_REQUEST_STATUSES as [GameRequestStatus, ...GameRequestStatus[]],
);

/** Filter der Admin-Liste; ohne Angabe kommen die offenen. */
export const gameRequestQuerySchema = z
  .object({
    status: gameRequestStatusSchema.optional(),
  })
  .strict();

export type CreateGameRequestInput = z.infer<typeof createGameRequestInputSchema>;
export type DecideGameRequestInput = z.infer<typeof decideGameRequestInputSchema>;
export type GameRequestQuery = z.infer<typeof gameRequestQuerySchema>;
