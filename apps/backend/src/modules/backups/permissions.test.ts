import { type BackupStatus, type Permission } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type PermissionActor, buildPermissionActor } from '../rbac/index.js';
import {
  computeBackupOverviewPermissions,
  computeBackupPermissions,
  computeBackupSchedulePermissions,
  isOwnServer,
} from './permissions.js';

function actorMit(...permissions: Permission[]): PermissionActor {
  return buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: permissions }] });
}

const owner = buildPermissionActor({ isOwner: true, roles: [] });

describe('„Eigen“ bei einem Server (Pflichtenheft §8)', () => {
  const server = { ownerId: 'u-besitzer', memberUserIds: ['u-mitglied'] };

  it('zählt Besitzer und Mitverwalter', () => {
    expect(isOwnServer('u-besitzer', server)).toBe(true);
    expect(isOwnServer('u-mitglied', server)).toBe(true);
    expect(isOwnServer('u-fremd', server)).toBe(false);
  });

  it('zählt einen nicht angemeldeten Aufrufer nie als eigen', () => {
    expect(isOwnServer(null, server)).toBe(false);
  });
});

describe('permissions-Objekt eines Backups (Pflichtenheft §5.2)', () => {
  it('gibt ohne Backup-Recht gar nichts frei', () => {
    const flags = computeBackupPermissions(
      actorMit('server.manage.own'),
      { status: 'completed' },
      true,
    );

    expect(flags).toEqual({
      canView: false,
      canRestore: false,
      canDelete: false,
      canDownload: false,
    });
  });

  it('gibt bei backup.manage.own nur eigene Backups frei', () => {
    const actor = actorMit('backup.manage.own');

    expect(computeBackupPermissions(actor, { status: 'completed' }, true).canView).toBe(true);
    expect(computeBackupPermissions(actor, { status: 'completed' }, false).canView).toBe(false);
  });

  it('gibt bei backup.manage.any auch fremde Backups frei', () => {
    const flags = computeBackupPermissions(
      actorMit('backup.manage.any'),
      { status: 'completed' },
      false,
    );

    expect(flags.canView).toBe(true);
    expect(flags.canRestore).toBe(true);
  });

  it('gibt dem Owner auch ohne Rolle alles frei (Lastenheft §2)', () => {
    expect(computeBackupPermissions(owner, { status: 'completed' }, false).canDownload).toBe(true);
  });

  it.each<[BackupStatus, boolean, boolean, boolean]>([
    // Zustand, canRestore, canDownload, canDelete
    ['pending', false, false, false],
    ['running', false, false, false],
    ['completed', true, true, true],
    ['failed', false, false, true],
  ])('sperrt bei Zustand %s die unpassenden Aktionen', (status, restore, download, remove) => {
    const flags = computeBackupPermissions(actorMit('backup.manage.own'), { status }, true);

    expect(flags.canRestore).toBe(restore);
    expect(flags.canDownload).toBe(download);
    // Ein Fehlversuch bleibt löschbar, sonst stünde er für immer in der Liste;
    // ein laufender Vorgang nicht, sonst bliebe eine halbe Datei zurück.
    expect(flags.canDelete).toBe(remove);
  });
});

describe('permissions-Objekte von Zeitplan und Übersicht', () => {
  it('bindet den Zeitplan an dasselbe Recht wie das Backup', () => {
    expect(computeBackupSchedulePermissions(actorMit('backup.manage.own'), true)).toEqual({
      canView: true,
      canEdit: true,
    });
    expect(computeBackupSchedulePermissions(actorMit('backup.manage.own'), false)).toEqual({
      canView: false,
      canEdit: false,
    });
  });

  it('meldet die globale Verwaltung nur bei backup.manage.any', () => {
    expect(computeBackupOverviewPermissions(actorMit('backup.manage.own')).canManageAny).toBe(
      false,
    );
    expect(computeBackupOverviewPermissions(actorMit('backup.manage.any')).canManageAny).toBe(true);
    expect(computeBackupOverviewPermissions(owner).canManageAny).toBe(true);
  });
});
