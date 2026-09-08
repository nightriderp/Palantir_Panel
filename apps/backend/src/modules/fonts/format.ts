/**
 * Erkennung des Schriftformats an den **Kopfbytes** (Arbeitspaket S-2).
 *
 * Die Endung entscheidet nichts. Sie ist der einzige Teil eines Uploads, den
 * der Hochladende frei wählt, und eine `.woff2`-Endung sagt über den Inhalt
 * genauso viel aus wie ein Aufkleber über den Inhalt einer Kiste. Entschieden
 * wird deshalb am `sfnt`-Kennwert in den ersten vier Bytes – dem einzigen Teil
 * der Datei, den ein Browser später ebenfalls liest.
 *
 * Die Endung wird trotzdem geprüft, aber als **zweite** Aussage: Stimmen Endung
 * und Inhalt nicht überein, ist die Datei nicht etwa „unbekannt", sondern falsch
 * benannt – `FONT_FILE_INVALID` (siehe Fehlerkatalog). Die Unterscheidung
 * gehört zur Antwort: „unbekanntes Format" führt zu einer anderen Datei,
 * „falsch benannt" führt zum Umbenennen derselben.
 *
 * ## Warum `ttcf` mitgeführt wird
 *
 * Eine TrueType-Collection (`ttcf`) ist eine gültige Schriftdatei, aber ein
 * Bündel mehrerer Schnitte in einer Datei. `FONT_FORMATS` kennt sie nicht, und
 * eine `@font-face`-Regel könnte auch gar nicht sagen, welchen der enthaltenen
 * Schnitte sie meint. Ohne diesen Eintrag käme sie als „keine lesbare Schrift"
 * (`FONT_FILE_INVALID`) zurück – eine Meldung, die den Hochladenden auf die
 * falsche Fährte schickt. Mit ihm kommt `FONT_FORMAT_UNSUPPORTED` zurück, und
 * das ist die Wahrheit: Es ist eine Schrift, nur keine, die diese Instanz
 * ausliefert.
 */

import {
  FONT_FORMAT_CATALOG,
  type FontFormat,
  isFontFormat,
  maxSizeBytesForFontFormat,
} from '@palantir/contracts';
import { FontError } from './errors.js';

/**
 * Anzahl Bytes, die für die Entscheidung gelesen werden.
 *
 * Alle hier unterschiedenen Kennwerte stehen in den ersten vier Bytes. Eine
 * kürzere Datei kann keine Schrift sein.
 */
export const FONT_SIGNATURE_LENGTH = 4;

/** Ein Kennwert und das Format, für das er steht. */
interface FontSignature {
  /** Die vier Kopfbytes. */
  readonly bytes: readonly number[];
  /**
   * Format aus dem Katalog – oder `null` für eine Datei, die zwar eine Schrift
   * ist, aber keine, die diese Instanz ausliefert (`FONT_FORMAT_UNSUPPORTED`).
   */
  readonly format: FontFormat | null;
  /** Lesbare Bezeichnung für die Fehlermeldung. */
  readonly label: string;
}

/** Kennwert aus vier ASCII-Zeichen (`wOF2`, `OTTO`, `true`, `ttcf`). */
function ascii(tag: string): readonly number[] {
  return [...tag].map((zeichen) => zeichen.charCodeAt(0));
}

const SIGNATURES: readonly FontSignature[] = [
  { bytes: ascii('wOF2'), format: 'woff2', label: 'WOFF2' },
  { bytes: ascii('wOFF'), format: 'woff', label: 'WOFF' },
  { bytes: ascii('OTTO'), format: 'otf', label: 'OpenType (CFF)' },
  // Version 1.0 einer TrueType-Datei: 0x00010000.
  { bytes: [0x00, 0x01, 0x00, 0x00], format: 'ttf', label: 'TrueType' },
  // Apples älterer Kennwert für dieselbe Struktur.
  { bytes: ascii('true'), format: 'ttf', label: 'TrueType (Apple)' },
  { bytes: ascii('ttcf'), format: null, label: 'TrueType-Collection' },
];

/** Ergebnis der Erkennung an den Kopfbytes. */
export type FontSignatureMatch =
  | { readonly kind: 'format'; readonly format: FontFormat }
  /** Erkennbar eine Schrift, aber außerhalb von `FONT_FORMATS`. */
  | { readonly kind: 'unsupported'; readonly label: string }
  /** Kein bekannter Kennwert – der Inhalt ist keine Schrift. */
  | { readonly kind: 'unknown' };

