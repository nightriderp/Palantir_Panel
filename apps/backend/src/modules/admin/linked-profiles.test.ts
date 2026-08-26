/**
 * Profilangaben der Freischalt-Warteliste (Lastenheft §3.1, Gefundener Punkt 39).
 */

import { LINKED_ACCOUNT_PROVIDERS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type LinkedMethodRow, profileUrlFor, toLinkedAccountProfile } from './linked-profiles.js';

const LINKED_AT = new Date('2026-08-26T10:00:00.000Z');

function row(overrides: Partial<LinkedMethodRow> = {}): LinkedMethodRow {
  return {
    type: 'discord',
    providerUserId: '123456789012345678',
    providerDisplayName: 'Spieler',
    providerAvatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/abc.png',
    createdAt: LINKED_AT,
    ...overrides,
  };
}

describe('Abbildung auf LinkedAccountProfileDto', () => {
  it('übernimmt Anzeigename und Avatar des Anbieters', () => {
    expect(toLinkedAccountProfile(row())).toEqual({
      provider: 'discord',
      displayName: 'Spieler',
      avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/abc.png',
      profileUrl: 'https://discord.com/users/123456789012345678',
      linkedAt: '2026-08-26T10:00:00.000Z',
    });
  });

  it('lässt fehlende Angaben null, statt sie zu erfinden', () => {
    // Welche Angaben vorliegen, hängt vom Anbieter und den minimalen Scopes ab
    // (Pflichtenheft §7).
    const profile = toLinkedAccountProfile(
      row({ type: 'steam', providerDisplayName: null, providerAvatarUrl: null }),
    );

    expect(profile.displayName).toBeNull();
    expect(profile.avatarUrl).toBeNull();
  });

  it('bildet das Passwort-Verfahren ohne Fremdprofil ab', () => {
    const profile = toLinkedAccountProfile(
      row({
        type: 'password',
        providerUserId: null,
        providerDisplayName: null,
        providerAvatarUrl: null,
      }),
    );

    expect(profile).toEqual({
      provider: 'password',
      displayName: null,
      avatarUrl: null,
      profileUrl: null,
      linkedAt: '2026-08-26T10:00:00.000Z',
    });
  });
});

describe('Profilseite beim Anbieter', () => {
  it('verlinkt Discord und Steam über die stabile Anbieter-Id', () => {
    expect(profileUrlFor('discord', '42')).toBe('https://discord.com/users/42');
    expect(profileUrlFor('steam', '76561198000000000')).toBe(
      'https://steamcommunity.com/profiles/76561198000000000',
    );
  });

  it('verlinkt Twitch bewusst nicht', () => {
    // Die URL wäre `twitch.tv/<login>`, gespeichert wird aber `display_name`.
    // Ein Link, der manchmal ins Leere zeigt, ist schlechter als gar keiner.
    expect(profileUrlFor('twitch', '12345')).toBeNull();
  });

  it('liefert ohne Anbieter-Kennung keinen Link', () => {
    expect(profileUrlFor('discord', null)).toBeNull();
    expect(profileUrlFor('password', null)).toBeNull();
  });

  it('behandelt jeden Anbieter des Vertrags', () => {
    // Kommt ein Anbieter dazu, fällt er hier auf, statt still `undefined` zu
    // liefern.
    for (const provider of LINKED_ACCOUNT_PROVIDERS) {
      expect(profileUrlFor(provider, 'kennung')).not.toBeUndefined();
    }
  });
});
