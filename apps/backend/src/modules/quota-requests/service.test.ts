import { describe, expect, it } from 'vitest';
import { createAuditService } from '../admin/audit.js';
import { createFakeAuditRepository } from '../admin/test-support.js';
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
  auditRepository: ReturnType<typeof createFakeAuditRepository>;
}

interface BuildOptions {
  vorhanden?: QuotaRequestRecord[];
  setzenScheitert?: boolean;
  /**
   * Läuft im Fake-Repository **vor** dem beanspruchenden `UPDATE`.
   *
   * Damit lässt sich das Rennen aus backend-admin-resources-06 nachstellen: Ein
   * zweiter Aufruf landet genau zwischen dem Lesen der Anfrage im Service und
   * dem Schreiben in der Datenbank.
   */
  vorDemBeanspruchen?: () => Promise<void>;
  /** Läuft, während das Kontingent gesetzt wird – die andere Hälfte des Rennens. */
  waehrendSetzen?: () => Promise<void>;
  /**
   * Lässt `create()` am partiellen Index `quota_requests_open_per_user_idx`
   * scheitern (Audit W2-9, `backend-admin-resources-12`).
   *
   * Damit lässt sich das Rennen zwischen `findOpenByUser()` und dem `INSERT`
   * nachstellen: Die Vorprüfung findet nichts, die Datenbank hat die Zeile
   * inzwischen trotzdem.
   */
  anlegenKollidiert?: boolean;
}

