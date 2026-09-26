/**
 * Prüfregeln der eigenen Profile (Contracts: `user-preset.ts`).
 *
 * Die Werte prüft hier nur die Form – wie bei der Live-Steuerung
 * (`liveValuesInputSchema`): Auswahl, Zahl oder Schalter, kein Freitext in
 * Konsolenlänge. Welche Felder ein Spiel annimmt und in welchen Grenzen, weiß
 * erst das Backend aus der Spiele-Definition.
 */

import { z } from 'zod';

const presetNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Bitte gib dem Profil einen Namen.' })
  .max(40, { message: 'Höchstens 40 Zeichen.' });

const presetValuesSchema = z
  .record(
    z.string().trim().min(1).max(64),
    z.union([z.string().max(128), z.number().finite(), z.boolean()]),
  )
  .refine((werte) => Object.keys(werte).length >= 1, {
    message: 'Ein Profil braucht mindestens einen Wert.',
  })
  .refine((werte) => Object.keys(werte).length <= 40, {
    message: 'Zu viele Felder für ein Profil.',
  });

export const createUserPresetInputSchema = z
  .object({
    gameType: z.string().trim().min(1).max(64),
    name: presetNameSchema,
    values: presetValuesSchema,
  })
  .strict();

/** Umbenennen und/oder Werte ersetzen; mindestens eins von beiden. */
export const updateUserPresetInputSchema = z
  .object({
    name: presetNameSchema.optional(),
    values: presetValuesSchema.optional(),
  })
  .strict()
  .refine((eingabe) => eingabe.name !== undefined || eingabe.values !== undefined, {
    message: 'Es wurde nichts geändert.',
  });

/** Liste der eigenen Profile eines Spieltyps. */
export const userPresetQuerySchema = z
  .object({
    gameType: z.string().trim().min(1).max(64),
  })
  .strict();

export type CreateUserPresetInput = z.infer<typeof createUserPresetInputSchema>;
export type UpdateUserPresetInput = z.infer<typeof updateUserPresetInputSchema>;
export type UserPresetQuery = z.infer<typeof userPresetQuerySchema>;
