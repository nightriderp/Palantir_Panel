/**
 * Admin-Sicht auf die Rollenverwaltung (R6, Gefundener Punkt 68).
 *
 * Geprüft wird, was dieses Modul beisteuert – das Audit-Log und die
 * Existenzprüfung des Kontos. Die Rollenregeln selbst gehören zu B2 und haben
 * ihre eigenen Tests in `modules/rbac/roles.test.ts`; hier steht nur, dass sie
 * **greifen** und nicht umgangen werden.
 */

import { GUEST_ROLE_NAME } from '@palantir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { isRbacError } from '../rbac/index.js';
import { createAuditService } from './audit.js';
import { AdminError } from './errors.js';
import type { RoleAdminService } from './roles.js';
import {
  GUEST_ROLE_ID,
  ROLE_ID,
  ROLE_PERMISSION_BUNDLE,
  USER_ID,
  actorWith,
  createFakeAuditRepository,
  createFakeRoleRepository,
  createTestRoleAdminService,
  ctxWith,
  type FakeAuditRepository,
  roleRecord,
} from './test-support.js';

const NUTZER_ROLE_ID = ROLE_ID;
const OTHER_USER_ID = '44444444-4444-4444-8444-444444444444';

let service: RoleAdminService;
let auditRepository: FakeAuditRepository;
let repository: ReturnType<typeof createFakeRoleRepository>;

const roleAdminCtx = () => ctxWith(actorWith('role.manage'));
const userAdminCtx = () => ctxWith(actorWith('user.manage'));

/** Erwartet, dass ein Aufruf mit genau diesem Fehlercode scheitert. */
async function expectErrorCode(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toSatisfy(
    (error: unknown) =>
      (isRbacError(error) || error instanceof AdminError) &&
      (error as { code: string }).code === code,
    `Fehlercode ${code}`,
  );
}

beforeEach(() => {
  repository = createFakeRoleRepository([
    roleRecord(),
    roleRecord({
      id: GUEST_ROLE_ID,
      name: GUEST_ROLE_NAME,
      description: 'Standardrolle nach der Registrierung.',
      permissions: [],
      isProtected: true,
    }),
  ]);
  auditRepository = createFakeAuditRepository();
  service = createTestRoleAdminService({
    repository,
    audit: createAuditService(auditRepository),
  });
});

describe('Lesen', () => {
  it('listet die Rollen mit Mitgliederzahl und permissions-Objekt', async () => {
    await service.assignToUser(roleAdminCtx(), NUTZER_ROLE_ID, USER_ID);

    const roles = await service.list(roleAdminCtx());
    const nutzer = roles.find((role) => role.id === NUTZER_ROLE_ID);

    expect(nutzer?.memberCount).toBe(1);
    expect(nutzer?.permissions).toEqual({
      canView: true,
      canEdit: true,
      canDelete: true,
      canAssign: true,
    });
  });

  it('lässt auch `user.manage` lesen – ohne Bearbeitungsrechte', async () => {
    // Wer Konten freischaltet, muss die Rollen zur Auswahl auflisten können
    // (Gefundener Punkt 68), darf sie deshalb aber nicht bearbeiten.
    const roles = await service.list(userAdminCtx());
    const nutzer = roles.find((role) => role.id === NUTZER_ROLE_ID);

    expect(nutzer?.permissions.canView).toBe(true);
    expect(nutzer?.permissions.canEdit).toBe(false);
    expect(nutzer?.permissions.canDelete).toBe(false);
  });

  it('schreibt beim Lesen nichts ins Audit-Log', async () => {
    await service.list(roleAdminCtx());
    await service.get(roleAdminCtx(), NUTZER_ROLE_ID);

    expect(auditRepository.rows).toHaveLength(0);
  });
});

