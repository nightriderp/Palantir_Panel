/**
 * Tests des Ressourcen-Service.
 *
 * Die Repositories sind bewusst durch schlichte Fakes ersetzt (analog zur
 * Fake-`ContainerRuntime` des Agents) – die Regeln dieses Moduls sollen ohne
 * laufende Datenbank prüfbar sein (CLAUDE.md §4).
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
  totalResources: { ramMb: 32_768, cpuCores: 16, diskMb: 2_097_152 },
  measuredUsage: null,
};

function emptyUserUsage(): UserResourceUsage {
  return {
    runningRamMb: 0,
    runningCpuCores: 0,
    allocatedDiskMb: 0,
    runningServers: 0,
    totalServers: 0,
  };
}

function emptyNodeUsage(): NodeResourceUsage {
  return {
    runningRamMb: 0,
    runningCpuCores: 0,
    allocatedDiskMb: 0,
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
      return [NODE];
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
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: 51_200, maxConcurrentServers: 2 },
      userUsage: {
        runningRamMb: 2048,
        runningCpuCores: 1.5,
        allocatedDiskMb: 20_480,
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
    });
    expect(quota.cpu).toEqual({
      resource: 'cpu',
      unit: 'cores',
      limit: 4,
      used: 1.5,
      remaining: 2.5,
    });
    // Speicherplatz zählt alle Server, nicht nur die laufenden.
    expect(quota.disk).toEqual({
      resource: 'disk',
      unit: 'mb',
      limit: 51_200,
      used: 20_480,
      remaining: 30_720,
    });
    // Die Serveranzahl zählt die gleichzeitig laufenden – wie in `capacity.ts`.
    expect(quota.servers).toEqual({
      resource: 'servers',
      unit: 'count',
      limit: 2,
      used: 1,
      remaining: 1,
    });
    expect(quota.updatedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('meldet ohne Limit `null` als Limit und Rest, nennt die Belegung aber weiter', async () => {
    const { service } = buildService({
      userUsage: { runningRamMb: 4096, allocatedDiskMb: 10_240, runningServers: 2 },
    });

    const quota = await service.getOwnQuota({ actor: plainActor, userId: USER_ID });

    expect(quota.ram.limit).toBeNull();
    expect(quota.ram.remaining).toBeNull();
    expect(quota.ram.used).toBe(4096);
    expect(quota.disk.remaining).toBeNull();
    expect(quota.servers.remaining).toBeNull();
    expect(quota.updatedAt).toBeNull();
  });

  it('gibt bei überschrittenem Limit 0 statt eines negativen Rests zurück', async () => {
    const { service } = buildService({
      limits: { maxRamMb: 4096, maxCpuCores: null, maxDiskMb: null, maxConcurrentServers: 1 },
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
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: null, maxConcurrentServers: 2 },
      userUsage: { runningRamMb: 2048, runningServers: 1, totalServers: 3 },
    });

    const dto = await service.getUserLimits(adminActor, USER_ID);

    expect(dto.userId).toBe(USER_ID);
    expect(dto.userDisplayName).toBe('Testnutzer');
    expect(dto.limits.maxRamMb).toBe(8192);
    expect(dto.limits.maxDiskMb).toBeNull();
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
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: 51_200, maxConcurrentServers: 2 },
    });

    await service.setUserLimits(adminActor, USER_ID, { maxRamMb: 16_384 });

    expect(stored.record?.limits).toEqual({
      maxRamMb: 16_384,
      maxCpuCores: 4,
      maxDiskMb: 51_200,
      maxConcurrentServers: 2,
    });
  });

  it('hebt eine einzelne Grenze über ausdrückliches null auf', async () => {
    const { service, stored } = buildService({
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: 51_200, maxConcurrentServers: 2 },
    });

    await service.setUserLimits(adminActor, USER_ID, { maxCpuCores: null });

    expect(stored.record?.limits.maxCpuCores).toBeNull();
    expect(stored.record?.limits.maxRamMb).toBe(8192);
  });

  it('hebt mit clearUserLimits das gesamte Kontingent auf', async () => {
    const { service } = buildService({
      limits: { maxRamMb: 8192, maxCpuCores: 4, maxDiskMb: 51_200, maxConcurrentServers: 2 },
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
      limits: { maxRamMb: 8192, maxCpuCores: null, maxDiskMb: null, maxConcurrentServers: 3 },
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
      requested: { ramMb: 4096, cpuCores: 2, diskMb: 20_480 },
    });

    expect(result.allowed).toBe(true);
  });

  it('wirft RESOURCE_LIMIT_EXCEEDED mit einer Meldung, die die Grenze benennt', async () => {
    const { service } = buildService({
      limits: { ...NO_USER_RESOURCE_LIMITS, maxRamMb: 4096 },
      userUsage: { runningRamMb: 4096 },
    });

    const error = await service
      .assertStartCapacity({
        ownerId: USER_ID,
        nodeId: NODE_ID,
        requested: { ramMb: 2048, cpuCores: 1, diskMb: 1024 },
      })
      .catch((thrown: unknown) => thrown);

    expect(isResourceError(error)).toBe(true);
    if (!isResourceError(error)) {
      return;
    }

    expect(error.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(error.violations).toHaveLength(1);
    expect(error.message).toContain('4096 MiB');
  });

  it('lehnt bei voller Node ab, obwohl der Nutzer gar kein Kontingent hat', async () => {
    const { service } = buildService({ nodeUsage: { runningRamMb: 32_000 } });

    const result = await service.checkStartCapacity({
      ownerId: USER_ID,
      nodeId: NODE_ID,
      requested: { ramMb: 4096, cpuCores: 1, diskMb: 1024 },
    });

    expect(result.allowed).toBe(false);
    expect(result.violations.map((v) => v.scope)).toEqual(['node']);
  });

  it('reicht excludeServerId an beide Belegungsabfragen durch', async () => {
    const { service, excludedIds } = buildService({});

    await service.checkStartCapacity({
      ownerId: USER_ID,
      nodeId: NODE_ID,
      requested: { ramMb: 1024, cpuCores: 1, diskMb: 1024 },
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
        requested: { ramMb: 1024, cpuCores: 1, diskMb: 1024 },
      }),
    ).rejects.toMatchObject({ code: 'NODE_NOT_FOUND' });
  });

  it('bewertet die Warnlage einer Node auch ohne Serverstart', async () => {
    const { service } = buildService({ nodeUsage: { runningRamMb: 30_000 } });

    const warnings = await service.evaluateNodeState(NODE_ID, new Date('2026-08-26T12:00:00.000Z'));

    expect(warnings.map((w) => w.resource)).toEqual(['ram']);
    expect(warnings[0]?.usedPercent).toBe(91.6);
  });

  it('sammelt die Warnlage aller Nodes für den Zeitgeber ein', async () => {
    const { service } = buildService({ nodeUsage: { runningRamMb: 30_000 } });

    const warnings = await service.evaluateAllNodeWarnings(new Date('2026-08-26T12:00:00.000Z'));

    expect(warnings.map((w) => w.resource)).toEqual(['ram']);
    expect(warnings[0]).toMatchObject({ scope: 'node', nodeId: NODE_ID, usedPercent: 91.6 });
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
  const LIMITS = { ramMb: 4096, cpuCores: 2, diskMb: 20_480 };

  function last(overrides: Partial<ServerLoadSnapshot> = {}): ServerLoadSnapshot {
    return {
      serverId: SERVER_ID,
      nodeId: NODE_ID,
      ownerId: USER_ID,
      limits: LIMITS,
      usedRamMb: 1024,
      usedCpuCores: 0.2,
      usedDiskMb: null,
      ...overrides,
    };
  }

  it('misst jeden Server gegen sein eigenes Limit', () => {
    const { service } = buildService({});

    const warnings = service.evaluateAllServerWarnings([last({ usedRamMb: 3900 })], AT);

    expect(warnings).toEqual([
      {
        scope: 'server',
        resource: 'ram',
        unit: 'mb',
        nodeId: NODE_ID,
        serverId: SERVER_ID,
        used: 3900,
        total: 4096,
        usedPercent: 95.2,
        thresholdPercent: 90,
        at: AT.toISOString(),
      },
    ]);
  });

  it('schweigt, solange ein Server unter seinem Schwellwert bleibt', () => {
    const { service } = buildService({});

    expect(service.evaluateAllServerWarnings([last()], AT)).toEqual([]);
  });

  it('macht aus einem fehlenden Messwert keine Warnung', () => {
    // `null` heißt „das Spiel bzw. der Agent liefert diesen Wert nicht" – und
    // gerade nicht 0, was bei einer Belegung ohne Kontingent eine Warnung wäre.
    const { service } = buildService({});

    const warnings = service.evaluateAllServerWarnings(
      [last({ usedRamMb: null, usedCpuCores: null, usedDiskMb: null })],
      AT,
    );

    expect(warnings).toEqual([]);
  });

  it('wertet mehrere Server in einem Durchlauf aus', () => {
    const { service } = buildService({});
    const zweiter = 'a1e5b6c2-0000-4000-8000-000000000003';

    const warnings = service.evaluateAllServerWarnings(
      [last({ usedRamMb: 4000 }), last({ serverId: zweiter, usedRamMb: 100 })],
      AT,
    );

    expect(warnings.map((w) => w.serverId)).toEqual([SERVER_ID]);
  });

  it('bewertet CPU in Kernen, nicht in Prozent eines Kerns', () => {
    /*
     * 2,5 ausgelastete Kerne (`cpuPercent` 250) gegen ein Limit von 2 Kernen
     * sind 125 % – eine Warnung. Dieselbe Zahl als „250 % des Kontingents" oder
     * als „250 Kerne" gelesen ergäbe entweder Unsinn oder eine Dauerwarnung.
     */
    const { service } = buildService({});

    const zuViel = service.evaluateAllServerWarnings([last({ usedCpuCores: 2.5 })], AT);

    expect(zuViel.map((w) => w.resource)).toEqual(['cpu']);
    expect(zuViel[0]?.usedPercent).toBe(125);

    // Gegenprobe: dieselben 250 % eines Kerns gegen ein Limit von vier Kernen
    // sind 62,5 % – und damit kein Warnungsgrund.
    const genug = service.evaluateAllServerWarnings(
      [last({ usedCpuCores: 2.5, limits: { ...LIMITS, cpuCores: 4 } })],
      AT,
    );

    expect(genug).toEqual([]);
  });
});
