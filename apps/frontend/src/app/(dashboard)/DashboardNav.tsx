'use client';

import { usePathname } from 'next/navigation';
import {
  SideNavSection,
  SideNavServerSection,
  type SideNavItem,
  type SideNavServerItem,
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
 * **Jeder Eintrag hat ein Ziel** (Fundpunkt 155, zweite Hälfte von
 * `frontend-app-06`): `href` ist Pflicht. Bis dahin gab es daneben ein
 * optionales `pending` und einen Hinweis-Zweig („entsteht im Arbeitspaket …"),
 * der seit dem letzten fertiggestellten Eintrag unerreichbar war und ohne
 * `pending` wörtlich „entsteht im Arbeitspaket undefined" meldete. Statt eine
 * tote Meldung zu pflegen, verlangt der Typ jetzt das Ziel – ein Eintrag ohne
 * gebaute Seite kommt gar nicht erst in die Liste.
 *
 * Eine neue Seite gehört unter `src/app/(dashboard)/<pfad>/page.tsx`; die
 * Anleitung samt der Dinge, die dabei ausdrücklich **nicht** zu tun sind, steht
 * unter „Navigation im eingeloggten Bereich" in `components/shared/README.md`
 * (Arbeitspaket R4, „Gefundener Punkt" 48).
 *
 * Welche Einträge überhaupt erscheinen, entscheidet ausschließlich das
 * `permissions`-Objekt des Kontos (Pflichtenheft §5.2, §8).
 */

export interface PlannedEntry {
  key: string;
  label: string;
  icon: SideNavItem['icon'];
  /** Route des Eintrags – Pflicht, siehe oben (Fundpunkt 155). */
  href: string;
  /** Nur zeigen, wenn dieses Flag am Konto gesetzt ist. */
  requires?: keyof AccountDto['permissions'];
}

/**
 * Hauptnavigation, nach Aufgaben geordnet (Betreiber-Wunsch 20.09.2026).
 *
 * Erst die Server: ansehen, anlegen, sichern. Dann das Eigene: Skins. Dann
 * das, was hereinkommt – Nachrichten und Benachrichtigungen stehen
 * nebeneinander, weil beides Posteingänge sind und man sie in einem Zug
 * durchsieht. Arcade als Zeitvertreib danach, Nodes zuletzt: Sie sind
 * Betriebssache und nur mit Recht überhaupt sichtbar.
 *
 * Abweichung vom Zuruf: „Meine Backups" steht hier oben beim Server-Block
 * statt weiter unten, und die beiden Posteingänge sind nicht durch Arcade
 * getrennt. Wer eine andere Reihenfolge will, ändert diese Liste – die
 * Seitenleiste zeigt sie genau so, wie sie hier steht.
 */
const MAIN_ENTRIES: PlannedEntry[] = [
  { key: 'servers', label: 'Übersicht', icon: 'grid', href: '/servers' },
  {
    key: 'server-new',
    label: 'Server erstellen',
    icon: 'plus',
    href: '/servers/neu',
    requires: 'canCreateServer',
  },
  { key: 'my-backups', label: 'Meine Backups', icon: 'database', href: '/my-backups' },
  { key: 'skins', label: 'Skins', icon: 'palette', href: '/skins' },
  { key: 'messages', label: 'Nachrichten', icon: 'chat', href: '/messages' },
  { key: 'notifications', label: 'Benachrichtigungen', icon: 'bell', href: '/notifications' },
  { key: 'arcade', label: 'Arcade', icon: 'gamepad', href: '/arcade' },
  { key: 'achievements', label: 'Erfolge', icon: 'medal', href: '/erfolge' },
  // Die Einweisung steht bewusst ganz hinten und nicht oben: Wer das Panel
  // kennt, soll nicht jeden Tag an ihr vorbeiscrollen. Ohne `requires` – sie
  // erklärt jedem Konto das, was es sehen darf, und lässt den Rest weg
  // (`components/tutorial/inhalt.ts`).
  { key: 'tutorial', label: 'Tutorial', icon: 'cap', href: '/tutorial' },
  { key: 'nodes', label: 'Nodes', icon: 'server', href: '/nodes', requires: 'canViewNodes' },
];

/**
 * Administration, in fünf Blöcken (Betreiber-Wunsch 20.09.2026).
 *
 * Die Reihenfolge des Mockups war über die Zeit gewachsen: Sticker zwischen
 * Templates und Schriften, Nodes zwischen Backups und Node-Platz, das
 * Audit-Log mittendrin. Jetzt stehen zusammen, was man zusammen tut:
 *
 * 1. **Menschen** – Nutzer, Rollen, Anfragen, Moderation
 * 2. **Erscheinung** – Templates, Schriften, Sticker, Arcade-Musik
 * 3. **Mitteilungen** – Ankündigungen, Benachrichtigungs-Regeln
 * 4. **Betrieb** – Nodes, Node-Platz, Backups, Adressen
 * 5. **Nachweis** – Audit-Log, ganz zuletzt: Man geht dorthin, wenn etwas
 *    passiert ist, nicht im Tagesgeschäft.
 *
 * Ohne Überschriften, nur als Reihenfolge – eine Seitenleiste mit fünf
 * Zwischentiteln wäre länger als die Liste selbst.
 *
 * **Exportiert, weil `/admin` dieselbe Liste braucht** (Fundpunkt
 * frontend-app-04): Die Einstiegsseite `AdminLanding` leitet auf den ersten
 * Bereich weiter, für den das Konto berechtigt ist. Solange sie eine zweite,
 * von Hand gepflegte Liste führte, fehlten dort `canManageNodes` und
 * `canManageGameTypes` – die Seitenleiste zeigte „Nodes", `/admin` meldete
 * „Kein Zugriff auf den Admin-Bereich". Eine Quelle, kein Abgleich von Hand.
 */
export const ADMIN_ENTRIES: PlannedEntry[] = [
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
    key: 'admin-requests',
    label: 'Anfragen',
    icon: 'inbox',
    href: '/admin/requests',
    requires: 'canManageUsers',
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
    // Schriften der Oberfläche (S-3). Neben „Nutzer" und „Rollen", weil die
    // Auswahl in den Instanz-Einstellungen liegt und dieselbe Berechtigung
    // verlangt wie diese (`user.manage`).
    key: 'admin-schriften',
    label: 'Schriften',
    icon: 'palette',
    href: '/admin/schriften',
    requires: 'canManageUsers',
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
    key: 'admin-announcements',
    label: 'Ankündigungen',
    icon: 'send',
    href: '/admin/announcements',
    requires: 'canManageNotifications',
  },
  {
    key: 'admin-notifications',
    label: 'Benachrichtigungs-Regeln',
    icon: 'bell',
    href: '/admin/notifications',
    requires: 'canManageNotifications',
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
    requires: 'canManageNodes',
  },
  {
    key: 'admin-backups',
    label: 'Backups',
    icon: 'database',
    href: '/admin/backups',
    requires: 'canManageAnyBackup',
  },
  {
    key: 'admin-adressen',
    label: 'Adressen',
    icon: 'key',
    href: '/admin/addresses',
    requires: 'canManageAddresses',
  },
  {
    key: 'admin-audit',
    label: 'Audit-Log',
    icon: 'clipboard',
    href: '/admin/audit',
    requires: 'canViewAuditLog',
  },
];

/**
 * Einträge, die dieses Konto sehen darf.
 *
 * Bewusst exportiert und nicht in der Komponente versteckt: `/admin` entscheidet
 * mit derselben Regel, wohin es weiterleitet (Fundpunkt frontend-app-04). Ein
 * Eintrag ohne `requires` ist für jedes eingeloggte Konto sichtbar; sonst
 * entscheidet allein das genannte Flag aus `AccountDto.permissions`
 * (Pflichtenheft §5.2, §8) – nie eine aus Rollen hergeleitete Prüfung.
 */
export function visibleEntries(
  entries: readonly PlannedEntry[],
  user: AccountDto | null,
): PlannedEntry[] {
  return entries.filter((entry) => !entry.requires || (user?.permissions[entry.requires] ?? false));
}

export interface DashboardNavProps {
  user: AccountDto | null;
  /** Eigene Server für die Gruppe „Deine Server" unter der Hauptnavigation. */
  ownServers: readonly SidebarServer[];
  /** Ungelesene Nachrichten insgesamt – Zähler am Eintrag „Nachrichten". */
  unreadMessages: number;
}

export function DashboardNav({ user, ownServers, unreadMessages }: DashboardNavProps) {
  const pathname = usePathname();

  const mainEntries = visibleEntries(MAIN_ENTRIES, user);
  const adminEntries = visibleEntries(ADMIN_ENTRIES, user);

  const serverHrefs = ownServers.map((server) => `/servers/${server.id}`);
  const active = activeNavHref(pathname, [
    ...[...mainEntries, ...adminEntries].map((entry) => entry.href),
    ...serverHrefs,
  ]);

  function toItems(entries: PlannedEntry[]): SideNavItem[] {
    return entries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      icon: entry.icon,
      href: entry.href,
      active: entry.href === active,
      badgeCount: entry.key === 'messages' ? unreadMessages : undefined,
      // Ziel des Rundgangs; welche Stationen es gibt, steht in
      // `components/tutorial/rundgangSchritte.ts`.
      tourId: `nav-${entry.key}`,
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
