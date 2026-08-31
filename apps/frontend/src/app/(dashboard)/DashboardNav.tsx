'use client';

import { usePathname } from 'next/navigation';
import {
  SideNavSection,
  SideNavServerSection,
  type SideNavItem,
  type SideNavServerItem,
  useToast,
} from '@/components/shared';
import { type AccountDto } from '@palantir/contracts';
import { activeNavHref, type SidebarServer } from './shellSummary';

/**
 * Seitenleiste des eingeloggten Bereichs.
 *
 * Reihenfolge und Zusammensetzung folgen dem Mockup („Abgleich" 1.3, 1.5, 1.6):
 * Übersicht, Nachrichten, Skins, Benachrichtigungen, Nodes, Server erstellen,
 * Meine Backups, Arcade – darunter die eigenen Server als Sprungziele und
 * zuletzt die Administration.
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
  { key: 'messages', label: 'Nachrichten', icon: 'chat', href: '/messages' },
  { key: 'skins', label: 'Skins', icon: 'palette', href: '/skins' },
  { key: 'notifications', label: 'Benachrichtigungen', icon: 'bell', href: '/notifications' },
  { key: 'nodes', label: 'Nodes', icon: 'server', href: '/nodes', requires: 'canViewNodes' },
  {
    key: 'server-new',
    label: 'Server erstellen',
    icon: 'plus',
    href: '/servers/neu',
    requires: 'canCreateServer',
  },
  { key: 'my-backups', label: 'Meine Backups', icon: 'database', href: '/my-backups' },
  { key: 'arcade', label: 'Arcade', icon: 'gamepad', href: '/arcade' },
];

/**
 * Administration in der Reihenfolge des Mockups.
 *
 * Drei Einträge kennt das Mockup nicht – **Moderation**, **Ankündigungen** und
 * **Nodes**. Sie stehen deshalb nicht am Ende, sondern jeweils neben dem
 * Eintrag, zu dem sie fachlich gehören: Moderation zu Nutzer und Rollen,
 * Ankündigungen zu den Benachrichtigungs-Regeln, Nodes zum Node-Platz.
 */
const ADMIN_ENTRIES: PlannedEntry[] = [
  {
    key: 'admin-users',
    label: 'Nutzer',
    icon: 'users',
    href: '/admin/users',
    requires: 'canManageUsers',
  },
  {
    key: 'admin-roles',
    label: 'Rollen',
    icon: 'shield',
    href: '/admin/roles',
    requires: 'canManageRoles',
  },
  {
    key: 'admin-moderation',
    label: 'Moderation',
    icon: 'chat',
    href: '/admin/moderation',
    requires: 'canModerateMessages',
  },
  {
    key: 'admin-templates',
    label: 'Templates',
    icon: 'layers',
    href: '/admin/templates',
    requires: 'canManageGameTypes',
  },
  {
    key: 'admin-bilder',
    label: 'Bilder',
    icon: 'image',
    href: '/admin/bilder',
    requires: 'canManageGameTypes',
  },
  {
    key: 'admin-sticker',
    label: 'Sticker',
    icon: 'smile',
    href: '/admin/sticker',
    requires: 'canManageGameTypes',
  },
  {
    key: 'admin-arcade-musik',
    label: 'Arcade-Musik',
    icon: 'gamepad',
    href: '/admin/arcade-musik',
    requires: 'canManageGameTypes',
  },
  {
    key: 'admin-notifications',
    label: 'Benachrichtigungs-Regeln',
    icon: 'bell',
    href: '/admin/notifications',
    requires: 'canManageNotifications',
  },
  {
    key: 'admin-announcements',
    label: 'Ankündigungen',
    icon: 'send',
    href: '/admin/announcements',
    requires: 'canManageNotifications',
  },
  {
    key: 'admin-requests',
    label: 'Anfragen',
    icon: 'inbox',
    href: '/admin/requests',
    requires: 'canManageUsers',
  },
  {
    key: 'admin-audit',
    label: 'Audit-Log',
    icon: 'clipboard',
    href: '/admin/audit',
    requires: 'canViewAuditLog',
  },
  {
    key: 'admin-backups',
    label: 'Backups',
    icon: 'database',
    href: '/admin/backups',
    requires: 'canManageAnyBackup',
  },
  {
    key: 'admin-nodes',
    label: 'Nodes',
    icon: 'server',
    href: '/admin/nodes',
    requires: 'canManageNodes',
  },
  {
    key: 'admin-node-platz',
    label: 'Node-Platz',
    icon: 'database',
    href: '/admin/storage',
    requires: 'canViewNodes',
  },
  {
    key: 'admin-adressen',
    label: 'Adressen',
    icon: 'key',
    href: '/admin/addresses',
    requires: 'canManageAddresses',
  },
];

export interface DashboardNavProps {
  user: AccountDto | null;
  /** Eigene Server für die Gruppe „Deine Server" unter der Hauptnavigation. */
  ownServers: readonly SidebarServer[];
  /** Ungelesene Nachrichten insgesamt – Zähler am Eintrag „Nachrichten". */
  unreadMessages: number;
}

export function DashboardNav({ user, ownServers, unreadMessages }: DashboardNavProps) {
  const pathname = usePathname();
  const toast = useToast();

  function visible(entries: PlannedEntry[]): PlannedEntry[] {
    return entries.filter(
      (entry) => !entry.requires || (user?.permissions[entry.requires] ?? false),
    );
  }

  const mainEntries = visible(MAIN_ENTRIES);
  const adminEntries = visible(ADMIN_ENTRIES);

  const serverHrefs = ownServers.map((server) => `/servers/${server.id}`);
  const active = activeNavHref(pathname, [
    ...[...mainEntries, ...adminEntries].flatMap((entry) => (entry.href ? [entry.href] : [])),
    ...serverHrefs,
  ]);

  function toItems(entries: PlannedEntry[]): SideNavItem[] {
    return entries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      icon: entry.icon,
      href: entry.href,
      active: entry.href !== undefined && entry.href === active,
      badgeCount: entry.key === 'messages' ? unreadMessages : undefined,
      onSelect: entry.href
        ? undefined
        : () =>
            toast.show(
              `„${entry.label}" entsteht im Arbeitspaket ${entry.pending} und ist noch nicht verfügbar.`,
            ),
    }));
  }

  const serverItems: SideNavServerItem[] = ownServers.map((server) => ({
    id: server.id,
    name: server.name,
    initials: server.initials,
    status: server.status,
    href: `/servers/${server.id}`,
    active: `/servers/${server.id}` === active,
  }));

  return (
    <>
      <SideNavSection items={toItems(mainEntries)} />
      <SideNavServerSection title="Deine Server" items={serverItems} />
      {adminEntries.length > 0 ? (
        <SideNavSection title="Administration" items={toItems(adminEntries)} />
      ) : null}
    </>
  );
}
