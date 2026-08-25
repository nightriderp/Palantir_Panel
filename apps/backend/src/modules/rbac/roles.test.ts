import { type ErrorCode, GUEST_ROLE_NAME, PERMISSIONS, type Permission } from '@palantir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildPermissionActor } from './permissions.js';
import {
  type CreateRoleData,
  type RoleRecord,
  type RoleRepository,
  type RoleService,
  SEED_ROLES,
  type UpdateRoleData,
  createRoleService,
  seedRoles,
} from './roles.js';

/**
 * Speicher-Attrappe statt echter Datenbank: die Regeln des Rollen-Service
 * (Schutzstatus, Namensvergabe, Berechtigungen) sind so ohne laufende
 * PostgreSQL-Instanz prüfbar (CLAUDE.md §4).
 */
function createFakeRoleRepository(): RoleRepository & { rows: RoleRecord[] } {
  const rows: RoleRecord[] = [];
  const assignments: { userId: string; roleId: string }[] = [];
  let nextId = 1;

  return {
    rows,

    async listAll() {
      return [...rows].sort((a, b) => a.name.localeCompare(b.name));
    },

    async findById(id) {
      return rows.find((role) => role.id === id) ?? null;
    },

    async findByName(name) {
      return rows.find((role) => role.name.toLowerCase() === name.toLowerCase()) ?? null;
    },

    async create(data: CreateRoleData) {
      const role: RoleRecord = {
        id: `role-${nextId++}`,
        name: data.name,
        description: data.description,
        permissions: [...data.permissions],
        isProtected: data.isProtected,
        createdAt: new Date('2026-08-26T00:00:00.000Z'),
      };
      rows.push(role);

      return role;
    },

    async update(id, data: UpdateRoleData) {
      const index = rows.findIndex((role) => role.id === id);
      const current = rows[index];

      if (!current) {
        throw new Error('Rolle nicht gefunden');
      }

      const updated: RoleRecord = {
        ...current,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.permissions !== undefined ? { permissions: [...data.permissions] } : {}),
      };
      rows[index] = updated;

      return updated;
    },

    async remove(id) {
      const index = rows.findIndex((role) => role.id === id);

      if (index >= 0) {
        rows.splice(index, 1);
      }
    },

    async countMembers() {
      const counts = new Map<string, number>();

      for (const assignment of assignments) {
        counts.set(assignment.roleId, (counts.get(assignment.roleId) ?? 0) + 1);
      }

      return counts;
    },

    async listRolesForUser(userId) {
      const roleIds = assignments
        .filter((assignment) => assignment.userId === userId)
        .map((assignment) => assignment.roleId);

      return rows.filter((role) => roleIds.includes(role.id));
    },

    async assignToUser(userId, roleId) {
      const exists = assignments.some(
        (assignment) => assignment.userId === userId && assignment.roleId === roleId,
      );

      if (!exists) {
        assignments.push({ userId, roleId });
      }
    },

    async removeFromUser(userId, roleId) {
      const index = assignments.findIndex(
        (assignment) => assignment.userId === userId && assignment.roleId === roleId,
      );

      if (index >= 0) {
        assignments.splice(index, 1);
      }
    },
  };
}

const owner = buildPermissionActor({ isOwner: true, roles: [] });
const rollenverwalter = buildPermissionActor({
  isOwner: false,
  roles: [{ grantedPermissions: ['role.manage'] }],
});
const nutzerverwalter = buildPermissionActor({
  isOwner: false,
  roles: [{ grantedPermissions: ['user.manage'] }],
});
const gast = buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: [] }] });

/** Erwartet, dass der Aufruf mit genau diesem Fehlercode aus dem Katalog scheitert. */
async function expectRbacError(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'RbacError', code });
}

