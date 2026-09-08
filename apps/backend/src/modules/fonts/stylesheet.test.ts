/**
 * Das erzeugte Stylesheet (Arbeitspaket S-3).
 *
 * Zwei Dinge werden hier festgehalten, und beide fallen sonst erst im Browser
 * auf – dem Ort, an dem man sie am schlechtesten sieht:
 *
 * 1. **Die Vorgabe.** Eine Instanz, die nie eine Schrift ausgewählt hat, muss
 *    danach genauso aussehen wie vorher: Space Grotesk und JetBrains Mono.
 *    Ginge das verloren, wäre der ganze Umbau ein Redesign statt einer
 *    Datenschutzänderung.
 * 2. **Der Familienname ist erzeugter Code.** Er kommt aus einem Formular und
 *    landet in einer Formatvorlage, die jeder Besucher ausgeliefert bekommt.
 *    Geprüft wird deshalb ausdrücklich der Ausbruchsversuch – nicht nur der
 *    gutartige Fall.
 */

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createAuditService } from '../admin/audit.js';
import { createFakeAuditRepository } from '../admin/test-support.js';
import { registerRbac } from '../rbac/index.js';
import {
  BUNDLED_FONTS,
  DEFAULT_MONOSPACE_FONT_ID,
  DEFAULT_UI_FONT_ID,
  findBundledFont,
} from './bundled.js';
import { registerFontRoutes } from './routes.js';
import { createFontService } from './service.js';
import { fontFileName } from './storage.js';
import {
  MONOSPACE_FONT_CSS_VARIABLE,
  UI_FONT_CSS_VARIABLE,
  type StylesheetFont,
  buildFontStylesheet,
  cssQuotedString,
  fontFileHref,
} from './stylesheet.js';
import {
  createFakeFontFileStore,
  createFakeFontRepository,
  fontBytes,
  roleSelection,
  uploadedFontRecord,
} from './test-support.js';

const VORGABE_UI = findBundledFont(DEFAULT_UI_FONT_ID)!;
const VORGABE_MONO = findBundledFont(DEFAULT_MONOSPACE_FONT_ID)!;

function schrift(overrides: Partial<StylesheetFont> = {}): StylesheetFont {
  return {
    id: 'bundled-space-grotesk',
    family: 'Space Grotesk',
    format: 'woff2',
    variable: true,
    weightRange: { min: 300, max: 700 },
    ...overrides,
  };
}

/** Alle mitgelieferten Schriften als Eingabe des Erzeugers. */
const ALLE: StylesheetFont[] = BUNDLED_FONTS.map((font) => ({
  id: font.id,
  family: font.family,
  format: font.format,
  variable: font.variable,
  weightRange: font.weightRange,
}));

describe('cssQuotedString', () => {
  it('lässt harmlose Namen unverändert', () => {
    expect(cssQuotedString('IBM Plex Mono')).toBe('"IBM Plex Mono"');
  });

  it('macht aus einem Ausbruchsversuch eine Zeichenkette ohne Sonderzeichen', () => {
    const boshaft = 'Inter"; } body { display: none } @font-face { font-family: "x';
    const erzeugt = cssQuotedString(boshaft);

    // Zwischen den beiden äußeren Anführungszeichen darf kein einziges
    // strukturbildendes Zeichen mehr stehen.
    const inhalt = erzeugt.slice(1, -1);

    expect(erzeugt.startsWith('"')).toBe(true);
    expect(erzeugt.endsWith('"')).toBe(true);
    expect(inhalt).not.toContain('"');
    expect(inhalt).not.toContain(';');
    expect(inhalt).not.toContain('{');
    expect(inhalt).not.toContain('}');
    expect(inhalt).not.toContain(':');
  });

  it('entschärft auch unsichtbare Zeichen', () => {
    // Zeilenumbruch, Nullbyte und ein Bidi-Steuerzeichen.
    const erzeugt = cssQuotedString('A\n\0‮B');

    expect(erzeugt).toBe('"A\\a \\0 \\202e B"');
  });
});

