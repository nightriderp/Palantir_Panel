import { describe, expect, it } from 'vitest';
import { baueCsp, erzeugeNonce, liveWsUrlAusUmgebung } from './csp';

/**
 * Die durchgesetzte CSP (Review 2026-09-16, Befunde 3.4/12.3): Der Kern ist,
 * dass `script-src` keine `'unsafe-inline'` mehr trägt, sondern eine Nonce –
 * sonst wäre der Header Dekoration.
 */
const BASIS = {
  nonce: 'Zufall123',
  apiUrl: 'https://api.example.test',
  liveWsUrl: 'wss://api.example.test',
  entwicklung: false,
};

describe('baueCsp', () => {
  it('erlaubt Skripte nur mit Nonce – kein unsafe-inline, kein unsafe-eval im Betrieb', () => {
    const csp = baueCsp(BASIS);
    const scriptSrc = csp.split('; ').find((teil) => teil.startsWith('script-src'));

    expect(scriptSrc).toBe("script-src 'self' 'nonce-Zufall123' 'strict-dynamic'");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('erlaubt unsafe-eval nur in der Entwicklung', () => {
    expect(baueCsp({ ...BASIS, entwicklung: true })).toContain(
      "script-src 'self' 'nonce-Zufall123' 'strict-dynamic' 'unsafe-eval'",
    );
  });

  it('kennt die API-Herkunft für Stylesheet, Schriften, XHR und den Live-Kanal', () => {
    const csp = baueCsp(BASIS);

    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://api.example.test");
    expect(csp).toContain("font-src 'self' https://api.example.test data:");
    expect(csp).toContain("connect-src 'self' https://api.example.test wss://api.example.test");
  });

  it('hält die bisher schon durchgesetzten Grundregeln', () => {
    const csp = baueCsp(BASIS);

    for (const regel of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
    ]) {
      expect(csp).toContain(regel);
    }
  });
});

describe('erzeugeNonce', () => {
  it('liefert je Aufruf einen anderen, base64-kodierten Wert', () => {
    const a = erzeugeNonce();
    const b = erzeugeNonce();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});

describe('liveWsUrlAusUmgebung', () => {
  it('leitet den Live-Kanal aus der API-Adresse ab', () => {
    expect(liveWsUrlAusUmgebung('https://api.example.test/')).toBe('wss://api.example.test');
    expect(liveWsUrlAusUmgebung('http://localhost:4000')).toBe('ws://localhost:4000');
  });
});
