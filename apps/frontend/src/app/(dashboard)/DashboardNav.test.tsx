import { type AccountDto, type GlobalPermissions } from '@palantir/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_ENTRIES, DashboardNav, type PlannedEntry } from './DashboardNav';

/**
 * Seitenleiste – jeder Eintrag hat ein Ziel (Fundpunkt 155).
 *
 * `PlannedEntry.href` war optional; ein Eintrag ohne Ziel wurde als Schaltfläche
 * gezeichnet und meldete beim Antippen, in welchem Arbeitspaket er entsteht.
 * Seit der letzte Eintrag gebaut ist, war dieser Zweig unerreichbar – und ohne
 * das ebenfalls optionale `pending` meldete er wörtlich „entsteht im
 * Arbeitspaket undefined". Beides ist entfernt, `href` ist Pflicht.
 *
 * Geprüft wird das an drei Stellen: am Typ, an den gepflegten Listen und an dem,
 * was tatsächlich im DOM landet. Die Deckung mit `/admin` sichert daneben
 * `components/admin/AdminLanding.test.tsx`.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/servers',
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

/** Konto mit allen instanzweiten Rechten – zeigt jeden Eintrag beider Listen. */
function allmaechtig(): AccountDto {
  const alle = berechtigungen();
  for (const flag of Object.keys(alle) as (keyof GlobalPermissions)[]) alle[flag] = true;

  return {
    id: 'admin-1',
    displayName: 'Admina',
    username: 'admina',
    isOwner: true,
    banned: false,
    awaitingApproval: false,
    twoFactorEnabled: false,
    roles: [],
    authMethods: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: alle,
  };
}

describe('Seitenleiste – Ziel ist Pflicht (Fundpunkt 155)', () => {
  it('lässt einen Eintrag ohne Ziel nicht mehr zu', () => {
    // @ts-expect-error – `href` ist Pflicht; ein Eintrag ohne Ziel ist kein Eintrag.
    const ohneZiel: PlannedEntry = { key: 'irgendwas', label: 'Irgendwas', icon: 'grid' };

    expect(ohneZiel.key).toBe('irgendwas');
  });

  it('gibt jedem Eintrag der Administration eine Route', () => {
    for (const entry of ADMIN_ENTRIES) {
      expect(entry.href.startsWith('/admin')).toBe(true);
    }
  });

  it('zeichnet jeden sichtbaren Eintrag als Link, keinen als Schaltfläche', () => {
    render(<DashboardNav user={allmaechtig()} ownServers={[]} unreadMessages={0} />);

    const links = screen.getAllByRole('link');

    expect(links.length).toBeGreaterThanOrEqual(ADMIN_ENTRIES.length);
    for (const link of links) {
      expect(link.getAttribute('href')?.startsWith('/')).toBe(true);
    }
    // Der Hinweis-Zweig zeichnete ein `<button>`; ohne ihn gibt es keins mehr.
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('meldet nirgends mehr ein noch entstehendes Arbeitspaket', () => {
    render(<DashboardNav user={allmaechtig()} ownServers={[]} unreadMessages={0} />);

    expect(screen.queryByText(/entsteht im Arbeitspaket/)).toBeNull();
  });

  it('hebt den Eintrag der aktuellen Seite hervor', () => {
    render(<DashboardNav user={allmaechtig()} ownServers={[]} unreadMessages={0} />);

    const aktiv = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(aktiv).toHaveLength(1);
    expect(aktiv[0]?.getAttribute('href')).toBe('/servers');
  });
});