function build(options: BuildOptions = {}): Aufbau {
  const gespeichert = [...(options.vorhanden ?? [])];
  const gesetzteLimits: Array<{ userId: string; input: Record<string, unknown> }> = [];

  const repository: QuotaRequestRepository = {
    create: (input) => {
      if (options.anlegenKollidiert === true) {
        // SQLSTATE, den `pg` als `code` auf den Fehler legt.
        return Promise.reject(
          Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
          }),
        );
      }

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
    decide: async (id, status, decidedById, note) => {
      await options.vorDemBeanspruchen?.();

      // Wie das echte `UPDATE ... WHERE status = 'pending'`: Wer zu spät kommt,
      // trifft keine Zeile mehr und bekommt `null`.
      const index = gespeichert.findIndex(
        (eintrag) => eintrag.id === id && eintrag.status === 'pending',
      );

      if (index === -1) {
        return null;
      }

      const aktualisiert = {
        ...gespeichert[index]!,
        status,
        decisionNote: note,
        decidedByDisplayName: decidedById === null ? null : 'Admin',
        decidedAt: new Date('2026-09-01T12:00:00.000Z'),
      };
      gespeichert[index] = aktualisiert;

      return aktualisiert;
    },
    reopen: (id) => {
      const index = gespeichert.findIndex((eintrag) => eintrag.id === id);

      if (index !== -1) {
        gespeichert[index] = {
          ...gespeichert[index]!,
          status: 'pending',
          decisionNote: null,
          decidedByDisplayName: null,
          decidedAt: null,
        };
      }

      return Promise.resolve();
    },
    withdraw: (id) => {
      // Wie das echte `UPDATE ... SET status = 'withdrawn' WHERE status = 'pending'`.
      const index = gespeichert.findIndex(
        (eintrag) => eintrag.id === id && eintrag.status === 'pending',
      );

      if (index === -1) {
        return Promise.resolve(false);
      }

      gespeichert[index] = { ...gespeichert[index]!, status: 'withdrawn' };

      return Promise.resolve(true);
    },
  };

  const quotas: QuotaWriter = {
    setUserLimits: async (_actor, userId, input) => {
      await options.waehrendSetzen?.();

      if (options.setzenScheitert === true) {
        throw new Error('Das Kontingent konnte nicht gesetzt werden.');
      }

      gesetzteLimits.push({ userId, input: input as Record<string, unknown> });

      return null;
    },
  };

  const auditRepository = createFakeAuditRepository();

  return {
    service: createQuotaRequestService({
      repository,
      quotas,
      audit: createAuditService(auditRepository),
    }),
    gesetzteLimits,
    gespeichert,
    auditRepository,
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

  /**
   * Audit W2-9, `backend-admin-resources-12`: Zwei gleichzeitige Anfragen
   * desselben Kontos bestehen beide `findOpenByUser()`. Den zweiten Insert
   * fängt der partielle Index – bisher als roher 23505 und damit als 500.
   */
  it('beantwortet den Unique-Index (23505) mit QUOTA_REQUEST_ALREADY_OPEN', async () => {
    const { service } = build({ anlegenKollidiert: true });

    await expectCode(
      service.create(plainActor, USER_ID, { requestedRamMb: 16_384, reason: 'Bitte mehr RAM.' }),
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

  it('protokolliert die Genehmigung genau einmal mit Handelndem, Ziel und Ergebnis', async () => {
    // Pflichtenheft §6: Über diesen Weg wurde das Kontingent eines fremden
    // Kontos bisher unprotokolliert erhöht – der Eintrag hing allein an
    // `PUT /admin/users/:userId/limits`.
    const { service, auditRepository } = build({ vorhanden: [record()] });

    await service.approve(adminActor, ADMIN_ID, 'req-1', {});

    expect(auditRepository.rows).toHaveLength(1);
    expect(auditRepository.rows[0]).toMatchObject({
      action: 'user.limitsChanged',
      actorId: ADMIN_ID,
      actorDisplayName: 'Admin',
      targetType: 'user',
      targetId: USER_ID,
      metadata: { quotaRequestId: 'req-1', maxRamMb: 8192, maxConcurrentServers: null },
    });
  });

  it('protokolliert nichts, wenn das Kontingent nicht gesetzt werden konnte', async () => {
    const { service, auditRepository } = build({ vorhanden: [record()], setzenScheitert: true });

    await expect(service.approve(adminActor, ADMIN_ID, 'req-1', {})).rejects.toThrow();

    expect(auditRepository.rows).toEqual([]);
  });

  it('protokolliert die Ablehnung nicht als Kontingent-Änderung', async () => {
    // Eine Ablehnung ändert kein Kontingent. Für den Vorgang selbst fehlt im
    // Katalog (`packages/contracts/src/audit.ts`) noch eine eigene Aktion.
    const { service, auditRepository } = build({ vorhanden: [record()] });

    await service.reject(adminActor, ADMIN_ID, 'req-1', {});

    expect(auditRepository.rows).toEqual([]);
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
  it('setzt den eigenen offenen Antrag auf zurückgezogen, statt ihn zu löschen', async () => {
    // Audit W2-15: Der Vorgang bleibt als Beleg stehen – vorher verschwand er
    // per `DELETE` und niemand konnte hinterher sagen, ob er je gestellt wurde.
    const { service, gespeichert } = build({ vorhanden: [record()] });

    await service.withdraw(plainActor, USER_ID, 'req-1');

    expect(gespeichert).toHaveLength(1);
    expect(gespeichert[0]?.status).toBe('withdrawn');
    // Kein Bescheid: Über einen Rückzug hat niemand entschieden.
    expect(gespeichert[0]?.decidedAt).toBeNull();
  });

  it('lässt nach dem Rückzug sofort einen neuen Antrag zu', async () => {
    // Der partielle Unique-Index deckt nur `status = 'pending'`; ein
    // zurückgezogener Vorgang blockiert deshalb nichts.
    const { service, gespeichert } = build({ vorhanden: [record()] });

    await service.withdraw(plainActor, USER_ID, 'req-1');
    const neu = await service.create(plainActor, USER_ID, {
      requestedRamMb: 8192,
      reason: 'Zweiter Anlauf mit besserer Begründung.',
    });

    expect(neu.status).toBe('pending');
    expect(gespeichert.map((eintrag) => eintrag.status).sort()).toEqual(['pending', 'withdrawn']);
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

/**
 * Genehmigen und Zurückziehen zur selben Zeit (backend-admin-resources-06).
 *
 * Beide Seiten lesen dieselbe offene Anfrage; entschieden wird erst im
 * bedingten Schreiben. Geprüft wird deshalb dreierlei: Genau einer gewinnt, der
 * Verlierer bekommt einen Fachcode aus dem Katalog (kein unerwarteter Fehler,
 * der als 500 endete), und ein erhöhtes Kontingent steht nie ohne die Anfrage
 * da, die es belegt.
 */
describe('Rennen zwischen Bescheid und Rückzug', () => {
  it('lässt den Rückzug scheitern, wenn die Genehmigung zuerst zugreift', async () => {
    const rueckzug: { fehler: unknown } = { fehler: null };
    const { service, gesetzteLimits, gespeichert } = build({
      vorhanden: [record()],
      // Der Rückzug kommt, während das Kontingent gesetzt wird – die Anfrage ist
      // zu diesem Zeitpunkt bereits beansprucht.
      waehrendSetzen: async () => {
        rueckzug.fehler = await service
          .withdraw(plainActor, USER_ID, 'req-1')
          .then(() => null)
          .catch((error: unknown) => error);
      },
    });

    const dto = await service.approve(adminActor, ADMIN_ID, 'req-1', {});

    expect(dto.status).toBe('approved');
    expect(gesetzteLimits).toHaveLength(1);
    expect(gespeichert[0]?.status).toBe('approved');
    expect(
      isQuotaRequestError(rueckzug.fehler) &&
        rueckzug.fehler.code === 'QUOTA_REQUEST_INVALID_STATE',
    ).toBe(true);
  });

  it('lässt die Genehmigung scheitern, wenn der Rückzug zuerst zugreift', async () => {
    let vorbereitet: (() => Promise<void>) | null = null;
    const { service, gesetzteLimits, gespeichert } = build({
      vorhanden: [record()],
      // Der Rückzug landet zwischen dem Lesen im Service und dem Schreiben.
      vorDemBeanspruchen: async () => {
        await vorbereitet?.();
      },
    });
    vorbereitet = () => service.withdraw(plainActor, USER_ID, 'req-1');

    await expectCode(
      service.approve(adminActor, ADMIN_ID, 'req-1', {}),
      'QUOTA_REQUEST_INVALID_STATE',
    );

    // Kein Kontingent ohne Beleg: Die Erhöhung darf gar nicht erst laufen.
    expect(gesetzteLimits).toEqual([]);
    expect(gespeichert[0]?.status).toBe('withdrawn');
  });

  it('lässt die zweite von zwei gleichzeitigen Ablehnungen scheitern', async () => {
    let zweiter: (() => Promise<unknown>) | null = null;
    const { service } = build({
      vorhanden: [record()],
      vorDemBeanspruchen: async () => {
        const lauf = zweiter;
        zweiter = null;
        await lauf?.();
      },
    });
    zweiter = () => service.reject(adminActor, ADMIN_ID, 'req-1', { note: 'Zu groß.' });

    await expectCode(
      service.reject(adminActor, ADMIN_ID, 'req-1', { note: 'Zu groß.' }),
      'QUOTA_REQUEST_INVALID_STATE',
    );
  });
});
