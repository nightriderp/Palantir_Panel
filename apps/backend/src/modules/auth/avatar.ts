import { AuthError } from './errors.js';

/**
 * Prüfregeln für das Profilbild eines Kontos (Lastenheft §3.1, Konto-Bereich).
 *
 * Bewusst **ohne Bildbibliothek**: Zugeschnitten und verkleinert wird im
 * Browser (`ImageCropper`), das Backend prüft nur, was es ohne Dekodieren
 * beantworten kann – Typ, Größe und die ersten Bytes. Damit kommt weder eine
 * Abhängigkeit noch ein Dekodierer für fremde Daten ins Backend; ein
 * Bildparser ist eine bekannt gefährliche Stelle.
 *
 * Die Prüfung bleibt trotzdem echt: Der gemeldete Typ allein ist eine Behauptung
 * des Browsers. Ein `.exe`, das sich als `image/png` ausgibt, fällt an der
 * Signatur auf.
 */

/** Erlaubte Bildformate – die drei, die jeder Browser zuverlässig zeichnet. */
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

/**
 * Obergrenze des gespeicherten Bildes.
 *
 * Nach dem Zuschneiden im Browser (höchstens 512×512, JPEG) liegt ein Bild
 * typisch bei 30–80 KB. 512 KiB lässt reichlich Luft und hält die Tabelle
 * klein genug, dass sie im nächtlichen Abzug nicht auffällt.
 */
export const AVATAR_MAX_BYTES = 512 * 1024;

/** Kantenlänge, auf die der Browser zuschneidet – hier nur zur Dokumentation. */
export const AVATAR_EDGE_PIXELS = 512;

/** Erkennungsmerkmale am Dateianfang, je erlaubtem Typ. */
const SIGNATURES: Record<AvatarMimeType, (bytes: Buffer) => boolean> = {
  'image/png': (bytes) =>
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47,
  'image/jpeg': (bytes) =>
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  // RIFF....WEBP
  'image/webp': (bytes) =>
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function isAvatarMimeType(value: string): value is AvatarMimeType {
  return (AVATAR_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Nimmt ein hochgeladenes Bild an – oder sagt, warum nicht.
 *
 * Wirft `UNSUPPORTED_MEDIA_TYPE`, wenn Typ oder Signatur nicht passen, und
 * `FILE_TOO_LARGE` bei Überschreitung. Beide Codes stehen bereits im Katalog
 * (Pflichtenheft §5.1); ein eigener Code fürs Profilbild sagte nichts, was
 * diese nicht schon sagen.
 */
export function pruefeAvatar(input: { mimeType: string; data: Buffer }): {
  mimeType: AvatarMimeType;
  data: Buffer;
} {
  if (!isAvatarMimeType(input.mimeType)) {
    throw new AuthError(
      'UNSUPPORTED_MEDIA_TYPE',
      `Nur ${AVATAR_MIME_TYPES.join(', ')} sind als Profilbild erlaubt.`,
    );
  }

  if (input.data.length === 0) {
    throw new AuthError('VALIDATION_FAILED', 'Das Bild ist leer.');
  }

  if (input.data.length > AVATAR_MAX_BYTES) {
    throw new AuthError('FILE_TOO_LARGE');
  }

  if (!SIGNATURES[input.mimeType](input.data)) {
    throw new AuthError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Die Datei ist kein Bild des angegebenen Formats.',
    );
  }

  return { mimeType: input.mimeType, data: input.data };
}
