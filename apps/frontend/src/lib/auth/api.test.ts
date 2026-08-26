import { describe, expect, it } from 'vitest';

import { AUTH_ENDPOINTS, CSRF_COOKIE_NAME, readCsrfToken } from './api';

describe('CSRF-Token aus dem Cookie (Pflichtenheft §7)', () => {
  it('liest das Token aus einer Cookie-Zeile mit mehreren Einträgen', () => {
    expect(readCsrfToken(`theme=dark; ${CSRF_COOKIE_NAME}=abc123; other=1`)).toBe('abc123');
  });

  it('kommt mit einem einzelnen Eintrag ohne Leerzeichen zurecht', () => {
    expect(readCsrfToken(`${CSRF_COOKIE_NAME}=abc123`)).toBe('abc123');
  });

  it('dekodiert prozentkodierte Werte', () => {
    expect(readCsrfToken(`${CSRF_COOKIE_NAME}=a%2Fb%3Dc`)).toBe('a/b=c');
  });

  it('behält Gleichheitszeichen im Wert – base64 endet oft darauf', () => {
    expect(readCsrfToken(`${CSRF_COOKIE_NAME}=dG9rZW4=`)).toBe('dG9rZW4=');
  });

  it('liefert null, wenn kein Token gesetzt ist', () => {
    expect(readCsrfToken('theme=dark')).toBeNull();
    expect(readCsrfToken('')).toBeNull();
  });

  it('verwechselt es nicht mit einem ähnlich benannten Cookie', () => {
    expect(readCsrfToken(`x_${CSRF_COOKIE_NAME}=fremd`)).toBeNull();
  });
});

describe('Endpunkte (Pflichtenheft §5.3)', () => {
  it('folgt bei OAuth den Redirect-URIs aus .env.example §5', () => {
    expect(AUTH_ENDPOINTS.oauthStart('discord')).toBe('/auth/discord/start');
    expect(AUTH_ENDPOINTS.oauthStart('steam')).toBe('/auth/steam/start');
  });

  it('führt alle Pfade unter /auth', () => {
    const paths = [
      AUTH_ENDPOINTS.login,
      AUTH_ENDPOINTS.twoFactor,
      AUTH_ENDPOINTS.register,
      AUTH_ENDPOINTS.session,
      AUTH_ENDPOINTS.logout,
      AUTH_ENDPOINTS.altchaChallenge,
    ];
    for (const path of paths) {
      expect(path.startsWith('/auth/')).toBe(true);
    }
  });
});
