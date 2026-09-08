import { type AccountDto, type GlobalPermissions } from '@palantir/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ENTRIES, DashboardNav } from '@/app/(dashboard)/DashboardNav';
import { AdminLanding } from './AdminLanding';

/**
 * Einstieg `/admin` – Fundpunkt frontend-app-04.
 *
 * `AdminLanding` führte eine zweite, von Hand gepflegte Liste der Admin-Bereiche,
 * in der `canManageNodes` und `canManageGameTypes` fehlten. Ein Konto mit nur
 * einem dieser Rechte sah in der Seitenleiste einen Eintrag, bekam auf `/admin`
 * aber „Kein Zugriff". Die Tests sichern beides: dass jedes Admin-Flag ein Ziel
 * hat und dass dieses Ziel dasselbe ist, das die Seitenleiste anbietet.
 *
 * Seit Fundpunkt 155 braucht die Seitenleiste keinen `ToastProvider` mehr: Der
 * Hinweis-Zweig für Einträge ohne Ziel ist entfernt, jeder Eintrag ist ein Link.
 */

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const sitzung = vi.hoisted(() => ({ account: null as AccountDto | null, loading: false }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({
    user: sitzung.account,
    loading: sitzung.loading,
    setUser: () => undefined,
  }),
}));

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

/** Alle Flags, an denen ein Eintrag der Administration hängt – aus der Liste selbst. */
const ADMIN_FLAGS = [
  ...new Set(ADMIN_ENTRIES.flatMap((entry) => (entry.requires ? [entry.requires] : []))),
];

/** Konto, dem genau ein einziges Admin-Recht zusteht. */
function nurMit(flag: keyof GlobalPermissions): AccountDto {
  const alle = berechtigungen();
  alle[flag] = true;
  return konto(alle);
}

beforeEach(() => {
  router.replace.mockReset();
  router.push.mockReset();
  sitzung.loading = false;
  sitzung.account = null;
});

describe('AdminLanding – jedes Admin-Flag hat ein Ziel (frontend-app-04)', () => {
  it('öffnet mit `canManageNodes` die Node-Verwaltung statt „Kein Zugriff"', () => {
    sitzung.account = konto(berechtigungen({ canManageNodes: true }));
    render(<AdminLanding />);

    expect(router.replace).toHaveBeenCalledWith('/admin/nodes');
    expect(screen.queryByText('Kein Zugriff')).toBeNull();
  });

  it('öffnet mit `canManageGameTypes` den ersten Spieltypen-Bereich', () => {
    sitzung.account = konto(berechtigungen({ canManageGameTypes: true }));
    render(<AdminLanding />);

    expect(router.replace).toHaveBeenCalledWith('/admin/templates');
    expect(screen.queryByText('Kein Zugriff')).toBeNull();
  });

  it.each(ADMIN_FLAGS)('findet auch mit nur „%s" einen Bereich', (flag) => {
    sitzung.account = nurMit(flag);
    render(<AdminLanding />);

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Kein Zugriff')).toBeNull();
  });

  it('zeigt ohne jedes Admin-Recht den Zugriffshinweis und leitet nicht um', () => {
    sitzung.account = konto(berechtigungen({ canCreateServer: true }));
    render(<AdminLanding />);

    expect(screen.getByText('Kein Zugriff'));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('wartet, solange das Konto noch geladen wird', () => {
    sitzung.loading = true;
    render(<AdminLanding />);

    expect(screen.getByRole('status'));
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('AdminLanding und Seitenleiste stimmen überein (frontend-app-04)', () => {
  /** Die Administrations-Gruppe der Seitenleiste, gerendert für dieses Konto. */
  function seitenleiste(account: AccountDto): string[] {
    render(<DashboardNav user={account} ownServers={[]} unreadMessages={0} />);

    return screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/admin'));
  }

  it.each(ADMIN_FLAGS)(
    'leitet mit nur „%s" auf genau den Eintrag, den die Seitenleiste zuerst zeigt',
    (flag) => {
      const account = nurMit(flag);
      sitzung.account = account;

      const links = seitenleiste(account);
      expect(links.length).toBeGreaterThan(0);

      render(<AdminLanding />);
      expect(router.replace).toHaveBeenCalledWith(links[0]);
    },
  );

  it('zeigt keine Administrations-Gruppe, wenn `/admin` auch nichts anzubieten hat', () => {
    const account = konto(berechtigungen({ canCreateServer: true }));
    sitzung.account = account;

    expect(seitenleiste(account)).toEqual([]);

    render(<AdminLanding />);
    expect(screen.getByText('Kein Zugriff'));
  });
});
