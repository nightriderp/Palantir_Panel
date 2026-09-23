import { describe, expect, it } from 'vitest';
import type { AuthMethodRecord, UserRecord } from '../auth/types.js';
import { createAuthIdentityResolver } from './identity.js';

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u1',
    username: null,
    displayName: 'Keyrim',
    isOwner: false,
    banned: false,
    avatarUpdatedAt: null,
    titleAchievementId: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function resolverFuer(konto: UserRecord | null, approved: boolean) {
  return createAuthIdentityResolver({
    repository: {
      findAuthMethodByProvider: async (type, providerUserId) =>
        type === 'discord' && providerUserId === 'd1' && konto
          ? ({ userId: konto.id } as AuthMethodRecord)
          : null,
      findUserById: async (id) => (konto && id === konto.id ? konto : null),
    },
    buildActor: async () => ({ approved }),
  });
}

/**
 * Wer über Discord etwas darf, entscheidet allein die Verknüpfung im Panel und
 * dieselbe Freischaltregel wie dort (Pflichtenheft §14a.3).
 */
describe('createAuthIdentityResolver', () => {
  it('findet das Konto über die Discord-Anmeldung', async () => {
    await expect(resolverFuer(user(), true).resolve('d1')).resolves.toEqual({
      userId: 'u1',
      displayName: 'Keyrim',
      banned: false,
      approved: true,
    });
  });

  it('kennt ohne Verknüpfung niemanden', async () => {
    await expect(resolverFuer(user(), true).resolve('d2')).resolves.toBeNull();
  });

  it('übernimmt die Freischaltung aus dem Auth-Modul', async () => {
    await expect(resolverFuer(user(), false).resolve('d1')).resolves.toMatchObject({
      approved: false,
    });
  });

  it('zählt ein gesperrtes Konto nie als freigeschaltet', async () => {
    await expect(resolverFuer(user({ banned: true }), true).resolve('d1')).resolves.toMatchObject({
      banned: true,
      approved: false,
    });
  });
});
