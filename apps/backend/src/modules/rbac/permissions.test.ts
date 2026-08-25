import {
  type GameServerPermissions,
  PERMISSIONS,
  type Permission,
  type RolePermissions,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  anonymousActor,
  buildPermissionActor,
  computeGlobalPermissions,
  computePermissionFlags,
  computeRolePermissions,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  hasScopedPermission,
} from './permissions.js';

const nutzerRolle = {
  grantedPermissions: [
    'server.create',
    'server.view.own',
    'server.manage.own',
    'backup.manage.own',
  ] as Permission[],
};

const moderatorRolle = {
  grantedPermissions: ['message.moderate', 'server.view.own'] as Permission[],
};

/** Geschützte Systemrolle „Gast": keinerlei Permissions (Lastenheft §2). */
const gastRolle = { grantedPermissions: [] as Permission[] };

describe('Effektive Rechte (Pflichtenheft §8)', () => {
  it('Owner hat alle Permissions – auch ohne jede Rolle', () => {
    const actor = buildPermissionActor({ isOwner: true, roles: [] });

    expect(actor.isOwner).toBe(true);
    expect(actor.permissions.size).toBe(PERMISSIONS.length);

    for (const permission of PERMISSIONS) {
      expect(hasPermission(actor, permission)).toBe(true);
    }
  });

  it('Owner behält alle Permissions, selbst wenn ihm nur die Gast-Rolle zugewiesen ist', () => {
    const actor = buildPermissionActor({ isOwner: true, roles: [gastRolle] });

    expect(actor.permissions.size).toBe(PERMISSIONS.length);
    expect(hasPermission(actor, 'role.manage')).toBe(true);
  });

  it('Gast hat nichts', () => {
    const actor = buildPermissionActor({ isOwner: false, roles: [gastRolle] });

    expect(actor.permissions.size).toBe(0);

    for (const permission of PERMISSIONS) {
      expect(hasPermission(actor, permission)).toBe(false);
    }
  });

  it('Konto ganz ohne Rolle hat ebenfalls nichts', () => {
    const actor = buildPermissionActor({ isOwner: false, roles: [] });

    expect(actor.permissions.size).toBe(0);
  });

  it('mehrere Rollen vereinigen sich', () => {
    const actor = buildPermissionActor({
      isOwner: false,
      roles: [nutzerRolle, moderatorRolle],
    });

    expect([...actor.permissions].sort()).toEqual(
      [
        'server.create',
        'server.view.own',
        'server.manage.own',
        'backup.manage.own',
        'message.moderate',
      ].sort(),
    );
  });

  it('vereinigt doppelt vergebene Permissions nur einmal', () => {
    const actor = buildPermissionActor({
      isOwner: false,
      roles: [moderatorRolle, moderatorRolle],
    });

    expect(actor.permissions.size).toBe(2);
  });

  it('hasAnyPermission / hasAllPermissions werten die Vereinigung aus', () => {
    const actor = buildPermissionActor({ isOwner: false, roles: [nutzerRolle] });

    expect(hasAnyPermission(actor, ['role.manage', 'server.create'])).toBe(true);
    expect(hasAnyPermission(actor, ['role.manage', 'user.manage'])).toBe(false);
    expect(hasAllPermissions(actor, ['server.create', 'server.view.own'])).toBe(true);
    expect(hasAllPermissions(actor, ['server.create', 'server.view.any'])).toBe(false);
    expect(hasAnyPermission(actor, [])).toBe(false);
    expect(hasAllPermissions(actor, [])).toBe(true);
  });

  it('anonymousActor() hat keinerlei Rechte', () => {
    expect(anonymousActor().permissions.size).toBe(0);
  });
});

describe('Geltungsbereich own/any (Pflichtenheft §8)', () => {
  const eigentuemer = buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.manage.own'] }],
  });
  const admin = buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.manage.any'] }],
  });

  it('`.own` greift nur bei eigenen Ressourcen', () => {
    expect(hasScopedPermission(eigentuemer, 'server.manage', true)).toBe(true);
    expect(hasScopedPermission(eigentuemer, 'server.manage', false)).toBe(false);
  });

  it('`.any` greift bei jeder Ressource', () => {
    expect(hasScopedPermission(admin, 'server.manage', true)).toBe(true);
    expect(hasScopedPermission(admin, 'server.manage', false)).toBe(true);
  });

  it('Owner darf auch bei fremden Ressourcen', () => {
    const owner = buildPermissionActor({ isOwner: true, roles: [] });

    expect(hasScopedPermission(owner, 'server.delete', false)).toBe(true);
  });

  it('ohne passende Permission bleibt es verboten', () => {
    const gast = buildPermissionActor({ isOwner: false, roles: [gastRolle] });

    expect(hasScopedPermission(gast, 'backup.manage', true)).toBe(false);
  });
});

