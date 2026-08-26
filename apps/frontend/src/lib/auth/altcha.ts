import { ALTCHA_ALGORITHM, type AltchaChallenge, type AltchaSolution } from '@palantir/contracts';

/**
 * Lösen der ALTCHA-Proof-of-Work-Aufgabe (Pflichtenheft §3, `.env.example` §6).
 *
 * ALTCHA ist ein selbstgehostetes Verfahren ohne Fremdanbieter (Lastenheft §4,
 * „Unabhängigkeit"). Die Aufgabe ist bewusst simpel: Das Backend zieht eine Zahl
 * `n` aus `[0, maxnumber]` und veröffentlicht `SHA-256(salt + n)`. Der Browser
 * probiert die Zahlen der Reihe nach durch, bis der Hash passt, und schickt die
 * gefundene Zahl zusammen mit der Signatur des Backends zurück.
 *
 * **Bewusst ohne zusätzliche Abhängigkeit:** Das offizielle `altcha`-Widget
 * bringt ein Web-Component-Paket mit eigener Gestaltung und eigenen Texten mit.
 * Der hier nötige Anteil ist eine Schleife über die Web-Crypto-API; das
 * Aussehen kommt aus den F2-Tokens und die Texte sind deutsch (Lastenheft §4).
 * Eine neue Laufzeit-Abhängigkeit wäre dafür nicht zu rechtfertigen
 * (CLAUDE.md §1).
 */

/** Ergebnis einer gelösten Aufgabe. */
export interface AltchaSolveResult {
  number: number;
  /** Rechendauer in Millisekunden. */
  took: number;
}

export interface AltchaSolveOptions {
  /** Bricht die Suche ab (Seitenwechsel, neue Challenge). */
  signal?: AbortSignal;
  /** Fortschritt von 0 bis 1 – für die Anzeige im Widget. */
  onProgress?: (progress: number) => void;
  /**
   * Nach wie vielen Versuchen die Schleife die Kontrolle abgibt.
   *
   * Ohne diese Pause blockiert die Suche den Haupt-Thread und die Seite wirkt
   * eingefroren – auf Smartphones deutlich früher als am Rechner
   * (Lastenheft §4, Mobile-First).
   */
  chunkSize?: number;
}

/** Signalisiert den Abbruch über `AbortSignal`. */
export class AltchaAbortError extends Error {
  constructor() {
    super('Die Sicherheitsprüfung wurde abgebrochen.');
    this.name = 'AltchaAbortError';
  }
}

/** Keine Lösung im erlaubten Zahlenbereich – die Challenge passt nicht. */
export class AltchaUnsolvableError extends Error {
  constructor() {
    super('Die Sicherheitsprüfung konnte nicht abgeschlossen werden.');
    this.name = 'AltchaUnsolvableError';
  }
}

const DEFAULT_CHUNK_SIZE = 2000;

const encoder = new TextEncoder();

/** Hex-Darstellung des SHA-256-Hashes von `salt + number`. */
export async function altchaHash(salt: string, value: number): Promise<string> {
  const digest = await crypto.subtle.digest(ALTCHA_ALGORITHM, encoder.encode(`${salt}${value}`));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Gibt den Haupt-Thread kurz frei, damit die Oberfläche reagieren kann. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Sucht die Zahl, deren Hash der Challenge entspricht.
 *
 * Die Suche läuft der Reihe nach von 0 aufwärts – dieselbe Reihenfolge wie in
 * ALTCHA selbst. Die erwartete Dauer hängt an `maxnumber` (`ALTCHA_COMPLEXITY`).
 */
export async function solveAltchaChallenge(
  challenge: AltchaChallenge,
  options: AltchaSolveOptions = {},
): Promise<AltchaSolveResult> {
  const { signal, onProgress, chunkSize = DEFAULT_CHUNK_SIZE } = options;
  const startedAt = Date.now();
  const target = challenge.challenge.toLowerCase();

  for (let number = 0; number <= challenge.maxnumber; number += 1) {
    if (signal?.aborted) {
      throw new AltchaAbortError();
    }

    if ((await altchaHash(challenge.salt, number)) === target) {
      onProgress?.(1);
      return { number, took: Date.now() - startedAt };
    }

    if (number % chunkSize === chunkSize - 1) {
      onProgress?.(Math.min(number / challenge.maxnumber, 0.99));
      await yieldToBrowser();
    }
  }

  throw new AltchaUnsolvableError();
}

/** Base64-Kodierung eines UTF-8-Strings – im Browser und in Node identisch. */
function toBase64(value: string): string {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Packt die Lösung in die Form, die das Backend erwartet.
 *
 * ALTCHA überträgt die gelöste Challenge als ein einziges base64-kodiertes
 * JSON-Feld, damit ein Formular nur ein zusätzliches Feld braucht. Signatur und
 * Challenge werden unverändert zurückgeschickt – nur so kann das Backend die
 * eigene Aufgabe wiedererkennen und gegen `ALTCHA_HMAC_KEY` prüfen.
 */
export function encodeAltchaSolution(
  challenge: AltchaChallenge,
  result: AltchaSolveResult,
): string {
  const solution: AltchaSolution = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    signature: challenge.signature,
    number: result.number,
    took: result.took,
  };
  return toBase64(JSON.stringify(solution));
}
