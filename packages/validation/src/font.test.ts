import { describe, expect, it } from 'vitest';
import { instanceSettingsInputSchema } from './auth.js';
import {
  FONT_FAMILY_NAME_MAX_LENGTH,
  FONT_LABEL_MAX_LENGTH,
  RESERVED_FONT_FAMILY_NAMES,
  bundledFontIdSchema,
  fontFamilyNameSchema,
  fontIdSchema,
  fontLabelSchema,
  fontWeightRangeSchema,
  uploadFontInputSchema,
} from './font.js';

/**
 * Der Familienname landet in einer erzeugten `@font-face`-Regel. Diese Liste
 * ist der eigentliche Gegenstand der Prüfung: Jede Zeile ist ein Versuch, aus
 * dem Namen heraus die Formatvorlage zu verlassen. Sie muss **hier** scheitern
 * – nicht erst im Backend und schon gar nicht erst im Browser.
 *
 * Unsichtbare Zeichen stehen bewusst als Escape-Folge (`…`) und nicht als
 * Zeichen: Ein Nullbyte oder ein Bidi-Steuerzeichen im Quelltext wäre beim
 * Lesen der Datei nicht zu erkennen.
 */
const EINSCHLEUSUNGSVERSUCHE: ReadonlyArray<readonly [string, string]> = [
  ['Anführungszeichen schließt den Namen', 'Inter"; } body { display: none } @font-face { x: "y'],
  ['einfaches Anführungszeichen', "Inter'; }"],
  ['Semikolon beendet die Deklaration', 'Inter; color: red'],
  ['geschweifte Klammern öffnen einen Block', 'Inter{}'],
  ['schließende Klammer verlässt die Regel', 'Inter } body { display: none'],
  ['spitze Klammern brechen aus dem style-Element aus', 'Inter</style><script>x()</script>'],
  ['Zeilenumbruch mitten im Namen', 'Inter\nbody{display:none}'],
  ['angehängter Zeilenumbruch (würde vom Trimmen verdeckt)', 'Inter\n'],
  ['Wagenrücklauf', 'Inter\r\n'],
  ['Tabulator', 'Inter\tbold'],
  ['Nullbyte', 'Inter\u0000'],
  ['Bidi-Steuerzeichen dreht die Anzeige um', 'Inter\u202Eretni'],
  ['Zero-Width-Space bleibt unsichtbar', 'Inter\u200BSans'],
  ['CSS-Kommentar', 'Inter/*'],
  ['CSS-Escape mit Backslash', 'Inter\\22 ; color: red'],
  ['Klammern und url()', 'Inter url(https://example.invalid/x)'],
  ['At-Regel', 'Inter @import "https://example.invalid/x.css"'],
  ['Komma hängt eine zweite Familie an', 'Inter, serif'],
  ['Doppelpunkt beginnt eine Eigenschaft', 'Inter: bold'],
  ['Backtick', '`Inter`'],
  ['Ausrufezeichen erzwingt Vorrang', 'Inter !important'],
  ['doppeltes Leerzeichen', 'Inter  Sans'],
  ['beginnt mit einer Ziffer statt einem Buchstaben', '1nter'],
  ['endet auf einem Bindestrich', 'Inter-'],
];

