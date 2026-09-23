import { describe, expect, it } from 'vitest';
import { createAuditService } from '../admin/audit.js';
import { createFakeAuditRepository } from '../admin/test-support.js';
import { buildPermissionActor } from '../rbac/index.js';
import {
  type GameRequestRecord,
  type GameRequestRepository,
  createGameRequestService,
} from './index.js';
import { isGameRequestError } from './errors.js';

/**
 * Spiel-Wünsche (Betreiber, 19.09.2026).
 *
 * Geprüft wird der Ablauf, nicht die Datenbank: wer bescheiden darf, was ein
 * zweiter offener Wunsch macht, und dass ein Bescheid genau einmal fällt.
 */

const USER_ID = '11111111-1111-4111-8111-000000000001';
const ADMIN_ID = '11111111-1111-4111-8111-000000000002';
const FREMD_ID = '11111111-1111-4111-8111-000000000003';

const adminActor = buildPermissionActor({
  isOwner: false,
  roles: [{ grantedPermissions: ['gametype.manage'] }],
});

const plainActor = buildPermissionActor({
  isOwner: false,
  roles: [{ grantedPermissions: ['server.create'] }],
});

function record(overrides: Partial<GameRequestRecord> = {}): GameRequestRecord {
  return {
    id: 'req-1',
    userId: USER_ID,
    userDisplayName: 'Antragsteller',
    game: 'Terraria',
    reason: 'Wir wollen zu dritt bauen.',
    status: 'pending',
    decisionNote: null,
    decidedByDisplayName: null,
    decidedAt: null,
    createdAt: new Date('2026-09-19T10:00:00.000Z'),
    ...overrides,
  };
}

interface Aufbau {
  service: ReturnType<typeof createGameRequestService>;
  gespeichert: GameRequestRecord[];
  auditRepository: ReturnType<typeof createFakeAuditRepository>;
  /** Was die Benachrichtigungen zu sehen bekommen hätten. */
  gemeldet: Array<{ event: string; payload: Record<string, unknown> }>;
}

function aufbau(vorhanden: GameRequestRecord[] = []): Aufbau {
  const gespeichert = [...vorhanden];
  const gemeldet: Aufbau['gemeldet'] = [];
  const auditRepository = createFakeAuditRepository();

  const repository: GameRequestRepository = {
    async create(input) {
      const neu = record({
        id: `req-${gespeichert.length + 1}`,
        userId: input.userId,
        game: input.game,
        reason: input.reason,
      });

      gespeichert.push(neu);

      return neu;
    },
    async findById(id) {
      return gespeichert.find((eintrag) => eintrag.id === id) ?? null;
    },
    async listByUser(userId) {
      return gespeichert.filter((eintrag) => eintrag.userId === userId);
    },
    async list(query) {
      return query.status === undefined
        ? gespeichert
        : gespeichert.filter((eintrag) => eintrag.status === query.status);
    },
    async findOpenByUser(userId) {
      return (
        gespeichert.find((eintrag) => eintrag.userId === userId && eintrag.status === 'pending') ??
        null
      );
    },
    async decide(id, status, decidedById, note) {
      const index = gespeichert.findIndex(
        (eintrag) => eintrag.id === id && eintrag.status === 'pending',
      );

      if (index === -1) {
        return null;
      }

      const beschieden = record({
        ...gespeichert[index],
        status,
        decisionNote: note,
        decidedByDisplayName: decidedById === null ? null : 'Betreiber',
        decidedAt: new Date('2026-09-19T12:00:00.000Z'),
      });

      gespeichert[index] = beschieden;

      return beschieden;
    },
    async withdraw(id) {
      const index = gespeichert.findIndex(
        (eintrag) => eintrag.id === id && eintrag.status === 'pending',
      );

      if (index === -1) {
        return false;
      }

      gespeichert[index] = record({ ...gespeichert[index], status: 'withdrawn' });

      return true;
    },
  };

  return {
    service: createGameRequestService({
      repository,
      audit: createAuditService(auditRepository),
      events: {
        emit(event, payload) {
          gemeldet.push({ event, payload: payload as unknown as Record<string, unknown> });
        },
      },
      now: () => new Date('2026-09-19T10:00:00.000Z'),
    }),
    gespeichert,
    auditRepository,
    gemeldet,
  };
}

describe('createGameRequestService – stellen', () => {
  it('legt den Wunsch an und meldet ihn der Administration', async () => {
    const { service, gemeldet } = aufbau();

    const dto = await service.create(plainActor, USER_ID, { game: 'Terraria' });

    expect(dto.game).toBe('Terraria');
    expect(dto.status).toBe('pending');
    expect(dto.permissions.canWithdraw).toBe(true);
    // Der Antragsteller selbst darf nicht bescheiden, auch nicht den eigenen.
    expect(dto.permissions.canDecide).toBe(false);
    expect(gemeldet).toHaveLength(1);
    expect(gemeldet[0]?.event).toBe('gameRequest.created');
    expect(gemeldet[0]?.payload.game).toBe('Terraria');
  });

  it('macht aus einer leeren Begründung null statt eines leeren Textes', async () => {
    const { service, gespeichert } = aufbau();

    await service.create(plainActor, USER_ID, { game: 'Terraria', reason: '   ' });

    expect(gespeichert[0]?.reason).toBeNull();
  });

  it('lässt nur einen offenen Wunsch je Konto zu', async () => {
    const { service } = aufbau([record()]);

    const fehler = await service
      .create(plainActor, USER_ID, { game: 'Factorio' })
      .catch((ursache: unknown) => ursache);

    expect(isGameRequestError(fehler) ? fehler.code : null).toBe('GAME_REQUEST_ALREADY_OPEN');
  });

  it('zählt einen beschiedenen Wunsch nicht mehr als offen', async () => {
    const { service } = aufbau([record({ status: 'rejected' })]);

    const dto = await service.create(plainActor, USER_ID, { game: 'Factorio' });

    expect(dto.status).toBe('pending');
  });
});

