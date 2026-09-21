/**
 * Zod-Schemas der Erfolge (Betreiber-Wunsch 21.09.2026).
 *
 * Gemeinsam genutzt von der Backend-Route (Prüfung der Titel-Wahl) und vom
 * Frontend (Typ des Aufrufs). Der Katalog der Kennungen kommt aus
 * `@palantir/contracts` und wird hier nicht zweitgeführt (Entwicklungsregeln §3).
 */

import { ACHIEVEMENT_IDS } from '@palantir/contracts';
import { z } from 'zod';

/** Gültige Abzeichen-Kennung. */
export const achievementIdSchema = z.enum(ACHIEVEMENT_IDS);

/**
 * Rumpf des Aufrufs `PUT /achievements/title`.
 *
 * `null` bedeutet „keinen Titel tragen" – deshalb `nullable()` und nicht
 * `optional()`: Das Feld muss dastehen, damit ein vergessenes Feld nicht
 * unbemerkt als „Titel ablegen" ankommt.
 *
 * Ob das Konto den gewählten Titel überhaupt freigeschaltet hat, prüft hier
 * bewusst **niemand**: Das ist eine Frage an die Datenbank, keine an die Form
 * der Eingabe, und sie gehört in den Service (`ACHIEVEMENT_NOT_UNLOCKED`).
 */
export const chooseAchievementTitleInputSchema = z
  .object({
    achievementId: achievementIdSchema.nullable(),
  })
  .strict();

export type ChooseAchievementTitleInput = z.infer<typeof chooseAchievementTitleInputSchema>;
