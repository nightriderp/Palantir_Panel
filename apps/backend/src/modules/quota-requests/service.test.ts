import { describe, expect, it } from 'vitest';
import { buildPermissionActor } from '../rbac/index.js';
import {
  type QuotaRequestRecord,
  type QuotaRequestRepository,
  type QuotaWriter,
  createQuotaRequestService,
} from './index.js';
import { isQuotaRequestError } from './errors.js';

/**
 * Kontingent-Anfragen (Mockup-Abgleich 12.3.1).
 *
 * Geprüft wird der Ablauf, nicht die Datenbank: Wer darf was, was passiert beim
 * Genehmigen mit dem Kontingent, und was schützt vor zwei offenen Anfragen
 * desselben Kontos.
 */

const USER_ID = '11111111-1111-4111-8111-000000000001';
const ADMIN_ID = '11111111-1111-4111-8111-000000000002';

const adminActor = buildPermissionActor({
  isOwner: false,
  roles: [{ grantedPermissions: ['user.manage'] }],
});

const plainActor = buildPermissionActor({
  isOwner: false,
  roles: [{ grantedPermissions: ['server.create'] }],
});

function record(overrides: Partial<QuotaRequestRecord> = {}): QuotaRequestRecord {
  return {
    id: 'req-1',
    userId: USER_ID,
    userDisplayName: 'Antragsteller',
    requestedRamMb: 8192,
    requestedMaxConcurrentServers: null,
    reason: 'Der Server läuft mit 4 GB regelmäßig voll.',
    status: 'pending',
    decisionNote: null,
    decidedByDisplayName: null,
    decidedAt: null,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    ...overrides,
  };
}

interface Aufbau {
  service: ReturnType<typeof createQuotaRequestService>;
  gesetzteLimits: Array<{ userId: string; input: Record<string, unknown> }>;
  gespeichert: QuotaRequestRecord[];
}

function build(
  options: { vorhanden?: QuotaRequestRecord[]; setzenScheitert?: boolean } = {},
): Aufbau {
  const gespeichert = [...(options.vorhanden ?? [])];
  const gesetzteLimits: Array<{ userId: string; input: Record<string, unknown> }> = [];

  const repository: QuotaRequestRepository = {
    create: (input) => {
      const neu = record({
        id: `req-${String(gespeichert.length + 1)}`,
        userId: input.userId,
        requestedRamMb: input.requestedRamMb,
        requestedMaxConcurrentServers: input.requestedMaxConcurrentServers,
        reason: input.reason,
      });
      gespeichert.push(neu);

      return Promise.resolve(neu);
    },
    findById: (id) => Promise.resolve(gespeichert.find((eintrag) => eintrag.id === id) ?? null),
    listByUser: (userId) =>
      Promise.resolve(gespeichert.filter((eintrag) => eintrag.userId === userId)),
    list: (query) =>
      Promise.resolve(
        query.status === undefined
          ? gespeichert
          : gespeichert.filter((eintrag) => eintrag.status === query.status),
      ),
    findOpenByUser: (userId) =>
      Promise.resolve(
        gespeichert.find((eintrag) => eintrag.userId === userId && eintrag.status === 'pending') ??
          null,
      ),
    decide: (id, status, decidedById, note) => {
      const index = gespeichert.findIndex((eintrag) => eintrag.id === id);
      const aktualisiert = {
        ...gespeichert[index]!,
        status,
        decisionNote: note,
        decidedByDisplayName: decidedById === null ? null : 'Admin',
        decidedAt: new Date('2026-09-01T12:00:00.000Z'),
      };
      gespeichert[index] = aktualisiert;

      return Promise.resolve(aktualisiert);
    },
    remove: (id) => {
      const index = gespeichert.findIndex((eintrag) => eintrag.id === id);
      gespeichert.splice(index, 1);

      return Promise.resolve();
    },
  };

  const quotas: QuotaWriter = {
    setUserLimits: (_actor, userId, input) => {
      if (options.setzenScheitert === true) {
        return Promise.reject(new Error('Das Kontingent konnte nicht gesetzt werden.'));
      }

      gesetzteLimits.push({ userId, input: input as Record<string, unknown> });

      return Promise.resolve(null);
    },
  };

  return {
    service: createQuotaRequestService({ repository, quotas }),
    gesetzteLimits,
    gespeichert,
  };
}

async function expectCode(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toSatisfy(
    (error: unknown) => isQuotaRequestError(error) && error.code === code,
    `Fehlercode ${code}`,
  );
}

