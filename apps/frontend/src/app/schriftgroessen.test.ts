import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';

/**
 * Die Grenze, ab der eine Überschrift die Anzeigeschrift des Themes trägt.
 *
 * `globals.css` legt sie auf `h1`/`h2` und nimmt die klein gesetzten wieder
 * aus. Beide Seiten stehen an verschiedenen Orten: die Ausnahmeliste im
 * Stylesheet, die Größen in `tailwind.config.ts`. Dieser Test hält sie
 * zusammen – wer der Skala eine Stufe unter 14px hinzufügt, bekommt sonst eine
 * Überschrift, die in einer Zierschrift bei 11px steht, und merkt es erst im
 * Browser.
 *
 * **So ist es auch passiert.** Die erste Fassung hatte gar keine Ausnahme;
 * „Deine Server · 3" stand danach bei 10px in Bangers. Im Quelltext war nichts
 * zu sehen – dort steht überall dasselbe `<h2>`.
 */

/** Ab hier (einschließlich) darf eine Überschrift die Anzeigeschrift tragen. */
const GRENZE_PX = 14;

const groessen = (tailwindConfig.theme?.fontSize ?? {}) as unknown as Record<
  string,
  [string, unknown]
>;

function pixel(stufe: [string, unknown]): number {
  const rem = Number.parseFloat(stufe[0]);
  return rem * 16;
}

const zuKlein = Object.entries(groessen)
  .filter(([, stufe]) => pixel(stufe) < GRENZE_PX)
  .map(([name]) => name)
  .sort();

const globals = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');

/** Die Klassen, die das Stylesheet von der Anzeigeschrift ausnimmt. */
const ausgenommen = [
  ...new Set(
    [...globals.matchAll(/h[12]\.(text-[\w-]+)/g)].map(([, klasse]) => (klasse ?? '').slice(5)),
  ),
].sort();

describe('Anzeigeschrift nur auf großen Überschriften', () => {
  it(`nimmt genau die Stufen unter ${String(GRENZE_PX)}px aus`, () => {
    expect(ausgenommen).toEqual(zuKlein);
  });

  it('lässt die Stufen ab der Grenze in Ruhe', () => {
    const abGrenze = Object.entries(groessen)
      .filter(([, stufe]) => pixel(stufe) >= GRENZE_PX)
      .map(([name]) => name);

    for (const name of abGrenze) {
      expect(ausgenommen, `${name} darf nicht ausgenommen sein`).not.toContain(name);
    }
  });

  /*
   * Ohne diese Prüfung liefe der Test auch dann grün, wenn beide Listen leer
   * wären – etwa weil das Auslesen des Stylesheets stillschweigend nichts
   * gefunden hat.
   */
  it('findet überhaupt Ausnahmen im Stylesheet', () => {
    expect(ausgenommen.length).toBeGreaterThan(0);
  });
});
