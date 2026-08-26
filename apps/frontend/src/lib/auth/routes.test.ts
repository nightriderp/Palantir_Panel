import { type AccountDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';

import {
  AUTH_ROUTES,
  DASHBOARD_HOME,
  belongsOnPendingScreen,
  landingPathForAccount,
} from './routes';

const baseAccount: AccountDto = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alex',
  username: 'alex',
  isOwner: false,
  banned: false,
  awaitingApproval: false,
  twoFactorEnabled: false,
  roles: [],
  authMethods: [],
  createdAt: '2026-08-26T10:00:00Z',
  permissions: {
    canCreateServer: false,
    canViewAnyServer: false,
    canManageAnyBackup: false,
    canManageUsers: false,
    canManageRoles: false,
    canManageNotifications: false,
    canViewNodes: false,
    canManageNodes: false,
    canManageAddresses: false,
    canViewAuditLog: false,
    canModerateMessages: false,
    canManageGameTypes: false,
  },
};

describe('Zielroute nach der Anmeldung (Pflichtenheft §5.2)', () => {
  it('führt freigeschaltete Konten ins Dashboard', () => {
    expect(landingPathForAccount(baseAccount)).toBe(DASHBOARD_HOME);
  });

  it('führt noch nicht freigeschaltete Konten auf den Wartebildschirm', () => {
    expect(landingPathForAccount({ ...baseAccount, awaitingApproval: true })).toBe(
      AUTH_ROUTES.pending,
    );
  });

  it('führt gesperrte Konten zurück zur Anmeldung – auch wenn sie noch warten', () => {
    expect(landingPathForAccount({ ...baseAccount, banned: true })).toBe(AUTH_ROUTES.login);
    expect(landingPathForAccount({ ...baseAccount, banned: true, awaitingApproval: true })).toBe(
      AUTH_ROUTES.login,
    );
  });

  it('entscheidet nicht anhand von Rollen oder Berechtigungen', () => {
    const guestWithRole: AccountDto = {
      ...baseAccount,
      roles: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Gast', isProtected: true }],
    };
    // Rolle „Gast", aber vom Backend freigeschaltet: das Feld gewinnt.
    expect(landingPathForAccount(guestWithRole)).toBe(DASHBOARD_HOME);

    const ownerAwaiting: AccountDto = { ...baseAccount, isOwner: true, awaitingApproval: true };
    expect(landingPathForAccount(ownerAwaiting)).toBe(AUTH_ROUTES.pending);
  });
});

describe('Zugehörigkeit zum Wartebildschirm', () => {
  it('gilt nur für wartende, nicht gesperrte Konten', () => {
    expect(belongsOnPendingScreen({ ...baseAccount, awaitingApproval: true })).toBe(true);
    expect(belongsOnPendingScreen(baseAccount)).toBe(false);
    expect(belongsOnPendingScreen({ ...baseAccount, awaitingApproval: true, banned: true })).toBe(
      false,
    );
  });
});
