/**
 * Tests des Ressourcen-Service.
 *
 * Die Repositories sind bewusst durch schlichte Fakes ersetzt (analog zur
 * Fake-`ContainerRuntime` des Agents) – die Regeln dieses Moduls sollen ohne
 * laufende Datenbank prüfbar sein (Entwicklungsregeln §4).
 */

import {
  NO_USER_RESOURCE_LIMITS,
  type NodeResourceUsage,
  type UserResourceLimits,
  type UserResourceUsage,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { buildPermissionActor } from '../rbac/permissions.js';
import { isResourceError } from './errors.js';
import type {
  HostNodeRecord,
  HostNodeRepository,
  ServerUsageRepository,
  UserResourceLimitRecord,
  UserResourceLimitRepository,
} from './ports.js';
import { type ResourceService, createResourceService } from './service.js';
import { type ServerLoadSnapshot } from './thresholds.js';

const USER_ID = 'a1e5b6c2-0000-4000-8000-000000000010';
const NODE_ID = 'a1e5b6c2-0000-4000-8000-000000000001';
const SERVER_ID = 'a1e5b6c2-0000-4000-8000-000000000002';

const adminActor = buildPermissionActor({
  isOwner: false,
  roles: [{ grantedPermissions: ['user.manage'] }],
});
const plainActor = buildPermissionActor({
  isOwner: false,
  roles: [{ grantedPermissions: ['server.create'] }],
});

const NODE: HostNodeRecord = {
  id: NODE_ID,
  name: 'homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online',
  totalResources: { ramMb: 32_768, cpuCores: 8, diskMb: 2_097_152 },
  measuredUsage: null,
};

const JETZT = new Date('2026-09-14T12:00:00.000Z');

/** Node mit frischer Messung – Vorgabe: Platte reichlich frei. */
function nodeMitMessung(gemessen: {
  ramAvailableMb: number;
  diskAvailableMb?: number;
  observedAt?: Date;
}): HostNodeRecord {
  return {
    ...NODE,
    measuredUsage: {
      ramAvailableMb: gemessen.ramAvailableMb,
      diskAvailableMb: gemessen.diskAvailableMb ?? 2_000_000,
      cpuLoad1m: null,
      observedAt: gemessen.observedAt ?? JETZT,
    },
  };
}

function emptyUserUsage(): UserResourceUsage {
  return {
    runningRamMb: 0,
    runningServers: 0,
    totalServers: 0,
  };
}

function emptyNodeUsage(): NodeResourceUsage {
  return {
    runningRamMb: 0,
    runningServers: 0,
    totalServers: 0,
  };
}

interface Fakes {
  readonly service: ResourceService;
  readonly stored: { record: UserResourceLimitRecord | null };
  readonly excludedIds: string[];
  /** Konto-Ids, nach denen der Service tatsächlich gefragt hat. */
  readonly abgefragteIds: string[];
}

function buildService(options?: {
  limits?: UserResourceLimits;
  userExists?: boolean;
  userUsage?: Partial<UserResourceUsage>;
  nodeUsage?: Partial<NodeResourceUsage>;
  node?: HostNodeRecord | null;
}): Fakes {
  const stored: { record: UserResourceLimitRecord | null } = {
    record:
      options?.userExists === false
        ? null
        : {
            userId: USER_ID,
            userDisplayName: 'Testnutzer',
            limits: options?.limits ?? NO_USER_RESOURCE_LIMITS,
            updatedAt: options?.limits ? new Date('2026-08-01T00:00:00.000Z') : null,
          },
  };
  const excludedIds: string[] = [];
  const abgefragteIds: string[] = [];

  const limitRepository: UserResourceLimitRepository = {
    async findByUserId(userId: string) {
      abgefragteIds.push(userId);

      return stored.record;
    },
    async findManyByUserId(userIds: readonly string[]) {
      const gefunden = new Map<string, UserResourceLimits>();

      if (stored.record && userIds.includes(stored.record.userId)) {
        gefunden.set(stored.record.userId, stored.record.limits);
      }

      return gefunden;
    },
    async upsert(userId, limits) {
      if (!stored.record) {
        return null;
      }

      stored.record = { ...stored.record, limits, updatedAt: new Date() };

      return stored.record;
    },
    async remove() {
      if (stored.record) {
        stored.record = {
          ...stored.record,
          limits: NO_USER_RESOURCE_LIMITS,
          updatedAt: null,
        };
      }
    },
  };

  const nodeRepository: HostNodeRepository = {
    async findById() {
      return options?.node === undefined ? NODE : options.node;
    },
    async listAll() {
      return options?.node === undefined ? [NODE] : options.node === null ? [] : [options.node];
    },
  };

  const usageRepository: ServerUsageRepository = {
    async usageForUser(_userId, queryOptions) {
      if (queryOptions?.excludeServerId) {
        excludedIds.push(queryOptions.excludeServerId);
      }

      return { ...emptyUserUsage(), ...options?.userUsage };
    },
    async usageForUsers(userIds: readonly string[]) {
      const belegung = new Map<string, UserResourceUsage>();

      for (const userId of userIds) {
        belegung.set(userId, { ...emptyUserUsage(), ...options?.userUsage });
      }

      return belegung;
    },
    async usageForNode(_nodeId, queryOptions) {
      if (queryOptions?.excludeServerId) {
        excludedIds.push(queryOptions.excludeServerId);
      }

      return { ...emptyNodeUsage(), ...options?.nodeUsage };
    },
  };

  return {
    service: createResourceService({
      limits: limitRepository,
      nodes: nodeRepository,
      usage: usageRepository,
      thresholds: { nodePercent: 85, serverPercent: 90 },
    }),
    stored,
    excludedIds,
    abgefragteIds,
  };
}

describe('Eigenes Kontingent (getOwnQuota, P6)', () => {
  it('liefert je Ressource Limit, Belegung und Rest', async () => {
    const { service } = buildService({
      limits: { maxRamMb: 8192, maxConcurrentServers: 2 },
      userUsage: {
        runningRamMb: 2048,
        runningServers: 1,
        totalServers: 3,
      },
    });

    const quota = await service.getOwnQuota({ actor: plainActor, userId: USER_ID });

    expect(quota.userId).toBe(USER_ID);
    expect(quota.ram).toEqual({
      resource: 'ram',
      unit: 'mb',
      limit: 8192,
      used: 2048,
      remaining: 6144,
      counting: 'running',
    });
    // Die Serveranzahl zählt die gleichzeitig laufenden – wie in `capacity.ts`.
    expect(quota.servers).toEqual({
      resource: 'servers',
      unit: 'count',
      limit: 2,
      used: 1,
      remaining: 1,
      counting: 'running',
    });
    expect(quota.updatedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('meldet ohne Limit `null` als Limit und Rest, nennt die Belegung aber weiter', async () => {
    const { service } = buildService({
      userUsage: { runningRamMb: 4096, runningServers: 2 },
    });

    const quota = await service.getOwnQuota({ actor: plainActor, userId: USER_ID });

    expect(quota.ram.limit).toBeNull();
    expect(quota.ram.remaining).toBeNull();
    expect(quota.ram.used).toBe(4096);
    expect(quota.servers.remaining).toBeNull();
    expect(quota.updatedAt).toBeNull();
  });

  it('gibt bei überschrittenem Limit 0 statt eines negativen Rests zurück', async () => {
    const { service } = buildService({
      limits: { maxRamMb: 4096, maxConcurrentServers: 1 },
      userUsage: { runningRamMb: 6144, runningServers: 3 },
    });

    const quota = await service.getOwnQuota({ actor: plainActor, userId: USER_ID });

    expect(quota.ram.remaining).toBe(0);
    expect(quota.servers.remaining).toBe(0);
  });

  it('verlangt keine Permission, setzt canEdit aber nur mit user.manage', async () => {
    const { service } = buildService({});

    expect((await service.getOwnQuota({ actor: plainActor, userId: USER_ID })).permissions).toEqual(
      {
        canView: true,
        canEdit: false,
      },
    );
    expect((await service.getOwnQuota({ actor: adminActor, userId: USER_ID })).permissions).toEqual(
      {
        canView: true,
        canEdit: true,
      },
    );
  });

  /*
   * backend-admin-resources-13: Die Methode liest ausschließlich das Konto der
   * Sitzung. Eine zweite, frei wählbare Id gibt es in der Signatur nicht mehr –
   * geprüft wird deshalb, dass genau die Id der Sitzung abgefragt wird und dass
   * eine fremde Id nur dann etwas liefert, wenn sie *die* Sitzung ist.
   */
  it('fragt ausschließlich das Konto der Sitzung ab', async () => {
    const { service, abgefragteIds } = buildService({});

    const quota = await service.getOwnQuota({ actor: plainActor, userId: USER_ID });

    expect(quota.userId).toBe(USER_ID);
    expect(abgefragteIds).toEqual([USER_ID]);
  });

  it('meldet ein unbekanntes Konto mit USER_NOT_FOUND', async () => {
    const { service } = buildService({ userExists: false });

    const error = await service
      .getOwnQuota({ actor: plainActor, userId: USER_ID })
      .catch((thrown: unknown) => thrown);

    expect(isResourceError(error)).toBe(true);
    if (!isResourceError(error)) {
      return;
    }

    expect(error.code).toBe('USER_NOT_FOUND');
  });
});

describe('Kontingent lesen und setzen', () => {
  it('liefert den vollständigen DTO inkl. permissions-Objekt und Belegung', async () => {
    const { service } = buildService({
      limits: { maxRamMb: 8192, maxConcurrentServers: 2 },
      userUsage: { runningRamMb: 2048, runningServers: 1, totalServers: 3 },
    });

    const dto = await service.getUserLimits(adminActor, USER_ID);

    expect(dto.userId).toBe(USER_ID);
    expect(dto.userDisplayName).toBe('Testnutzer');
    expect(dto.limits.maxRamMb).toBe(8192);
    expect(dto.limits.maxConcurrentServers).toBe(2);
    expect(dto.usage.totalServers).toBe(3);
    expect(dto.permissions).toEqual({ canView: true, canEdit: true });
  });

  it('verweigert Fremdzugriff ohne user.manage', async () => {
    const { service } = buildService({});

    await expect(service.getUserLimits(plainActor, USER_ID)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('lässt das eigene Kontingent lesen, aber nicht ändern', async () => {
    const { service } = buildService({});

    const dto = await service.getUserLimits(plainActor, USER_ID, { isSelf: true });

    expect(dto.permissions).toEqual({ canView: true, canEdit: false });
    await expect(
      service.setUserLimits(plainActor, USER_ID, { maxRamMb: 1024 }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('setzt ein Teil-Update, ohne die übrigen Felder anzutasten', async () => {
    const { service, stored } = buildService({
      limits: { maxRamMb: 8192, maxConcurrentServers: 2 },
    });

    await service.setUserLimits(adminActor, USER_ID, { maxRamMb: 16_384 });

    expect(stored.record?.limits).toEqual({
      maxRamMb: 16_384,
      maxConcurrentServers: 2,
    });
  });

  it('hebt eine einzelne Grenze über ausdrückliches null auf', async () => {
    const { service, stored } = buildService({
      limits: { maxRamMb: 8192, maxConcurrentServers: 2 },
    });

    await service.setUserLimits(adminActor, USER_ID, { maxConcurrentServers: null });

    expect(stored.record?.limits.maxConcurrentServers).toBeNull();
    expect(stored.record?.limits.maxRamMb).toBe(8192);
  });

  it('hebt mit clearUserLimits das gesamte Kontingent auf', async () => {
    const { service } = buildService({
      limits: { maxRamMb: 8192, maxConcurrentServers: 2 },
    });

    const dto = await service.clearUserLimits(adminActor, USER_ID);

    expect(dto.limits).toEqual(NO_USER_RESOURCE_LIMITS);
    expect(dto.updatedAt).toBeNull();
  });

  it('meldet ein unbekanntes Konto mit USER_NOT_FOUND', async () => {
    const { service } = buildService({ userExists: false });

    await expect(service.getUserLimits(adminActor, USER_ID)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});

describe('Kontingente für Listen (Mockup-Abgleich 12.1.3)', () => {
  it('liefert je Konto Arbeitsspeicher und Serveranzahl', async () => {
    const { service } = buildService({
      limits: { maxRamMb: 8192, maxConcurrentServers: 3 },
      userUsage: { runningRamMb: 4096, runningServers: 1 },
    });

    const kontingente = await service.listQuotaSummaries(adminActor, [USER_ID]);

    expect(kontingente.get(USER_ID)?.ram).toMatchObject({ limit: 8192, used: 4096 });
    expect(kontingente.get(USER_ID)?.servers).toMatchObject({ limit: 3, used: 1 });
  });

  it('zeigt ein Konto ohne Kontingent als unbegrenzt', async () => {
    const { service } = buildService({ userUsage: { runningRamMb: 512, runningServers: 1 } });

    const kontingente = await service.listQuotaSummaries(adminActor, [USER_ID]);

    // Ohne Datensatz gilt `NO_USER_RESOURCE_LIMITS` – die Belegung stimmt
    // trotzdem, nur eine Grenze gibt es nicht.
    expect(kontingente.get(USER_ID)?.ram).toMatchObject({ limit: null, used: 512 });
  });

  it('verlangt user.manage – es sind fremde Kontingente', async () => {
    const { service } = buildService();

    await expect(service.listQuotaSummaries(plainActor, [USER_ID])).rejects.toSatisfy(
      (error: unknown) => isResourceError(error) && error.code === 'PERMISSION_DENIED',
    );
  });

  it('kommt ohne Konten ohne Abfrage aus', async () => {
    const { service } = buildService();

    expect((await service.listQuotaSummaries(adminActor, [])).size).toBe(0);
  });
});

describe('Kapazitätsprüfung über den Service', () => {
  it('erlaubt den Start eines Nutzers ohne Kontingent auf einer leeren Node', async () => {
    const { service } = buildService({});

    const result = await service.assertStartCapacity({
      ownerId: USER_ID,
      nodeId: NODE_ID,
      requested: { ramMb: 4096, diskMb: 20_480 },
    });

    expect(result.allowed).toBe(true);
  });

  it('wirft RESOURCE_LIMIT_EXCEEDED mit einer Meldung, die die Grenze benennt', async () => {
    // Nur noch die Anzahl gleichzeitiger Server ist ein Kontingent (2026-09-18).
    const { service } = buildService({
      limits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 1 },
      userUsage: { runningServers: 1 },
    });

    const error = await service
      .assertStartCapacity({
        ownerId: USER_ID,
        nodeId: NODE_ID,
        requested: { ramMb: 2048, diskMb: 1024 },
      })
      .catch((thrown: unknown) => thrown);

    expect(isResourceError(error)).toBe(true);
    if (!isResourceError(error)) {
      return;
    }

    expect(error.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(error.violations).toHaveLength(1);
    expect(error.violations[0]?.resource).toBe('servers');
    expect(error.message).toContain('1');
  });

  it('merkt eine volle Node an, statt abzulehnen', async () => {
    const { service } = buildService({ node: nodeMitMessung({ ramAvailableMb: 768 }) });

    const result = await service.checkStartCapacity({
      ownerId: USER_ID,
      nodeId: NODE_ID,
      requested: { ramMb: 4096, diskMb: 1024 },
      at: JETZT,
    });

    expect(result.allowed).toBe(true);
    expect(result.concerns?.map((v) => v.scope)).toEqual(['nodeMeasured']);
  });

  it('merkt die Summe der Buchungen nicht mehr an (weiche Grenze, 2026-09-18)', async () => {
    const { service } = buildService({ nodeUsage: { runningRamMb: 32_000 } });

    const result = await service.checkStartCapacity({
      ownerId: USER_ID,
      nodeId: NODE_ID,
      requested: { ramMb: 4096, diskMb: 1024 },
    });

    expect(result.allowed).toBe(true);
    expect(result.concerns ?? []).toEqual([]);
  });

  /*
   * Die weiche Prüfung aus Etappe 4: „aktuell laufen zu viele Server bzw. der
   * aktuell frei verfügbare RAM reicht nicht – möchtest du trotzdem starten?"
   * Sie fragt, sie verbietet nicht; beantwortet wird sie mit `force`.
   */
  describe('Rückfrage statt Ablehnung (RESOURCE_CONFIRMATION_REQUIRED)', () => {
    async function starte(options: {
      nodeUsage?: Partial<NodeResourceUsage>;
      limits?: UserResourceLimits;
      userUsage?: Partial<UserResourceUsage>;
      node?: HostNodeRecord;
      force?: boolean;
    }): Promise<unknown> {
      const { service } = buildService({
        ...(options.nodeUsage ? { nodeUsage: options.nodeUsage } : {}),
        ...(options.limits ? { limits: options.limits } : {}),
        ...(options.userUsage ? { userUsage: options.userUsage } : {}),
        ...(options.node ? { node: options.node } : {}),
      });

      return service
        .assertStartCapacity({
          ownerId: USER_ID,
          nodeId: NODE_ID,
          requested: { ramMb: 4096, diskMb: 1024 },
          ...(options.force === undefined ? {} : { force: options.force }),
          at: JETZT,
        })
        .catch((thrown: unknown) => thrown);
    }

    it('fragt nicht mehr nach der gebuchten Belegung – nur die Messung zaehlt', async () => {
      const antwort = await starte({ nodeUsage: { runningRamMb: 32_000 } });

      expect(isResourceError(antwort)).toBe(false);
      expect(antwort).toMatchObject({ allowed: true });
    });

    it('fragt nach, wenn die Messung weniger frei sieht als gebucht', async () => {
      // Gebucht ist nichts – gemessen sind nur 1 GiB frei, weil neben den
      // Gameservern noch etwas anderes auf dem Homeserver läuft.
      const antwort = await starte({ node: nodeMitMessung({ ramAvailableMb: 1024 }) });

      expect(isResourceError(antwort) ? antwort.code : null).toBe('RESOURCE_CONFIRMATION_REQUIRED');
      expect(isResourceError(antwort) ? antwort.message : '').toContain('gemessene freie');
    });

    it('lässt `force` die Rückfrage übergehen', async () => {
      const antwort = await starte({ node: nodeMitMessung({ ramAvailableMb: 1024 }), force: true });

      expect(isResourceError(antwort)).toBe(false);
      expect(antwort).toMatchObject({ allowed: true });
    });

    it('lässt `force` ein Nutzer-Kontingent **nicht** übergehen', async () => {
      // Eine Grenze hat jemand gesetzt; ein Feld in der Anfrage darf sie nicht
      // aufheben, sonst wäre sie keine.
      const antwort = await starte({
        limits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 1 },
        userUsage: { runningServers: 1 },
        force: true,
      });

      expect(isResourceError(antwort) ? antwort.code : null).toBe('RESOURCE_LIMIT_EXCEEDED');
    });

    it('ignoriert eine veraltete Messung, statt auf ihr zu bestehen', async () => {
      const vorZweiStunden = new Date(JETZT.getTime() - 2 * 60 * 60 * 1000);
      const antwort = await starte({
        node: nodeMitMessung({ ramAvailableMb: 0, observedAt: vorZweiStunden }),
      });

      expect(isResourceError(antwort)).toBe(false);
      expect(antwort).toMatchObject({ allowed: true });
    });
  });

  it('reicht excludeServerId an beide Belegungsabfragen durch', async () => {
    const { service, excludedIds } = buildService({});

    await service.checkStartCapacity({
      ownerId: USER_ID,
      nodeId: NODE_ID,
      requested: { ramMb: 1024, diskMb: 1024 },
      excludeServerId: SERVER_ID,
    });

    expect(excludedIds).toEqual([SERVER_ID, SERVER_ID]);
  });

  it('meldet eine unbekannte Node mit NODE_NOT_FOUND', async () => {
    const { service } = buildService({ node: null });

    await expect(
      service.checkStartCapacity({
        ownerId: USER_ID,
        nodeId: NODE_ID,
        requested: { ramMb: 1024, diskMb: 1024 },
      }),
    ).rejects.toMatchObject({ code: 'NODE_NOT_FOUND' });
  });

  it('bewertet die Warnlage einer Node auch ohne Serverstart – aus der Messung', async () => {
    // 30 GiB gemessen belegt (32 768 − 2 768); die Buchungen zaehlen nicht mehr.
    const { service } = buildService({ node: nodeMitMessung({ ramAvailableMb: 2_768 }) });

    const warnings = await service.evaluateNodeState(NODE_ID, JETZT);

    expect(warnings.map((w) => w.resource)).toEqual(['ram']);
    expect(warnings[0]?.usedPercent).toBe(91.6);
  });

  it('sammelt die Warnlage aller Nodes für den Zeitgeber ein', async () => {
    const { service } = buildService({ node: nodeMitMessung({ ramAvailableMb: 2_768 }) });

    const warnings = await service.evaluateAllNodeWarnings(JETZT);

    expect(warnings.map((w) => w.resource)).toEqual(['ram']);
    expect(warnings[0]).toMatchObject({ scope: 'node', nodeId: NODE_ID, usedPercent: 91.6 });
  });

  it('warnt ohne Messung nicht, auch wenn viel gebucht ist', async () => {
    const { service } = buildService({ nodeUsage: { runningRamMb: 30_000 } });

    expect(await service.evaluateAllNodeWarnings(JETZT)).toEqual([]);
  });

  it('meldet nichts, solange jede Node unter dem Schwellwert bleibt', async () => {
    const { service } = buildService({ nodeUsage: { runningRamMb: 1024 } });

    expect(await service.evaluateAllNodeWarnings()).toEqual([]);
  });
});

/**
 * Warnungen auf **Server**-Ebene (Lastenheft §3.3).
 *
 * Gegenstück zur Node-Ebene: Der Dienst steuert nur den Schwellwert
 * (`RESOURCE_WARN_SERVER_PERCENT`) bei, die Messwerte bringt der Aufrufer mit.
 */
describe('Ressourcen-Service: Warnungen auf Server-Ebene', () => {
  const AT = new Date('2026-08-26T12:00:00.000Z');
  const LIMITS = { ramMb: 4096, diskMb: 20_480 };

  function last(overrides: Partial<ServerLoadSnapshot> = {}): ServerLoadSnapshot {
    return {
      serverId: SERVER_ID,
      nodeId: NODE_ID,
      ownerId: USER_ID,
      limits: LIMITS,
      usedRamMb: 1024,
      ...overrides,
    };
  }

  it('warnt nicht mehr gegen die Zuweisung eines Servers (weiche Grenze, 2026-09-18)', () => {
    const { service } = buildService({});

    const warnings = service.evaluateAllServerWarnings([last({ usedRamMb: 3900 })], AT);

    expect(warnings).toEqual([]);
  });

  it('schweigt, solange ein Server unter seinem Schwellwert bleibt', () => {
    const { service } = buildService({});

    expect(service.evaluateAllServerWarnings([last()], AT)).toEqual([]);
  });

  it('macht aus einem fehlenden Messwert keine Warnung', () => {
    // `null` heißt „das Spiel bzw. der Agent liefert diesen Wert nicht" – und
    // gerade nicht 0, was bei einer Belegung ohne Kontingent eine Warnung wäre.
    const { service } = buildService({});

    const warnings = service.evaluateAllServerWarnings([last({ usedRamMb: null })], AT);

    expect(warnings).toEqual([]);
  });

  it('liefert auch bei mehreren Servern keine RAM-Warnung mehr', () => {
    const { service } = buildService({});
    const zweiter = 'a1e5b6c2-0000-4000-8000-000000000003';

    const warnings = service.evaluateAllServerWarnings(
      [last({ usedRamMb: 4000 }), last({ serverId: zweiter, usedRamMb: 100 })],
      AT,
    );

    expect(warnings).toEqual([]);
  });

  it('warnt nicht mehr wegen CPU – es gibt keine Bezugsgroesse je Server', () => {
    // Die Server-Warnung fuer CPU rechnete gegen `resourceLimits.cpuCores`.
    // Mit dem Wegfall der Zuweisung gibt es dieses Limit nicht mehr, und eine
    // Warnung ohne Bezugsgroesse waere geraten.
    const { service } = buildService({});

    const warnungen = service.evaluateAllServerWarnings([last({ usedRamMb: 4000 })], AT);

    expect(warnungen.map((w) => w.resource)).not.toContain('cpu');
  });
});
