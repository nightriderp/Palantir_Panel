import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { STANDARD_THEME_ID, THEMES } from '@/lib/theme/palette';
import { THEME_COOKIE } from '@/lib/theme/cookie';
import { AppearancePanel } from './AppearancePanel';

/**
 * Die Auswahl des Erscheinungsbilds.
 *
 * Geprüft wird nicht, wie es aussieht, sondern was das Umschalten **tut**: das
 * Attribut am Dokument (daran hängt die ganze Umfärbung) und das Cookie (daran
 * hängt, dass der nächste Seitenaufruf gleich richtig ankommt). Beides fällt
 * still aus, wenn es bricht – die Oberfläche sähe nur wieder gewöhnlich aus.
 */

const anderesTheme = THEMES.find((thema) => thema.id !== STANDARD_THEME_ID);
if (anderesTheme === undefined) throw new Error('Für diesen Test braucht es ein zweites Theme');

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
});

describe('AppearancePanel', () => {
  it('bietet jedes Theme als Auswahl an und markiert das geltende', () => {
    render(<AppearancePanel aktiv={anderesTheme.id} />);

    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length);
    expect(screen.getByRole('radio', { name: new RegExp(anderesTheme.name) })).toHaveProperty(
      'checked',
      true,
    );
  });

  it('färbt beim Wählen sofort um und merkt sich die Wahl', () => {
    render(<AppearancePanel aktiv={STANDARD_THEME_ID} />);

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(anderesTheme.name) }));

    expect(document.documentElement.dataset.theme).toBe(anderesTheme.id);
    expect(document.cookie).toContain(`${THEME_COOKIE}=${anderesTheme.id}`);
  });

  /*
   * Der Standard steht auf `:root` und gilt ohne Attribut. Bliebe beim
   * Zurückwechseln ein `data-theme="standard"` stehen, wäre das heute
   * wirkungslos – und der Tag, an dem jemand einen Block dafür anlegt, wäre
   * der Tag, an dem zwei Regeln dasselbe behaupten.
   */
  it('nimmt das Attribut zurück, wenn wieder der Standard gewählt wird', () => {
    render(<AppearancePanel aktiv={anderesTheme.id} />);
    document.documentElement.dataset.theme = anderesTheme.id;

    fireEvent.click(screen.getByRole('radio', { name: /Standard/ }));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.cookie).toContain(`${THEME_COOKIE}=${STANDARD_THEME_ID}`);
  });
});
