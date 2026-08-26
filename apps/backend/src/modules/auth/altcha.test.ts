import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type AltchaOptions, createAltchaChallenge, verifyAltchaSolution } from './altcha.js';

const options: AltchaOptions = {
  hmacKey: 'test-hmac-schluessel',
  complexity: 500,
  expirySeconds: 300,
};

const NOW = 1_700_000_000_000;

/** Löst eine Challenge so, wie es das ALTCHA-Widget im Browser tut. */
function solve(challenge: ReturnType<typeof createAltchaChallenge>): string {
  for (let number = 0; number <= challenge.maxnumber; number += 1) {
    const hash = createHash('sha256')
      .update(`${challenge.salt}${String(number)}`, 'utf8')
      .digest('hex');

    if (hash === challenge.challenge) {
      return Buffer.from(
        JSON.stringify({
          algorithm: challenge.algorithm,
          challenge: challenge.challenge,
          salt: challenge.salt,
          number,
          signature: challenge.signature,
        }),
      ).toString('base64');
    }
  }

  throw new Error('Challenge war im erlaubten Zahlenraum nicht lösbar.');
}

describe('ALTCHA-Challenge (Pflichtenheft §7)', () => {
  it('liefert das Format, das das Widget erwartet', () => {
    const challenge = createAltchaChallenge(options, NOW);

    expect(challenge.algorithm).toBe('SHA-256');
    expect(challenge.maxnumber).toBe(options.complexity);
    expect(challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('trägt die Ablaufzeit im Salt, damit der Server nichts speichern muss', () => {
    const challenge = createAltchaChallenge(options, NOW);
    const expires = new URLSearchParams(challenge.salt.split('?')[1]).get('expires');

    expect(Number(expires)).toBe(Math.floor(NOW / 1000) + options.expirySeconds);
  });

  it('erzeugt bei jedem Aufruf eine andere Challenge', () => {
    expect(createAltchaChallenge(options, NOW).salt).not.toBe(
      createAltchaChallenge(options, NOW).salt,
    );
  });
});

describe('ALTCHA-Prüfung', () => {
  it('akzeptiert eine korrekt gelöste Challenge', () => {
    const challenge = createAltchaChallenge(options, NOW);

    expect(verifyAltchaSolution(solve(challenge), options, NOW + 1000)).toBe(true);
  });

  it('lehnt eine abgelaufene Challenge ab', () => {
    const challenge = createAltchaChallenge(options, NOW);
    const afterExpiry = NOW + (options.expirySeconds + 1) * 1000;

    expect(verifyAltchaSolution(solve(challenge), options, afterExpiry)).toBe(false);
  });

  it('lehnt eine Challenge mit fremdem HMAC-Schlüssel ab', () => {
    const challenge = createAltchaChallenge({ ...options, hmacKey: 'anderer-schluessel' }, NOW);

    expect(verifyAltchaSolution(solve(challenge), options, NOW)).toBe(false);
  });

  it('lehnt eine falsche Zahl ab, auch bei gültiger Signatur', () => {
    const challenge = createAltchaChallenge(options, NOW);
    const tampered = Buffer.from(
      JSON.stringify({
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        salt: challenge.salt,
        number: challenge.maxnumber + 1,
        signature: challenge.signature,
      }),
    ).toString('base64');

    expect(verifyAltchaSolution(tampered, options, NOW)).toBe(false);
  });

  it('lehnt unbrauchbare Nutzdaten ab, ohne zu scheitern', () => {
    expect(verifyAltchaSolution('kein-base64-json', options, NOW)).toBe(false);
    expect(verifyAltchaSolution(Buffer.from('{}').toString('base64'), options, NOW)).toBe(false);
    expect(verifyAltchaSolution('', options, NOW)).toBe(false);
  });

  it('lehnt einen anderen Algorithmus ab', () => {
    const challenge = createAltchaChallenge(options, NOW);
    const solved = JSON.parse(Buffer.from(solve(challenge), 'base64').toString()) as {
      algorithm: string;
    };
    solved.algorithm = 'SHA-1';

    expect(
      verifyAltchaSolution(Buffer.from(JSON.stringify(solved)).toString('base64'), options, NOW),
    ).toBe(false);
  });
});