describe('createGameRequestService – bescheiden', () => {
  it('verlangt user.manage', async () => {
    const { service } = aufbau([record()]);

    const fehler = await service
      .approve(plainActor, USER_ID, 'req-1', {})
      .catch((ursache: unknown) => ursache);

    expect(isGameRequestError(fehler) ? fehler.code : null).toBe('PERMISSION_DENIED');
  });

  it('sagt zu, hält die Anmerkung fest und protokolliert den Bescheid', async () => {
    const { service, auditRepository } = aufbau([record()]);

    const dto = await service.approve(adminActor, ADMIN_ID, 'req-1', {
      note: 'Kommt mit dem nächsten Image.',
    });

    expect(dto.status).toBe('approved');
    expect(dto.decisionNote).toBe('Kommt mit dem nächsten Image.');
    expect(auditRepository.rows.map((eintrag) => eintrag.action)).toContain('gameRequest.approved');
  });

  it('lehnt ab und protokolliert auch das', async () => {
    const { service, auditRepository } = aufbau([record()]);

    const dto = await service.reject(adminActor, ADMIN_ID, 'req-1', { note: 'Kein Server frei.' });

    expect(dto.status).toBe('rejected');
    expect(auditRepository.rows.map((eintrag) => eintrag.action)).toContain('gameRequest.rejected');
  });

  it('beschiedet genau einmal', async () => {
    const { service } = aufbau([record()]);

    await service.approve(adminActor, ADMIN_ID, 'req-1', {});
    const fehler = await service
      .reject(adminActor, ADMIN_ID, 'req-1', {})
      .catch((ursache: unknown) => ursache);

    expect(isGameRequestError(fehler) ? fehler.code : null).toBe('GAME_REQUEST_INVALID_STATE');
  });

  it('meldet einen unbekannten Wunsch als nicht vorhanden', async () => {
    const { service } = aufbau();

    const fehler = await service
      .approve(adminActor, ADMIN_ID, 'req-42', {})
      .catch((ursache: unknown) => ursache);

    expect(isGameRequestError(fehler) ? fehler.code : null).toBe('GAME_REQUEST_NOT_FOUND');
  });
});

describe('createGameRequestService – zurückziehen und lesen', () => {
  it('lässt den Antragsteller zurückziehen', async () => {
    const { service, gespeichert } = aufbau([record()]);

    await service.withdraw(plainActor, USER_ID, 'req-1');

    expect(gespeichert[0]?.status).toBe('withdrawn');
  });

  it('verschweigt einen fremden Wunsch, statt ihn zu verbieten', async () => {
    const { service } = aufbau([record()]);

    const fehler = await service
      .withdraw(plainActor, FREMD_ID, 'req-1')
      .catch((ursache: unknown) => ursache);

    // „Nicht vorhanden" statt „verboten": Sonst verriete die Antwort, dass es
    // den Wunsch gibt.
    expect(isGameRequestError(fehler) ? fehler.code : null).toBe('GAME_REQUEST_NOT_FOUND');
  });

  it('zieht einen beschiedenen Wunsch nicht mehr zurück', async () => {
    const { service } = aufbau([record({ status: 'approved' })]);

    const fehler = await service
      .withdraw(plainActor, USER_ID, 'req-1')
      .catch((ursache: unknown) => ursache);

    expect(isGameRequestError(fehler) ? fehler.code : null).toBe('GAME_REQUEST_INVALID_STATE');
  });

  it('zeigt dem Konto die eigenen Wünsche, der Administration alle offenen', async () => {
    const { service } = aufbau([
      record(),
      record({ id: 'req-2', userId: FREMD_ID, status: 'approved', game: 'Factorio' }),
    ]);

    const eigene = await service.listOwn(plainActor, USER_ID);
    const offene = await service.list(adminActor, { status: 'pending' });

    expect(eigene.map((eintrag) => eintrag.id)).toEqual(['req-1']);
    expect(offene.map((eintrag) => eintrag.id)).toEqual(['req-1']);
    expect(offene[0]?.permissions.canDecide).toBe(true);
  });

  it('lässt die Liste der Administration nur mit user.manage zu', async () => {
    const { service } = aufbau([record()]);

    const fehler = await service.list(plainActor, {}).catch((ursache: unknown) => ursache);

    expect(isGameRequestError(fehler) ? fehler.code : null).toBe('PERMISSION_DENIED');
  });
});
