import { type LinkedAuthMethod } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { hasPassword, linkableProviders, methodDetail } from './methods';

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
