/**
 * CSRF-Schutz für zustandsändernde Requests (Pflichtenheft §7 und §18).
 *
 * Verfahren: Double-Submit. Das Backend setzt ein **nicht**-httpOnly-Cookie mit
 * einem Zufallswert; jeder zustandsändernde Request muss denselben Wert im
 * Header {@link CSRF_HEADER_NAME} mitschicken. Eine fremde Seite kann zwar einen
 * Request auslösen und das Cookie mitschicken lassen, den Wert aber nicht lesen
 * und deshalb den Header nicht setzen (Same-Origin-Policy).
 *
 * Das ergänzt `SameSite=Lax` am Sitzungs-Cookie, ersetzt es nicht: `Lax` ist im
 * Pflichtenheft §7 bewusst statt `Strict` gewählt, damit der Rücksprung von
 * Discord/Steam/Twitch funktioniert – genau dadurch bleibt ein Rest an
 * seitenübergreifenden Requests möglich, den dieses Token abfängt.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Erzeugt ein neues CSRF-Token. */
export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Vergleicht Cookie-Wert und Header-Wert in konstanter Zeit.
 *
 * Fehlt einer der beiden oder sind sie unterschiedlich lang, gilt der Request
 * als ungültig.
 */
export function csrfTokenMatches(
  cookieValue: string | undefined,
  headerValue: string | string[] | undefined,
): boolean {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!cookieValue || !header) {
    return false;
  }

  const left = Buffer.from(cookieValue, 'utf8');
  const right = Buffer.from(header, 'utf8');

  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * HTTP-Methoden, die den Zustand nicht verändern und deshalb kein CSRF-Token
 * brauchen (RFC 9110 – „safe methods").
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}
