import { describe, expect, it } from 'vitest';
import {
  STANDARD_THEME,
  STANDARD_THEME_ID,
  THEMES,
  kanaele,
  themeFuerId,
  themesCss,
  variablenName,
} from './palette';

describe('kanaele – Hex zu den Kanälen, die Tailwind braucht', () => {
  it('rechnet einen Hex-Wert in drei Kanäle um', () => {
    expect(kanaele('#0a0b0f')).toBe('10 11 15');
    expect(kanaele('#ffffff')).toBe('255 255 255');
    expect(kanaele('#000000')).toBe('0 0 0');
  });

  it('nimmt Großschreibung an', () => {
    expect(kanaele('#7C5CFF')).toBe('124 92 255');
  });

  /*
   * Lieber ein Fehler beim Bauen als eine Farbe, die es nicht gibt: Eine
   * Kurzform wie `#fff` ergäbe stillschweigend Unsinn, und die daraus gebaute
   * Angabe `rgb(255 / <alpha-value>)` wäre ungültiges CSS – die Farbe fiele
   * ersatzlos aus, und zwar überall dort, wo das Token benutzt wird.
   */
  it('weist alles zurück, was kein sechsstelliger Hex-Wert ist', () => {
    expect(() => kanaele('#fff')).toThrow();
    expect(() => kanaele('rgb(255,255,255)')).toThrow();
    expect(() => kanaele('rot')).toThrow();
  });
});

describe('variablenName', () => {
  it('macht aus der Farbstelle den Variablennamen', () => {
    expect(variablenName('canvas')).toBe('--c-canvas');
    expect(variablenName('surfaceMuted')).toBe('--c-surface-muted');
    expect(variablenName('brandBright')).toBe('--c-brand-bright');
  });
});

describe('themeFuerId', () => {
  it('findet ein bekanntes Theme', () => {
    expect(themeFuerId(STANDARD_THEME_ID)).toBe(STANDARD_THEME);
    expect(themeFuerId('schmiedefeuer')?.id).toBe('schmiedefeuer');
  });

  /*
   * Die Kennung kommt aus einem Cookie und ist damit beliebig: veraltet, sobald
   * ein Theme umbenannt wird, und frei erfunden, sobald jemand das Cookie von
   * Hand setzt. Das darf die Seite nicht zerlegen.
   */
  it('fällt bei Unbekanntem, `undefined` und `null` auf den Standard zurück', () => {
    expect(themeFuerId('gibtesnicht')).toBe(STANDARD_THEME);
    expect(themeFuerId(undefined)).toBe(STANDARD_THEME);
    expect(themeFuerId(null)).toBe(STANDARD_THEME);
    expect(themeFuerId('')).toBe(STANDARD_THEME);
  });
});

describe('Kennungen der Themes', () => {
  it('sind eindeutig', () => {
    const ids = THEMES.map((thema) => thema.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
   * Die Kennung landet unverändert in einem Attributselektor ohne
   * Anführungszeichen (`:root[data-theme=schmiedefeuer]`). Alles, was dort kein
   * gültiger Bezeichner ist, macht die Regel ungültig – und ein ungültiger
   * Selektor fällt still aus: Das Theme wäre wählbar und bliebe wirkungslos.
   */
  it('sind gültige CSS-Bezeichner', () => {
    for (const thema of THEMES) {
      expect(thema.id, thema.name).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('enthalten den Standard', () => {
    expect(THEMES.some((thema) => thema.id === STANDARD_THEME_ID)).toBe(true);
  });
});

describe('themesCss', () => {
  const css = themesCss();

  it('stellt den Standard auf `:root`, damit er ohne Attribut gilt', () => {
    expect(css).toContain(':root{color-scheme:');
    expect(css).not.toContain(`:root[data-theme=${STANDARD_THEME_ID}]`);
  });

  it('gibt jedem weiteren Theme einen eigenen, stärkeren Selektor', () => {
    for (const thema of THEMES.filter((t) => t.id !== STANDARD_THEME_ID)) {
      expect(css).toContain(`:root[data-theme=${thema.id}]{`);
    }
  });

  it('setzt für jedes Theme jede Farbstelle und das Farbschema', () => {
    const bloecke = css.split('\n');
    expect(bloecke).toHaveLength(THEMES.length);

    for (const [i, thema] of THEMES.entries()) {
      const block = bloecke[i] ?? '';
      expect(block, thema.id).toContain(`color-scheme:${thema.farbschema}`);

      for (const [schluessel, wert] of Object.entries(thema.palette)) {
        // `selectPfeil` ist die Ausnahme: kein `--c-…`, sondern eingebacken
        // im Hintergrundbild darunter.
        if (schluessel === 'selectPfeil') continue;

        expect(block, `${thema.id} · ${schluessel}`).toContain(
          `${variablenName(schluessel)}:${kanaele(wert)}`,
        );
      }
    }
  });

  /**
   * Der Pfeil im Auswahlfeld, je Theme mit eingebackener Farbe.
   *
   * Geprüft wird, dass die Farbe wirklich **in** der Adresse steht – als
   * `%23rrggbb`, denn prozentkodiert ist sie dort. Stünde sie nicht drin,
   * trüge jedes Theme denselben Pfeil, und im hellen wäre er kaum zu sehen.
   */
  it('backt die Pfeilfarbe je Theme in das Hintergrundbild', () => {
    const bloecke = css.split('\n');

    for (const [i, thema] of THEMES.entries()) {
      const block = bloecke[i] ?? '';
      const kodiert = thema.palette.selectPfeil.replace('#', '%23');

      expect(block, thema.id).toContain('--select-pfeil:url(data:image/svg+xml,');
      expect(block, `${thema.id} · Farbe im Pfeil`).toContain(kodiert);
    }
  });

  /**
   * Die Schattendeckkraft, aus dem Faktor des Themes gerechnet.
   *
   * Der Standard muss dabei genau auf den Werten landen, die vorher fest in
   * `tailwind.config.ts` standen – sonst wäre die Umstellung keine Umstellung,
   * sondern eine Änderung.
   */
  it('rechnet die Schattendeckkraft aus dem Faktor des Themes', () => {
    const bloecke = css.split('\n');
    const standard = bloecke[0] ?? '';

    expect(standard).toContain('--schatten-glow:0.3');
    expect(standard).toContain('--schatten-panel:0.5');
    expect(standard).toContain('--schatten-modal:0.55');

    for (const [i, thema] of THEMES.entries()) {
      const block = bloecke[i] ?? '';
      for (const name of ['glow', 'panel', 'modal']) {
        expect(block, `${thema.id} · ${name}`).toMatch(
          new RegExp(`--schatten-${name}:0?\\.?\\d+(;|})`),
        );
      }
    }
  });

  /**
   * Das Stylesheet geht als Textknoten in ein `<style>` (Wurzel-Layout).
   *
   * Wie React einen Textknoten maskiert, ist eine Eigenschaft der Bibliothek –
   * ein `"` oder `&`, das unterwegs zu `&quot;` würde, machte aus einer
   * gültigen Regel stillen Unsinn: Die Seite bliebe stehen, nur ohne Farben.
   * Statt sich auf das Verhalten zu verlassen, kommt das Stylesheet gar nicht
   * erst in die Lage – es enthält keines dieser Zeichen.
   */
  it('kommt ohne Zeichen aus, die beim Einbetten maskiert würden', () => {
    expect(css).not.toMatch(/["'<>&]/);
  });
});
