/**
 * Zod-Schemas des Arcade-Bereichs (Arbeitspaket F8).
 *
 * Gemeinsam genutzt von der Backend-Route (Prüfung des abgesendeten
 * Punktestands) und vom Frontend (Typ des Absende-Aufrufs). Die Spiel-Kennungen
 * und die Punkte-Obergrenze kommen aus `@palantir/contracts` – hier wird der
 * Katalog nicht zweitgeführt (CLAUDE.md §3).
 */

import { ARCADE_GAME_IDS, ARCADE_SCORE_MAX } from '@palantir/contracts';
import { z } from 'zod';

/** Gültige Spiel-Kennung. */
export const arcadeGameIdSchema = z.enum(ARCADE_GAME_IDS);

/**
 * Ein abgesendeter Punktestand.
 *
 * Nur ganze, nicht-negative Zahlen; die Obergrenze fängt offensichtlichen
 * Unsinn ab (siehe `ARCADE_SCORE_MAX`). `finite`, damit weder `NaN` noch
 * `Infinity` durchrutschen.
 */
export const arcadeScoreValueSchema = z
  .number({ invalid_type_error: 'Punktestand muss eine Zahl sein.' })
  .int({ message: 'Punktestand muss eine ganze Zahl sein.' })
  .min(0, { message: 'Punktestand darf nicht negativ sein.' })
  .max(ARCADE_SCORE_MAX, { message: 'Punktestand ist unplausibel hoch.' });

/** Rumpf des Absende-Aufrufs `POST /arcade/scores`. */
export const submitArcadeScoreInputSchema = z.object({
  gameId: arcadeGameIdSchema,
  score: arcadeScoreValueSchema,
});

export type SubmitArcadeScoreInput = z.infer<typeof submitArcadeScoreInputSchema>;
