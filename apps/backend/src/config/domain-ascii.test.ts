import { describe, expect, it } from 'vitest';
import { hostAlsAscii, urlAlsAscii } from './domain-ascii.js';

describe('hostAlsAscii', () => {
  it('bringt eine Umlaut-Domain in die ASCII-Form', () => {
    expect(hostAlsAscii('müf-it.de', 'PALANTIR_DOMAIN')).toBe('xn--mf-it-kva.de');
  });

  it('rechnet auch eine Subdomain mit um', () => {
    expect(hostAlsAscii('mc.müf-it.de', 'GAME_ROUTER_HOSTNAME')).toBe('mc.xn--mf-it-kva.de');
  });

  /*
   * Der wichtigste Fall: Jede bestehende Instanz pflegt ASCII. Dort darf sich
   * kein Zeichen ändern – auch keine Grossschreibung und kein Punkt.
   */
  it('lässt einen ASCII-Wert Zeichen für Zeichen unverändert', () => {
    for (const wert of [
      'beispiel.tld',
      'panel.beispiel.tld',
      'localhost',
      'xn--mf-it-kva.de',
      'Beispiel.TLD',
      '',
    ]) {
      expect(hostAlsAscii(wert, 'PALANTIR_DOMAIN')).toBe(wert);
    }
  });

  it('behält den führenden Punkt einer Cookie-Domain', () => {
    expect(hostAlsAscii('.müf-it.de', 'COOKIE_DOMAIN')).toBe('.xn--mf-it-kva.de');
  });

  it('nennt die Variable, wenn der Wert kein Hostname ist', () => {
    expect(() => hostAlsAscii('müf it.de/pfad', 'PALANTIR_DOMAIN')).toThrow(/PALANTIR_DOMAIN/);
  });
});

describe('urlAlsAscii', () => {
  it('bringt den Namensteil einer Adresse in die ASCII-Form', () => {
    expect(urlAlsAscii('https://müf-it.de/api', 'PUBLIC_API_URL')).toBe(
      'https://xn--mf-it-kva.de/api',
    );
  });

  it('hängt keinen Schrägstrich an, der nicht dastand', () => {
    expect(urlAlsAscii('https://müf-it.de', 'PUBLIC_WEB_URL')).toBe('https://xn--mf-it-kva.de');
  });

  it('behält einen Schrägstrich, der dastand', () => {
    expect(urlAlsAscii('https://müf-it.de/', 'PUBLIC_WEB_URL')).toBe('https://xn--mf-it-kva.de/');
  });

  it('lässt Port und Pfad in Ruhe', () => {
    expect(urlAlsAscii('https://müf-it.de:8443/api/auth', 'PUBLIC_API_URL')).toBe(
      'https://xn--mf-it-kva.de:8443/api/auth',
    );
  });

  it('lässt eine ASCII-Adresse unverändert', () => {
    for (const wert of ['http://localhost:4000', 'https://beispiel.tld/api', 'https://x.tld/']) {
      expect(urlAlsAscii(wert, 'PUBLIC_API_URL')).toBe(wert);
    }
  });

  it('nennt die Variable, wenn der Wert keine Adresse ist', () => {
    expect(() => urlAlsAscii('müf-it.de/api', 'PUBLIC_API_URL')).toThrow(/PUBLIC_API_URL/);
  });
});