describe('Anlegen, Ändern, Löschen', () => {
  it('legt eine Rolle an und protokolliert sie mit ihrem Rechtebündel', async () => {
    const role = await service.create(roleAdminCtx(), {
      name: 'Supporter',
      description: 'Hilft bei Rückfragen.',
      permissions: [...ROLE_PERMISSION_BUNDLE],
    });

    expect(role.isProtected).toBe(false);
    expect(role.grantedPermissions).toEqual([...ROLE_PERMISSION_BUNDLE]);

    const entry = auditRepository.rows.at(-1);

    expect(entry?.action).toBe('role.created');
    expect(entry?.targetType).toBe('role');
    expect(entry?.targetId).toBe(role.id);
    expect(entry?.actorId).toBe(USER_ID);
    expect(entry?.metadata).toMatchObject({
      name: 'Supporter',
      grantedPermissions: [...ROLE_PERMISSION_BUNDLE],
    });
  });

  it('hält beim Ändern den Stand vor und nach der Änderung fest', async () => {
    // „Rolle geändert" ohne das Vorher wäre im Nachhinein kaum auswertbar
    // (Pflichtenheft §6).
    await service.update(roleAdminCtx(), NUTZER_ROLE_ID, { name: 'Mitglied' });

    const entry = auditRepository.rows.at(-1);

    expect(entry?.action).toBe('role.updated');
    expect(entry?.metadata).toMatchObject({
      before: { name: 'Nutzer', grantedPermissions: ['server.create'] },
      after: { name: 'Mitglied', grantedPermissions: ['server.create'] },
    });
  });

  it('bewahrt beim Löschen Name, Rechtebündel und Mitgliederzahl im Log', async () => {
    await service.assignToUser(roleAdminCtx(), NUTZER_ROLE_ID, USER_ID);
    await service.remove(roleAdminCtx(), NUTZER_ROLE_ID);

    const entry = auditRepository.rows.at(-1);

    expect(entry?.action).toBe('role.deleted');
    expect(entry?.metadata).toMatchObject({
      name: 'Nutzer',
      grantedPermissions: ['server.create'],
      memberCount: 1,
    });
    expect(repository.rows.some((row) => row.id === NUTZER_ROLE_ID)).toBe(false);
  });

  it('schützt die Systemrolle „Gast" und protokolliert den Versuch nicht', async () => {
    // Die Regel gehört B2; hier zählt, dass sie durch diese Schicht wirkt.
    await expectErrorCode(
      service.update(roleAdminCtx(), GUEST_ROLE_ID, { name: 'Besucher' }),
      'ROLE_PROTECTED',
    );
    await expectErrorCode(service.remove(roleAdminCtx(), GUEST_ROLE_ID), 'ROLE_PROTECTED');

    expect(auditRepository.rows).toHaveLength(0);
  });

  it('lehnt einen bereits vergebenen Namen ab', async () => {
    await expectErrorCode(
      service.create(roleAdminCtx(), { name: 'nutzer', permissions: [] }),
      'ROLE_NAME_TAKEN',
    );
  });

  it('lehnt eine unbekannte Rolle mit ROLE_NOT_FOUND ab', async () => {
    await expectErrorCode(service.get(roleAdminCtx(), 'gibtsnicht'), 'ROLE_NOT_FOUND');
    await expectErrorCode(service.remove(roleAdminCtx(), 'gibtsnicht'), 'ROLE_NOT_FOUND');
  });

  it('lehnt Änderungen ohne role.manage ab', async () => {
    await expectErrorCode(
      service.create(userAdminCtx(), { name: 'Supporter', permissions: [] }),
      'PERMISSION_DENIED',
    );
    await expectErrorCode(service.remove(userAdminCtx(), NUTZER_ROLE_ID), 'PERMISSION_DENIED');
  });
});

describe('Zuweisen und Entziehen', () => {
  it('weist zu, liefert die neue Mitgliederzahl und protokolliert das Konto', async () => {
    const role = await service.assignToUser(userAdminCtx(), NUTZER_ROLE_ID, USER_ID);

    expect(role.memberCount).toBe(1);

    const entry = auditRepository.rows.at(-1);

    expect(entry?.action).toBe('user.roleAssigned');
    // Zielobjekt ist das Konto – im Log wird nach dem Nutzer gesucht.
    expect(entry?.targetType).toBe('user');
    expect(entry?.targetId).toBe(USER_ID);
    expect(entry?.metadata).toMatchObject({ roleId: NUTZER_ROLE_ID, roleName: 'Nutzer' });
  });

  it('ist beim Zuweisen wiederholbar', async () => {
    await service.assignToUser(userAdminCtx(), NUTZER_ROLE_ID, USER_ID);
    const role = await service.assignToUser(userAdminCtx(), NUTZER_ROLE_ID, USER_ID);

    expect(role.memberCount).toBe(1);
  });

  it('entzieht wieder und protokolliert das ebenfalls', async () => {
    await service.assignToUser(userAdminCtx(), NUTZER_ROLE_ID, USER_ID);
    const role = await service.removeFromUser(userAdminCtx(), NUTZER_ROLE_ID, USER_ID);

    expect(role.memberCount).toBe(0);
    expect(auditRepository.rows.at(-1)?.action).toBe('user.roleRemoved');
  });

  it('lehnt ein unbekanntes Konto mit USER_NOT_FOUND ab', async () => {
    // Ohne diese Prüfung liefe die Konto-Id in die Fremdschlüsselbedingung von
    // `user_roles` und käme als roher Datenbankfehler zurück (CLAUDE.md §5).
    await expectErrorCode(
      service.assignToUser(userAdminCtx(), NUTZER_ROLE_ID, OTHER_USER_ID),
      'USER_NOT_FOUND',
    );

    expect(repository.assignments).toHaveLength(0);
    expect(auditRepository.rows).toHaveLength(0);
  });

  it('lehnt eine unbekannte Rolle ab, bevor etwas zugewiesen wird', async () => {
    await expectErrorCode(
      service.assignToUser(userAdminCtx(), 'gibtsnicht', USER_ID),
      'ROLE_NOT_FOUND',
    );

    expect(repository.assignments).toHaveLength(0);
  });
});
