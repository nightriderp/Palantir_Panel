import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FONT_ROLES,
  FONT_STYLESHEET_LINK_ATTRIBUTE,
  fontRoleUrl,
  fontStylesheetUrl,
  reloadFontStylesheet,
  uploadFont,
} from './fonts';

/**
 * Zugriff auf die Schriften (Arbeitspaket S-3).
 *
 * Zwei Dinge, die man im laufenden Betrieb nur schwer bemerkt:
 *
 * 1. **Die Reihenfolge im Upload-Formular.** Das Backend liest den Rumpf als
 *    Strom und wertet aus, was bis zum Dateiteil angekommen ist. Ein Textfeld
 *    hinter der Datei käme dort nie an – der Upload schlüge mit
 *    `VALIDATION_FAILED` fehl, und niemand sähe warum.
 * 2. **Das Nachladen des Stylesheets.** Ohne es zeigte die Vorschau eine gerade
 *    hochgeladene Schrift bis zu eine Minute lang in der Ersatzschrift, weil
 *    die Antwort zwischengespeichert werden darf.
 *
 * Läuft in jsdom (Dateiendung `.tsx`), weil der zweite Teil ein Dokument
 * braucht.
 */

const client = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiRequest: client.apiRequest,
}));

beforeEach(() => {
  client.apiRequest.mockReset();
  client.apiRequest.mockResolvedValue({ success: true, data: null, error: null });
  document.head.innerHTML = '';
});

describe('uploadFont', () => {
  function gesendetesFormular(): FormData {
    const optionen = client.apiRequest.mock.calls[0]?.[1] as { body: FormData };

    return optionen.body;
  }

  it('schickt alle Textfelder vor der Datei', async () => {
    await uploadFont(new File(['x'], 'inter.woff2'), {
      label: 'Inter',
      family: 'Inter',
      variable: true,
      monospace: false,
      weightMin: 100,
      weightMax: 900,
    });

    const felder = [...gesendetesFormular().keys()];

    expect(felder[felder.length - 1]).toBe('file');
    expect(felder).toContain('label');
    expect(felder).toContain('family');
  });

  it('überträgt Schalter als Zeichenketten und den Bereich als zwei Felder', async () => {
    await uploadFont(new File(['x'], 'inter.woff2'), {
      label: 'Inter',
      family: 'Inter',
      variable: true,
      monospace: true,
      weightMin: 100,
      weightMax: 900,
    });

    const form = gesendetesFormular();

    expect(form.get('variable')).toBe('true');
    expect(form.get('monospace')).toBe('true');
    expect(form.get('weightMin')).toBe('100');
    expect(form.get('weightMax')).toBe('900');
  });

  it('lässt den Gewichtsbereich weg, wenn die Schrift nicht variabel ist', async () => {
    await uploadFont(new File(['x'], 'inter.woff2'), {
      label: 'Inter',
      family: 'Inter',
      variable: false,
      monospace: false,
      weightMin: 100,
      weightMax: 900,
    });

    const form = gesendetesFormular();

    // Sonst stünde im Datensatz ein Bereich, den die Datei gar nicht abdeckt.
    expect(form.has('weightMin')).toBe(false);
    expect(form.has('weightMax')).toBe(false);
    expect(form.get('variable')).toBe('false');
  });
});

describe('reloadFontStylesheet', () => {
  function link(href: string): HTMLLinkElement {
    const element = document.createElement('link');
    element.setAttribute('rel', 'stylesheet');
    element.setAttribute('href', href);
    element.setAttribute(FONT_STYLESHEET_LINK_ATTRIBUTE, 'true');
    document.head.append(element);

    return element;
  }

  it('hängt einen Zeitstempel an die Adresse des Stylesheets', () => {
    const element = link(fontStylesheetUrl());

    reloadFontStylesheet();

    expect(element.getAttribute('href')).toMatch(/\?v=\d+$/);
  });

  it('ersetzt einen vorhandenen Zeitstempel, statt einen zweiten anzuhängen', () => {
    const element = link(`${fontStylesheetUrl()}?v=1`);

    reloadFontStylesheet();

    const href = element.getAttribute('href') ?? '';

    expect(href.match(/\?/g)).toHaveLength(1);
    expect(href).not.toContain('v=1&');
  });

  it('tut nichts, wenn es das Stylesheet nicht gibt', () => {
    expect(() => reloadFontStylesheet()).not.toThrow();
  });
});

/**
 * Die Adresse je Schriftrolle.
 *
 * Sie ist der ganze Grund, warum das Wurzel-Layout die zwei benutzten
 * Schriften vorladen kann: Sie steht fest, bevor irgendjemand die Auswahl des
 * Betreibers kennt. Über die Kennung der Schrift ginge das nicht – die steht
 * erst fest, wenn das Stylesheet gelesen ist, und dann ist der serielle Weg
 * (Dokument → CSS → Schriftdatei) schon gegangen.
 */
describe('fontRoleUrl', () => {
  it('kennt genau die zwei Rollen der Oberfläche', () => {
    expect([...FONT_ROLES]).toEqual(['ui', 'mono']);
  });

  it('nennt die Rolle, nicht die Kennung der Schrift', () => {
    for (const rolle of FONT_ROLES) {
      const adresse = fontRoleUrl(rolle);

      expect(adresse.endsWith(`/public/fonts/${rolle}`)).toBe(true);
      // Keine Kennung darin – sonst müsste die Seite die Auswahl kennen.
      expect(adresse).not.toMatch(/\/api\/fonts\//);
    }
  });

  it('liegt unter derselben Herkunft wie das Stylesheet', () => {
    // Beide kommen aus der API. Zeigten sie auseinander, wäre das Vorladen
    // eine Verbindung zu einem Host, den sonst niemand anspricht.
    const stylesheet = fontStylesheetUrl();
    const basis = stylesheet.slice(0, stylesheet.indexOf('/public/'));

    for (const rolle of FONT_ROLES) {
      expect(fontRoleUrl(rolle).startsWith(basis)).toBe(true);
    }
  });
});