describe('fontFamilyNameSchema – Schutz der erzeugten Formatvorlage', () => {
  it.each(EINSCHLEUSUNGSVERSUCHE)('weist ab: %s', (_beschreibung, angriff) => {
    expect(fontFamilyNameSchema.safeParse(angriff).success).toBe(false);
  });

  it('weist jeden dieser Versuche auch als Teil des Upload-Formulars ab', () => {
    for (const [, angriff] of EINSCHLEUSUNGSVERSUCHE) {
      const ergebnis = uploadFontInputSchema.safeParse({ label: 'Testschrift', family: angriff });

      expect(ergebnis.success).toBe(false);
    }
  });

  it.each([
    'Inter',
    'IBM Plex Mono',
    'JetBrains Mono',
    'Space Grotesk',
    'Atkinson Hyperlegible',
    'Source Code Pro',
    'M PLUS 1p',
    'Fira-Code',
    'Roboto2',
  ])('lässt einen üblichen Familiennamen durch: %s', (name) => {
    const ergebnis = fontFamilyNameSchema.safeParse(name);

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data).toBe(name);
  });

  it('entfernt umschließende Leerzeichen, ohne den Namen zu verändern', () => {
    const ergebnis = fontFamilyNameSchema.safeParse('  IBM Plex Mono  ');

    expect(ergebnis.success && ergebnis.data).toBe('IBM Plex Mono');
  });

  it('weist in CSS reservierte Namen ab – unabhängig von der Schreibweise', () => {
    for (const reserviert of RESERVED_FONT_FAMILY_NAMES) {
      expect(fontFamilyNameSchema.safeParse(reserviert).success).toBe(false);
    }

    expect(fontFamilyNameSchema.safeParse('Monospace').success).toBe(false);
    expect(fontFamilyNameSchema.safeParse('INHERIT').success).toBe(false);
    // Ein Name, der ein reserviertes Wort nur enthält, bleibt erlaubt.
    expect(fontFamilyNameSchema.safeParse('Monospace Neue').success).toBe(true);
  });

  it('weist leere und überlange Namen ab', () => {
    expect(fontFamilyNameSchema.safeParse('').success).toBe(false);
    expect(fontFamilyNameSchema.safeParse('   ').success).toBe(false);
    expect(fontFamilyNameSchema.safeParse('A'.repeat(FONT_FAMILY_NAME_MAX_LENGTH)).success).toBe(
      true,
    );
    expect(
      fontFamilyNameSchema.safeParse('A'.repeat(FONT_FAMILY_NAME_MAX_LENGTH + 1)).success,
    ).toBe(false);
    // Auch eine Eingabe weit jenseits jeder Grenze wird abgewiesen und nicht
    // erst zeichenweise geprüft.
    expect(fontFamilyNameSchema.safeParse('A'.repeat(100_000)).success).toBe(false);
  });

  it('weist Nicht-ASCII-Buchstaben ab (der Anzeigename trägt sie)', () => {
    expect(fontFamilyNameSchema.safeParse('Grün Sans').success).toBe(false);
    expect(fontFamilyNameSchema.safeParse('Ｉnter').success).toBe(false);
  });

  it('weist alles ab, was gar kein Text ist', () => {
    expect(fontFamilyNameSchema.safeParse(42).success).toBe(false);
    expect(fontFamilyNameSchema.safeParse(null).success).toBe(false);
    expect(fontFamilyNameSchema.safeParse({ toString: () => 'Inter' }).success).toBe(false);
  });
});

