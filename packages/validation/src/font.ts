/**
 * Zod-Schemas der Oberflächen-Schriften (Lastenheft §3.10).
 *
 * Gegenstück zu `FontDto` und den Format-Grenzen aus `@palantir/contracts`.
 * Backend (Prüfung des Uploads) und Frontend (Formularprüfung im
 * Schrift-Dialog) nutzen dieselben Schemas – kein zweiter, abweichender
 * Regelsatz (CLAUDE.md §3).
 *
 * **Der wichtigste Punkt dieser Datei ist {@link fontFamilyNameSchema}.** Der
 * Familienname landet später in einer erzeugten `@font-face`-Regel, also in
 * einer Formatvorlage, die jeder Besucher der Oberfläche ausgeliefert bekommt.
 * Ein Name wie `Inter"; } body { display: none } @font-face { font-family: "x`
 * wäre dort kein Name mehr, sondern Code. Deshalb scheitert eine Einschleusung
 * **hier** – nicht erst beim Erzeugen des CSS und schon gar nicht erst im
 * Browser. Das Schema arbeitet mit einer Positivliste erlaubter Zeichen: Was
 * nicht ausdrücklich erlaubt ist, ist verboten. Eine Sperrliste („kein
 * Anführungszeichen, kein Semikolon…") übersieht zwangsläufig das nächste
 * Zeichen, das jemand findet.
 */

import {
  BUNDLED_FONT_ID_PATTERN,
  FONT_FORMATS,
  FONT_ID_MAX_LENGTH,
  FONT_SOURCES,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  isBundledFontId,
} from '@palantir/contracts';
import { z } from 'zod';

import { idSchema } from './common.js';

export const fontSourceSchema = z.enum(FONT_SOURCES);
export const fontFormatSchema = z.enum(FONT_FORMATS);

/**
 * Verbietet Steuer-, Format- und Ersatzzeichen (Unicode-Kategorie `C`).
 *
 * Wird **vor** dem Trimmen angewandt. Sonst würde `String.trim()` einen
 * angehängten Zeilenumbruch stillschweigend wegräumen und die Eingabe als
 * harmlos durchwinken – die Absicht dahinter bliebe unbemerkt. Deckt neben
 * `\n`, `\r` und `\t` auch das ab, was man in einer Eingabemaske nicht sieht:
 * Nullbytes, Zero-Width-Zeichen (U+200B) und Bidi-Steuerzeichen (U+202E).
 */
const NO_CONTROL_CHARACTERS_PATTERN = /^[^\p{C}]*$/u;

/**
 * Rohgrenze, an der geprüft wird, bevor überhaupt etwas anderes passiert.
 *
 * Fängt Eingaben ab, die nur dazu da sind, die nachfolgenden Prüfungen mit
 * Arbeit zu füttern. Die eigentlichen, kurzen Grenzen greifen danach.
 */
const RAW_INPUT_MAX_LENGTH = 400;

/** Höchstlänge des Familiennamens. */
export const FONT_FAMILY_NAME_MAX_LENGTH = 64;

/** Höchstlänge des Anzeigenamens. */
export const FONT_LABEL_MAX_LENGTH = 48;

/**
 * Erlaubte Form eines Familiennamens.
 *
 * Nur ASCII-Buchstaben, Ziffern, einfache Leerzeichen und Bindestriche; der
 * Name beginnt mit einem Buchstaben und endet auf Buchstabe oder Ziffer.
 * Damit passen die üblichen Namen (`Inter`, `IBM Plex Mono`, `JetBrains Mono`,
 * `M PLUS 1p`, `Atkinson Hyperlegible`), und alles, was in CSS eine Bedeutung
 * hat, fällt heraus: `"` `'` `` ` `` `;` `{` `}` `(` `)` `<` `>` `/` `\` `@`
 * `:` `,` `*` `&` `#` `!` `%` `=` sowie doppelte Leerzeichen.
 *
 * Bewusst ohne Umlaute und andere Nicht-ASCII-Buchstaben: Ein Familienname ist
 * eine technische Kennung im CSS, kein Anzeigetext – dafür gibt es
 * {@link fontLabelSchema}, das Umlaute erlaubt und nie in einer Formatvorlage
 * landet.
 */
