import { describe, expect, it } from 'vitest';
import {
  BUNDLED_FONT_ID_PATTERN,
  BUNDLED_FONT_ID_PREFIX,
  FONT_FORMATS,
  FONT_FORMAT_CATALOG,
  FONT_ID_MAX_LENGTH,
  FONT_SOURCES,
  FONT_UPLOAD_MAX_SIZE_BYTES,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  type FontDto,
  isBundledFontId,
  isFontFormat,
  maxSizeBytesForFontFormat,
} from './font.js';

describe('Schrift-Contract (Lastenheft §3.10)', () => {
  describe('Kennungen', () => {
    it('erkennt mitgelieferte Kennungen an ihrem Präfix', () => {
      expect(isBundledFontId('bundled-space-grotesk')).toBe(true);
      expect(isBundledFontId('bundled-jetbrains-mono')).toBe(true);
      expect(isBundledFontId('bundled-inter')).toBe(true);
      expect(BUNDLED_FONT_ID_PATTERN.test(`${BUNDLED_FONT_ID_PREFIX}atkinson-hyperlegible`)).toBe(
        true,
      );
    });

    it('weist Kennungen zurück, die nur so aussehen wie mitgelieferte', () => {
      expect(isBundledFontId('bundled-')).toBe(false); // ohne Slug
      expect(isBundledFontId('bundled')).toBe(false); // ohne Bindestrich
      expect(isBundledFontId('Bundled-Inter')).toBe(false); // Großschreibung
      expect(isBundledFontId('bundled-Inter')).toBe(false);
      expect(isBundledFontId('bundled--inter')).toBe(false); // doppelter Bindestrich
      expect(isBundledFontId('bundled-inter-')).toBe(false); // Bindestrich am Ende
      expect(isBundledFontId('bundled-inter mono')).toBe(false); // Leerzeichen
      expect(isBundledFontId('../bundled-inter')).toBe(false); // Pfadanteil
    });

    it('hält die beiden Kennungsräume auseinander: eine UUID ist nie mitgeliefert', () => {
      // Trägt die eigentliche Begründung des Präfixes: `u`, `n` und `l` sind
      // keine Hexziffern, deshalb kann keine UUID mit `bundled-` beginnen.
      expect(isBundledFontId('0f2f3f4f-0000-4000-8000-000000000001')).toBe(false);
      expect(BUNDLED_FONT_ID_PREFIX.split('').some((char) => !/[0-9a-f-]/.test(char))).toBe(true);
    });

    it('lässt jede Kennung in die vereinbarte Höchstlänge passen', () => {
      // 36 Zeichen UUID plus Luft für jeden sinnvollen Slug.
      expect(FONT_ID_MAX_LENGTH).toBeGreaterThanOrEqual(36);
      expect('bundled-atkinson-hyperlegible'.length).toBeLessThanOrEqual(FONT_ID_MAX_LENGTH);
    });
  });

  describe('Formate und Grenzen', () => {
    it('führt genau die vier vereinbarten Formate', () => {
      expect(FONT_FORMATS).toEqual(['woff2', 'woff', 'ttf', 'otf']);
      expect(new Set(FONT_FORMATS).size).toBe(FONT_FORMATS.length);
      expect(Object.keys(FONT_FORMAT_CATALOG).sort()).toEqual([...FONT_FORMATS].sort());
    });

    it('gibt jedem Format Endung, MIME-Typ, CSS-Bezeichner und eine Obergrenze', () => {
      for (const format of FONT_FORMATS) {
        const definition = FONT_FORMAT_CATALOG[format];
        expect(definition.extension).toBe(`.${format}`);
        expect(definition.mimeType).toMatch(/^font\//);
        expect(definition.cssFormat.length).toBeGreaterThan(0);
        expect(definition.maxSizeBytes).toBeGreaterThan(0);
        expect(maxSizeBytesForFontFormat(format)).toBe(definition.maxSizeBytes);
      }
    });

    it('bildet die CSS-Bezeichner ab, die sich nicht aus der Endung ergeben', () => {
      expect(FONT_FORMAT_CATALOG.ttf.cssFormat).toBe('truetype');
      expect(FONT_FORMAT_CATALOG.otf.cssFormat).toBe('opentype');
      expect(FONT_FORMAT_CATALOG.woff2.cssFormat).toBe('woff2');
      expect(FONT_FORMAT_CATALOG.woff.cssFormat).toBe('woff');
    });

    it('erlaubt komprimierten Formaten weniger als unkomprimierten', () => {
      expect(FONT_FORMAT_CATALOG.woff2.maxSizeBytes).toBeLessThan(
        FONT_FORMAT_CATALOG.woff.maxSizeBytes,
      );
      expect(FONT_FORMAT_CATALOG.woff.maxSizeBytes).toBeLessThan(
        FONT_FORMAT_CATALOG.ttf.maxSizeBytes,
      );
    });

    it('setzt die Vorab-Grenze des Uploads auf die größte Einzelgrenze', () => {
      // Die Grenze, die der Multipart-Empfänger kennt, bevor das Format
      // feststeht – sie darf keine erlaubte Datei ausschließen.
      for (const format of FONT_FORMATS) {
        expect(maxSizeBytesForFontFormat(format)).toBeLessThanOrEqual(FONT_UPLOAD_MAX_SIZE_BYTES);
      }
      expect(FONT_UPLOAD_MAX_SIZE_BYTES).toBe(FONT_FORMAT_CATALOG.ttf.maxSizeBytes);
    });

    it('erkennt unbekannte Formate', () => {
      expect(isFontFormat('woff2')).toBe(true);
      expect(isFontFormat('eot')).toBe(false);
      expect(isFontFormat('svg')).toBe(false);
      expect(isFontFormat('WOFF2')).toBe(false);
    });

    it('hält die CSS-Grenzen des Schriftgewichts fest', () => {
      expect(FONT_WEIGHT_MIN).toBe(1);
      expect(FONT_WEIGHT_MAX).toBe(1000);
    });
  });

  describe('FontDto', () => {
    it('beschreibt eine mitgelieferte Schrift ohne Upload-Angaben und ohne Löschrecht', () => {
      const bundled: FontDto = {
        id: 'bundled-space-grotesk',
        family: 'Space Grotesk',
        label: 'Space Grotesk',
        source: 'bundled',
        format: 'woff2',
        sizeBytes: 61_440,
        uploadedAt: null,
        uploadedByDisplayName: null,
        variable: true,
        weightRange: { min: 300, max: 700 },
        permissions: { canDelete: false },
      };

      expect(isBundledFontId(bundled.id)).toBe(true);
      expect(bundled.uploadedAt).toBeNull();
      expect(bundled.uploadedByDisplayName).toBeNull();
      expect(bundled.permissions.canDelete).toBe(false);
    });

    it('trägt bei einer statischen Schrift einen Bereich der Länge null', () => {
      const uploaded: FontDto = {
        id: '0f2f3f4f-0000-4000-8000-000000000002',
        family: 'Fira Sans',
        label: 'Fira Sans (Regular)',
        source: 'uploaded',
        format: 'ttf',
        sizeBytes: 400_000,
        uploadedAt: '2026-09-06T10:00:00.000Z',
        uploadedByDisplayName: 'Admin',
        variable: false,
        weightRange: { min: 400, max: 400 },
        permissions: { canDelete: true },
      };

      expect(uploaded.weightRange.min).toBe(uploaded.weightRange.max);
      expect(isBundledFontId(uploaded.id)).toBe(false);
    });

    it('kennt genau zwei Herkünfte', () => {
      expect(FONT_SOURCES).toEqual(['bundled', 'uploaded']);
    });
  });
});
