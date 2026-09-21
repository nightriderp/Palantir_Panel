import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@/lib/theme/palette';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { ThemeEmblem } from './ThemeEmblem';

/** Das gezeichnete Zeichen eines Themes – als Markup, zum Vergleichen. */
function zeichne(themeId: string): string {
  const { container } = render(
    <ThemeProvider themeId={themeId}>
      <ThemeEmblem />
    </ThemeProvider>,
  );
  return container.innerHTML;
}

describe('ThemeEmblem', () => {
  it.each(THEMES.map((thema) => [thema.id, thema.name] as const))(
    'Theme „%s" bringt ein eigenes Motiv mit',
    (id) => {
      const markup = zeichne(id);

      expect(markup).toContain('<svg');
      // Mindestens eine gezeichnete Form – ein leeres SVG wäre ein stiller Ausfall.
      expect(/<(path|circle)\b/.test(markup), `${id} zeichnet nichts`).toBe(true);
    },
  );

  /*
   * Der eigentliche Zweck: Ein Emblem, das alle Themes teilen, ist kein
   * Emblem, sondern ein Icon. Fehlt ein Motiv in der Tabelle, fällt es
   * stillschweigend auf den Lorbeer zurück – sichtbar wird das nur hier.
   */
  it('kein Theme trägt versehentlich das Zeichen eines anderen', () => {
    const gezeichnet = new Map<string, string>();
    for (const thema of THEMES) gezeichnet.set(thema.id, zeichne(thema.id));

    const doppelt = [...gezeichnet].filter(
      ([id, markup]) =>
        [...gezeichnet].find(([anderes, m]) => anderes !== id && m === markup) !== undefined,
    );

    expect(doppelt.map(([id]) => id)).toEqual([]);
  });

  /*
   * Die Kennung kommt aus einem Cookie und ist damit beliebig. Ein unbekannter
   * Wert darf keine leere Stelle hinterlassen, wo ein Zeichen stehen sollte.
   */
  it('fällt bei unbekannter Kennung auf den Lorbeer zurück', () => {
    expect(zeichne('gibtesnicht')).toBe(zeichne('standard'));
  });

  /*
   * Daneben steht immer die Überschrift „Bestenliste“. Das Zeichen schmückt
   * sie, es sagt nichts Eigenes – eine Sprachausgabe würde es sonst als
   * zweite, stumme Überschrift vorlesen.
   */
  it('bleibt für Sprachausgaben unsichtbar', () => {
    const { container } = render(
      <ThemeProvider themeId="schmiedefeuer">
        <ThemeEmblem />
      </ThemeProvider>,
    );
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
  });
});
