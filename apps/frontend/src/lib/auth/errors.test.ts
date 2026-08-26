import { ERROR_CODES, defaultMessageForErrorCode } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';

import {
  AuthRequestError,
  NETWORK_ERROR_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
  isBlockingError,
  messageForApiError,
  messageForErrorCode,
  messageForThrown,
  shouldRestartLogin,
} from './errors';

describe('Übersetzung anhand des Fehlercodes (Pflichtenheft §5.1)', () => {
  it('übersetzt jeden Code des Katalogs in einen nicht-leeren deutschen Satz', () => {
    for (const code of ERROR_CODES) {
      const message = messageForErrorCode(code);
      expect(message).toBe(defaultMessageForErrorCode(code));
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('deckt die Fehlerzustände der Anmeldung ab', () => {
    expect(messageForErrorCode('AUTH_INVALID_CREDENTIALS')).toMatch(/falsch/i);
    expect(messageForErrorCode('AUTH_ACCOUNT_BANNED')).toMatch(/gesperrt/i);
    expect(messageForErrorCode('AUTH_RATE_LIMITED')).toMatch(/viele Versuche/i);
  });

  it('fängt einen Code ab, den dieses Frontend noch nicht kennt', () => {
    expect(messageForErrorCode('AUTH_SOMETHING_NEW')).toBe(UNKNOWN_ERROR_MESSAGE);
  });

  it('nutzt den Code, nicht den Freitext der Antwort', () => {
    const message = messageForApiError({
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'user lookup failed for id 42',
    });
    expect(message).toBe(defaultMessageForErrorCode('AUTH_INVALID_CREDENTIALS'));
    expect(message).not.toContain('42');
  });
});

describe('Geworfene Fehler', () => {
  it('gibt bei einem Netzwerkfehler die eigene Meldung zurück', () => {
    expect(messageForThrown(new AuthRequestError(NETWORK_ERROR_MESSAGE, null))).toBe(
      NETWORK_ERROR_MESSAGE,
    );
  });

  it('übersetzt einen Fehler mit Code über den Katalog', () => {
    const error = new AuthRequestError('lookup failed', 'AUTH_RATE_LIMITED');
    expect(messageForThrown(error)).toBe(defaultMessageForErrorCode('AUTH_RATE_LIMITED'));
  });

  it('fällt bei fremden Fehlern auf die allgemeine Meldung zurück', () => {
    expect(messageForThrown(new Error('boom'))).toBe(UNKNOWN_ERROR_MESSAGE);
    expect(messageForThrown('boom')).toBe(UNKNOWN_ERROR_MESSAGE);
  });
});

describe('Folgen einzelner Fehler für den Ablauf', () => {
  it('startet die Anmeldung nur beim abgelaufenen Zwischen-Token neu', () => {
    expect(shouldRestartLogin('AUTH_TWO_FACTOR_EXPIRED')).toBe(true);
    expect(shouldRestartLogin('AUTH_TWO_FACTOR_INVALID')).toBe(false);
    expect(shouldRestartLogin(null)).toBe(false);
  });

  it('erkennt Fehler, bei denen ein sofortiger neuer Versuch nichts bringt', () => {
    expect(isBlockingError('AUTH_ACCOUNT_BANNED')).toBe(true);
    expect(isBlockingError('AUTH_RATE_LIMITED')).toBe(true);
    expect(isBlockingError('AUTH_INVALID_CREDENTIALS')).toBe(false);
    expect(isBlockingError(null)).toBe(false);
  });
});
