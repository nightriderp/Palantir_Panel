import { describe, expect, it } from 'vitest';
import {
  TOTP_PERIOD_SECONDS,
  buildOtpauthUri,
  decodeBase32,
  encodeBase32,
  generateHotp,
  generateTotp,
  generateTotpSecret,
  totpCounterFor,
  verifyTotp,
} from './totp.js';

/** Geheimnis aus RFC 4226 Anhang D: die ASCII-Zeichen `12345678901234567890`. */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_BASE32 = encodeBase32(RFC_SECRET);

describe('Base32 (RFC 4648)', () => {
  it('kodiert die Testvektoren aus RFC 4648 §10', () => {
    expect(encodeBase32(Buffer.from('f'))).toBe('MY');
    expect(encodeBase32(Buffer.from('fo'))).toBe('MZXQ');
    expect(encodeBase32(Buffer.from('foo'))).toBe('MZXW6');
    expect(encodeBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('dekodiert zurück in die Ausgangsbytes', () => {
    expect(decodeBase32(encodeBase32(RFC_SECRET)).equals(RFC_SECRET)).toBe(true);
  });

  it('toleriert Kleinschreibung, Leerzeichen und Auffüllzeichen', () => {
    // Nutzer tippen den Schlüssel oft in der Gruppierung ab, die der
    // Authenticator anzeigt.
    expect(decodeBase32('mzxw 6ytb oi==').toString()).toBe('foobar');
  });

  it('lehnt Zeichen außerhalb des Alphabets ab', () => {
    expect(() => decodeBase32('MZXW6YTB01')).toThrow();
  });
});

describe('HOTP (RFC 4226 Anhang D)', () => {
  it('erzeugt die Referenzcodes der Zähler 0 bis 9', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];

    expected.forEach((code, counter) => {
      expect(generateHotp(RFC_SECRET, counter)).toBe(code);
    });
  });
});

describe('TOTP (RFC 6238)', () => {
  it('rechnet den Zeitzähler aus RFC 6238 Anhang B', () => {
    expect(totpCounterFor(59_000)).toBe(1);
    expect(totpCounterFor(1_111_111_109_000)).toBe(0x023523ec);
  });

  it('erzeugt den SHA-1-Referenzcode zu T = 59 Sekunden', () => {
    // RFC 6238 Anhang B nennt für SHA-1 und T=59 den Code 94287082; die
    // sechsstellige Variante daraus ist 287082.
    expect(generateTotp(RFC_SECRET_BASE32, 59_000)).toBe('287082');
  });

  it('akzeptiert den Code des aktuellen Fensters', () => {
    const now = 1_700_000_000_000;

    expect(verifyTotp(RFC_SECRET_BASE32, generateTotp(RFC_SECRET_BASE32, now), now)).toBe(true);
  });

  it('akzeptiert je ein Fenster davor und danach (Uhr-Abweichung)', () => {
    const now = 1_700_000_000_000;
    const step = TOTP_PERIOD_SECONDS * 1000;

    expect(verifyTotp(RFC_SECRET_BASE32, generateTotp(RFC_SECRET_BASE32, now - step), now)).toBe(
      true,
    );
    expect(verifyTotp(RFC_SECRET_BASE32, generateTotp(RFC_SECRET_BASE32, now + step), now)).toBe(
      true,
    );
  });

  it('lehnt Codes außerhalb der zugelassenen Abweichung ab', () => {
    const now = 1_700_000_000_000;
    const step = TOTP_PERIOD_SECONDS * 1000;

    expect(
      verifyTotp(RFC_SECRET_BASE32, generateTotp(RFC_SECRET_BASE32, now - 2 * step), now),
    ).toBe(false);
    expect(
      verifyTotp(RFC_SECRET_BASE32, generateTotp(RFC_SECRET_BASE32, now + 2 * step), now),
    ).toBe(false);
  });

  it('lehnt falsche und formal ungültige Eingaben ab', () => {
    const now = 1_700_000_000_000;

    expect(verifyTotp(RFC_SECRET_BASE32, '000000', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET_BASE32, '12345', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET_BASE32, '', now)).toBe(false);
  });

  it('erzeugt Geheimnisse mit 20 Byte Länge', () => {
    const secret = generateTotpSecret();

    expect(decodeBase32(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });
});

describe('otpauth-URI', () => {
  it('enthält Aussteller, Konto und die Parameter der Authenticator-Apps', () => {
    const uri = buildOtpauthUri({
      secretBase32: 'ABCDEF',
      accountName: 'spieler 1',
      issuer: 'palantir.example',
    });

    expect(uri.startsWith('otpauth://totp/palantir.example:spieler%201?')).toBe(true);
    expect(uri).toContain('secret=ABCDEF');
    expect(uri).toContain('issuer=palantir.example');
    expect(uri).toContain('digits=6');
    expect(uri).toContain(`period=${String(TOTP_PERIOD_SECONDS)}`);
  });
});
