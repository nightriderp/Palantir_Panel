import { describe, expect, it } from 'vitest';
import { fail, httpStatusForResponse, isFail, isOk, ok, type ApiResponse } from './envelope.js';

describe('Response-Envelope (Pflichtenheft §5.1)', () => {
  it('ok() liefert genau die drei Felder des Envelope', () => {
    const response = ok({ status: 'ok' });

    expect(response).toEqual({ success: true, data: { status: 'ok' }, error: null });
    expect(Object.keys(response).sort()).toEqual(['data', 'error', 'success']);
  });

  it('fail() setzt data auf null und übernimmt Code und Meldung', () => {
    const response = fail('SUBDOMAIN_TAKEN', 'mc.example.com ist belegt.');

    expect(response).toEqual({
      success: false,
      data: null,
      error: { code: 'SUBDOMAIN_TAKEN', message: 'mc.example.com ist belegt.' },
    });
  });

  it('fail() ohne Meldung nutzt die Fallback-Meldung aus dem Katalog', () => {
    expect(fail('AUTH_INVALID_CREDENTIALS').error.message).toBe(
      'Benutzername oder Passwort ist falsch.',
    );
  });

  it('httpStatusForResponse() liefert den Status aus dem Katalog', () => {
    expect(httpStatusForResponse(fail('AUTH_INVALID_CREDENTIALS'))).toBe(401);
    expect(httpStatusForResponse(fail('RESOURCE_LIMIT_EXCEEDED'))).toBe(403);
    expect(httpStatusForResponse(fail('SUBDOMAIN_TAKEN'))).toBe(409);
  });

  it('isOk()/isFail() verengen den Union-Typ', () => {
    const responses: ApiResponse<number>[] = [ok(42), fail('SUBDOMAIN_TAKEN')];
    const [success, failure] = responses;

    expect(success && isOk(success)).toBe(true);
    expect(failure && isFail(failure)).toBe(true);

    if (success && isOk(success)) {
      // Verengung: data ist hier number, nicht number | null
      expect(success.data + 1).toBe(43);
    }
    if (failure && isFail(failure)) {
      expect(failure.error.code).toBe('SUBDOMAIN_TAKEN');
    }
  });
});
