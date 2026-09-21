import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../../tailwind.config';
import { THEMES, variablenName } from './palette';

/**
 * Die Klammer zwischen Palette und Stylesheets.
 *
 * Seit die Farben über CSS-Variablen laufen, gibt es einen Fehler, den weder
 * der Übersetzer noch ein Kontrastwert bemerkt: einen Tippfehler im
 * Variablennamen. `rgb(var(--c-sufrace) / …)` ist gültiges CSS, die Variable
 * ist nur nie gesetzt – die Farbe fällt ersatzlos aus, und zwar genau in dem
 * Zustand, den beim Prüfen niemand aufgeschlagen hat.
 *
 * Beide Richtungen zählen. Eine gelesene Variable ohne Wert ist die fehlende
 * Farbe von oben; ein Wert ohne Leser ist harmloser, aber er ist auch nie das,
 * was jemand wollte – meistens heißt er, dass eine Farbstelle umbenannt wurde
 * und eine Hälfte der Umbenennung liegen blieb.
 *
 * Liegt in der Node-Umgebung (`*.test.ts`), weil er Dateien liest: In jsdom
 * ist `import.meta.url` keine `file:`-Adresse.
 */

const AUS_DATEI = (pfad: string): string =>
  readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), 'utf8');

/** Jede Variable, die irgendwo gelesen wird – aus der Konfiguration und aus `globals.css`. */
const gelesen = new Set(
  [
    ...`${JSON.stringify(tailwindConfig.theme?.extend ?? {})}\n${AUS_DATEI('../../app/globals.css')}`.matchAll(
      /var\((--c-[a-z-]+)\)/g,
    ),
  ].map(([, name]) => name as string),
);

/**
 * Farbstellen, die **nicht** als `--c-…` gelesen werden.
 *
 * `selectPfeil` steckt fertig im Hintergrundbild des Auswahlfelds: In eine
 * `url()`-Datenadresse setzt CSS keine Variablen ein, deshalb baut
 * `themesCss()` je Theme eine eigene Adresse mit eingebackener Farbe. Der
 * abgeleitete Weg wird unten eigens geprüft – ausgenommen heißt hier nicht
 * ungeprüft.
 */
const ABGELEITET = new Set(['selectPfeil']);

/** Jede Variable, welche die Palette als Farbe setzt. */
const vorhanden = new Set(
  Object.keys(THEMES[0]?.palette ?? {})
    .filter((schluessel) => !ABGELEITET.has(schluessel))
    .map(variablenName),
);

describe('Farbvariablen: Palette und Stylesheets passen zusammen', () => {
  it('jede gelesene Variable hat in der Palette einen Wert', () => {
    expect([...gelesen].filter((name) => !vorhanden.has(name)).sort()).toEqual([]);
  });

  it('jeder Wert der Palette wird auch irgendwo gelesen', () => {
    expect([...vorhanden].filter((name) => !gelesen.has(name)).sort()).toEqual([]);
  });

  /*
   * Ohne das hier bliebe der Nachweis oben auf halber Strecke stehen: Er prüft
   * die Farbstellen des **ersten** Themes. Ein zweites, dem eine Stelle fehlt,
   * setzt deren Variable nicht – es gilt dann der Wert von `:root`, also der
   * des Standards. Sichtbar wäre das als eine einzelne blaue Fläche mitten im
   * warmen Theme, und niemand wüsste, woher sie kommt.
   */
  it.each(THEMES.map((thema) => [thema.id, thema] as const))(
    'Theme „%s" besetzt jede Farbstelle',
    (_id, thema) => {
      expect(
        Object.keys(thema.palette)
          .filter((schluessel) => !ABGELEITET.has(schluessel))
          .map(variablenName)
          .sort(),
      ).toEqual([...vorhanden].sort());
    },
  );

  /*
   * Die Gegenprobe zur Ausnahme oben: Was nicht als Farbe gelesen wird, muss
   * über seinen abgeleiteten Weg ankommen. Sonst wäre `ABGELEITET` nur eine
   * bequeme Art, eine Variable verschwinden zu lassen.
   */
  it('liest die abgeleiteten Variablen - Pfeil und Schatten - ebenfalls', () => {
    const css = `${JSON.stringify(tailwindConfig.theme?.extend ?? {})}\n${AUS_DATEI('../../app/globals.css')}`;

    expect(css, 'Pfeil im Auswahlfeld').toContain('var(--select-pfeil)');
    for (const name of ['glow', 'panel', 'modal']) {
      expect(css, `Schatten ${name}`).toContain(`var(--schatten-${name})`);
    }
  });
});
