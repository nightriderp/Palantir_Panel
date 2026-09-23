import { describe, expect, it } from 'vitest';
import {
  importDiscordPublicKey,
  MAX_SIGNATURE_AGE_SECONDS,
  verifyDiscordSignature,
} from './signature.js';
import { createTestKeyPair } from './test-keys.js';

/**
 * Die Signatur ist die einzige Anmeldung des Interactions-Endpoints
 * (Pflichtenheft §14a.2). Jeder Fall, in dem sie fälschlich „gültig" sagt,
 * ließe jeden im Namen von Discord Knöpfe drücken.
 */
describe('verifyDiscordSignature', () => {
  const keys = createTestKeyPair();
  const key = importDiscordPublicKey(keys.publicKeyHex);
  const nowMs = 1_800_000_000_000;
  const timestamp = String(nowMs / 1000);
  const body = '{"type":1}';

  it('nimmt eine korrekt signierte Anfrage an', () => {
    const signatureHex = keys.signBody(timestamp, body);

    expect(verifyDiscordSignature(key, { signatureHex, timestamp, rawBody: body }, nowMs)).toBe(
      true,
    );
  });

  it('lehnt einen veränderten Körper ab', () => {
    const signatureHex = keys.signBody(timestamp, body);

    expect(
      verifyDiscordSignature(key, { signatureHex, timestamp, rawBody: '{"type":2}' }, nowMs),
    ).toBe(false);
  });

  it('lehnt einen veränderten Zeitstempel ab', () => {
    const signatureHex = keys.signBody(timestamp, body);

    expect(
      verifyDiscordSignature(
        key,
        { signatureHex, timestamp: String(Number(timestamp) + 1), rawBody: body },
        nowMs,
      ),
    ).toBe(false);
  });

  it('lehnt eine Signatur mit einem fremden Schlüssel ab', () => {
    const fremd = createTestKeyPair();
    const signatureHex = fremd.signBody(timestamp, body);

    expect(verifyDiscordSignature(key, { signatureHex, timestamp, rawBody: body }, nowMs)).toBe(
      false,
    );
  });

  it('lehnt eine zu alte Anfrage ab, auch wenn die Signatur stimmt', () => {
    // Schutz gegen das Wiedereinspielen einer mitgeschnittenen Anfrage.
    const alt = String(nowMs / 1000 - MAX_SIGNATURE_AGE_SECONDS - 1);
    const signatureHex = keys.signBody(alt, body);

    expect(
      verifyDiscordSignature(key, { signatureHex, timestamp: alt, rawBody: body }, nowMs),
    ).toBe(false);
  });

  it('nimmt eine Anfrage knapp innerhalb der Frist an', () => {
    const knapp = String(nowMs / 1000 - MAX_SIGNATURE_AGE_SECONDS + 1);
    const signatureHex = keys.signBody(knapp, body);

    expect(
      verifyDiscordSignature(key, { signatureHex, timestamp: knapp, rawBody: body }, nowMs),
    ).toBe(true);
  });

  it.each([
    ['fehlende Signatur', { signatureHex: undefined, timestamp, rawBody: body }],
    [
      'fehlender Zeitstempel',
      { signatureHex: 'a'.repeat(128), timestamp: undefined, rawBody: body },
    ],
    ['Signatur kein Hex', { signatureHex: 'z'.repeat(128), timestamp, rawBody: body }],
    ['Signatur zu kurz', { signatureHex: 'ab', timestamp, rawBody: body }],
    [
      'Zeitstempel keine Zahl',
      { signatureHex: 'a'.repeat(128), timestamp: 'jetzt', rawBody: body },
    ],
  ])('wirft nie, sondern lehnt ab: %s', (_fall, request) => {
    expect(verifyDiscordSignature(key, request, nowMs)).toBe(false);
  });
});

describe('importDiscordPublicKey', () => {
  it('verlangt genau 64 Hex-Zeichen', () => {
    expect(() => importDiscordPublicKey('abc')).toThrow(/64 Hex-Zeichen/);
    expect(() => importDiscordPublicKey('g'.repeat(64))).toThrow(/64 Hex-Zeichen/);
  });
});
