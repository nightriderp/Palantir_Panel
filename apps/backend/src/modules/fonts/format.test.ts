/**
 * Formaterkennung an den Kopfbytes (Arbeitspaket S-2).
 *
 * Der eigentliche Gegenstand dieser Datei ist die **lügende Endung**: Eine
 * Datei, die `.woff2` heißt und ein ZIP-Archiv ist, muss hier scheitern – nicht
 * erst im Browser, und schon gar nicht erst dann, wenn sie als Schrift der
 * Instanz ausgeliefert wird.
 */

import { FONT_FORMAT_CATALOG, FONT_UPLOAD_MAX_SIZE_BYTES } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { isFontError } from './errors.js';
import { detectFontSignature, fontFormatForFileName, resolveFontUpload } from './format.js';
import { fontBytes } from './test-support.js';

/** Fehlercode eines erwarteten Fehlschlags – oder `null`, wenn keiner kam. */
function fehlercode(arbeit: () => unknown): string | null {
  try {
    arbeit();

    return null;
  } catch (fehler: unknown) {
    return isFontError(fehler) ? fehler.code : null;
  }
}

describe('detectFontSignature', () => {
  it('erkennt alle vier Formate des Katalogs an ihren Kopfbytes', () => {
    expect(detectFontSignature(fontBytes('woff2'))).toEqual({ kind: 'format', format: 'woff2' });
    expect(detectFontSignature(fontBytes('woff'))).toEqual({ kind: 'format', format: 'woff' });
    expect(detectFontSignature(fontBytes('otf'))).toEqual({ kind: 'format', format: 'otf' });
    expect(detectFontSignature(fontBytes('ttf'))).toEqual({ kind: 'format', format: 'ttf' });
  });

  it('erkennt Apples älteren TrueType-Kennwert „true"', () => {
    const inhalt = Buffer.concat([Buffer.from('true', 'latin1'), Buffer.alloc(8)]);

    expect(detectFontSignature(inhalt)).toEqual({ kind: 'format', format: 'ttf' });
  });

  it('nennt eine TrueType-Collection als Schrift außerhalb des Katalogs', () => {
    expect(detectFontSignature(fontBytes('ttc'))).toEqual({
      kind: 'unsupported',
      label: 'TrueType-Collection',
    });
  });

  it('hält ein ZIP-Archiv und eine zu kurze Datei für keine Schrift', () => {
    expect(detectFontSignature(fontBytes('zip'))).toEqual({ kind: 'unknown' });
    expect(detectFontSignature(Buffer.from([0x00, 0x01]))).toEqual({ kind: 'unknown' });
  });
});

describe('fontFormatForFileName', () => {
  it('liest die Endung unabhängig von der Groß-/Kleinschreibung', () => {
    expect(fontFormatForFileName('Inter.WOFF2')).toBe('woff2');
    expect(fontFormatForFileName('inter.woff')).toBe('woff');
  });

  it('liefert nichts für unbekannte oder fehlende Endungen', () => {
    expect(fontFormatForFileName('inter.eot')).toBeNull();
    expect(fontFormatForFileName('inter')).toBeNull();
  });
});

describe('resolveFontUpload', () => {
  it('nimmt eine Datei an, deren Endung zum Inhalt passt', () => {
    expect(resolveFontUpload('inter.woff2', fontBytes('woff2'))).toBe('woff2');
    expect(resolveFontUpload('inter.otf', fontBytes('otf'))).toBe('otf');
  });

  it('lehnt eine Endung ab, die im Katalog gar nicht vorkommt', () => {
    expect(fehlercode(() => resolveFontUpload('inter.eot', fontBytes('woff2')))).toBe(
      'FONT_FORMAT_UNSUPPORTED',
    );
  });

  it('lehnt eine erkennbare Schrift außerhalb des Katalogs ab (ttcf)', () => {
    expect(fehlercode(() => resolveFontUpload('inter.ttf', fontBytes('ttc')))).toBe(
      'FONT_FORMAT_UNSUPPORTED',
    );
  });

  it('lehnt eine als Schrift benannte Nicht-Schrift ab (ZIP mit .woff2)', () => {
    expect(fehlercode(() => resolveFontUpload('inter.woff2', fontBytes('zip')))).toBe(
      'FONT_FILE_INVALID',
    );
  });

  it('lehnt eine lügende Endung ab: WOFF2-Inhalt als .ttf benannt', () => {
    expect(fehlercode(() => resolveFontUpload('inter.ttf', fontBytes('woff2')))).toBe(
      'FONT_FILE_INVALID',
    );
  });

  it('lehnt auch die feine Lüge ab: OTTO-Inhalt als .ttf benannt', () => {
    expect(fehlercode(() => resolveFontUpload('inter.ttf', fontBytes('otf')))).toBe(
      'FONT_FILE_INVALID',
    );
  });

  it('misst die Größe gegen die Grenze des jeweiligen Formats', () => {
    const grenze = FONT_FORMAT_CATALOG.woff2.maxSizeBytes;
    const zuGross = Buffer.concat([fontBytes('woff2', 0), Buffer.alloc(grenze)]);

    expect(fehlercode(() => resolveFontUpload('inter.woff2', zuGross))).toBe('FONT_FILE_TOO_LARGE');
  });

  it('erlaubt dieselbe Datenmenge als TTF, weil dort eine andere Grenze gilt', () => {
    // Genau der Punkt der formatabhängigen Grenzen: Was als WOFF2 zu groß ist,
    // ist als unkomprimiertes TTF noch im Rahmen.
    const grenzeWoff2 = FONT_FORMAT_CATALOG.woff2.maxSizeBytes;

    expect(FONT_FORMAT_CATALOG.ttf.maxSizeBytes).toBeGreaterThan(grenzeWoff2);

    const inhalt = Buffer.concat([fontBytes('ttf', 0), Buffer.alloc(grenzeWoff2)]);

    expect(resolveFontUpload('inter.ttf', inhalt)).toBe('ttf');
  });

  it('lehnt auch die größte Datei über der gemeinsamen Obergrenze ab', () => {
    const inhalt = Buffer.concat([
      fontBytes('ttf', 0),
      Buffer.alloc(FONT_UPLOAD_MAX_SIZE_BYTES + 1),
    ]);

    expect(fehlercode(() => resolveFontUpload('inter.ttf', inhalt))).toBe('FONT_FILE_TOO_LARGE');
  });
});
