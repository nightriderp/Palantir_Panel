import { type AltchaChallenge } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';

import {
  AltchaAbortError,
  AltchaUnsolvableError,
  altchaHash,
  encodeAltchaSolution,
  solveAltchaChallenge,
} from './altcha';

/** Baut eine Challenge, wie das Backend sie erzeugen würde. */
async function makeChallenge(
  salt: string,
  secret: number,
  maxnumber = 200,
): Promise<AltchaChallenge> {
  return {
    algorithm: 'SHA-256',
    challenge: await altchaHash(salt, secret),
    salt,
    maxnumber,
    signature: 'signatur-des-backends',
  };
}

describe('ALTCHA-Proof-of-Work (Pflichtenheft §3)', () => {
  it('bildet den Hash als SHA-256 über die Verkettung salt + Zahl', async () => {
    // Fester Referenzwert für SHA-256("salz7"). Bindet Verfahren und
    // Verkettungsreihenfolge fest – eine Abweichung würde jede Challenge des
    // Backends unlösbar machen, ohne dass ein Vergleich mit sich selbst das
    // bemerken würde.
    expect(await altchaHash('salz', 7)).toBe(
      '7f6b8dec4451124fbd19986a36785535a229017c7b3e06b234f0b94efd8f17f3',
    );
    expect(await altchaHash('salz', 8)).not.toBe(await altchaHash('salz', 7));
  });

  it('findet die gesuchte Zahl', async () => {
    const challenge = await makeChallenge('salz', 137);
    const result = await solveAltchaChallenge(challenge, { chunkSize: 16 });
    expect(result.number).toBe(137);
    expect(result.took).toBeGreaterThanOrEqual(0);
  });

  it('findet auch die 0 – die Schleife beginnt einschließlich', async () => {
    const challenge = await makeChallenge('salz', 0);
    expect((await solveAltchaChallenge(challenge)).number).toBe(0);
  });

  it('findet die obere Grenze – der Bereich ist einschließlich', async () => {
    const challenge = await makeChallenge('salz', 50, 50);
    expect((await solveAltchaChallenge(challenge)).number).toBe(50);
  });

  it('vergleicht unabhängig von der Schreibweise des Hashes', async () => {
    const challenge = await makeChallenge('salz', 12);
    const upperCase = { ...challenge, challenge: challenge.challenge.toUpperCase() };
    expect((await solveAltchaChallenge(upperCase)).number).toBe(12);
  });

  it('meldet Fortschritt zwischen 0 und 1', async () => {
    const challenge = await makeChallenge('salz', 90, 100);
    const progress: number[] = [];
    await solveAltchaChallenge(challenge, { chunkSize: 8, onProgress: (p) => progress.push(p) });
    expect(progress.length).toBeGreaterThan(0);
    expect(Math.min(...progress)).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
  });

  it('bricht ab, wenn im Bereich keine Lösung liegt', async () => {
    const challenge = await makeChallenge('salz', 500, 20);
    await expect(solveAltchaChallenge(challenge)).rejects.toBeInstanceOf(AltchaUnsolvableError);
  });

  it('reagiert auf ein Abbruchsignal', async () => {
    const challenge = await makeChallenge('salz', 199);
    const controller = new AbortController();
    controller.abort();
    await expect(
      solveAltchaChallenge(challenge, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AltchaAbortError);
  });
});

describe('Kodierung der Lösung', () => {
  it('schickt Challenge und Signatur unverändert zurück', async () => {
    const challenge = await makeChallenge('salz', 5);
    const encoded = encodeAltchaSolution(challenge, { number: 5, took: 42 });
    const decoded: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));

    expect(decoded).toEqual({
      algorithm: 'SHA-256',
      challenge: challenge.challenge,
      salt: 'salz',
      signature: 'signatur-des-backends',
      number: 5,
      took: 42,
    });
  });
});
