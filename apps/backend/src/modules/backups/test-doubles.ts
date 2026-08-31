/**
 * Testdoubles der Backup-Verwaltung.
 *
 * Bewusst eine eigene Datei statt Fakes in jeder Testdatei: Service- und
 * Zeitplan-Tests arbeiten auf demselben Bestand, und zwei leicht verschiedene
 * Nachbauten desselben Repositories wären eine Fehlerquelle für sich. Die Datei
 * wird **nicht** aus `index.ts` re-exportiert – sie gehört zu den Tests, nicht
 * zur Schnittstelle des Moduls.
 */

import type { ApiResponse, ArchiveExtraFile } from '@palantir/contracts';
import { fail, ok } from '@palantir/contracts';
import type {
  BackupAgentGateway,
  BackupEventPublisher,
  BackupServerRecord,
  ServerDirectory,
  UserDirectory,
} from './ports.js';
import type {
  BackupFilter,
  BackupRecord,
  BackupRepository,
  BackupScheduleRecord,
  CreateBackupData,
  UpdateBackupData,
  UpsertBackupScheduleData,
} from './repository.js';

let nextId = 0;

/** Fortlaufende, aber UUID-förmige Ids – die Route prüft auf UUID-Format. */
export function testId(prefix = '0'): string {
  nextId += 1;

  return `${prefix.repeat(8).slice(0, 8)}-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

export function testServer(overrides: Partial<BackupServerRecord> = {}): BackupServerRecord {
  return {
    id: testId('1'),
    name: 'Wüstensturm',
    ownerId: testId('2'),
    status: 'running',
    dockerContainerId: 'container-1',
    dataHostPath: '/srv/palantir/data/wuestensturm',
    memberUserIds: [],
    ...overrides,
  };
}

/**
 * Vollständiger Backup-Datensatz für Tests, die einen Bestand voraussetzen
 * (Aufbewahrungsregel, Übersicht). Der Zeitstempel wird bewusst mitgegeben:
 * Über `create()` entstünde ein Datensatz mit „jetzt“, und die Frist aus
 * Lastenheft §3.3 ließe sich nicht prüfen.
 */
export function testBackup(overrides: Partial<BackupRecord> = {}): BackupRecord {
  return {
    id: testId('3'),
    serverId: testId('1'),
    ownerId: testId('2'),
    type: 'automatic',
    status: 'completed',
    isExport: false,
    sizeBytes: 1024,
    storagePath: '/srv/palantir/backups/alt.tar.zst',
    checksumSha256: 'b'.repeat(64),
    createdByUserId: null,
    scheduleId: null,
    correlationId: null,
    containerStopped: false,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
    startedAt: new Date('2026-08-26T00:00:00.000Z'),
    completedAt: new Date('2026-08-26T00:01:00.000Z'),
    failureCode: null,
    failureMessage: null,
    ...overrides,
  };
}

/** Server-Verzeichnis, das B3 später über die Tabelle `game_servers` liefert. */
export function fakeServerDirectory(servers: readonly BackupServerRecord[]): ServerDirectory {
  const byId = new Map(servers.map((server) => [server.id, server]));

  return {
    findById: (serverId) => Promise.resolve(byId.get(serverId) ?? null),
    findManyByIds: (serverIds) =>
      Promise.resolve(
        serverIds
          .map((id) => byId.get(id))
          .filter((server): server is BackupServerRecord => !!server),
      ),
  };
}

export function fakeUserDirectory(names: Record<string, string> = {}): UserDirectory {
  return {
    findDisplayNames: (userIds) =>
      Promise.resolve(
        new Map(
          userIds.filter((id) => names[id] !== undefined).map((id) => [id, names[id] as string]),
        ),
      ),
  };
}

/** Aufzeichnung dessen, was an den Agent geschickt wurde. */
export interface FakeAgent extends BackupAgentGateway {
  readonly createdBackupIds: string[];
  readonly deletedStoragePaths: string[];
  readonly restoredBackupIds: string[];
  /** Prüfsummen, mit denen der Service `restoreBackup` aufgerufen hat. */
  readonly restoredChecksums: string[];
  /** Zusatzdateien je `createBackup`-Aufruf – beim Export das Manifest (P8). */
  readonly createdExtraFiles: (readonly ArchiveExtraFile[])[];
  /** Antwort, die `createBackup` liefern soll. */
  createResponse: ApiResponse<unknown>;
  deleteResponse: ApiResponse<unknown>;
  restoreResponse: ApiResponse<unknown>;
  /** Blöcke, die `downloadBackupChunk` nacheinander liefert. */
  downloadResponses: ApiResponse<unknown>[];
}

export function fakeAgent(overrides: Partial<FakeAgent> = {}): FakeAgent {
  const agent: FakeAgent = {
    createdBackupIds: [],
    createdExtraFiles: [],
    deletedStoragePaths: [],
    restoredBackupIds: [],
    restoredChecksums: [],
    createResponse: ok({
      backupId: '00000000-0000-4000-8000-000000000000',
      storagePath: '/srv/palantir/backups/a.tar.zst',
      sizeBytes: 1024,
      checksumSha256: 'a'.repeat(64),
      containerStopped: false,
      startedAt: '2026-08-26T04:00:00.000Z',
      completedAt: '2026-08-26T04:01:00.000Z',
    }),
    deleteResponse: ok({
      backupId: '00000000-0000-4000-8000-000000000000',
      removed: true,
      freedBytes: 1024,
    }),
    restoreResponse: ok({
      backupId: '00000000-0000-4000-8000-000000000000',
      restoredBytes: 1024,
      containerStopped: true,
      startedAt: '2026-08-26T05:00:00.000Z',
      completedAt: '2026-08-26T05:02:00.000Z',
    }),
    downloadResponses: [],

    createBackup(payload) {
      agent.createdBackupIds.push(payload.backupId);
      agent.createdExtraFiles.push(payload.extraFiles ?? []);
      const response = agent.createResponse;

      return Promise.resolve(
        response.success && typeof response.data === 'object' && response.data !== null
          ? ok({ ...response.data, backupId: payload.backupId })
          : response,
      );
    },

    restoreBackup(payload) {
      agent.restoredBackupIds.push(payload.backupId);
      agent.restoredChecksums.push(payload.expectedChecksum);

      return Promise.resolve(agent.restoreResponse);
    },

    downloadBackupChunk() {
      return Promise.resolve(
        agent.downloadResponses.shift() ?? fail('AGENT_COMMAND_FAILED', 'Kein Block hinterlegt.'),
      );
    },

    deleteBackup(payload) {
      agent.deletedStoragePaths.push(payload.storagePath);

      return Promise.resolve(agent.deleteResponse);
    },

    ...overrides,
  };

  return agent;
}

/** Ereignis-Senke, die mitschreibt statt zu verschicken. */
export interface RecordingEventPublisher extends BackupEventPublisher {
  readonly published: { event: string; payload: Record<string, unknown> }[];
}

export function recordingEventPublisher(): RecordingEventPublisher {
  const published: { event: string; payload: Record<string, unknown> }[] = [];

  return {
    published,
    publish(event, payload) {
      published.push({ event, payload });
    },
  };
}

/**
 * Repository im Speicher.
 *
 * Bildet die Zusicherungen der Datenbank nach, auf die sich der Service
 * verlässt – insbesondere „höchstens ein laufendes Backup je Server“ und
 * „höchstens ein Backup-Zeitplan je Server“ (beides partielle Unique-Indizes in
 * der Migration).
 */
export function inMemoryBackupRepository(seed: readonly BackupRecord[] = []): BackupRepository {
  const rows = new Map<string, BackupRecord>(seed.map((record) => [record.id, record]));
  const schedules = new Map<string, BackupScheduleRecord>();

  function matches(record: BackupRecord, filter: BackupFilter): boolean {
    return (
      (filter.ownerId === undefined || record.ownerId === filter.ownerId) &&
      (filter.serverId === undefined || record.serverId === filter.serverId) &&
      (filter.type === undefined || record.type === filter.type) &&
      (filter.status === undefined || record.status === filter.status)
    );
  }

  function newestFirst(records: BackupRecord[]): BackupRecord[] {
    return [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  return {
    findById: (backupId) => Promise.resolve(rows.get(backupId) ?? null),

    listByServer: (serverId) =>
      Promise.resolve(newestFirst([...rows.values()].filter((r) => r.serverId === serverId))),

    listByOwner: (ownerId) =>
      Promise.resolve(newestFirst([...rows.values()].filter((r) => r.ownerId === ownerId))),

    list: (filter) =>
      Promise.resolve(newestFirst([...rows.values()].filter((r) => matches(r, filter)))),

    findActiveByServer: (serverId) =>
      Promise.resolve(
        [...rows.values()].find(
          (r) => r.serverId === serverId && (r.status === 'pending' || r.status === 'running'),
        ) ?? null,
      ),

    create(data: CreateBackupData) {
      const active = [...rows.values()].find(
        (r) => r.serverId === data.serverId && (r.status === 'pending' || r.status === 'running'),
      );

      if (active) {
        // Entspricht dem partiellen Unique-Index `backups_one_active_per_server_idx`.
        return Promise.reject(new Error('backups_one_active_per_server_idx'));
      }

      const record: BackupRecord = {
        id: testId('3'),
        serverId: data.serverId,
        ownerId: data.ownerId,
        type: data.type,
        status: 'pending',
        isExport: data.isExport,
        sizeBytes: 0,
        storagePath: null,
        checksumSha256: null,
        createdByUserId: data.createdByUserId,
        scheduleId: data.scheduleId,
        correlationId: null,
        containerStopped: false,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        failureCode: null,
        failureMessage: null,
      };

      rows.set(record.id, record);

      return Promise.resolve(record);
    },

    update(backupId, data: UpdateBackupData) {
      const existing = rows.get(backupId);

      if (!existing) {
        return Promise.reject(new Error(`Backup ${backupId} existiert nicht mehr.`));
      }

      const updated: BackupRecord = { ...existing, ...data };
      rows.set(backupId, updated);

      return Promise.resolve(updated);
    },

    remove(backupId) {
      rows.delete(backupId);

      return Promise.resolve();
    },

    totals(filter) {
      const matching = [...rows.values()].filter((r) => matches(r, filter));
      const sum = (list: BackupRecord[]) => list.reduce((total, r) => total + r.sizeBytes, 0);
      const manual = matching.filter((r) => r.type === 'manual');
      const automatic = matching.filter((r) => r.type === 'automatic');

      return Promise.resolve({
        totalCount: matching.length,
        totalSizeBytes: sum(matching),
        manualCount: manual.length,
        manualSizeBytes: sum(manual),
        automaticCount: automatic.length,
        automaticSizeBytes: sum(automatic),
        failedCount: matching.filter((r) => r.status === 'failed').length,
        pendingCount: matching.filter((r) => r.status === 'pending' || r.status === 'running')
          .length,
      });
    },

    sumByOwner(filter) {
      return Promise.resolve(
        groupSums(
          [...rows.values()].filter((r) => matches(r, filter)),
          (r) => r.ownerId,
        ),
      );
    },

    sumByServer(filter) {
      return Promise.resolve(
        groupSums(
          [...rows.values()].filter((r) => matches(r, filter)),
          (r) => r.serverId,
        ),
      );
    },

    findScheduleByServer: (serverId) =>
      Promise.resolve([...schedules.values()].find((s) => s.serverId === serverId) ?? null),

    findScheduleById: (scheduleId) => Promise.resolve(schedules.get(scheduleId) ?? null),

    upsertSchedule(data: UpsertBackupScheduleData) {
      const existing = [...schedules.values()].find((s) => s.serverId === data.serverId);
      const record: BackupScheduleRecord = {
        id: existing?.id ?? testId('4'),
        serverId: data.serverId,
        cronExpression: data.cronExpression,
        enabled: data.enabled,
        stopServer: data.stopServer,
        lastRunAt: existing?.lastRunAt ?? null,
        nextRunAt: data.nextRunAt,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };

      schedules.set(record.id, record);

      return Promise.resolve(record);
    },

    listDueSchedules: (now) =>
      Promise.resolve(
        [...schedules.values()].filter(
          (s) => s.enabled && s.nextRunAt !== null && s.nextRunAt.getTime() <= now.getTime(),
        ),
      ),

    markScheduleRun(scheduleId, lastRunAt, nextRunAt) {
      const existing = schedules.get(scheduleId);

      if (existing) {
        schedules.set(scheduleId, { ...existing, lastRunAt, nextRunAt, updatedAt: new Date() });
      }

      return Promise.resolve();
    },
  };
}

function groupSums(
  records: readonly BackupRecord[],
  keyOf: (record: BackupRecord) => string | null,
): { key: string | null; backupCount: number; totalSizeBytes: number }[] {
  const groups = new Map<string | null, { backupCount: number; totalSizeBytes: number }>();

  for (const record of records) {
    const key = keyOf(record);
    const entry = groups.get(key) ?? { backupCount: 0, totalSizeBytes: 0 };
    entry.backupCount += 1;
    entry.totalSizeBytes += record.sizeBytes;
    groups.set(key, entry);
  }

  return [...groups.entries()].map(([key, value]) => ({ key, ...value }));
}
