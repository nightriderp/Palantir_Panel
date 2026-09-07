import {
  type AccountDto,
  type GlobalPermissions,
  type InstanceSettingsDto,
  type RegistrationRequestDto,
} from '@palantir/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { server as serverFixture } from '@/components/servers/testFixtures';
import { UsersView } from './UsersView';

/**
 * Nutzerverwaltung – Rückfragen und Rechte (Maßnahme W2-20).
 *
 * Deckt zwei Fundpunkte ab:
 *
 * - **frontend-lib-02** – „Passwort" setzte ohne jede Rückfrage zurück und
 *   beendete dabei alle Sitzungen des Kontos. Geprüft wird, dass der Aufruf
 *   erst nach einer Bestätigung geschieht, bei Abbruch gar nicht, und dass das
 *   Einmal-Passwort danach kopierbar ist.
 * - **spec-lastenheft-07** – „Server einsehen" hängt an `server.view.any`.
 *   Ohne dieses Recht zeigte der Dialog für jedes fremde Konto „besitzt keine
 *   Server"; jetzt erscheint die Schaltfläche erst gar nicht.
 */

const api = vi.hoisted(() => ({
  fetchRegistrationRequests: vi.fn(),
  fetchRoles: vi.fn(),
  fetchInstanceSettings: vi.fn(),
  fetchAllServers: vi.fn(),
  resetUserPassword: vi.fn(),
}));

const sitzung = vi.hoisted(() => ({ account: null as AccountDto | null }));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: sitzung.account, loading: false, setUser: () => undefined }),
}));

vi.mock('@/lib/api/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRegistrationRequests: api.fetchRegistrationRequests,
  fetchRoles: api.fetchRoles,
  fetchInstanceSettings: api.fetchInstanceSettings,
  fetchAllServers: api.fetchAllServers,
  resetUserPassword: api.resetUserPassword,
}));

/** Alle instanzweiten Flags aus – der strengste Fall, wie bei den Server-Tests. */
function berechtigungen(overrides: Partial<GlobalPermissions> = {}): GlobalPermissions {
  return {
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
    ...overrides,
  };
}

function konto(permissions: GlobalPermissions): AccountDto {
  return {
    id: 'admin-1',
    displayName: 'Admina',
    username: 'admina',
    isOwner: false,
    banned: false,
    awaitingApproval: false,
    twoFactorEnabled: false,
    roles: [],
    authMethods: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions,
  };
}

function eintrag(overrides: Partial<RegistrationRequestDto> = {}): RegistrationRequestDto {
  return {
    userId: 'user-1',
    displayName: 'Alex',
    status: 'approved',
    banned: false,
    profiles: [],
    roleNames: ['Nutzer'],
    roles: [{ id: 'role-1', name: 'Nutzer' }],
    serverCount: 1,
    registeredAt: '2026-08-02T10:00:00.000Z',
    permissions: { canView: true, canApprove: false, canBlock: true, canUnblock: false },
    ...overrides,
  };
}

const einstellungen: InstanceSettingsDto = {
  selfRegistrationEnabled: true,
  updatedAt: null,
  permissions: { canEdit: true },
};

function ok<T>(data: T) {
  return { success: true as const, data, error: null };
}

/** Rendert die Ansicht und wartet, bis die Nutzerliste steht. */
async function zeichne() {
  const ergebnis = render(
    <ToastProvider>
      <UsersView />
    </ToastProvider>,
  );
  await screen.findByText('Alex');
  return ergebnis;
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();

  api.fetchRegistrationRequests.mockResolvedValue(ok([eintrag()]));
  api.fetchRoles.mockResolvedValue(ok([]));
  api.fetchInstanceSettings.mockResolvedValue(ok(einstellungen));
  api.fetchAllServers.mockResolvedValue(ok([]));
  api.resetUserPassword.mockResolvedValue(ok({ temporaryPassword: 'Einmal-4711' }));

  sitzung.account = konto(berechtigungen({ canManageUsers: true, canViewAnyServer: true }));
});

afterEach(() => {
  Reflect.deleteProperty(globalThis.navigator, 'clipboard');
});

describe('UsersView – Passwort zurücksetzen (frontend-lib-02)', () => {
  it('fragt vor dem Zurücksetzen nach und nennt das Ende aller Sitzungen', async () => {
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Passwort' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Passwort von .*Alex.* zurücksetzen\?/ }));
    expect(within(dialog).getByText(/Alle laufenden Sitzungen des Kontos enden sofort/));
    expect(api.resetUserPassword).not.toHaveBeenCalled();
  });

  it('setzt beim Abbrechen nichts zurück', async () => {
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Passwort' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.resetUserPassword).not.toHaveBeenCalled();
  });

  it('setzt erst nach der Bestätigung zurück und zeigt das Einmal-Passwort', async () => {
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Passwort' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Zurücksetzen' }),
    );

    await waitFor(() => expect(api.resetUserPassword).toHaveBeenCalledWith('user-1'));
    expect(api.resetUserPassword).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Einmal-4711'));
  });

  it('legt das Einmal-Passwort auf Klick in die Zwischenablage', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Passwort' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Zurücksetzen' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Kopieren' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Einmal-4711'));
  });

  it('meldet ohne Zwischenablage einen Fehler, statt zu scheitern', async () => {
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Passwort' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Zurücksetzen' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Kopieren' }));

    expect(await screen.findByText('Kopieren nicht möglich.'));
    // Der Dialog bleibt stehen – das Passwort ist noch abschreibbar.
    expect(screen.getByText('Einmal-4711'));
  });
});

describe('UsersView – „Server einsehen" (spec-lastenheft-07)', () => {
  it('bietet „Server einsehen" an, wenn das Konto alle Server sehen darf', async () => {
    await zeichne();

    expect(screen.getByRole('button', { name: 'Server einsehen' }));
  });

  it('lässt „Server einsehen" ohne `canViewAnyServer` weg', async () => {
    sitzung.account = konto(berechtigungen({ canManageUsers: true }));
    await zeichne();

    expect(screen.queryByRole('button', { name: 'Server einsehen' })).toBeNull();
    // Die übrigen Aktionen der Nutzerverwaltung bleiben erreichbar.
    expect(screen.getByRole('button', { name: 'Kontingent' }));
  });

  it('zeigt die Server des Kontos und grenzt Mitgliedschaften ab', async () => {
    api.fetchAllServers.mockResolvedValue(
      ok([
        serverFixture({ id: 'srv-1', name: 'Welt', ownerId: 'user-1' }),
        serverFixture({ id: 'srv-2', name: 'Fremd', ownerId: 'user-2' }),
      ]),
    );
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Server einsehen' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Welt'));
    expect(within(dialog).queryByText('Fremd')).toBeNull();
    expect(within(dialog).getByText(/allein\s+Mitglied ist, erscheinen hier nicht/));
  });

  it('unterscheidet „keine eigenen Server" von „keiner davon sichtbar"', async () => {
    api.fetchRegistrationRequests.mockResolvedValue(ok([eintrag({ serverCount: 0 })]));
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Server einsehen' }));
    expect(
      await within(await screen.findByRole('dialog')).findByText(
        'Dieses Konto besitzt keine eigenen Server.',
      ),
    );
  });

  it('nennt die Zahl, wenn das Konto Server besitzt, aber keiner geladen wurde', async () => {
    api.fetchRegistrationRequests.mockResolvedValue(ok([eintrag({ serverCount: 3 })]));
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Server einsehen' }));
    expect(
      await within(await screen.findByRole('dialog')).findByText(
        /besitzt 3 Server, die dir hier nicht angezeigt werden können/,
      ),
    );
  });
});
