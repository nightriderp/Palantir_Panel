/**
 * Zod-Schemas der Übersichts-Kacheln ohne Server (Betreiber-Wunsch 26.09.2026).
 *
 * Gegenstück zu `OverviewTileDto` in `@palantir/contracts`. Backend (Prüfung
 * der Verwaltungs-Routen) und Frontend (Formular in der Administration) nutzen
 * dieselben Schemas – kein zweiter, abweichender Regelsatz (Entwicklungsregeln
 * §3).
 *
 * **Der wichtigste Punkt ist {@link overviewTileLinkUrlSchema}.** Der Link
 * landet als `href` auf einer Kachel, die jedes Konto sieht. Erlaubt sind nur
 * `http` und `https`; ein `javascript:`-Ziel bestünde eine bloße URL-Prüfung
 * und wäre auf der Kachel kein Link mehr, sondern Code.
 */

import {
  OVERVIEW_TILE_ADDRESS_MAX_LENGTH,
  OVERVIEW_TILE_GAME_LABEL_MAX_LENGTH,
  OVERVIEW_TILE_LINK_LABEL_MAX_LENGTH,
  OVERVIEW_TILE_LINK_URL_MAX_LENGTH,
  OVERVIEW_TILE_SORT_ORDER_MAX,
  OVERVIEW_TILE_SUBTITLE_MAX_LENGTH,
  OVERVIEW_TILE_TITLE_MAX_LENGTH,
} from '@palantir/contracts';
import { z } from 'zod';

import { idSchema } from './common.js';

/**
 * Verbietet Steuer-, Format- und Ersatzzeichen (Unicode-Kategorie `C`) –
 * dieselbe Überlegung wie bei den Schriften (`font.ts`): geprüft **vor** dem
 * Trimmen, damit ein angehängter Zeilenumbruch nicht wortlos verschwindet.
 */
const NO_CONTROL_CHARACTERS_PATTERN = /^[^\p{C}]*$/u;

/** Rohgrenze, bevor irgendetwas anderes geprüft wird. */
const RAW_INPUT_MAX_LENGTH = 1000;

/** Anzeigetext mit Obergrenze: Steuerzeichen und spitze Klammern verboten. */
function anzeigetext(feld: string, maxLength: number) {
  return z
    .string({ invalid_type_error: `${feld} muss Text sein.` })
    .max(RAW_INPUT_MAX_LENGTH, {
      message: `${feld} darf höchstens ${maxLength} Zeichen lang sein.`,
    })
    .regex(NO_CONTROL_CHARACTERS_PATTERN, {
      message: `${feld} darf keine Steuer- oder unsichtbaren Zeichen enthalten.`,
    })
    .trim()
    .max(maxLength, { message: `${feld} darf höchstens ${maxLength} Zeichen lang sein.` })
    .regex(/^[^<>]*$/, { message: `${feld} darf keine spitzen Klammern enthalten.` });
}

/** Leere Eingabe eines optionalen Feldes wird zu `null`, nicht zu `""`. */
function optionalText(feld: string, maxLength: number) {
  return anzeigetext(feld, maxLength)
    .nullable()
    .transform((wert) => (wert === null || wert === '' ? null : wert));
}

export const overviewTileTitleSchema = anzeigetext('Der Titel', OVERVIEW_TILE_TITLE_MAX_LENGTH).min(
  1,
  { message: 'Bitte gib einen Titel an.' },
);

export const overviewTileSubtitleSchema = optionalText(
  'Der Untertitel',
  OVERVIEW_TILE_SUBTITLE_MAX_LENGTH,
);

export const overviewTileGameLabelSchema = optionalText(
  'Die Spielbezeichnung',
  OVERVIEW_TILE_GAME_LABEL_MAX_LENGTH,
);

/**
 * Kennung eines Spieltyps aus dem Katalog, z. B. `cs2` oder `minecraft-vanilla`.
 *
 * Nur die Form: Ob es das Spiel gibt, weiß allein die Registry im Backend
 * (`NOT_FOUND` beim Speichern).
 */
export const overviewTileGameTypeIdSchema = z
  .string({ invalid_type_error: 'Die Spiel-Kennung muss Text sein.' })
  .trim()
  .max(64, { message: 'Die Spiel-Kennung ist zu lang.' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Die Spiel-Kennung besteht aus Kleinbuchstaben, Ziffern und Bindestrichen.',
  })
  .nullable();

/**
 * Verbindungsadresse, wie ein Spieler sie eintippt.
 *
 * Bewusst keine strenge `host:port`-Prüfung: Steam-Spiele nehmen `host:port`,
 * Minecraft eine Subdomain ohne Port, manche Spiele eine Adresse mit Pfad.
 * Verboten sind nur Leerraum und Steuerzeichen – eine Adresse mit Leerzeichen
 * ist keine.
 */