/**
 * Liest das Format aus den ersten vier Bytes.
 *
 * Rein und ohne Fehler: Die Zuordnung auf Fehlercodes trifft
 * {@link resolveFontUpload}, damit dieselbe Erkennung auch anderswo (Prüfung
 * mitgelieferter Dateien) nutzbar bleibt.
 */
export function detectFontSignature(content: Buffer): FontSignatureMatch {
  if (content.length < FONT_SIGNATURE_LENGTH) {
    return { kind: 'unknown' };
  }

  for (const signature of SIGNATURES) {
    const passt = signature.bytes.every((byte, index) => content[index] === byte);

    if (!passt) {
      continue;
    }

    return signature.format === null
      ? { kind: 'unsupported', label: signature.label }
      : { kind: 'format', format: signature.format };
  }

  return { kind: 'unknown' };
}

/**
 * Format zur Dateiendung – `null`, wenn die Endung in keinem Katalogeintrag
 * steht.
 *
 * Groß-/Kleinschreibung spielt keine Rolle: `Inter.WOFF2` kommt von einem
 * Windows-Rechner genauso wie `inter.woff2` von einem Mac.
 */
export function fontFormatForFileName(fileName: string): FontFormat | null {
  const punkt = fileName.lastIndexOf('.');

  if (punkt < 0) {
    return null;
  }

  const endung = fileName.slice(punkt + 1).toLowerCase();

  return isFontFormat(endung) ? endung : null;
}

/**
 * Entscheidet Format und Größe eines Uploads – die vollständige Prüfkette.
 *
 * Reihenfolge ist Absicht:
 *
 * 1. **Endung** im Katalog? Sonst `FONT_FORMAT_UNSUPPORTED` – der Aufrufer hat
 *    gar nicht erst eines der vier Formate gemeint.
 * 2. **Kopfbytes**: unbekannt → `FONT_FILE_INVALID`; erkennbare Schrift
 *    außerhalb des Katalogs → `FONT_FORMAT_UNSUPPORTED`.
 * 3. **Übereinstimmung** von Endung und Inhalt. Weicht sie ab, ist die Datei
 *    falsch benannt (`FONT_FILE_INVALID`). Bewusst streng, auch zwischen `ttf`
 *    und `otf`: Aus dem Format ergeben sich der ausgelieferte MIME-Typ und der
 *    `format(...)`-Hinweis der `@font-face`-Regel. Beide beschrieben sonst
 *    etwas, das die Datei nicht ist – und die Abhilfe ist ein Umbenennen, kein
 *    neuer Upload.
 * 4. **Größe** gegen die Grenze des erkannten Formats (`FONT_FILE_TOO_LARGE`).
 *    Erst hier, weil die Grenze vom Format abhängt.
 */
export function resolveFontUpload(fileName: string, content: Buffer): FontFormat {
  const ausEndung = fontFormatForFileName(fileName);

  if (ausEndung === null) {
    throw new FontError('FONT_FORMAT_UNSUPPORTED');
  }

  const erkannt = detectFontSignature(content);

  if (erkannt.kind === 'unknown') {
    throw new FontError('FONT_FILE_INVALID');
  }

  if (erkannt.kind === 'unsupported') {
    throw new FontError(
      'FONT_FORMAT_UNSUPPORTED',
      `Die Datei ist eine ${erkannt.label} – dieses Format wird nicht unterstützt. Erlaubt sind WOFF2, WOFF, TTF und OTF.`,
    );
  }

  if (erkannt.format !== ausEndung) {
    throw new FontError(
      'FONT_FILE_INVALID',
      `Der Inhalt der Datei ist ${FONT_FORMAT_CATALOG[erkannt.format].extension.slice(1).toUpperCase()}, die Endung sagt ${FONT_FORMAT_CATALOG[ausEndung].extension.slice(1).toUpperCase()}. Bitte die Datei passend benennen.`,
    );
  }

  if (content.length > maxSizeBytesForFontFormat(erkannt.format)) {
    throw new FontError('FONT_FILE_TOO_LARGE');
  }

  return erkannt.format;
}
