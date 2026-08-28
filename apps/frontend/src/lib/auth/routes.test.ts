import { type AccountDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';

import {
  AUTH_ROUTES,
  DASHBOARD_HOME,
  belongsOnPendingScreen,
  gateRedirect,
  landingPathForAccount,
  sessionStateFromEnvelope,
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

describe('gateRedirect (Zugriffssperre)', () => {
  const anon = { authed: false, awaiting: false };
  const gast = { authed: true, awaiting: true };
  const nutzer = { authed: true, awaiting: false };

  it('leitet nicht angemeldete Besucher von geschützten Seiten zur Anmeldung', () => {
    expect(gateRedirect('/servers', anon)).toBe(AUTH_ROUTES.login);
    expect(gateRedirect('/admin', anon)).toBe(AUTH_ROUTES.login);
    expect(gateRedirect('/nodes', anon)).toBe(AUTH_ROUTES.login);
    expect(gateRedirect('/', anon)).toBe(AUTH_ROUTES.login);
  });

  it('lässt nicht angemeldete Besucher auf den öffentlichen Seiten', () => {
    expect(gateRedirect('/login', anon)).toBeNull();
    expect(gateRedirect('/register', anon)).toBeNull();
    expect(gateRedirect('/pending', anon)).toBeNull();
  });

  it('schickt ein noch nicht freigeschaltetes Konto ausschließlich zum Wartebildschirm', () => {
    expect(gateRedirect('/servers', gast)).toBe(AUTH_ROUTES.pending);
    expect(gateRedirect('/admin', gast)).toBe(AUTH_ROUTES.pending);
    expect(gateRedirect('/login', gast)).toBe(AUTH_ROUTES.pending);
    expect(gateRedirect('/pending', gast)).toBeNull();
  });

  it('führt ein freigeschaltetes Konto von Anmelde-, Warte- und Wurzelseite zur Übersicht', () => {
    expect(gateRedirect('/login', nutzer)).toBe(DASHBOARD_HOME);
    expect(gateRedirect('/register', nutzer)).toBe(DASHBOARD_HOME);
    expect(gateRedirect('/pending', nutzer)).toBe(DASHBOARD_HOME);
    expect(gateRedirect('/', nutzer)).toBe(DASHBOARD_HOME);
  });

  it('lässt ein freigeschaltetes Konto auf geschützten Seiten', () => {
    expect(gateRedirect('/servers', nutzer)).toBeNull();
    expect(gateRedirect('/admin', nutzer)).toBeNull();
    expect(gateRedirect('/messages', nutzer)).toBeNull();
  });
});

describe('sessionStateFromEnvelope', () => {
  it('liest awaitingApproval aus data.account (Hülle ok({ account }))', () => {
    expect(
      sessionStateFromEnvelope({ success: true, data: { account: { awaitingApproval: true } } }),
    ).toEqual({ authed: true, awaiting: true });

    expect(
      sessionStateFromEnvelope({ success: true, data: { account: { awaitingApproval: false } } }),
    ).toEqual({ authed: true, awaiting: false });
  });

  it('behandelt einen fehlenden oder ungültigen Envelope als nicht angemeldet', () => {
    // Genau der frühere Fehler: awaitingApproval liegt NICHT direkt auf data.
    expect(sessionStateFromEnvelope({ success: true, data: { awaitingApproval: true } })).toEqual({
      authed: false,
      awaiting: false,
    });
    expect(sessionStateFromEnvelope(null)).toEqual({ authed: false, awaiting: false });
    expect(sessionStateFromEnvelope({ success: false })).toEqual({
      authed: false,
      awaiting: false,
    });
  });

  it('markiert eine 200-Antwort ohne Session-Envelope nicht als angemeldet', () => {
    // Etwa eine Fehlerseite eines vorgelagerten Proxys mit HTTP 200.
    expect(sessionStateFromEnvelope({ irgendwas: 'html' })).toEqual({
      authed: false,
      awaiting: false,
    });
  });
});
