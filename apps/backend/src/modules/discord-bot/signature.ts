/**
 * Signaturprüfung des Interactions-Endpoints (Pflichtenheft §14a.2).
 *
 * Discord signiert jede Anfrage mit Ed25519 über `X-Signature-Timestamp` +
 * Rohkörper. Die Signatur ist die **einzige** Authentifizierung dieses
 * Endpoints – es gibt weder Sitzung noch CSRF-Token, weil der Aufrufer Discord
 * ist und nicht ein Browser.
 *
 * Keine neue Abhängigkeit: `node:crypto` kann Ed25519 seit Node 12. Der
 * öffentliche Schlüssel kommt von Discord als 32 rohe Bytes in Hex; `crypto`
 * will ihn als SPKI. Das Präfix unten ist die feste DER-Kopfzeile eines
 * Ed25519-SPKI-Schlüssels (RFC 8410), dahinter folgen die 32 Bytes.
 */

import { createPublicKey, type KeyObject, verify } from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Höchstalter des Zeitstempels. Discord verlangt diese Prüfung nicht, sie ist
 * der Schutz gegen das Wiedereinspielen einer mitgeschnittenen Anfrage.
 * Fünf Minuten lassen reichlich Raum für eine schief gehende Uhr.
 */
export const MAX_SIGNATURE_AGE_SECONDS = 300;

const HEX = /^[0-9a-f]+$/i;

/** Wandelt den Hex-Schlüssel aus dem Developer Portal in ein `KeyObject`. */
export function importDiscordPublicKey(publicKeyHex: string): KeyObject {
  if (publicKeyHex.length !== 64 || !HEX.test(publicKeyHex)) {
    throw new Error('DISCORD_PUBLIC_KEY muss aus genau 64 Hex-Zeichen bestehen.');
  }

  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

export interface SignedRequest {
  readonly signatureHex: string | undefined;
  readonly timestamp: string | undefined;
  readonly rawBody: string;
}

/**
 * Prüft Signatur und Alter. Wirft nie: Jede unbrauchbare Eingabe – fehlender
 * Kopf, kein Hex, falsche Länge – ist schlicht „ungültig".
 */
export function verifyDiscordSignature(
  key: KeyObject,
  request: SignedRequest,
  nowMs: number = Date.now(),
): boolean {
  const { signatureHex, timestamp, rawBody } = request;

  if (!signatureHex || !timestamp || signatureHex.length !== 128 || !HEX.test(signatureHex)) {
    return false;
  }

  if (!/^\d{1,12}$/.test(timestamp)) {
    return false;
  }

  const ageSeconds = Math.abs(nowMs / 1000 - Number(timestamp));

  if (ageSeconds > MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }

  try {
    return verify(
      null,
      Buffer.from(timestamp + rawBody, 'utf8'),
      key,
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}
