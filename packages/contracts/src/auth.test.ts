import { describe, expect, it } from 'vitest';

import {
  ALTCHA_ALGORITHM,
  AUTH_METHOD_TYPES,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  LOGIN_RESULT_STATUSES,
  OAUTH_PROVIDERS,
  TOTP_CODE_LENGTH,
  isOAuthProvider,
} from './auth.js';

describe('Auth-Contracts (Pflichtenheft §7)', () => {
  it('kennt genau die Anmeldeverfahren aus Pflichtenheft §6', () => {
    expect(AUTH_METHOD_TYPES).toEqual(['password', 'discord', 'twitch', 'steam']);
  });

  it('führt alle externen Provider aus Lastenheft §3.1 – ohne das Passwort-Verfahren', () => {
    expect(OAUTH_PROVIDERS).toEqual(['discord', 'twitch', 'steam']);
    expect(OAUTH_PROVIDERS).not.toContain('password');
  });

  it('listet jeden externen Provider auch als Anmeldeverfahren', () => {
    for (const provider of OAUTH_PROVIDERS) {
      expect(AUTH_METHOD_TYPES).toContain(provider);
    }
  });

  it('erkennt bekannte Provider und weist unbekannte ab', () => {
    expect(isOAuthProvider('discord')).toBe(true);
    expect(isOAuthProvider('password')).toBe(false);
    expect(isOAuthProvider('github')).toBe(false);
  });

  it('nennt beide Ausgänge eines Login-Versuchs', () => {
    expect(LOGIN_RESULT_STATUSES).toEqual(['authenticated', 'two_factor_required']);
  });

  it('legt ALTCHA auf SHA-256 fest (Pflichtenheft §3)', () => {
    expect(ALTCHA_ALGORITHM).toBe('SHA-256');
  });
});

describe('Ergänzungen aus B1 (Pflichtenheft §7)', () => {
  it('hält Header- und Cookie-Namen des CSRF-Tokens in Kleinschreibung fest', () => {
    // Fastify liefert Header-Namen kleingeschrieben; ein Name mit
    // Großbuchstaben würde beim Nachschlagen ins Leere greifen.
    expect(CSRF_HEADER_NAME).toBe(CSRF_HEADER_NAME.toLowerCase());
    expect(CSRF_COOKIE_NAME).toBe(CSRF_COOKIE_NAME.toLowerCase());
  });

  it('nutzt dieselben CSRF-Namen wie der Client in F1', () => {
    // Die Konstanten standen zuerst in apps/frontend/src/lib/auth/api.ts; sie
    // gehören in den Vertrag, damit beide Seiten dieselbe Quelle nutzen.
    expect(CSRF_COOKIE_NAME).toBe('palantir_csrf');
    expect(CSRF_HEADER_NAME).toBe('x-csrf-token');
  });

  it('nutzt die sechsstellige TOTP-Länge aus RFC 6238', () => {
    expect(TOTP_CODE_LENGTH).toBe(6);
  });
});
