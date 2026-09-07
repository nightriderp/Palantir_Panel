import { type LinkedAuthMethod } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  AUTH_METHOD_LABEL,
  authMethodLabel,
  hasPassword,
  isAuthMethodType,
  linkableProviders,
  methodDetail,
} from './methods';

function method(
  overrides: Partial<LinkedAuthMethod> & Pick<LinkedAuthMethod, 'type'>,
): LinkedAuthMethod {
  return {
    providerDisplayName: null,
    linkedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('linkableProviders', () => {
  it('meldet alle drei Anbieter, wenn nur ein Passwort verknüpft ist', () => {
    expect(linkableProviders([method({ type: 'password' })])).toEqual([
      'discord',
      'twitch',
      'steam',
    ]);
  });

  it('lässt bereits verknüpfte Anbieter weg', () => {
    const methods = [method({ type: 'discord' }), method({ type: 'password' })];
    expect(linkableProviders(methods)).toEqual(['twitch', 'steam']);
  });

  it('meldet nichts mehr, wenn alle Anbieter verknüpft sind', () => {
    const methods = [
      method({ type: 'discord' }),
      method({ type: 'twitch' }),
      method({ type: 'steam' }),
    ];
    expect(linkableProviders(methods)).toEqual([]);
  });
});

describe('hasPassword', () => {
  it('erkennt ein vorhandenes Passwort-Verfahren', () => {
    expect(hasPassword([method({ type: 'password' })])).toBe(true);
    expect(hasPassword([method({ type: 'discord' })])).toBe(false);
    expect(hasPassword([])).toBe(false);
  });
});

/*
 * Beschriftung aus der Query (Fundpunkt frontend-lib-11).
 *
 * `/profil?linked=…` kommt aus der Adresszeile und damit von jedem, der einen
 * Link verschicken kann. Der Wert landete über einen ungeprüften Cast als
 * Freitext in einem grünen Erfolgs-Toast („… wurde verknüpft.") – React
 * maskiert, es gibt also kein XSS, aber die eigene Oberfläche sprach fremde
 * Sätze aus. Erwartet wird jetzt: bekannter Wert → Beschriftung, alles andere →
 * `null` und damit gar keine Meldung.
 */
describe('authMethodLabel', () => {
  it('übersetzt die vier bekannten Verfahren', () => {
    expect(authMethodLabel('password')).toBe(AUTH_METHOD_LABEL.password);
    expect(authMethodLabel('discord')).toBe('Discord');
    expect(authMethodLabel('twitch')).toBe('Twitch');
    expect(authMethodLabel('steam')).toBe('Steam');
  });

  it('meldet für einen untergeschobenen Freitext nichts', () => {
    expect(authMethodLabel('Dein Konto wurde gesperrt, melde dich unter …')).toBeNull();
    expect(authMethodLabel('Discord ')).toBeNull();
    expect(authMethodLabel('DISCORD')).toBeNull();
    expect(authMethodLabel('')).toBeNull();
  });

  it('fällt nicht auf Eigenschaften der Prototypkette herein', () => {
    expect(authMethodLabel('toString')).toBeNull();
    expect(authMethodLabel('constructor')).toBeNull();
    expect(authMethodLabel('__proto__')).toBeNull();
  });

  it('kommt mit fehlendem Parameter zurecht', () => {
    // `searchParams.get()` liefert `null`, wenn die Query den Schlüssel nicht hat.
    expect(authMethodLabel(null)).toBeNull();
    expect(authMethodLabel(undefined)).toBeNull();
  });
});

describe('isAuthMethodType', () => {
  it('erkennt nur die Werte aus dem Vertrag', () => {
    expect(isAuthMethodType('steam')).toBe(true);
    expect(isAuthMethodType('github')).toBe(false);
    expect(isAuthMethodType(42)).toBe(false);
    expect(isAuthMethodType(null)).toBe(false);
  });
});

describe('methodDetail', () => {
  it('zeigt für Passwort keinen Anbieternamen', () => {
    expect(methodDetail(method({ type: 'password', providerDisplayName: 'egal' }))).toBeNull();
  });

  it('gibt bei externen Anbietern den Anzeigenamen zurück', () => {
    expect(methodDetail(method({ type: 'discord', providerDisplayName: 'user#1234' }))).toBe(
      'user#1234',
    );
  });
});