describe('buildFontStylesheet – Regeln', () => {
  it('schreibt für jede verfügbare Schrift eine @font-face-Regel', () => {
    const css = buildFontStylesheet(ALLE, { uiFontId: null, monospaceFontId: null });

    expect(css.match(/@font-face\{/g)).toHaveLength(BUNDLED_FONTS.length);

    for (const font of BUNDLED_FONTS) {
      expect(css).toContain(`font-family:"${font.family}"`);
      expect(css).toContain(`url("${fontFileHref(font.id)}")`);
    }
  });

  it('gibt einer variablen Schrift einen Gewichtsbereich und einer statischen genau ein Gewicht', () => {
    const css = buildFontStylesheet(
      [
        schrift({
          id: 'a',
          family: 'Variabel',
          variable: true,
          weightRange: { min: 100, max: 800 },
        }),
        schrift({
          id: 'b',
          family: 'Statisch',
          variable: false,
          weightRange: { min: 400, max: 400 },
        }),
      ],
      { uiFontId: null, monospaceFontId: null },
    );

    expect(css).toContain('font-weight:100 800;');
    expect(css).toContain('font-weight:400;');
  });

  it('benennt das Format so, wie CSS es kennt – nicht wie die Endung heißt', () => {
    const css = buildFontStylesheet([schrift({ id: 'a', family: 'Alt', format: 'ttf' })], {
      uiFontId: null,
      monospaceFontId: null,
    });

    expect(css).toContain('format("truetype")');
  });

  it('lässt einen bösartigen Familiennamen nicht aus seiner Regel ausbrechen', () => {
    const boshaft = 'Inter"; } body { display: none } @font-face { font-family: "x';
    const css = buildFontStylesheet([schrift({ id: 'a', family: boshaft })], {
      uiFontId: 'a',
      monospaceFontId: null,
    });

    // Genau eine Regel – der eingeschleuste zweite Block ist keiner geworden.
    expect(css.match(/@font-face\{/g)).toHaveLength(1);
    expect(css).not.toContain('display: none');
    expect(css).not.toContain('body {');
  });
});

describe('buildFontStylesheet – Auswahl und Vorgabe', () => {
  it('trägt ohne Auswahl die Vorgabe in beide Variablen', () => {
    const css = buildFontStylesheet(ALLE, { uiFontId: null, monospaceFontId: null });

    expect(css).toContain(`${UI_FONT_CSS_VARIABLE}:"${VORGABE_UI.family}"`);
    expect(css).toContain(`${MONOSPACE_FONT_CSS_VARIABLE}:"${VORGABE_MONO.family}"`);
  });

  it('trägt die gewählte Schrift in die Variable ihrer Rolle', () => {
    const css = buildFontStylesheet(ALLE, {
      uiFontId: 'bundled-playpen-sans',
      monospaceFontId: null,
    });

    expect(css).toContain(`${UI_FONT_CSS_VARIABLE}:"Playpen Sans"`);
    // Die zweite Rolle bleibt unberührt – die Felder wechseln einzeln.
    expect(css).toContain(`${MONOSPACE_FONT_CSS_VARIABLE}:"${VORGABE_MONO.family}"`);
  });

  it('fällt auf die Vorgabe zurück, wenn die gewählte Schrift verschwunden ist', () => {
    const css = buildFontStylesheet(ALLE, {
      uiFontId: '00000000-0000-4000-8000-000000000000',
      monospaceFontId: null,
    });

    expect(css).toContain(`${UI_FONT_CSS_VARIABLE}:"${VORGABE_UI.family}"`);
  });

  it('lässt die Variablen weg, wenn es gar keine Schrift gibt', () => {
    const css = buildFontStylesheet([], { uiFontId: null, monospaceFontId: null });

    expect(css).not.toContain(':root');
    expect(css).not.toContain('@font-face');
  });
});

/** Dienst und Route mit den beiden Vorgabe-Schriften im Auslieferungsordner. */
async function baueApp(auswahl: { ui: string | null; mono: string | null }) {
  const record = uploadedFontRecord({ family: 'Atkinson Hyperlegible' });

  const app = Fastify({ logger: false });
  registerRbac(app, { resolveActor: () => null });

  await app.register(
    registerFontRoutes({
      service: createFontService({
        repository: createFakeFontRepository([record]),
        uploads: createFakeFontFileStore({
          [fontFileName(record.id, record.format)]: fontBytes('woff2', 64),
        }),
        bundled: createFakeFontFileStore({
          [VORGABE_UI.fileName]: fontBytes('woff2', 128),
          [VORGABE_MONO.fileName]: fontBytes('woff2', 128),
        }),
        selection: roleSelection(auswahl.ui, auswahl.mono),
        audit: createAuditService(createFakeAuditRepository()),
      }),
    }),
  );

  await app.ready();

  return app;
}

describe('GET /public/fonts.css', () => {
  it('liefert das Stylesheet ohne Sitzung aus', async () => {
    const app = await baueApp({ ui: null, mono: null });

    const antwort = await app.inject({ method: 'GET', url: '/public/fonts.css' });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(antwort.headers['x-content-type-options']).toBe('nosniff');
    expect(antwort.body).toContain(`${UI_FONT_CSS_VARIABLE}:"${VORGABE_UI.family}"`);

    await app.close();
  });

  it('nennt mitgelieferte und hochgeladene Schriften in denselben Regeln', async () => {
    const app = await baueApp({ ui: null, mono: null });

    const { body } = await app.inject({ method: 'GET', url: '/public/fonts.css' });

    expect(body).toContain(`font-family:"${VORGABE_UI.family}"`);
    expect(body).toContain('font-family:"Atkinson Hyperlegible"');

    await app.close();
  });

  it('liefert unter der Adresse aus der erzeugten Regel wirklich die Datei', async () => {
    const app = await baueApp({ ui: null, mono: null });

    const { body } = await app.inject({ method: 'GET', url: '/public/fonts.css' });
    const adresse = /url\("([^"]+)"\)/.exec(body)?.[1];

    expect(adresse).toBeDefined();

    const datei = await app.inject({ method: 'GET', url: adresse! });

    expect(datei.statusCode).toBe(200);
    expect(datei.headers['content-type']).toBe('font/woff2');

    await app.close();
  });

  it('darf zwischengespeichert werden, aber nicht unbegrenzt – und antwortet auf ETag mit 304', async () => {
    const app = await baueApp({ ui: null, mono: null });

    const erste = await app.inject({ method: 'GET', url: '/public/fonts.css' });

    expect(erste.headers['cache-control']).toBe('public, max-age=60, must-revalidate');
    expect(erste.headers['cache-control']).not.toContain('immutable');

    const zweite = await app.inject({
      method: 'GET',
      url: '/public/fonts.css',
      headers: { 'if-none-match': String(erste.headers.etag) },
    });

    expect(zweite.statusCode).toBe(304);
    expect(zweite.body).toBe('');

    await app.close();
  });

  it('ändert seinen ETag, sobald eine andere Schrift gewählt ist', async () => {
    const vorgabe = await baueApp({ ui: null, mono: null });
    const gewaehlt = await baueApp({ ui: 'bundled-jetbrains-mono', mono: null });

    const a = await vorgabe.inject({ method: 'GET', url: '/public/fonts.css' });
    const b = await gewaehlt.inject({ method: 'GET', url: '/public/fonts.css' });

    expect(a.headers.etag).not.toBe(b.headers.etag);

    await vorgabe.close();
    await gewaehlt.close();
  });
});