export const FONT_FAMILY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+)*$/;

/**
 * Namen, die in einer `font-family`-Angabe eine eigene Bedeutung haben.
 *
 * Sie bestünden die Zeichenprüfung, wären aber keine Schrift, sondern eine
 * Anweisung: `font-family: inherit` erbt, `font-family: monospace` wählt die
 * Systemschrift. Eine hochgeladene Schrift namens `inherit` würde ihre eigene
 * Regel aushebeln – unabhängig davon, ob das Backend den Namen in
 * Anführungszeichen setzt. Vergleich in Kleinschreibung, weil CSS-Schlüsselwörter
 * unabhängig von der Groß-/Kleinschreibung wirken.
 */
export const RESERVED_FONT_FAMILY_NAMES: readonly string[] = [
  // CSS-weite Schlüsselwörter
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  // Generische Familien (CSS Fonts Level 4)
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
];

/**
 * Familienname einer Schrift – der Wert, der später im `font-family` steht.
 *
 * Reihenfolge der Prüfungen ist Absicht: erst die Rohgrenze, dann die
 * Steuerzeichen (vor dem Trimmen, siehe {@link NO_CONTROL_CHARACTERS_PATTERN}),
 * dann trimmen, dann Länge und Zeichenvorrat, zuletzt die reservierten Namen.
 */
export const fontFamilyNameSchema = z
  .string({ invalid_type_error: 'Der Familienname muss Text sein.' })
  .max(RAW_INPUT_MAX_LENGTH, {
    message: `Der Familienname darf höchstens ${FONT_FAMILY_NAME_MAX_LENGTH} Zeichen lang sein.`,
  })
  .regex(NO_CONTROL_CHARACTERS_PATTERN, {
    message: 'Der Familienname darf keine Steuer- oder unsichtbaren Zeichen enthalten.',
  })
  .trim()
  .min(1, { message: 'Bitte gib den Familiennamen der Schrift an.' })
  .max(FONT_FAMILY_NAME_MAX_LENGTH, {
    message: `Der Familienname darf höchstens ${FONT_FAMILY_NAME_MAX_LENGTH} Zeichen lang sein.`,
  })
  .regex(FONT_FAMILY_NAME_PATTERN, {
    message:
      'Erlaubt sind Buchstaben, Ziffern, einzelne Leerzeichen und Bindestriche – der Name beginnt mit einem Buchstaben.',
  })
  .refine((value) => !RESERVED_FONT_FAMILY_NAMES.includes(value.toLowerCase()), {
    message: 'Dieser Name ist in CSS reserviert und kann keine Schrift benennen.',
  });

/**
 * Anzeigename in der Oberfläche.
 *
 * Großzügiger als der Familienname, weil er ausschließlich als Text dargestellt
 * wird und nie in eine Formatvorlage gelangt: Umlaute, Klammern und Punkte sind
 * erlaubt („Inter (variabel)"). Steuerzeichen und spitze Klammern bleiben
 * verboten – Letztere, damit der Name auch dort unauffällig bleibt, wo er
 * nicht durch React läuft (Benachrichtigungen, Audit-Metadaten).
 */
export const fontLabelSchema = z
  .string({ invalid_type_error: 'Der Anzeigename muss Text sein.' })
  .max(RAW_INPUT_MAX_LENGTH, {
    message: `Der Anzeigename darf höchstens ${FONT_LABEL_MAX_LENGTH} Zeichen lang sein.`,
  })
  .regex(NO_CONTROL_CHARACTERS_PATTERN, {
    message: 'Der Anzeigename darf keine Steuer- oder unsichtbaren Zeichen enthalten.',
  })
  .trim()
  .min(1, { message: 'Bitte gib einen Anzeigenamen an.' })
  .max(FONT_LABEL_MAX_LENGTH, {
    message: `Der Anzeigename darf höchstens ${FONT_LABEL_MAX_LENGTH} Zeichen lang sein.`,
  })
  .regex(/^[^<>]*$/, {
    message: 'Der Anzeigename darf keine spitzen Klammern enthalten.',
  });

