/**
 * Schlüsselpaar und Signierhilfe für die Tests des Bots.
 *
 * Erzeugt zur Laufzeit – kein Schlüssel im Repository, auch kein Testschlüssel
 * (Entwicklungsregeln §2). Signiert wird genau so, wie Discord es tut:
 * Ed25519 über Zeitstempel + Rohkörper.
 */

import { generateKeyPairSync, sign } from 'node:crypto';

export function createTestKeyPair(): {
  publicKeyHex: string;
  signBody: (timestamp: string, body: string) => string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // Die letzten 32 Bytes des SPKI sind der rohe Schlüssel, wie Discord ihn anzeigt.
  const publicKeyHex = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(12)
    .toString('hex');

  return {
    publicKeyHex,
    signBody: (timestamp, body) =>
      sign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex'),
  };
}
