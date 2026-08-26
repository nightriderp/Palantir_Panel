/**
 * `permissions`-Objekte der Backup-Verwaltung (Pflichtenheft §5.2).
 *
 * Grundlage sind ausschließlich `backup.manage.own` und `backup.manage.any`
 * (Pflichtenheft §8). Die Auswertung des `.own`/`.any`-Paares liegt weiterhin
 * im RBAC-Modul (`hasScopedPermission`) – hier wird nur entschieden, was „eigen“
 * bei einem Backup bedeutet und welcher Zustand eine Aktion zusätzlich
 * ausschließt.
 */

import type {
  BackupOverviewPermissions,
  BackupPermissions,
  BackupSchedulePermissions,
  BackupStatus,
} from '@palantir/contracts';
import {
  type PermissionActor,
  computePermissionFlags,
  hasPermission,
  hasScopedPermission,
} from '../rbac/index.js';

/**
 * Gilt ein Server für diesen Nutzer als „eigen“?
 *
 * Neben dem Besitzer zählen die Mitverwalter (`ServerMember`, Pflichtenheft §6)
 * mit – Pflichtenheft §8 nennt für `.own` ausdrücklich „eigene (bzw. solche, bei
 * denen er Mitglied ist)“.
 */
export function isOwnServer(
  actorUserId: string | null,
  server: { readonly ownerId: string; readonly memberUserIds: readonly string[] },
): boolean {
  if (actorUserId === null) {
    return false;
  }

  return server.ownerId === actorUserId || server.memberUserIds.includes(actorUserId);
}

/** Darf der Aufrufer Backups dieses Servers verwalten? */
export function canManageBackupsOf(actor: PermissionActor, isOwn: boolean): boolean {
  return hasScopedPermission(actor, 'backup.manage', isOwn);
}

/**
 * `permissions`-Objekt eines Backups.
 *
 * Ein laufender Vorgang (`pending`/`running`) hat noch kein verwendbares
 * Archiv: Wiederherstellen und Herunterladen sind dann aus, und gelöscht wird
 * er ebenfalls nicht – das Abbrechen mitten im Lauf ließe eine halbe Datei auf
 * dem Homeserver zurück. Ein fehlgeschlagenes Backup lässt sich dagegen
 * löschen, sonst blieben Fehlversuche für immer in der Liste stehen.
 */
export function computeBackupPermissions(
  actor: PermissionActor,
  backup: { readonly status: BackupStatus },
  isOwn: boolean,
): BackupPermissions {
  const manage = canManageBackupsOf(actor, isOwn);
  const finished = backup.status === 'completed' || backup.status === 'failed';

  return computePermissionFlags<keyof BackupPermissions>(actor, {
    canView: manage,
    canRestore: manage && backup.status === 'completed',
    canDelete: manage && finished,
    canDownload: manage && backup.status === 'completed',
  });
}

/** `permissions`-Objekt des Backup-Zeitplans eines Servers. */
export function computeBackupSchedulePermissions(
  actor: PermissionActor,
  isOwn: boolean,
): BackupSchedulePermissions {
  const manage = canManageBackupsOf(actor, isOwn);

  return computePermissionFlags<keyof BackupSchedulePermissions>(actor, {
    canView: manage,
    canEdit: manage,
  });
}

/** `permissions`-Objekt der globalen Übersicht (Lastenheft §3.7). */
export function computeBackupOverviewPermissions(
  actor: PermissionActor,
): BackupOverviewPermissions {
  return computePermissionFlags<keyof BackupOverviewPermissions>(actor, {
    canManageAny: hasPermission(actor, 'backup.manage.any'),
  });
}
