/**
 * Passwort-Hashing mit Argon2id (Pflichtenheft §7 und §18).
 *
 * Die Parameter liegen bewusst an genau einer Stelle: sie gelten für jedes
 * erzeugte Hash und dürfen nicht je Aufrufort abweichen. `@node-rs/argon2`
 * schreibt sie mit in den Hash-String, deshalb bleiben ältere Hashes auch nach
 * einer Erhöhung prüfbar.
 */

import { randomInt } from 'node:crypto';
import { type Algorithm, hash, verify } from '@node-rs/argon2';
import { PASSWORD_MIN_LENGTH } from '@palantir/validation';

/**
 * `Algorithm.Argon2id` aus `@node-rs/argon2` ist ein `const enum` und lässt sich
 * unter `isolatedModules` nicht als Wert verwenden. Der Zahlenwert wird deshalb
 * einmal hier festgehalten und über `satisfies` an den Typ gebunden – weicht die
 * Bibliothek jemals ab, scheitert der Typecheck an dieser Stelle statt still ein
 * anderes Verfahren zu nutzen.
 */
const ARGON2ID: Algorithm = 2 satisfies Algorithm;

/**
 * Argon2id-Parameter.
 *
 * Orientiert an der zweiten Empfehlung des RFC 9106 (64 MiB, 3 Durchgänge,
 * 4 Spuren) – ein Kompromiss, der auf der VPS aus Pflichtenheft §1 auch bei
 * mehreren gleichzeitigen Anmeldungen tragbar bleibt. Erhöhen ist jederzeit
 * möglich: bestehende Hashes tragen ihre eigenen Parameter.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

/** Erzeugt den Argon2id-Hash eines Passworts. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Prüft ein Passwort gegen einen Hash.
 *
 * Ein beschädigter oder fremdformatiger Hash gilt als „passt nicht" statt als
 * Ausnahme – sonst würde ein einzelner kaputter Datensatz einen Serverfehler
 * statt einer regulären Abweisung erzeugen.
 */
export async function verifyPassword(hashString: string, password: string): Promise<boolean> {
  try {
    return await verify(hashString, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Zeichenvorrat des Einmal-Passworts.
 *
 * Ohne `I`, `l`, `O`, `0` und `1`: das Passwort wird vom Admin abgelesen und
 * weitergegeben, verwechselbare Zeichen kosten dort echte Zeit.
 */
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Erzeugt das Einmal-Passwort für den vom Admin ausgelösten Reset
 * (Lastenheft §3.1, Pflichtenheft §7).
 *
 * Länge bewusst über der Mindestlänge aus Pflichtenheft §7: der Wert wird
 * ohnehin nicht auswendig gelernt, sondern beim nächsten Login sofort ersetzt.
 * `randomInt` zieht aus einer kryptografischen Quelle und ohne Modulo-Schieflage.
 */
export function generateTemporaryPassword(length = PASSWORD_MIN_LENGTH + 6): string {
  let password = '';

  for (let index = 0; index < length; index += 1) {
    password += TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  }

  return password;
}