describe('fontLabelSchema – Anzeigename', () => {
  it('erlaubt Umlaute, Klammern und Punkte', () => {
    expect(fontLabelSchema.safeParse('Inter (variabel)').success).toBe(true);
    expect(fontLabelSchema.safeParse('Grün Sans 2.0').success).toBe(true);
  });

  it('weist Steuerzeichen und spitze Klammern ab', () => {
    expect(fontLabelSchema.safeParse('Inter\n').success).toBe(false);
    expect(fontLabelSchema.safeParse('Inter\u0000').success).toBe(false);
    expect(fontLabelSchema.safeParse('<b>Inter</b>').success).toBe(false);
  });

  it('weist leere und überlange Anzeigenamen ab', () => {
    expect(fontLabelSchema.safeParse('  ').success).toBe(false);
    expect(fontLabelSchema.safeParse('A'.repeat(FONT_LABEL_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe('fontIdSchema – Kennungen', () => {
  it('nimmt mitgelieferte Kennungen und UUIDs an', () => {
    expect(fontIdSchema.safeParse('bundled-space-grotesk').success).toBe(true);
    expect(fontIdSchema.safeParse('0f2f3f4f-0000-4000-8000-000000000001').success).toBe(true);
  });

  it('weist alles andere ab', () => {
    expect(fontIdSchema.safeParse('Inter').success).toBe(false);
    expect(fontIdSchema.safeParse('bundled-').success).toBe(false);
    expect(fontIdSchema.safeParse('../../etc/passwd').success).toBe(false);
    expect(fontIdSchema.safeParse('bundled-inter/../../secret').success).toBe(false);
    expect(fontIdSchema.safeParse('').success).toBe(false);
    expect(fontIdSchema.safeParse('b'.repeat(200)).success).toBe(false);
  });

  it('unterscheidet die mitgelieferte Kennung von der hochgeladenen', () => {
    expect(bundledFontIdSchema.safeParse('bundled-jetbrains-mono').success).toBe(true);
    expect(bundledFontIdSchema.safeParse('0f2f3f4f-0000-4000-8000-000000000001').success).toBe(
      false,
    );
  });
});

describe('fontWeightRangeSchema', () => {
  it('nimmt einen aufsteigenden Bereich und einen einzelnen Schnitt an', () => {
    expect(fontWeightRangeSchema.safeParse({ min: 100, max: 900 }).success).toBe(true);
    expect(fontWeightRangeSchema.safeParse({ min: 400, max: 400 }).success).toBe(true);
  });

  it('weist umgekehrte und unmögliche Bereiche ab', () => {
    expect(fontWeightRangeSchema.safeParse({ min: 700, max: 300 }).success).toBe(false);
    expect(fontWeightRangeSchema.safeParse({ min: 0, max: 900 }).success).toBe(false);
    expect(fontWeightRangeSchema.safeParse({ min: 100, max: 1001 }).success).toBe(false);
    expect(fontWeightRangeSchema.safeParse({ min: 400.5, max: 700 }).success).toBe(false);
  });
});

describe('uploadFontInputSchema', () => {
  it('nimmt Anzeigename und Familienname an', () => {
    const ergebnis = uploadFontInputSchema.safeParse({
      label: 'Inter (variabel)',
      family: 'Inter',
    });

    expect(ergebnis.success).toBe(true);
  });

  it('verlangt beide Angaben', () => {
    expect(uploadFontInputSchema.safeParse({ family: 'Inter' }).success).toBe(false);
    expect(uploadFontInputSchema.safeParse({ label: 'Inter' }).success).toBe(false);
  });

  it('nimmt die Angaben zur Variabilität an, verlangt sie aber nicht', () => {
    expect(
      uploadFontInputSchema.safeParse({
        label: 'Inter',
        family: 'Inter',
        variable: true,
        weightRange: { min: 100, max: 900 },
      }).success,
    ).toBe(true);
  });

  it('nimmt die Angabe „dicktengleich" an und lässt sie weg', () => {
    const mitAngabe = uploadFontInputSchema.safeParse({
      label: 'JetBrains Mono',
      family: 'JetBrains Mono',
      monospace: true,
    });

    expect(mitAngabe.success && mitAngabe.data.monospace).toBe(true);

    // Ohne Angabe bleibt das Feld leer – die Vorgabe „proportional" setzt das
    // Backend, nicht das Schema. So bleibt unterscheidbar, ob jemand die Frage
    // beantwortet oder übergangen hat.
    const ohneAngabe = uploadFontInputSchema.safeParse({ label: 'Inter', family: 'Inter' });

    expect(ohneAngabe.success && ohneAngabe.data.monospace).toBeUndefined();
  });

  it('lehnt eine Zeichenkette statt eines Schalters ab', () => {
    // Der Weg hierher ist ein Multipart-Formular; dort ist jedes Feld eine
    // Zeichenkette. Das Umwandeln gehört in die Route, nicht ins Schema –
    // sonst würde aus jedem beliebigen Text stillschweigend „wahr".
    expect(
      uploadFontInputSchema.safeParse({ label: 'Inter', family: 'Inter', monospace: 'true' })
        .success,
    ).toBe(false);
  });
});

describe('instanceSettingsInputSchema – additive Erweiterung', () => {
  it('bleibt ohne die Schrift-Felder gültig', () => {
    // Der Nachweis aus CLAUDE.md §3: Ein Aufrufer, der nur den
    // Registrierungsschalter kennt, muss weiterhin durchkommen.
    const ergebnis = instanceSettingsInputSchema.safeParse({ selfRegistrationEnabled: true });

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.uiFontId).toBeUndefined();
    expect(ergebnis.success && ergebnis.data.monospaceFontId).toBeUndefined();
  });

  it('unterscheidet „unverändert" (fehlend) von „zurück auf die Vorgabe" (null)', () => {
    const zurueck = instanceSettingsInputSchema.safeParse({
      selfRegistrationEnabled: true,
      uiFontId: null,
      monospaceFontId: null,
    });

    expect(zurueck.success).toBe(true);
    expect(zurueck.success && zurueck.data.uiFontId).toBeNull();
  });

  it('nimmt beide Kennungen getrennt an', () => {
    const ergebnis = instanceSettingsInputSchema.safeParse({
      selfRegistrationEnabled: false,
      uiFontId: '0f2f3f4f-0000-4000-8000-000000000004',
      monospaceFontId: 'bundled-jetbrains-mono',
    });

    expect(ergebnis.success).toBe(true);
  });

  it('weist eine Kennung ab, die keine ist', () => {
    expect(
      instanceSettingsInputSchema.safeParse({
        selfRegistrationEnabled: true,
        uiFontId: 'Inter"; } body { display: none }',
      }).success,
    ).toBe(false);
  });
});
