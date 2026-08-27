'use client';

import { usePathname } from 'next/navigation';
import { SideNavSection, type SideNavItem, useToast } from '@/components/shared';
import { type AccountDto } from '@palantir/contracts';

/**
 * Seitenleiste des eingeloggten Bereichs.
 *
 * **Zwischenstand:** Von den Ansichten aus STRUKTUR.md existiert bisher nur die
 * Serverübersicht (F3). Die übrigen Einträge stehen trotzdem hier, damit der
 * Aufbau dem Mockup entspricht – sie führen aber noch nirgendwo hin und melden
 * das beim Antippen, statt in eine 404-Seite zu laufen.
 *
 * **Für F4–F11:** Ein fertiges Arbeitspaket ändert an dieser Datei genau eine
 * Zeile – `pending` raus, `href` rein – und legt die Seite unter
 * `src/app/(dashboard)/<pfad>/page.tsx` an. Die ausführliche Anleitung samt der
 * Dinge, die dabei ausdrücklich **nicht** zu tun sind, steht unter „Navigation
 * im eingeloggten Bereich" in `components/shared/README.md` (Arbeitspaket R4,
 * „Gefundener Punkt" 48).
 *
 * Welche Einträge überhaupt erscheinen, entscheidet ausschließlich das
 * `permissions`-Objekt des Kontos (Pflichtenheft §5.2, §8).
 */

interface PlannedEntry {
  key: string;
  label: string;
  icon: SideNavItem['icon'];
  /** Route, sobald das zugehörige Arbeitspaket sie gebaut hat. */
  href?: string;
  /** Arbeitspaket, das den Eintrag fertigstellt – erscheint im Hinweis. */
  pending?: string;
  /** Nur zeigen, wenn dieses Flag am Konto gesetzt ist. */
  requires?: keyof AccountDto['permissions'];
}

const MAIN_ENTRIES: PlannedEntry[] = [
  { key: 'servers', label: 'Übersicht', icon: 'grid', href: '/servers' },
  { key: 'my-backups', label: 'Meine Backups', icon: 'database', pending: 'F4' },
  { key: 'messages', label: 'Nachrichten', icon: 'chat', pending: 'F5' },
  { key: 'notifications', label: 'Benachrichtigungen', icon: 'bell', href: '/notifications' },
  { key: 'nodes', label: 'Nodes', icon: 'server', href: '/nodes', requires: 'canViewNodes' },
  { key: 'arcade', label: 'Arcade', icon: 'gamepad', pending: 'F8' },
  { key: 'skins', label: 'Skins', icon: 'palette', pending: 'F9' },
];

const ADMIN_ENTRIES: PlannedEntry[] = [
  {
    key: 'admin-users',
    label: 'Nutzer',
    icon: 'users',
    pending: 'F10',
    requires: 'canManageUsers',
  },
  {
    key: 'admin-roles',
    label: 'Rollen',
    icon: 'shield',
    pending: 'F10',
    requires: 'canManageRoles',
  },
  {
    key: 'admin-audit',
    label: 'Audit-Log',
    icon: 'clipboard',
    pending: 'F10',
    requires: 'canViewAuditLog',
  },
  {
    key: 'admin-games',
    label: 'Spiele',
    icon: 'layers',
    pending: 'F11',
    requires: 'canManageGameTypes',
  },
];

export interface DashboardNavProps {
  user: AccountDto | null;
}

export function DashboardNav({ user }: DashboardNavProps) {
  const pathname = usePathname();
  const toast = useToast();

  function toItems(entries: PlannedEntry[]): SideNavItem[] {
    return entries
      .filter((entry) => !entry.requires || (user?.permissions[entry.requires] ?? false))
      .map((entry) => ({
        key: entry.key,
        label: entry.label,
        icon: entry.icon,
        href: entry.href,
        active: entry.href ? pathname.startsWith(entry.href) : false,
        onSelect: entry.href
          ? undefined
          : () =>
              toast.show(
                `„${entry.label}" entsteht im Arbeitspaket ${entry.pending} und ist noch nicht verfügbar.`,
              ),
      }));
  }

  const adminItems = toItems(ADMIN_ENTRIES);

  return (
    <>
      <SideNavSection items={toItems(MAIN_ENTRIES)} />
      {adminItems.length > 0 ? <SideNavSection title="Administration" items={adminItems} /> : null}
    </>
  );
}
