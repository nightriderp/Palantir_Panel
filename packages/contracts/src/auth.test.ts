import { describe, expect, it } from 'vitest';

import {
  ALTCHA_ALGORITHM,
  AUTH_METHOD_TYPES,
  LOGIN_RESULT_STATUSES,
  OAUTH_PROVIDERS,
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