describe('Anfrage stellen', () => {
  it('legt sie an und weist sie dem Antragsteller zu', async () => {
    const { service } = build();

    const dto = await service.create(plainActor, USER_ID, {
      requestedRamMb: 8192,
      reason: 'Der Server läuft mit 4 GB regelmäßig voll.',
    });

    expect(dto.userId).toBe(USER_ID);
    expect(dto.status).toBe('pending');
    // Der eigene, offene Antrag lässt sich zurückziehen; entscheiden darf ihn
    // ein gewöhnliches Konto nicht.
    expect(dto.permissions).toEqual({ canDecide: false, canWithdraw: true });
  });

  it('lässt nur eine offene Anfrage je Konto zu', async () => {
    const { service } = build({ vorhanden: [record()] });

    await expectCode(
      service.create(plainActor, USER_ID, { requestedRamMb: 16_384, reason: 'Noch mehr, bitte.' }),
      'QUOTA_REQUEST_ALREADY_OPEN',
    );
  });

  it('stört sich nicht an einer bereits entschiedenen Anfrage', async () => {
    const { service } = build({ vorhanden: [record({ status: 'rejected' })] });

    const dto = await service.create(plainActor, USER_ID, {
      requestedMaxConcurrentServers: 5,
      reason: 'Diesmal mit besserer Begründung.',
    });

    expect(dto.status).toBe('pending');
  });
});

describe('Bescheiden', () => {
  it('setzt beim Genehmigen genau die beantragten Grenzen', async () => {
    const { service, gesetzteLimits } = build({ vorhanden: [record()] });

    const dto = await service.approve(adminActor, ADMIN_ID, 'req-1', {});

    expect(dto.status).toBe('approved');
    // Nur RAM war beantragt – die Serverzahl bleibt unberührt.
    expect(gesetzteLimits).toEqual([{ userId: USER_ID, input: { maxRamMb: 8192 } }]);
  });

  it('lässt die Anfrage offen, wenn das Kontingent nicht gesetzt werden kann', async () => {
    const { service, gespeichert } = build({
      vorhanden: [record()],
      setzenScheitert: true,
    });

    await expect(service.approve(adminActor, ADMIN_ID, 'req-1', {})).rejects.toThrow();

    // Sonst stünde eine genehmigte Anfrage ohne das Kontingent da, das sie
    // verspricht.
    expect(gespeichert[0]?.status).toBe('pending');
  });

  it('rührt beim Ablehnen kein Kontingent an', async () => {
    const { service, gesetzteLimits } = build({ vorhanden: [record()] });

    const dto = await service.reject(adminActor, ADMIN_ID, 'req-1', { note: 'Node ist zu klein.' });

    expect(dto.status).toBe('rejected');
    expect(dto.decisionNote).toBe('Node ist zu klein.');
    expect(gesetzteLimits).toEqual([]);
  });

  it('entscheidet genau einmal', async () => {
    const { service } = build({ vorhanden: [record({ status: 'approved' })] });

    await expectCode(
      service.approve(adminActor, ADMIN_ID, 'req-1', {}),
      'QUOTA_REQUEST_INVALID_STATE',
    );
  });

  it('verlangt user.manage', async () => {
    const { service } = build({ vorhanden: [record()] });

    await expectCode(service.approve(plainActor, USER_ID, 'req-1', {}), 'PERMISSION_DENIED');
  });
});

describe('Zurückziehen', () => {
  it('entfernt den eigenen offenen Antrag', async () => {
    const { service, gespeichert } = build({ vorhanden: [record()] });

    await service.withdraw(plainActor, USER_ID, 'req-1');

    expect(gespeichert).toHaveLength(0);
  });

  it('kennt fremde Anfragen nicht', async () => {
    const { service } = build({ vorhanden: [record()] });

    // Bewusst „nicht gefunden" statt „nicht erlaubt": Das verriete, dass es sie
    // gibt.
    await expectCode(service.withdraw(plainActor, ADMIN_ID, 'req-1'), 'QUOTA_REQUEST_NOT_FOUND');
  });

  it('zieht nichts zurück, was bereits entschieden ist', async () => {
    const { service } = build({ vorhanden: [record({ status: 'approved' })] });

    await expectCode(service.withdraw(plainActor, USER_ID, 'req-1'), 'QUOTA_REQUEST_INVALID_STATE');
  });
});
