/**
 * Zod-Schemas der Spielhalle.
 *
 * Gemeinsam genutzt von Backend-Routen und Frontend. Kennungen, Grenzen und
 * Stufen kommen aus `@palantir/contracts` – hier wird nichts zweitgeführt
 * (Entwicklungsregeln §3).
 *
 * Züge und Einstellungen der Spiele (`move`, `options`) sind hier bewusst nur
 * „irgendein JSON": Ihre Form kennt allein die Regel-Datei des Spiels in
 * `@palantir/arcade` (`parseMove`/`parseOptions`), und genau dort werden sie
 * geprüft. Die Schemas begrenzen nur die Größe.
 */

import {
  ARCADE_BOT_LEVELS,
  ARCADE_GAME_IDS,
  ARCADE_ROOM_CHAT_MAX_LENGTH,
  ARCADE_SCORE_MAX,
  ARCADE_TRACK_TITLE_MAX_LENGTH,
  type ArcadeBotLevel,
} from '@palantir/contracts';
import { z } from 'zod';

export const arcadeGameIdSchema = z.enum(ARCADE_GAME_IDS);

export const arcadeScoreValueSchema = z
  .number({ invalid_type_error: 'Punktestand muss eine Zahl sein.' })
  .int({ message: 'Punktestand muss eine ganze Zahl sein.' })
  .min(0, { message: 'Punktestand darf nicht negativ sein.' })
  .max(ARCADE_SCORE_MAX, { message: 'Punktestand ist unplausibel hoch.' });

export const arcadeBotLevelSchema = z.enum(
  ARCADE_BOT_LEVELS as unknown as [ArcadeBotLevel, ...ArcadeBotLevel[]],
);

/** Höchstgröße eines Zugs oder einer Einstellung als JSON-Text (Bytes ≈ Zeichen). */
export const ARCADE_JSON_MAX_CHARS = 4_000;
/** Höchstgröße des Base64-Bandes (entspricht `MAX_ARCADE_REPLAY_BYTES` × 4/3). */
export const ARCADE_REPLAY_BASE64_MAX_CHARS = 520_000;
/** Höchstzahl aufgezeichneter Züge einer Partie gegen den Computer. */
export const ARCADE_RECORDED_MOVES_MAX = 5_000;

/** Beliebiges JSON mit Größengrenze. */
export const arcadeJsonSchema = z.unknown().refine(
  (value) => {
    if (value === undefined) return true;
    try {
      return JSON.stringify(value).length <= ARCADE_JSON_MAX_CHARS;
    } catch {
      return false;
    }
  },
  { message: 'Zu große Daten.' },
);

export const arcadeSeatControllerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('human') }).strict(),
  z.object({ type: z.literal('bot'), level: arcadeBotLevelSchema }).strict(),
]);

export const arcadeTurnRecordingSchema = z
  .object({
    options: arcadeJsonSchema,
    seats: z.array(arcadeSeatControllerSchema).min(1).max(10),
    moves: z
      .array(z.object({ seat: z.number().int().min(0).max(9), move: arcadeJsonSchema }).strict())
      .max(ARCADE_RECORDED_MOVES_MAX),
  })
  .strict();

/** `POST /arcade/scores` (Breaking Change 26.09.2026, vorher `{ gameId, score }`). */
export const submitArcadeRunInputSchema = z
  .object({
    gameId: arcadeGameIdSchema,
    seedId: z.string().uuid(),
    replay: z.string().min(1).max(ARCADE_REPLAY_BASE64_MAX_CHARS).optional(),
    match: arcadeTurnRecordingSchema.optional(),
    claimedScore: arcadeScoreValueSchema.optional(),
  })
  .strict()
  .refine((value) => (value.replay === undefined) !== (value.match === undefined), {
    message: 'Genau eines von „replay" und „match" angeben.',
  });

export type SubmitArcadeRunInputParsed = z.infer<typeof submitArcadeRunInputSchema>;

export const createArcadeRoomInputSchema = z
  .object({
    gameId: arcadeGameIdSchema,
    seatCount: z.number().int().min(1).max(10),
    isPrivate: z.boolean(),
    options: arcadeJsonSchema.optional(),
  })
  .strict();

export const joinArcadeRoomInputSchema = z
  .object({ seat: z.number().int().min(0).max(9).optional() })
  .strict();

export const setArcadeRoomSeatInputSchema = z
  .object({
    seat: z.number().int().min(0).max(9),
    kind: z.enum(['open', 'bot']),
    botLevel: arcadeBotLevelSchema.optional(),
  })
  .strict();

export const arcadeRoomMoveInputSchema = z
  .object({
    version: z.number().int().min(0),
    move: arcadeJsonSchema,
  })
  .strict();

export const arcadeRoomChatInputSchema = z
  .object({
    text: z.string().trim().min(1).max(ARCADE_ROOM_CHAT_MAX_LENGTH),
  })
  .strict();

/** Beitrittscode: sechs Zeichen aus Großbuchstaben und Ziffern ohne Verwechsler. */
export const arcadeRoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, { message: 'Ungültiger Raumcode.' });

export const arcadeTrackTitleSchema = z
  .string()
  .trim()
  .min(1, { message: 'Titel fehlt.' })
  .max(ARCADE_TRACK_TITLE_MAX_LENGTH, { message: 'Titel ist zu lang.' });

/**
 * Alter Rumpf von `POST /arcade/scores` mit nacktem Punktestand.
 *
 * @deprecated Seit 26.09.2026 nimmt das Backend nur noch nachrechenbare
 * Einsendungen an (`submitArcadeRunInputSchema`). Bleibt nur, damit der
 * Contracts-PR vor dem Umbau des Backends allein gemergt werden kann; mit dem
 * Spielhallen-PR entfällt jede Verwendung.
 */
export const submitArcadeScoreInputSchema = z
  .object({
    gameId: arcadeGameIdSchema,
    score: arcadeScoreValueSchema,
  })
  .strict();

/** @deprecated siehe `submitArcadeScoreInputSchema`. */
export type SubmitArcadeScoreInput = z.infer<typeof submitArcadeScoreInputSchema>;