/**
 * Kennung einer Schrift: `bundled-<slug>` oder die UUID einer hochgeladenen.
 *
 * Bewusst ein Schema statt zweier: Wer eine Schrift auswählt oder abruft, hat
 * genau eine Kennung – ob sie mitgeliefert ist, entscheidet ihre Form, nicht
 * der Aufrufer. Die UUID-Prüfung kommt aus {@link idSchema}, damit das Format
 * der Entitäts-IDs nur an einer Stelle steht.
 */
export const fontIdSchema = z
  .string({ invalid_type_error: 'Die Schrift-Kennung muss Text sein.' })
  .trim()
  .max(FONT_ID_MAX_LENGTH, { message: 'Die Schrift-Kennung ist zu lang.' })
  .refine((value) => isBundledFontId(value) || idSchema.safeParse(value).success, {
    message:
      'Ungültige Schrift-Kennung (erwartet wird „bundled-…" oder die UUID einer hochgeladenen Schrift).',
  });

/** Kennung ausschließlich einer mitgelieferten Schrift. */
export const bundledFontIdSchema = z
  .string()
  .max(FONT_ID_MAX_LENGTH)
  .regex(BUNDLED_FONT_ID_PATTERN, {
    message: 'Erwartet wird die Kennung einer mitgelieferten Schrift („bundled-…").',
  });

/** Ein einzelnes CSS-Schriftgewicht. */
export const fontWeightSchema = z
  .number({ invalid_type_error: 'Das Schriftgewicht muss eine Zahl sein.' })
  .int({ message: 'Das Schriftgewicht muss eine ganze Zahl sein.' })
  .min(FONT_WEIGHT_MIN, { message: `Das Schriftgewicht muss mindestens ${FONT_WEIGHT_MIN} sein.` })
  .max(FONT_WEIGHT_MAX, { message: `Das Schriftgewicht darf höchstens ${FONT_WEIGHT_MAX} sein.` });

/**
 * Abgedeckter Gewichtsbereich.
 *
 * `min === max` beschreibt eine statische Schrift mit genau einem Schnitt; ein
 * umgedrehter Bereich wäre in der erzeugten `@font-face`-Regel wirkungslos und
 * fällt deshalb hier durch.
 */
export const fontWeightRangeSchema = z
  .object({
    min: fontWeightSchema,
    max: fontWeightSchema,
  })
  .refine((range) => range.min <= range.max, {
    message: 'Das kleinste Schriftgewicht darf nicht größer als das größte sein.',
    path: ['max'],
  });

/**
 * Angaben, die beim Hochladen einer Schrift neben der Datei mitkommen.
 *
 * Die Datei selbst steht **nicht** in diesem Schema: Sie kommt als
 * `multipart/form-data` und wird gegen `FONT_FORMAT_CATALOG` geprüft (Format,
 * Größe, Kopfbytes) – dafür gibt es die Fehlercodes `FONT_FORMAT_UNSUPPORTED`,
 * `FONT_FILE_TOO_LARGE` und `FONT_FILE_INVALID`.
 *
 * `variable` und `weightRange` sind optional: Vorrang hat, was sich aus der
 * Schriftdatei selbst auslesen lässt. Nur wenn die Datei dazu nichts hergibt,
 * zählt die Angabe aus dem Formular; fehlt beides, gilt die Schrift als
 * statisch mit dem Gewicht 400.
 */
export const uploadFontInputSchema = z.object({
  label: fontLabelSchema,
  family: fontFamilyNameSchema,
  variable: z.boolean().optional(),
  weightRange: fontWeightRangeSchema.optional(),
  /**
   * Dicktengleich? Angabe des Hochladenden (siehe `FontDto.monospace`).
   *
   * Optional mit `false` als Vorgabe: Der häufigere Fall ist eine
   * Proportionalschrift, und eine falsch als dicktengleich gemeldete Schrift
   * richtet in der Konsole mehr Schaden an als eine falsch als proportional
   * gemeldete in der Oberfläche.
   */
  monospace: z.boolean().optional(),
});

export type UploadFontInput = z.infer<typeof uploadFontInputSchema>;
export type FontWeightRangeInput = z.infer<typeof fontWeightRangeSchema>;
