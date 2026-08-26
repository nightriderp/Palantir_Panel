/**
 * TOTP nach RFC 6238 (Pflichtenheft §7: 2FA optional für Passwort-Konten).
 *
 * Bewusst ohne zusätzliche Abhängigkeit umgesetzt (CLAUDE.md §1): das Verfahren
 * ist HMAC-SHA1 über einen Zeitzähler und lässt sich mit den Testvektoren aus
 * RFC 4226 und RFC 6238 vollständig prüfen – siehe `totp.test.ts`. Alles, was
 * hier gebraucht wird, steht in `node:crypto`.
 *
 * Diese Datei kennt weder Datenbank noch HTTP und ist deshalb ohne
 * Infrastruktur testbar (CLAUDE.md §4).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOTP_CODE_LENGTH } from '@palantir/contracts';

/** Zeitfenster eines Codes in Sekunden (RFC 6238 empfiehlt 30). */
export const TOTP_PERIOD_SECONDS = 30;

/**
 * Wie viele Fenster vor und nach dem aktuellen zusätzlich akzeptiert werden.
 *
 * Ein Fenster in jede Richtung fängt eine leicht falsch gehende Geräteuhr und
 * die Tippzeit des Nutzers ab. Größere Werte würden die Zeitspanne, in der ein
 * abgefangener Code noch gilt, unnötig verlängern.
 */
export const TOTP_ALLOWED_DRIFT_WINDOWS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32-Kodierung nach RFC 4648 ohne Auffüllzeichen. */
export function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Base32-Dekodierung nach RFC 4648.
 *
 * Toleriert Kleinschreibung, Leerzeichen und Auffüllzeichen, weil Nutzer den
 * Schlüssel häufig abgetippt aus einem Authenticator wieder einsetzen.
 */
export function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error('Ungültiges Base32-Zeichen im TOTP-Geheimnis.');
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Erzeugt ein neues TOTP-Geheimnis.
 *
 * 20 Byte entsprechen der Schlüssellänge von HMAC-SHA1 aus RFC 4226 und sind
 * das, was gängige Authenticator-Apps erwarten.
 */
export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

/** HOTP nach RFC 4226 – die Grundlage von TOTP. */
export function generateHotp(secret: Buffer, counter: number, digits = TOTP_CODE_LENGTH): string {
  const counterBuffer = Buffer.alloc(8);
  // `writeBigUInt64BE`, weil der Zähler laut RFC 8 Byte breit ist; für unsere
  // Zeitstempel reichen 6, die oberen zwei bleiben null.
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  // Dynamic Truncation (RFC 4226 §5.3): die letzten vier Bit zeigen auf den
  // Startpunkt der vier Bytes, aus denen der Code entsteht. `readUInt32BE`
  // liest diese vier Bytes am Stück – der SHA-1-Digest ist 20 Byte lang und
  // der Versatz höchstens 15, der Zugriff bleibt also immer im Puffer.
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** Zeitzähler zu einem Zeitpunkt (RFC 6238 §4.2). */
export function totpCounterFor(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** Aktueller Code zu einem Base32-Geheimnis – vor allem für Tests. */
export function generateTotp(secretBase32: string, atMs: number): string {
  return generateHotp(decodeBase32(secretBase32), totpCounterFor(atMs));
}

/**
 * Prüft einen eingegebenen Code gegen das Geheimnis.
 *
 * Der Vergleich läuft in konstanter Zeit, damit sich aus der Antwortzeit nicht
 * ablesen lässt, wie viele Stellen bereits stimmen. Geprüft wird das aktuelle
 * Fenster und je {@link TOTP_ALLOWED_DRIFT_WINDOWS} davor und danach.
 */
export function verifyTotp(secretBase32: string, code: string, atMs: number): boolean {
  const trimmed = code.trim();

  if (trimmed.length !== TOTP_CODE_LENGTH) {
    return false;
  }

  const secret = decodeBase32(secretBase32);
  const counter = totpCounterFor(atMs);
  const candidate = Buffer.from(trimmed, 'utf8');
  let matched = false;

  for (let drift = -TOTP_ALLOWED_DRIFT_WINDOWS; drift <= TOTP_ALLOWED_DRIFT_WINDOWS; drift += 1) {
    const expected = Buffer.from(generateHotp(secret, counter + drift), 'utf8');

    // Bewusst ohne vorzeitigen Ausstieg: alle Fenster werden immer geprüft,
    // damit die Laufzeit nicht verrät, welches Fenster gepasst hat.
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      matched = true;
    }
  }

  return matched;
}

/**
 * `otpauth://`-URI für den QR-Code der Authenticator-App.
 *
 * Aussteller und Konto stehen doppelt in der URI (im Pfad und als Parameter) –
 * das erwarten gängige Apps, damit der Eintrag korrekt benannt wird.
 */
export function buildOtpauthUri(options: {
  secretBase32: string;
  accountName: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.accountName)}`;
  const params = new URLSearchParams({
    secret: options.secretBase32,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_CODE_LENGTH),
    period: String(TOTP_PERIOD_SECONDS),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}
