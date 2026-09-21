import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import tailwindConfig from '../../../tailwind.config';
import { THEMES, type Palette } from '@/lib/theme/palette';
import { LogoMark } from './icons/LogoMark';
import { MetricRing } from './server/MetricRing';

/**
 * `tailwind.config.ts` verbietet literale Farbwerte in Komponenten. `MetricRing`
 * und `LogoMark` hielten sich als Einzige nicht daran und schrieben die Werte
 * der Tokens `line` und `canvas` von Hand ab (Audit W3-2, frontend-lib-17).
 * `LogoMark` zeichnet inzwischen das Signet aus dem Projektlogo und braucht
 * dafür zusätzlich `brand` und `accent` als Farbstopps des Verlaufs.
 *
 * Der Test hält beide Seiten zusammen: die Klasse, die die Komponente setzt,
 * und den Token, den die Konfiguration dazu führt. Ein Umbenennen des Tokens
 * ließe die Komponente sonst still ungefärbt.
 *
 * **Seit der Theme-Umstellung prüft diese Datei zusätzlich jedes Theme.** Die
 * Kontrastrechnung lief früher gegen die einzige Palette, die es gab; jetzt
 * ist sie der Türsteher: Ein neues Theme kommt nur herein, wenn sein Text auf
 * seinen eigenen Flächen lesbar bleibt. Ohne das wäre die Auswahl ein Weg, die
 * halbe Oberfläche unsichtbar zu machen – freiwillig, aber unwiderruflich für
 * den, der die Schrift danach nicht mehr findet.
 */

/**
 * Farbpalette aus der Konfiguration.
 *
 * `Config['theme']` ist bis auf Index-Signaturen untypisiert; ein `unknown` mit
 * anschließender Prüfung ist deshalb ehrlicher als ein `any` (Entwicklungsregeln §4).
 */
const palette = (tailwindConfig.theme?.extend?.colors ?? {}) as unknown as Record<string, unknown>;

function tokenVorhanden(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(palette, name);
}

const LITERALE_FARBE = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

/** Relative Leuchtdichte nach WCAG 2.x. */
function leuchtdichte(hex: string): number {
  const kanal = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * kanal(1) + 0.7152 * kanal(3) + 0.0722 * kanal(5);
}