describe('Seed-Rollen (Pflichtenheft §8, Lastenheft §2)', () => {
  let repository: ReturnType<typeof createFakeRoleRepository>;

  beforeEach(() => {
    repository = createFakeRoleRepository();
  });

  it('legt Admin, Moderator, Nutzer und Gast an', async () => {
    const result = await seedRoles(repository);

    expect(result.created).toEqual(['Admin', 'Moderator', 'Nutzer', GUEST_ROLE_NAME]);
    expect(repository.rows).toHaveLength(4);
  });

  it('gibt Admin den vollständigen Permission-Katalog', async () => {
    await seedRoles(repository);
    const admin = await repository.findByName('Admin');

    expect([...(admin?.permissions ?? [])].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('legt Gast als geschützte Rolle ohne jede Permission an', async () => {
    await seedRoles(repository);
    const guest = await repository.findByName(GUEST_ROLE_NAME);

    expect(guest?.isProtected).toBe(true);
    expect(guest?.permissions).toEqual([]);
  });

  it('macht Admin, Moderator und Nutzer vollständig editierbar', async () => {
    await seedRoles(repository);

    for (const name of ['Admin', 'Moderator', 'Nutzer']) {
      const role = await repository.findByName(name);
      expect(role?.isProtected).toBe(false);
    }
  });

  it('gibt der Rolle Nutzer nur Rechte am eigenen Bestand', async () => {
    await seedRoles(repository);
    const nutzer = await repository.findByName('Nutzer');

    expect(nutzer?.permissions).toContain('server.manage.own');
    expect(nutzer?.permissions).not.toContain('server.manage.any');
    expect(nutzer?.permissions).not.toContain('user.manage');
  });

  it('gibt dem Moderator zusätzlich message.moderate', async () => {
    await seedRoles(repository);
    const moderator = await repository.findByName('Moderator');

    expect(moderator?.permissions).toContain('message.moderate');
    expect(moderator?.permissions).toContain('server.create');
  });

  it('ist idempotent und verändert vorhandene Rollen nicht', async () => {
    await seedRoles(repository);
    const admin = await repository.findByName('Admin');
    await repository.update(admin!.id, { permissions: ['audit.view'] });

    const result = await seedRoles(repository);

    expect(result.created).toEqual([]);
    expect(result.existing).toEqual(['Admin', 'Moderator', 'Nutzer', GUEST_ROLE_NAME]);
    expect(repository.rows).toHaveLength(4);
    expect((await repository.findByName('Admin'))?.permissions).toEqual(['audit.view']);
  });

  it('legt eine fehlende Gast-Rolle beim nächsten Lauf wieder an', async () => {
    await seedRoles(repository);
    const guest = await repository.findByName(GUEST_ROLE_NAME);
    await repository.remove(guest!.id);

    const result = await seedRoles(repository);

    expect(result.created).toEqual([GUEST_ROLE_NAME]);
    expect((await repository.findByName(GUEST_ROLE_NAME))?.isProtected).toBe(true);
  });

  it('enthält genau die im Lastenheft §2 genannten Standard-Rollen', () => {
    expect(SEED_ROLES.map((role) => role.name)).toEqual([
      'Admin',
      'Moderator',
      'Nutzer',
      GUEST_ROLE_NAME,
    ]);
  });
});

describe('Rollen-Service', () => {
  let repository: ReturnType<typeof createFakeRoleRepository>;
  let service: RoleService;

  beforeEach(async () => {
    repository = createFakeRoleRepository();
    service = createRoleService(repository);
    await seedRoles(repository);
  });

  it('liefert vollständige DTOs inklusive permissions-Objekt (Pflichtenheft §5.2)', async () => {
    const roles = await service.list(rollenverwalter);
    const guest = roles.find((role) => role.name === GUEST_ROLE_NAME);

    expect(guest).toMatchObject({
      name: GUEST_ROLE_NAME,
      grantedPermissions: [],
      isProtected: true,
      memberCount: 0,
      permissions: { canView: true, canEdit: false, canDelete: false, canAssign: true },
    });
    expect(typeof guest?.createdAt).toBe('string');
  });

  it('zählt die Mitglieder je Rolle', async () => {
    const nutzer = await repository.findByName('Nutzer');
    await service.assignToUser(rollenverwalter, 'user-1', nutzer!.id);
    await service.assignToUser(rollenverwalter, 'user-2', nutzer!.id);

    const roles = await service.list(rollenverwalter);

    expect(roles.find((role) => role.name === 'Nutzer')?.memberCount).toBe(2);
  });

  it('verweigert Lesen ohne role.manage oder user.manage', async () => {
    await expectRbacError(service.list(gast), 'PERMISSION_DENIED');
  });

  it('lässt Nutzerverwalter lesen und zuweisen, aber nicht anlegen', async () => {
    await expect(service.list(nutzerverwalter)).resolves.toHaveLength(4);
    await expectRbacError(
      service.create(nutzerverwalter, { name: 'Neu', permissions: [] }),
      'PERMISSION_DENIED',
    );
  });

  it('legt neue Rollen immer ungeschützt an', async () => {
    const role = await service.create(rollenverwalter, {
      name: 'Backup-Beauftragter',
      description: 'Darf fremde Backups verwalten.',
      permissions: ['backup.manage.any'] as Permission[],
    });

    expect(role.isProtected).toBe(false);
    expect(role.grantedPermissions).toEqual(['backup.manage.any']);
    expect(role.permissions.canEdit).toBe(true);
  });

  it('lehnt einen bereits vergebenen Namen ab – auch in anderer Schreibweise', async () => {
    await expectRbacError(
      service.create(rollenverwalter, { name: 'admin', permissions: [] }),
      'ROLE_NAME_TAKEN',
    );
  });

  it('meldet unbekannte Rollen mit ROLE_NOT_FOUND', async () => {
    await expectRbacError(service.get(rollenverwalter, 'gibt-es-nicht'), 'ROLE_NOT_FOUND');
    await expectRbacError(
      service.update(rollenverwalter, 'gibt-es-nicht', { name: 'X' }),
      'ROLE_NOT_FOUND',
    );
    await expectRbacError(service.remove(rollenverwalter, 'gibt-es-nicht'), 'ROLE_NOT_FOUND');
  });

  it('bearbeitet editierbare Rollen', async () => {
    const moderator = await repository.findByName('Moderator');
    const updated = await service.update(rollenverwalter, moderator!.id, {
      name: 'Chat-Moderator',
      permissions: ['message.moderate'] as Permission[],
    });

    expect(updated.name).toBe('Chat-Moderator');
    expect(updated.grantedPermissions).toEqual(['message.moderate']);
  });

  it('erlaubt beim Bearbeiten den eigenen, unveränderten Namen', async () => {
    const moderator = await repository.findByName('Moderator');

    await expect(
      service.update(rollenverwalter, moderator!.id, { name: 'Moderator' }),
    ).resolves.toMatchObject({ name: 'Moderator' });
  });

  it('lehnt eine Umbenennung auf einen belegten Namen ab', async () => {
    const moderator = await repository.findByName('Moderator');

    await expectRbacError(
      service.update(rollenverwalter, moderator!.id, { name: 'Nutzer' }),
      'ROLE_NAME_TAKEN',
    );
  });

  it('schützt die Systemrolle Gast vor Bearbeitung und Löschung – auch gegenüber dem Owner', async () => {
    const guest = await repository.findByName(GUEST_ROLE_NAME);

    await expectRbacError(service.update(owner, guest!.id, { name: 'Besucher' }), 'ROLE_PROTECTED');
    await expectRbacError(service.remove(owner, guest!.id), 'ROLE_PROTECTED');
    expect(await repository.findByName(GUEST_ROLE_NAME)).not.toBeNull();
  });

  it('löscht editierbare Rollen', async () => {
    const moderator = await repository.findByName('Moderator');
    await service.remove(rollenverwalter, moderator!.id);

    expect(await repository.findByName('Moderator')).toBeNull();
  });

  it('berechnet die effektiven Rechte eines Nutzers aus seinen Rollen', async () => {
    const nutzer = await repository.findByName('Nutzer');
    const moderator = await repository.findByName('Moderator');
    await service.assignToUser(rollenverwalter, 'user-1', nutzer!.id);
    await service.assignToUser(rollenverwalter, 'user-1', moderator!.id);

    const actor = await service.loadActor('user-1', false);

    expect(actor.permissions.has('server.create')).toBe(true);
    expect(actor.permissions.has('message.moderate')).toBe(true);
    expect(actor.permissions.has('user.manage')).toBe(false);
  });

  it('gibt dem Owner alle Rechte, ohne seine Rollen zu laden', async () => {
    const actor = await service.loadActor('owner-1', true);

    expect(actor.isOwner).toBe(true);
    expect(actor.permissions.size).toBe(PERMISSIONS.length);
  });

  it('liefert für ein Konto ohne Rollen einen Actor ohne Rechte', async () => {
    const actor = await service.loadActor('unbekannt', false);

    expect(actor.permissions.size).toBe(0);
  });

  it('entzieht eine zugewiesene Rolle wieder', async () => {
    const nutzer = await repository.findByName('Nutzer');
    await service.assignToUser(rollenverwalter, 'user-1', nutzer!.id);
    await service.removeFromUser(rollenverwalter, 'user-1', nutzer!.id);

    expect((await service.loadActor('user-1', false)).permissions.size).toBe(0);
  });
});