export const overviewTileAddressSchema = z
  .string({ invalid_type_error: 'Die Adresse muss Text sein.' })
  .max(RAW_INPUT_MAX_LENGTH, {
    message: `Die Adresse darf höchstens ${OVERVIEW_TILE_ADDRESS_MAX_LENGTH} Zeichen lang sein.`,
  })
  .regex(NO_CONTROL_CHARACTERS_PATTERN, {
    message: 'Die Adresse darf keine Steuer- oder unsichtbaren Zeichen enthalten.',
  })
  .trim()
  .max(OVERVIEW_TILE_ADDRESS_MAX_LENGTH, {
    message: `Die Adresse darf höchstens ${OVERVIEW_TILE_ADDRESS_MAX_LENGTH} Zeichen lang sein.`,
  })
  .regex(/^[^\s<>"']*$/, {
    message:
      'Die Adresse darf keine Leerzeichen, Anführungszeichen oder spitzen Klammern enthalten.',
  })
  .nullable()
  .transform((wert) => (wert === null || wert === '' ? null : wert));

/** Ziel des Knopfes: nur `http`/`https`, siehe Kopfkommentar. */
export const overviewTileLinkUrlSchema = z
  .string({ invalid_type_error: 'Der Link muss Text sein.' })
  .max(RAW_INPUT_MAX_LENGTH, {
    message: `Der Link darf höchstens ${OVERVIEW_TILE_LINK_URL_MAX_LENGTH} Zeichen lang sein.`,
  })
  .regex(NO_CONTROL_CHARACTERS_PATTERN, {
    message: 'Der Link darf keine Steuer- oder unsichtbaren Zeichen enthalten.',
  })
  .trim()
  .max(OVERVIEW_TILE_LINK_URL_MAX_LENGTH, {
    message: `Der Link darf höchstens ${OVERVIEW_TILE_LINK_URL_MAX_LENGTH} Zeichen lang sein.`,
  })
  .nullable()
  .transform((wert) => (wert === null || wert === '' ? null : wert))
  .refine((wert) => wert === null || /^https?:\/\/[^\s]+$/i.test(wert), {
    message: 'Der Link muss mit http:// oder https:// beginnen.',
  });

export const overviewTileLinkLabelSchema = optionalText(
  'Die Knopf-Beschriftung',
  OVERVIEW_TILE_LINK_LABEL_MAX_LENGTH,
);

export const overviewTileSortOrderSchema = z
  .number({ invalid_type_error: 'Die Reihenfolge muss eine Zahl sein.' })
  .int({ message: 'Die Reihenfolge muss eine ganze Zahl sein.' })
  .min(0, { message: 'Die Reihenfolge darf nicht negativ sein.' })
  .max(OVERVIEW_TILE_SORT_ORDER_MAX, {
    message: `Die Reihenfolge darf höchstens ${OVERVIEW_TILE_SORT_ORDER_MAX} sein.`,
  });

/** Eingabe zum Anlegen einer Kachel (Administration → Backend). */
export const createOverviewTileInputSchema = z
  .object({
    title: overviewTileTitleSchema,
    subtitle: overviewTileSubtitleSchema.default(null),
    gameTypeId: overviewTileGameTypeIdSchema.default(null),
    gameLabel: overviewTileGameLabelSchema.default(null),
    address: overviewTileAddressSchema.default(null),
    linkUrl: overviewTileLinkUrlSchema.default(null),
    linkLabel: overviewTileLinkLabelSchema.default(null),
    sortOrder: overviewTileSortOrderSchema.default(0),
    /** Neue Kacheln sind eingeschaltet – wer eine anlegt, will sie sehen. */
    enabled: z.boolean().default(true),
  })
  .strict();

/** Eingabe zum Ändern – jedes Feld optional, aber mindestens eines. */
export const updateOverviewTileInputSchema = z
  .object({
    title: overviewTileTitleSchema.optional(),
    subtitle: overviewTileSubtitleSchema.optional(),
    gameTypeId: overviewTileGameTypeIdSchema.optional(),
    gameLabel: overviewTileGameLabelSchema.optional(),
    address: overviewTileAddressSchema.optional(),
    linkUrl: overviewTileLinkUrlSchema.optional(),
    linkLabel: overviewTileLinkLabelSchema.optional(),
    sortOrder: overviewTileSortOrderSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Es wurde kein zu änderndes Feld angegeben.',
  });

export const overviewTileParamsSchema = z.object({ tileId: idSchema }).strict();

export type CreateOverviewTileInput = z.infer<typeof createOverviewTileInputSchema>;
export type UpdateOverviewTileInput = z.infer<typeof updateOverviewTileInputSchema>;