/** Kontrastverhältnis zweier Farben (1 bis 21). */
function kontrast(a: string, b: string): number {
  const la = leuchtdichte(a);
  const lb = leuchtdichte(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Alle Flächen, auf denen Text stehen kann.
 *
 * `surface` ist die hellste und damit die schwerste – an ihr entscheidet sich
 * jeder Grenzfall. `surfaceCard` steht mit in der Liste, obwohl es dunkler ist
 * als `surface`: Es ist der Grund jeder Karte, und dass es heute keinen
 * Grenzfall stellt, ist eine Eigenschaft der Werte, nicht der Regel.
 */
const FLAECHEN = [
  'canvas',
  'surface',
  'surfaceMuted',
  'surfaceDeep',
  'surfaceCard',
  'surfaceConsole',
] as const satisfies readonly (keyof Palette)[];

/** Fließtext, auch klein – 4,5:1 (WCAG 1.4.3). `inkDisabled` ist ausgenommen: Inaktives darf leiser sein. */
const TEXT_TOKENS = [
  'ink',
  'inkMuted',
  'inkSoft',
  'inkFaint',
] as const satisfies readonly (keyof Palette)[];

/** Statusfarben stehen als Text in Badges und Meldungen. */
const STATUS_TOKENS = [
  'success',
  'warning',
  'danger',
  'caution',
  'accent',
  'brandBright',
] as const satisfies readonly (keyof Palette)[];

/**
 * Der Nachweis, den es vorher nicht gab (Review 2026-09-16, Befund 12.7): Die
 * Tokens sind das Design-System; ob sie lesbar sind, prüfte niemand. Fällt ein
 * Wert unter die Schwelle, wird es hier rot – nicht erst beim Nutzer.
 */
describe.each(THEMES.map((thema) => [thema.name, thema.palette] as const))(
  'Kontrast der Farbtokens, Theme „%s" (WCAG 1.4.3)',
  (_name, farben) => {
    it.each([...TEXT_TOKENS, ...STATUS_TOKENS])('%s hält 4,5:1 gegen jede Fläche', (token) => {
      for (const flaeche of FLAECHEN) {
        expect(
          kontrast(farben[token], farben[flaeche]),
          `${token} auf ${flaeche}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('die Textstufen bleiben in ihrer Reihenfolge', () => {
      // Heller machen darf die Hierarchie nicht umkehren – dann sähe Nebensache
      // wichtiger aus als der Haupttext.
      const gegenSurface = TEXT_TOKENS.map((token) => kontrast(farben[token], farben.surface));
      expect(gegenSurface).toEqual([...gegenSurface].sort((a, b) => b - a));
    });

    /**
     * Reihenfolge allein genügt nicht – der Abstand muss auch zu sehen sein.
     *
     * Genau daran fehlte es: Nach dem Anheben von Review 2026-09-16 standen
     * `soft` und `faint` bei 5,43 und 4,64, ein Schritt von 1,17. Formal vier
     * Textstufen, sichtbar drei – ein Abschnittslabel und ein Zeitstempel sahen
     * gleich wichtig aus, und die Oberfläche wirkte flach. Der Fall ging durch
     * jede Prüfung, weil niemand nach dem *Abstand* fragte, nur nach Boden und
     * Reihenfolge.
     *
     * ⚠️ Die Schwelle ist bewusst niedrig angesetzt (1,25). Sie soll nicht eine
     * bestimmte Rampe festschreiben, sondern verhindern, dass zwei Stufen wieder
     * zusammenfallen – nach oben ist jeder Abstand recht. Für ein neues Theme
     * ist sie damit die eigentliche Auflage: Es darf anders aussehen, aber es
     * muss dieselbe Tiefe haben.
     */
    const MINDESTSCHRITT = 1.25;

    it(`zwischen zwei Textstufen liegt mindestens Faktor ${String(MINDESTSCHRITT)}`, () => {
      const gegenSurface = TEXT_TOKENS.map((token) => ({
        token,
        wert: kontrast(farben[token], farben.surface),
      }));

      for (let i = 1; i < gegenSurface.length; i += 1) {
        const heller = gegenSurface[i - 1];
        const dunkler = gegenSurface[i];
        if (!heller || !dunkler) throw new Error('Textstufen fehlen');

        expect(
          heller.wert / dunkler.wert,
          `${heller.token} (${heller.wert.toFixed(2)}) zu ${dunkler.token} (${dunkler.wert.toFixed(2)})`,
        ).toBeGreaterThanOrEqual(MINDESTSCHRITT);
      }
    });

    it('`brand` als Text erreicht mindestens 3:1 (Bedienelemente, große Schrift)', () => {
      // Die Markenfarbe steht auf Knöpfen unter weißer Schrift und als Textfarbe
      // in Initialen und Links – dort mit 3,9:1 auf `surface` unter 4,5. Für
      // Fließtext gibt es `brand.bright`; hier wird nur der Boden gehalten.
      for (const flaeche of FLAECHEN) {
        expect(
          kontrast(farben.brand, farben[flaeche]),
          `brand auf ${flaeche}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  },
);

describe('Farbtokens statt literaler Werte', () => {
  it('MetricRing zeichnet die Ringspur über den Token `line`', () => {
    const { container } = render(<MetricRing label="CPU" value="42 %" percent={42} />);
    const spur = container.querySelector('circle');

    expect(spur).not.toBeNull();
    expect(spur?.getAttribute('class')).toContain('stroke-line');
    expect(spur?.getAttribute('stroke')).toBeNull();
    expect(tokenVorhanden('line')).toBe(true);
  });

  it('LogoMark färbt Kachel und Signet über Tokens', () => {
    const { container } = render(<LogoMark />);
    const kachel = container.firstElementChild;
    const stopps = container.querySelectorAll('stop');

    expect(kachel?.getAttribute('class')).toContain('bg-canvas');
    expect(stopps).toHaveLength(2);
    // SVG-Farbstopps haben keine Utility-Klasse, deshalb die theme()-Schreibweise.
    expect(stopps[0]?.getAttribute('class')).toContain('theme(colors.brand.DEFAULT)');
    expect(stopps[1]?.getAttribute('class')).toContain('theme(colors.accent)');
    expect(stopps[0]?.getAttribute('stop-color')).toBeNull();
    expect(stopps[1]?.getAttribute('stop-color')).toBeNull();
    expect(tokenVorhanden('canvas')).toBe(true);
    expect(tokenVorhanden('brand')).toBe(true);
    expect(tokenVorhanden('accent')).toBe(true);
  });

  it('beide Komponenten kommen ohne literalen Farbwert im Markup aus', () => {
    const ring = render(<MetricRing label="RAM" value="—" percent={null} />);
    const logo = render(<LogoMark size={40} />);

    expect(ring.container.innerHTML).not.toMatch(LITERALE_FARBE);
    expect(logo.container.innerHTML).not.toMatch(LITERALE_FARBE);
  });
});
