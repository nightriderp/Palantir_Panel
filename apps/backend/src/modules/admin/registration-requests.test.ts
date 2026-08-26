import { GUEST_ROLE_NAME, type RoleDto } from '@palantir/contracts';
import {
  approveRegistrationRequestInputSchema,
  blockRegistrationRequestInputSchema,
  registrationRequestQuerySchema,
} from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import type { PermissionActor, RoleService } from '../rbac/index.js';
import { createAuditService } from './audit.js';
import {
  type RegistrationRequestRepository,
  type WaitlistUserRecord,
  createRegistrationRequestService,
  statusOf,
} from './registration-requests.js';
import { USER_ID, actorWith, createFakeAuditRepository, ctxWith } from './test-support.js';

const GUEST_ROLE = { id: 'role-gast', name: GUEST_ROLE_NAME, isProtected: true };
const USER_ROLE = { id: 'role-nutzer', name: 'Nutzer', isProtected: false };

function waitlistUser(overrides: Partial<WaitlistUserRecord> = {}): WaitlistUserRecord {
  return {
    id: USER_ID,
    displayName: 'Neuling',
    isOwner: false,
    banned: false,
    createdAt: new Date('2026-08-20T12:00:00.000Z'),
    roles: [GUEST_ROLE],
    profiles: [
      {
        provider: 'discord',
        displayName: 'neuling#0001',
        avatarUrl: 'https://cdn.example/avatar.png',
        profileUrl: null,
        linkedAt: '2026-08-20T12:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** Rollenverwaltung aus B2, soweit die Warteliste sie braucht. */
function createFakeRoleService(): RoleService & { assigned: string[]; removed: string[] } {
  const assigned: string[] = [];
  const removed: string[] = [];

  const roleDto = (id: string, name: string): RoleDto => ({
    id,
    name,
    description: null,
    grantedPermissions: [],
    isProtected: name === GUEST_ROLE_NAME,
    memberCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    permissions: { canView: true, canEdit: false, canDelete: false, canAssign: true },
  });

  return {
    assigned,
    removed,
    async list() {
      return [roleDto(USER_ROLE.id, USER_ROLE.name), roleDto(GUEST_ROLE.id, GUEST_ROLE.name)];
    },
    async get(_actor: PermissionActor, roleId: string) {
      return roleDto(roleId, 'Nutzer');
    },
    async create() {
      throw new Error('nicht Teil dieses Tests');
    },
    async update() {
      throw new Error('nicht Teil dieses Tests');
    },
    async remove() {
      throw new Error('nicht Teil dieses Tests');
    },
    async assignToUser(_actor, _userId, roleId) {
      assigned.push(roleId);
    },
    async removeFromUser(_actor, _userId, roleId) {
      removed.push(roleId);
    },
    async loadActor() {
      throw new Error('nicht Teil dieses Tests');
    },
  };
}

function createFakeRepository(seed: WaitlistUserRecord[]): RegistrationRequestRepository & {
  rows: WaitlistUserRecord[];
} {
  const rows = [...seed];

  return {
    rows,

    async list(query) {
      const matching = rows.filter((row) => statusOf(row) === query.status);

      return {
        rows: matching.slice(query.offset, query.offset + query.limit),
        total: matching.length,
      };
    },

    async findByUserId(userId) {
      return rows.find((row) => row.id === userId) ?? null;
    },

    async setBanned(userId, banned) {
      const index = rows.findIndex((row) => row.id === userId);
      const current = rows[index];

      if (current) {
        rows[index] = { ...current, banned };
      }
    },
  };
}

function build(seed: WaitlistUserRecord[]) {
  const auditRepository = createFakeAuditRepository();
  const repository = createFakeRepository(seed);
  const roles = createFakeRoleService();
  const service = createRegistrationRequestService({
    repository,
    roles,
    audit: createAuditService(auditRepository),
  });

  return { service, repository, roles, auditRepository };
}

const adminCtx = () => ctxWith(actorWith('user.manage'));

describe('Zustand eines Wartelisten-Eintrags (Lastenheft §3.1)', () => {
  it('gilt mit ausschließlich der Gast-Rolle als offene Anfrage', () => {
    expect(statusOf(waitlistUser())).toBe('pending');
  });

  it('gilt mit einer weiteren Rolle als freigegeben', () => {
    expect(statusOf(waitlistUser({ roles: [USER_ROLE] }))).toBe('approved');
  });

  it('gilt gesperrt, sobald das Konto gesperrt ist – unabhängig von der Rolle', () => {
    expect(statusOf(waitlistUser({ banned: true }))).toBe('blocked');
    expect(statusOf(waitlistUser({ roles: [USER_ROLE], banned: true }))).toBe('blocked');
  });

  it('gilt für den Owner nie als offene Anfrage (Lastenheft §2)', () => {
    // Der Owner-Sonderstatus liegt außerhalb des Rollensystems und gibt alle
    // Rechte – auch mit ausschließlich der Gast-Rolle. Dieselbe Auslegung wie
    // `isAwaitingApproval()` im Auth-Modul (B1).
    expect(statusOf(waitlistUser({ isOwner: true }))).toBe('approved');
  });
});

describe('Freischalt-Warteliste', () => {
  it('liefert die Profilangaben zur Wiedererkennung mit', async () => {
    const { service } = build([waitlistUser()]);

    const [request] = await service.list(adminCtx(), registrationRequestQuerySchema.parse({}));

    expect(request?.profiles[0]).toMatchObject({
      provider: 'discord',
      displayName: 'neuling#0001',
    });
    expect(request?.roleNames).toEqual([GUEST_ROLE_NAME]);
  });

  it('lehnt jede Wartelisten-Aktion ohne user.manage ab', async () => {
    const { service } = build([waitlistUser()]);

    await expect(
      service.list(ctxWith(actorWith('audit.view')), registrationRequestQuerySchema.parse({})),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('vergibt bei der Freigabe ohne Auswahl die Rolle „Nutzer" und entzieht die Gast-Rolle', async () => {
    const { service, roles, auditRepository } = build([waitlistUser()]);

    await service.approve(adminCtx(), USER_ID, approveRegistrationRequestInputSchema.parse({}));

    expect(roles.assigned).toEqual([USER_ROLE.id]);
    expect(roles.removed).toEqual([GUEST_ROLE.id]);
    expect(auditRepository.rows.map((row) => row.action)).toEqual(['user.approved']);
  });

  it('weist die Freigabe eines bereits freigegebenen Kontos zurück', async () => {
    const { service } = build([waitlistUser({ roles: [USER_ROLE] })]);

    await expect(
      service.approve(adminCtx(), USER_ID, approveRegistrationRequestInputSchema.parse({})),
    ).rejects.toMatchObject({ code: 'REGISTRATION_REQUEST_INVALID_STATE' });
  });

  it('sperrt ein Konto und protokolliert den Grund', async () => {
    const { service, repository, auditRepository } = build([waitlistUser()]);

    const request = await service.block(
      adminCtx(),
      USER_ID,
      blockRegistrationRequestInputSchema.parse({ reason: 'Spam' }),
    );

    expect(request.status).toBe('blocked');
    expect(repository.rows[0]?.banned).toBe(true);
    expect(auditRepository.rows[0]).toMatchObject({
      action: 'user.banned',
      metadata: { reason: 'Spam' },
    });
  });

  it('schützt das Owner-Konto vor dem Sperren (Lastenheft §2)', async () => {
    const { service, repository } = build([waitlistUser({ isOwner: true, roles: [USER_ROLE] })]);

    await expect(
      service.block(adminCtx(), USER_ID, blockRegistrationRequestInputSchema.parse({})),
    ).rejects.toMatchObject({ code: 'OWNER_PROTECTED' });

    expect(repository.rows[0]?.banned).toBe(false);
  });

  it('bietet am Owner-Konto kein Sperren an', async () => {
    const { service } = build([waitlistUser({ isOwner: true, banned: false, roles: [USER_ROLE] })]);

    const [request] = await service.list(
      adminCtx(),
      registrationRequestQuerySchema.parse({ status: 'approved' }),
    );

    expect(request?.permissions.canBlock).toBe(false);
  });

  it('hebt eine Sperre wieder auf', async () => {
    const { service, repository, auditRepository } = build([waitlistUser({ banned: true })]);

    const request = await service.unblock(adminCtx(), USER_ID);

    expect(request.status).toBe('pending');
    expect(repository.rows[0]?.banned).toBe(false);
    expect(auditRepository.rows.map((row) => row.action)).toEqual(['user.unbanned']);
  });

  it('meldet ein unbekanntes Konto mit USER_NOT_FOUND', async () => {
    const { service } = build([]);

    await expect(
      service.approve(adminCtx(), USER_ID, approveRegistrationRequestInputSchema.parse({})),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
