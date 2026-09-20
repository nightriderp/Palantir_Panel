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
  fontRoleHref,
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

describe('fontFileHref – Adresse der Schriftdatei', () => {
  it('bleibt relativ zum Stylesheet, damit ein Unterpfad nicht danebengeht', () => {
    /*
     * Betreiber-Meldung 20.09.2026: Seit die API auch unter <Domain>/api
     * erreichbar ist, laedt der Browser das Stylesheet als
     * <Domain>/api/public/fonts.css. Wurzel-relativ zeigte die Schrift dann
     * auf <Domain>/api/fonts/..., der vorgeschaltete Server schnitt sein
     * Praefix ab, und das Backend sah /fonts/... - eine Route, die es nicht
     * gibt. Jede Schrift kam mit 404 zurueck.
     */
    expect(fontFileHref('bundled-chewy')).toBe('../api/fonts/bundled-chewy/file');
  });

  it('maskiert die Kennung, damit nichts aus der Adresse ausbricht', () => {
    expect(fontFileHref('a/b')).toBe('../api/fonts/a%2Fb/file');
  });
});

describe('buildFontStylesheet – Regeln', () => {
  it('schreibt für jede verfügbare Schrift eine @font-face-Regel', () => {
    const css = buildFontStylesheet(ALLE, { uiFontId: null, monospaceFontId: null });

    expect(css.match(/@font-face\{/g)).toHaveLength(BUNDLED_FONTS.length);

    for (const font of BUNDLED_FONTS) {
      expect(css).toContain(`font-family:"${font.family}"`);
    }

    /*
     * Die Adresse hängt davon ab, ob die Schrift gerade eine Rolle besetzt:
     * Die beiden gewählten stehen unter ihrer Rollen-Adresse (nur so kann das
     * Frontend sie vorladen), alle anderen unter ihrer Kennung.
     */
    const inRolle = new Set([DEFAULT_UI_FONT_ID, DEFAULT_MONOSPACE_FONT_ID]);

    for (const font of BUNDLED_FONTS.filter((f) => !inRolle.has(f.id))) {
      expect(css).toContain(`url("${fontFileHref(font.id)}")`);
    }

    expect(css).toContain(`url("${fontRoleHref('ui')}")`);
    expect(css).toContain(`url("${fontRoleHref('mono')}")`);
  });

  /**
   * ⚠️ Der Fall, der das Vorladen still teurer machen würde als gar keines.
   *
   * Lädt das Frontend `…/public/fonts/ui` vor, während die Regel die Datei
   * über `…/api/fonts/<Kennung>/file` holt, sind das für den Browser zwei
   * verschiedene Adressen: Er lädt zweimal und meldet „preloaded but not
   * used". Der Test hält fest, dass die gewählte Schrift **nicht** mehr unter
   * ihrer Kennung in der Regel steht.
   */
  it('nennt die gewählte Schrift nicht mehr unter ihrer Kennung', () => {
    const css = buildFontStylesheet(ALLE, {
      uiFontId: DEFAULT_MONOSPACE_FONT_ID,
      monospaceFontId: null,
    });

    expect(css).not.toContain(`url("${fontFileHref(DEFAULT_MONOSPACE_FONT_ID)}")`);
    expect(css).toContain(`url("${fontRoleHref('ui')}")`);
  });

  /**
   * Besetzt eine Schrift beide Rollen, kann sie nur eine Adresse haben – eine
   * Familie hat genau eine Regel. `ui` gewinnt.
   */
  it('gibt einer Schrift in beiden Rollen die ui-Adresse', () => {
    const css = buildFontStylesheet(ALLE, {
      uiFontId: DEFAULT_MONOSPACE_FONT_ID,
      monospaceFontId: DEFAULT_MONOSPACE_FONT_ID,
    });

    expect(css).toContain(`url("${fontRoleHref('ui')}")`);
    expect(css).not.toContain(`url("${fontRoleHref('mono')}")`);
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

  it('liefert unter jeder Adresse aus den erzeugten Regeln wirklich eine Datei', async () => {
    const app = await baueApp({ ui: null, mono: null });

    const { body } = await app.inject({ method: 'GET', url: '/public/fonts.css' });
    const adressen = [...body.matchAll(/url\("([^"]+)"\)/g)].map((treffer) => treffer[1]!);

    expect(adressen.length).toBeGreaterThan(0);

    /*
     * Die Adressen im Stylesheet sind **pfad-relativ** – sie gelten gegen das
     * Verzeichnis des Stylesheets, nicht gegen die Wurzel. Genau so löst ein
     * Browser sie auf, und genau so muss der Test sie auflösen; vorher lief
     * das über Glück beim Normalisieren.
     */
    for (const adresse of adressen) {
      const pfad = new URL(adresse, 'http://test/public/fonts.css').pathname;
      const datei = await app.inject({ method: 'GET', url: pfad });

      expect(datei.statusCode, `${adresse} -> ${pfad}`).toBe(200);
      expect(datei.headers['content-type']).toBe('font/woff2');
    }

    // Beide Arten müssen vorkommen: die Rollen-Adressen und mindestens eine
    // über die Kennung.
    expect(adressen.some((a) => a.startsWith('fonts/'))).toBe(true);
    expect(adressen.some((a) => a.startsWith('../api/fonts/'))).toBe(true);

    await app.close();
  });

  /**
   * Die Rollen-Adresse ist der Grund für das ganze Paket: Sie steht fest,
   * bevor die Auswahl bekannt ist, und nur deshalb kann das Frontend die
   * Schrift vorladen.
   */
  it('liefert unter der Rollen-Adresse die gewählte Schrift – und wechselt mit der Auswahl', async () => {
    const vorgabe = await baueApp({ ui: null, mono: null });
    const gewaehlt = await baueApp({ ui: 'bundled-jetbrains-mono', mono: null });

    const a = await vorgabe.inject({ method: 'GET', url: '/public/fonts/ui' });
    const b = await gewaehlt.inject({ method: 'GET', url: '/public/fonts/ui' });

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    /*
     * Am Dateinamen, nicht am ETag: Der Prueflauf liefert fuer jede Schrift
     * dieselben Attrappen-Bytes (siehe `fontBytes`), der Fingerabdruck waere
     * also auch dann gleich, wenn die Route die falsche Datei zurueckgaebe.
     * Der Name kommt dagegen aus der aufgeloesten Schrift.
     */
    expect(a.headers['content-disposition']).toContain('space-grotesk.woff2');
    expect(b.headers['content-disposition']).toContain('jetbrains-mono.woff2');

    await vorgabe.close();
    await gewaehlt.close();
  });

  it('lässt die Rollen-Adresse nie als `immutable` zwischenspeichern', async () => {
    // Hinter derselben Adresse steckt eine andere Datei, sobald der Betreiber
    // die Auswahl ändert – `immutable` liesse die alte bis zu einem Jahr
    // stehen. Die Frist passt zu der des Stylesheets, damit beide zusammen
    // wechseln.
    const app = await baueApp({ ui: null, mono: null });

    const antwort = await app.inject({ method: 'GET', url: '/public/fonts/mono' });

    expect(antwort.headers['cache-control']).toBe('public, max-age=60, must-revalidate');
    expect(antwort.headers['cache-control']).not.toContain('immutable');

    const zweite = await app.inject({
      method: 'GET',
      url: '/public/fonts/mono',
      headers: { 'if-none-match': String(antwort.headers.etag) },
    });

    expect(zweite.statusCode).toBe(304);

    await app.close();
  });

  it('kennt nur die zwei Rollen', async () => {
    const app = await baueApp({ ui: null, mono: null });

    const antwort = await app.inject({ method: 'GET', url: '/public/fonts/gibtsnicht' });

    expect(antwort.statusCode).toBe(404);

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
