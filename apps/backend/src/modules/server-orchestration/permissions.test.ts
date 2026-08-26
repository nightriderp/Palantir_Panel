/**
 * Tests des `permissions`-Objekts eines Gameservers (Pflichtenheft §5.2, §8).
 *
 * Der interessante Teil ist das Zusammenspiel der beiden Achsen: globale Rolle
 * und Mitgliedsstufe je Server (WORK_STATUS „Gefundene Punkte" Nr. 12).
 */

import { type Permission, type ServerMemberLevel } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { buildPermissionActor } from '../rbac/index.js';
import { type ServerPermissionContext, computeGameServerPermissions } from './permissions.js';

const OWNER = 'owner-1';
const OTHER = 'other-1';

function actorWith(...permissions: Permission[]) {
  return buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: permissions }] });
}

function context(overrides: Partial<ServerPermissionContext> = {}): ServerPermissionContext {
  return {
    ownerId: OWNER,
    status: 'running',
    viewerId: OWNER,
    viewerMemberLevel: null,
    ...overrides,
  };
}

describe('Besitzer', () => {
  const actor = actorWith(
    'server.view.own',
    'server.manage.own',
    'server.delete.own',
    'backup.manage.own',
    'server.create',
  );

  it('darf seinen Server sehen, bedienen, verwalten und löschen', () => {
    const permissions = computeGameServerPermissions(actor, context());

    expect(permissions).toMatchObject({
      canView: true,
      canViewAddress: true,
      canStart: true,
      canStop: true,
      canRestart: true,
      canUseConsole: true,
      canManageSettings: true,
      canManageFiles: true,
      canManageBackups: true,
      canDelete: true,
      canClone: true,
      canManageMembers: true,
    });
  });

  it('darf ohne server.create nicht klonen', () => {
    const withoutCreate = actorWith('server.view.own', 'server.manage.own');

    expect(computeGameServerPermissions(withoutCreate, context()).canClone).toBe(false);
  });
});

describe('Fremder ohne Mitgliedschaft', () => {
  const actor = actorWith('server.view.own', 'server.manage.own', 'server.delete.own');

  it('sieht den Server nicht', () => {
    const permissions = computeGameServerPermissions(actor, context({ viewerId: OTHER }));

    expect(permissions.canView).toBe(false);
    expect(permissions.canStart).toBe(false);
    expect(permissions.canDelete).toBe(false);
  });
});

describe('Mitgliedsstufen (Lastenheft §3.3)', () => {
  const actor = actorWith(
    'server.view.own',
    'server.manage.own',
    'server.delete.own',
    'backup.manage.own',
    'server.create',
  );

  function forLevel(level: ServerMemberLevel) {
    return computeGameServerPermissions(
      actor,
      context({ viewerId: OTHER, viewerMemberLevel: level }),
    );
  }

  it('viewer darf sehen, aber nicht eingreifen', () => {
    const permissions = forLevel('viewer');

    expect(permissions.canView).toBe(true);
    expect(permissions.canViewAddress).toBe(true);
    expect(permissions.canStart).toBe(false);
    expect(permissions.canUseConsole).toBe(false);
    expect(permissions.canManageSettings).toBe(false);
  });

  it('operator darf bedienen, aber nicht verwalten', () => {
    const permissions = forLevel('operator');

    expect(permissions.canStart).toBe(true);
    expect(permissions.canStop).toBe(true);
    expect(permissions.canRestart).toBe(true);
    expect(permissions.canUseConsole).toBe(true);
    expect(permissions.canManageSettings).toBe(false);
    expect(permissions.canManageFiles).toBe(false);
  });

  it('manager darf zusätzlich verwalten', () => {
    const permissions = forLevel('manager');

    expect(permissions.canManageSettings).toBe(true);
    expect(permissions.canManageFiles).toBe(true);
    expect(permissions.canManageSchedules).toBe(true);
    expect(permissions.canManageBackups).toBe(true);
  });

  it('lässt auch einen manager den Server weder löschen noch Mitglieder verwalten', () => {
    // Ein Mitglied soll sich nicht selbst zum Besitzer machen oder den Server
    // unter dem Besitzer wegräumen können.
    const permissions = forLevel('manager');

    expect(permissions.canDelete).toBe(false);
    expect(permissions.canManageMembers).toBe(false);
  });

  it('lässt die Mitgliedsstufe nicht wirkungslos werden', () => {
    // Ohne die Schranke wäre ein `viewer` mit `server.manage.own` so mächtig
    // wie ein `manager`.
    expect(forLevel('viewer').canStart).toBe(false);
    expect(forLevel('operator').canStart).toBe(true);
  });
});

describe('Verwaltung fremder Server über .any', () => {
  const admin = actorWith(
    'server.view.any',
    'server.manage.any',
    'server.delete.any',
    'backup.manage.any',
    'server.create',
  );

  it('darf jeden Server sehen, bedienen und löschen', () => {
    const permissions = computeGameServerPermissions(admin, context({ viewerId: OTHER }));

    expect(permissions).toMatchObject({
      canView: true,
      canStart: true,
      canManageSettings: true,
      canDelete: true,
      canManageMembers: true,
      canManageBackups: true,
    });
  });

  it('braucht für fremde Server ausdrücklich .any', () => {
    const onlyOwn = actorWith('server.view.own', 'server.manage.own');

    expect(computeGameServerPermissions(onlyOwn, context({ viewerId: OTHER })).canView).toBe(false);
  });
});

describe('Owner-Konto (Lastenheft §2)', () => {
  it('bekommt bei jedem Server alle Flags', () => {
    const owner = buildPermissionActor({ isOwner: true, roles: [] });
    const permissions = computeGameServerPermissions(owner, context({ viewerId: OTHER }));

    expect(Object.values(permissions).every(Boolean)).toBe(true);
  });
});

describe('Nicht angemeldet', () => {
  it('bekommt kein einziges Flag', () => {
    const anonymous = buildPermissionActor({ isOwner: false, roles: [] });
    const permissions = computeGameServerPermissions(anonymous, context({ viewerId: null }));

    expect(Object.values(permissions).some(Boolean)).toBe(false);
  });
});

describe('Zustandsunabhängigkeit', () => {
  it('bildet nur die Berechtigung ab, nicht den Lifecycle', () => {
    // Ob ein Start im aktuellen Zustand zulässig ist, entscheidet die State
    // Machine – stünde es auch hier, gäbe es zwei Auslegungen von §9.
    const actor = actorWith('server.view.own', 'server.manage.own');

    for (const status of ['running', 'stopped', 'crashed', 'error'] as const) {
      expect(computeGameServerPermissions(actor, context({ status })).canStart).toBe(true);
    }
  });
});
