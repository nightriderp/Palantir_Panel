import { describe, expect, it } from 'vitest';
import { createCsrfToken, csrfTokenMatches, isSafeMethod } from './csrf.js';
import { describeDevice, toIpHint } from './request-context.js';

describe('Gerätekennung für die Sitzungsübersicht (Lastenheft §3.1)', () => {
  it('erkennt gängige Browser und Plattformen', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
      ),
    ).toBe('Firefox auf Windows');

    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari auf iOS');
  });

  it('bevorzugt das spezifischere Muster bei überlappenden Kennungen', () => {
    // Edge und Opera tragen „Chrome" im User-Agent, Chrome trägt „Safari".
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      ),
    ).toBe('Edge auf Windows');

    expect(
      describeDevice(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome auf Linux');
  });

  it('erfindet nichts, wenn sich nichts ableiten lässt', () => {
    expect(describeDevice(undefined)).toBeNull();
    expect(describeDevice('curl/8.5.0')).toBeNull();
  });
});

describe('Herkunfts-Hinweis (Datenschutz-Prinzip, Pflichtenheft §18)', () => {
  it('kürzt IPv4 um das letzte Oktett', () => {
    expect(toIpHint('203.0.113.10')).toBe('203.0.113.x');
  });

  it('erkennt IPv4 hinter IPv6-Sockets', () => {
    expect(toIpHint('::ffff:203.0.113.10')).toBe('203.0.113.x');
  });

  it('kürzt IPv6 nach dem dritten Block', () => {
    expect(toIpHint('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:x');
  });

  it('speichert nie die vollständige Adresse', () => {
    expect(toIpHint('203.0.113.10')).not.toContain('.10');
    expect(toIpHint(undefined)).toBeNull();
    expect(toIpHint('keine-adresse')).toBeNull();
  });
});

describe('CSRF-Token (Pflichtenheft §7)', () => {
  it('erkennt lesende Methoden als unbedenklich', () => {
    expect(isSafeMethod('GET')).toBe(true);
    expect(isSafeMethod('head')).toBe(true);
    expect(isSafeMethod('POST')).toBe(false);
    expect(isSafeMethod('DELETE')).toBe(false);
  });

  it('akzeptiert nur den exakt übereinstimmenden Wert', () => {
    const token = createCsrfToken();

    expect(csrfTokenMatches(token, token)).toBe(true);
    expect(csrfTokenMatches(token, [token])).toBe(true);
    expect(csrfTokenMatches(token, `${token}x`)).toBe(false);
    expect(csrfTokenMatches(token, createCsrfToken())).toBe(false);
  });

  it('lehnt ab, wenn Cookie oder Header fehlt', () => {
    const token = createCsrfToken();

    expect(csrfTokenMatches(undefined, token)).toBe(false);
    expect(csrfTokenMatches(token, undefined)).toBe(false);
    expect(csrfTokenMatches(undefined, undefined)).toBe(false);
  });
});
