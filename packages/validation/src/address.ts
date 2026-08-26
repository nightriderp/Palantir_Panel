/**
 * Zod-Schemas zum öffentlichen Port-Bereich der VPS (Lastenheft §3.7,
 * Pflichtenheft §2.4).
 *
 * Gegenstück zu `PortRangeDto` und `PortAllocationDto` aus
 * `@palantir/contracts`. Geprüft wird hier nur die Form eines Bereichs; ob er
 * sich mit einem bestehenden überschneidet, kann erst das Backend gegen die
 * Datenbank feststellen (`PORT_RANGE_OVERLAP`).
 */

import { MAX_PUBLIC_PORT, MIN_PUBLIC_PORT, PORT_PROTOCOLS } from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';

export const portProtocolSchema = z.enum(PORT_PROTOCOLS);

/**
 * Einzelner öffentlicher Port.
 *
 * Untergrenze ist 1024: Ports darunter sind reserviert und erfordern auf der
 * VPS erhöhte Rechte – Gameserver bekommen dort grundsätzlich keinen Platz.
 */
export const publicPortSchema = z
  .number()
  .int()
  .min(MIN_PUBLIC_PORT, { message: `Ports unter ${MIN_PUBLIC_PORT} sind reserviert.` })
  .max(MAX_PUBLIC_PORT, { message: `Der größte gültige Port ist ${MAX_PUBLIC_PORT}.` });

export const portRangeLabelSchema = z
  .string()
  .trim()
  .min(2, { message: 'Die Bezeichnung muss mindestens 2 Zeichen lang sein.' })
  .max(50, { message: 'Die Bezeichnung darf höchstens 50 Zeichen lang sein.' });

const rangeBoundsRefinement = {
  check: (input: { startPort: number; endPort: number }): boolean =>
    input.startPort <= input.endPort,
  message: 'Der erste Port muss kleiner oder gleich dem letzten Port sein.',
} as const;

/** Eingabe zum Anlegen eines Port-Bereichs (F10 → Backend). */
export const createPortRangeInputSchema = z
  .object({
    label: portRangeLabelSchema,
    startPort: publicPortSchema,
    endPort: publicPortSchema,
    protocol: portProtocolSchema,
    nodeId: idSchema.nullish(),
    enabled: z.boolean().default(true),
  })
  .refine(rangeBoundsRefinement.check, {
    message: rangeBoundsRefinement.message,
    path: ['endPort'],
  });

/**
 * Eingabe zum Bearbeiten eines Port-Bereichs – alle Felder optional.
 *
 * Werden beide Grenzen zusammen geschickt, wird ihr Verhältnis hier geprüft.
 * Kommt nur eine Grenze, prüft das Backend gegen den gespeicherten Wert; das
 * Schema kennt den nicht.
 */
export const updatePortRangeInputSchema = z
  .object({
    label: portRangeLabelSchema,
    startPort: publicPortSchema,
    endPort: publicPortSchema,
    enabled: z.boolean(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Es muss mindestens ein Feld geändert werden.',
  })
  .refine(
    (input) =>
      input.startPort === undefined ||
      input.endPort === undefined ||
      input.startPort <= input.endPort,
    { message: rangeBoundsRefinement.message, path: ['endPort'] },
  );

export type CreatePortRangeInput = z.infer<typeof createPortRangeInputSchema>;
export type UpdatePortRangeInput = z.infer<typeof updatePortRangeInputSchema>;