describe('permissions-Objekt für DTOs (Pflichtenheft §5.2)', () => {
  it('wertet alle Regelarten aus', () => {
    const actor = buildPermissionActor({
      isOwner: false,
      roles: [{ grantedPermissions: ['server.view.own', 'message.moderate'] }],
    });

    const flags = computePermissionFlags(actor, {
      immerErlaubt: true,
      nieErlaubt: false,
      einzelnePermission: 'message.moderate',
      eineVonMehreren: ['role.manage', 'message.moderate'],
      eigeneRessource: { scope: 'server.view', isOwn: true },
      fremdeRessource: { scope: 'server.view', isOwn: false },
    });

    expect(flags).toEqual({
      immerErlaubt: true,
      nieErlaubt: false,
      einzelnePermission: true,
      eineVonMehreren: true,
      eigeneRessource: true,
      fremdeRessource: false,
    });
  });

  it('lässt sich auf ein bestehendes DTO-Flags-Objekt anwenden (GameServerPermissions)', () => {
    const actor = buildPermissionActor({
      isOwner: false,
      roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
    });
    const isOwn = true;

    const permissions: GameServerPermissions = computePermissionFlags<keyof GameServerPermissions>(
      actor,
      {
        canView: { scope: 'server.view', isOwn },
        canViewAddress: { scope: 'server.view', isOwn },
        canStart: { scope: 'server.manage', isOwn },
        canStop: { scope: 'server.manage', isOwn },
        canRestart: { scope: 'server.manage', isOwn },
        canManageSettings: { scope: 'server.manage', isOwn },
        canDelete: { scope: 'server.delete', isOwn },
        canClone: 'server.create',
        canManageMembers: { scope: 'server.manage', isOwn },
        canManageBackups: { scope: 'backup.manage', isOwn },
        canManageFiles: { scope: 'server.manage', isOwn },
        canManageSchedules: { scope: 'server.manage', isOwn },
        canUseConsole: { scope: 'server.manage', isOwn },
      },
    );

    expect(permissions.canView).toBe(true);
    expect(permissions.canStart).toBe(true);
    // Ohne `server.delete.own` bleibt Löschen verboten, obwohl es der eigene Server ist.
    expect(permissions.canDelete).toBe(false);
    expect(permissions.canClone).toBe(false);
  });
});

describe('GlobalPermissions (Pflichtenheft §5.2, §8)', () => {
  it('sind für den Owner durchgehend wahr', () => {
    const permissions = computeGlobalPermissions(
      buildPermissionActor({ isOwner: true, roles: [] }),
    );

    expect(Object.values(permissions).every((flag) => flag === true)).toBe(true);
  });

  it('sind für den Gast durchgehend falsch', () => {
    const permissions = computeGlobalPermissions(
      buildPermissionActor({ isOwner: false, roles: [gastRolle] }),
    );

    expect(Object.values(permissions).some((flag) => flag === true)).toBe(false);
  });

  it('bilden die Vereinigung mehrerer Rollen ab', () => {
    const permissions = computeGlobalPermissions(
      buildPermissionActor({ isOwner: false, roles: [nutzerRolle, moderatorRolle] }),
    );

    expect(permissions.canCreateServer).toBe(true);
    expect(permissions.canModerateMessages).toBe(true);
    expect(permissions.canManageUsers).toBe(false);
    expect(permissions.canManageGameTypes).toBe(false);
  });

  it('erlaubt die Node-Ansicht auch, wer Nodes verwalten darf', () => {
    const permissions = computeGlobalPermissions(
      buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: ['node.manage'] }] }),
    );

    expect(permissions.canViewNodes).toBe(true);
    expect(permissions.canManageNodes).toBe(true);
  });
});

describe('permissions-Objekt einer Rolle', () => {
  const rollenverwalter = buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['role.manage'] }],
  });

  it('erlaubt Bearbeiten und Löschen bei einer normalen Rolle', () => {
    const permissions: RolePermissions = computeRolePermissions(rollenverwalter, {
      isProtected: false,
    });

    expect(permissions).toEqual({
      canView: true,
      canEdit: true,
      canDelete: true,
      canAssign: true,
    });
  });

  it('sperrt Bearbeiten und Löschen bei einer geschützten Systemrolle – auch für den Owner', () => {
    const owner = buildPermissionActor({ isOwner: true, roles: [] });
    const permissions = computeRolePermissions(owner, { isProtected: true });

    expect(permissions.canEdit).toBe(false);
    expect(permissions.canDelete).toBe(false);
    expect(permissions.canView).toBe(true);
    expect(permissions.canAssign).toBe(true);
  });

  it('lässt Nutzerverwalter Rollen sehen und zuweisen, aber nicht bearbeiten', () => {
    const nutzerverwalter = buildPermissionActor({
      isOwner: false,
      roles: [{ grantedPermissions: ['user.manage'] }],
    });
    const permissions = computeRolePermissions(nutzerverwalter, { isProtected: false });

    expect(permissions).toEqual({
      canView: true,
      canEdit: false,
      canDelete: false,
      canAssign: true,
    });
  });

  it('zeigt einem Gast gar nichts', () => {
    const gast = buildPermissionActor({ isOwner: false, roles: [gastRolle] });
    const permissions = computeRolePermissions(gast, { isProtected: false });

    expect(Object.values(permissions).some((flag) => flag === true)).toBe(false);
  });
});
