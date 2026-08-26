import { type GameServerPermissions } from '@palantir/contracts';
import { type TabItem } from '@/components/shared';

/**
 * Reiter der Server-Detailansicht (Lastenheft §3.3).
 *
 * Welche Reiter bedienbar sind, ergibt sich **ausschließlich** aus dem
 * `permissions`-Objekt des DTO (Pflichtenheft §5.2). Gesperrte Reiter bleiben
 * sichtbar und tragen eine Begründung – so ist erkennbar, dass es die Ansicht
 * gibt, nur eben nicht für dieses Konto. Hier wird nichts aus Rollen abgeleitet.
 */

export const SERVER_TAB_KEYS = [
  'overview',
  'console',
  'files',
  'backups',
  'tasks',
  'settings',
] as const;

export type ServerTabKey = (typeof SERVER_TAB_KEYS)[number];

const LOCK_REASON = 'Für deine Rolle nicht freigegeben.';

const TAB_LABELS: Record<ServerTabKey, string> = {
  overview: 'Übersicht',
  console: 'Konsole',
  files: 'Dateien',
  backups: 'Backups',
  tasks: 'Aufgaben',
  settings: 'Einstellungen',
};

/** Welches Flag gibt den jeweiligen Reiter frei? */
function isUnlocked(key: ServerTabKey, permissions: GameServerPermissions): boolean {
  switch (key) {
    case 'overview':
      return permissions.canView;
    case 'console':
      return permissions.canUseConsole;
    case 'files':
      return permissions.canManageFiles;
    case 'backups':
      return permissions.canManageBackups;
    case 'tasks':
      return permissions.canManageSchedules;
    case 'settings':
      // Der Reiter bündelt Einstellungen, Mitglieder, Klonen, Export und
      // Löschen – eines davon genügt, um ihn zu öffnen.
      return (
        permissions.canManageSettings ||
        permissions.canManageMembers ||
        permissions.canClone ||
        permissions.canDelete
      );
  }
}

/** Reiterleiste für die Detailansicht aufbauen. */
export function buildServerTabs(permissions: GameServerPermissions): TabItem<ServerTabKey>[] {
  return SERVER_TAB_KEYS.map((key) => {
    const unlocked = isUnlocked(key, permissions);
    return {
      key,
      label: TAB_LABELS[key],
      locked: !unlocked,
      lockedReason: unlocked ? undefined : LOCK_REASON,
    };
  });
}

/**
 * Den tatsächlich anzuzeigenden Reiter bestimmen.
 *
 * Ist der gewünschte Reiter gesperrt – etwa weil die Adresse aus einem
 * Lesezeichen kommt oder eine Berechtigung entzogen wurde –, wird auf den
 * ersten offenen ausgewichen. `null` heißt: kein einziger Reiter ist offen.
 */
export function resolveServerTab(
  requested: string | null | undefined,
  tabs: readonly TabItem<ServerTabKey>[],
): ServerTabKey | null {
  const match = tabs.find((tab) => tab.key === requested);
  if (match && !match.locked) return match.key;

  return tabs.find((tab) => !tab.locked)?.key ?? null;
}

/** Ist der Wert ein bekannter Reiter-Schlüssel? Prüft Werte aus der Adresszeile. */
export function isServerTabKey(value: string): value is ServerTabKey {
  return (SERVER_TAB_KEYS as readonly string[]).includes(value);
}
