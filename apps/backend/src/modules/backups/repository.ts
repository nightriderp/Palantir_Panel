/**
 * Persistenz der Backup-Verwaltung (Pflichtenheft §6).
 *
 * Das Interface steht bewusst hier und nicht bei der Drizzle-Umsetzung, damit
 * Service und Aufbewahrungsregel ohne laufende Datenbank prüfbar bleiben
 * (CLAUDE.md §4). Es enthält ausschließlich Datenzugriff – jede fachliche Regel
 * liegt im Service bzw. in `retention.ts`.
 */

import type { BackupStatus, BackupType, ErrorCode } from '@palantir/contracts';
import { and, count, desc, eq, inArray, isNotNull, lte, sql, sum } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { backups, schedules } from '../../db/schema/backups.js';
import { users } from '../../db/schema/users.js';
import type { UserDirectory } from './ports.js';

/** Backup, wie es in der Datenbank steht (Entität `Backup`, Pflichtenheft §6). */
export interface BackupRecord {
  readonly id: string;
  readonly serverId: string;
  readonly ownerId: string;
  readonly type: BackupType;
  readonly status: BackupStatus;
  readonly isExport: boolean;
  readonly sizeBytes: number;
  readonly storagePath: string | null;
  readonly checksumSha256: string | null;
  readonly createdByUserId: string | null;
  readonly scheduleId: string | null;
  readonly correlationId: string | null;
  readonly containerStopped: boolean;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly failureCode: ErrorCode | null;
  readonly failureMessage: string | null;
}

export interface CreateBackupData {
  readonly serverId: string;
  readonly ownerId: string;
  readonly type: BackupType;
  readonly isExport: boolean;
  readonly createdByUserId: string | null;
  readonly scheduleId: string | null;
}

export interface UpdateBackupData {
  readonly status?: BackupStatus;
  readonly sizeBytes?: number;
  readonly storagePath?: string | null;
  readonly checksumSha256?: string | null;
  readonly correlationId?: string | null;
  readonly containerStopped?: boolean;
  readonly startedAt?: Date | null;
  readonly completedAt?: Date | null;
  readonly failureCode?: ErrorCode | null;
  readonly failureMessage?: string | null;
}

/** Backup-Zeitplan eines Servers (Entität `Schedule` mit `action = 'backup'`). */
export interface BackupScheduleRecord {
  readonly id: string;
  readonly serverId: string;
  readonly cronExpression: string;
  readonly enabled: boolean;
  /** Nutzdaten der Aktion, aktuell nur `stopServer`. */
  readonly stopServer: boolean;
  readonly lastRunAt: Date | null;
  readonly nextRunAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UpsertBackupScheduleData {
  readonly serverId: string;
  readonly cronExpression: string;
  readonly enabled: boolean;
  readonly stopServer: boolean;
  readonly nextRunAt: Date | null;
}

/** Zwischenergebnis der globalen Übersicht: Summen je Gruppe. */
export interface StorageAggregate {
  readonly key: string;
  readonly backupCount: number;
  readonly totalSizeBytes: number;
}

/** Summen der globalen Übersicht (Lastenheft §3.7). */
export interface BackupTotals {
  readonly totalCount: number;
  readonly totalSizeBytes: number;
  readonly manualCount: number;
  readonly manualSizeBytes: number;
  readonly automaticCount: number;
  readonly automaticSizeBytes: number;
  readonly failedCount: number;
  readonly pendingCount: number;
}

/** Filter der globalen Übersicht. */
export interface BackupFilter {
  readonly ownerId?: string;
  readonly serverId?: string;
  readonly type?: BackupType;
  readonly status?: BackupStatus;
}

export interface BackupRepository {
  findById(backupId: string): Promise<BackupRecord | null>;
  /** Alle Backups eines Servers, neueste zuerst – Grundlage der Aufbewahrungsregel. */
  listByServer(serverId: string): Promise<BackupRecord[]>;
  /** Backups mehrerer Server, neueste zuerst (globale Übersicht, „Meine Backups“). */
  listByOwner(ownerId: string): Promise<BackupRecord[]>;
  list(filter: BackupFilter): Promise<BackupRecord[]>;
  /** Läuft für diesen Server bereits ein Backup? */
  findActiveByServer(serverId: string): Promise<BackupRecord | null>;
  create(data: CreateBackupData): Promise<BackupRecord>;
  update(backupId: string, data: UpdateBackupData): Promise<BackupRecord>;
  remove(backupId: string): Promise<void>;

  totals(filter: BackupFilter): Promise<BackupTotals>;
  sumByOwner(filter: BackupFilter): Promise<StorageAggregate[]>;
  sumByServer(filter: BackupFilter): Promise<StorageAggregate[]>;

  findScheduleByServer(serverId: string): Promise<BackupScheduleRecord | null>;
  findScheduleById(scheduleId: string): Promise<BackupScheduleRecord | null>;
  upsertSchedule(data: UpsertBackupScheduleData): Promise<BackupScheduleRecord>;
  /** Zeitpläne, deren nächster Lauf erreicht ist. */
  listDueSchedules(now: Date): Promise<BackupScheduleRecord[]>;
  markScheduleRun(scheduleId: string, lastRunAt: Date, nextRunAt: Date | null): Promise<void>;
}

interface BackupRow {
  id: string;
  serverId: string;
  ownerId: string;
  type: BackupType;
  status: BackupStatus;
  isExport: boolean;
  sizeBytes: number;
  storagePath: string | null;
  checksumSha256: string | null;
  createdByUserId: string | null;
  scheduleId: string | null;
  correlationId: string | null;
  containerStopped: boolean;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failureCode: ErrorCode | null;
  failureMessage: string | null;
}

function toBackupRecord(row: BackupRow): BackupRecord {
  return { ...row };
}

interface ScheduleRow {
  id: string;
  serverId: string;
  cronExpression: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toScheduleRecord(row: ScheduleRow): BackupScheduleRecord {
  return {
    id: row.id,
    serverId: row.serverId,
    cronExpression: row.cronExpression,
    enabled: row.enabled,
    stopServer: row.payload['stopServer'] === true,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Baut die WHERE-Bedingung aus einem Filter; `undefined`, wenn nichts gefiltert wird. */
function whereFromFilter(filter: BackupFilter) {
  const conditions = [
    filter.ownerId === undefined ? undefined : eq(backups.ownerId, filter.ownerId),
    filter.serverId === undefined ? undefined : eq(backups.serverId, filter.serverId),
    filter.type === undefined ? undefined : eq(backups.type, filter.type),
    filter.status === undefined ? undefined : eq(backups.status, filter.status),
  ].filter((condition) => condition !== undefined);

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** `sum()` liefert in Postgres `numeric` und damit einen String bzw. `null`. */
function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

export function createDrizzleBackupRepository(db: Database): BackupRepository {
  async function loadBackup(backupId: string): Promise<BackupRecord | null> {
    const [row] = await db.select().from(backups).where(eq(backups.id, backupId)).limit(1);

    return row ? toBackupRecord(row) : null;
  }

  async function loadSchedule(scheduleId: string): Promise<BackupScheduleRecord | null> {
    const [row] = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1);

    return row ? toScheduleRecord(row) : null;
  }

  async function loadScheduleByServer(serverId: string): Promise<BackupScheduleRecord | null> {
    const [row] = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.serverId, serverId), eq(schedules.action, 'backup')))
      .limit(1);

    return row ? toScheduleRecord(row) : null;
  }

  return {
    findById: loadBackup,

    async listByServer(serverId) {
      const rows = await db
        .select()
        .from(backups)
        .where(eq(backups.serverId, serverId))
        .orderBy(desc(backups.createdAt));

      return rows.map(toBackupRecord);
    },

    async listByOwner(ownerId) {
      const rows = await db
        .select()
        .from(backups)
        .where(eq(backups.ownerId, ownerId))
        .orderBy(desc(backups.createdAt));

      return rows.map(toBackupRecord);
    },

    async list(filter) {
      const condition = whereFromFilter(filter);
      const query = db.select().from(backups).orderBy(desc(backups.createdAt));
      const rows = await (condition ? query.where(condition) : query);

      return rows.map(toBackupRecord);
    },

    async findActiveByServer(serverId) {
      const [row] = await db
        .select()
        .from(backups)
        .where(and(eq(backups.serverId, serverId), inArray(backups.status, ['pending', 'running'])))
        .limit(1);

      return row ? toBackupRecord(row) : null;
    },

    async create(data) {
      const [row] = await db
        .insert(backups)
        .values({
          serverId: data.serverId,
          ownerId: data.ownerId,
          type: data.type,
          isExport: data.isExport,
          createdByUserId: data.createdByUserId,
          scheduleId: data.scheduleId,
          status: 'pending',
        })
        .returning();

      if (!row) {
        throw new Error('Backup konnte nicht angelegt werden.');
      }

      return toBackupRecord(row);
    },

    async update(backupId, data) {
      const [row] = await db
        .update(backups)
        .set({ ...data })
        .where(eq(backups.id, backupId))
        .returning();

      if (!row) {
        // Kein BackupError: Wer hier landet, hat den Datensatz vorher geladen –
        // ein Verschwinden mittendrin ist ein echter Programmfehler.
        throw new Error(`Backup ${backupId} existiert nicht mehr.`);
      }

      return toBackupRecord(row);
    },

    async remove(backupId) {
      await db.delete(backups).where(eq(backups.id, backupId));
    },

    async totals(filter) {
      const condition = whereFromFilter(filter);
      const query = db
        .select({
          totalCount: count(),
          totalSizeBytes: sum(backups.sizeBytes),
          manualCount: sql<number>`count(*) filter (where ${backups.type} = 'manual')`,
          manualSizeBytes: sql<string>`coalesce(sum(${backups.sizeBytes}) filter (where ${backups.type} = 'manual'), 0)`,
          automaticCount: sql<number>`count(*) filter (where ${backups.type} = 'automatic')`,
          automaticSizeBytes: sql<string>`coalesce(sum(${backups.sizeBytes}) filter (where ${backups.type} = 'automatic'), 0)`,
          failedCount: sql<number>`count(*) filter (where ${backups.status} = 'failed')`,
          pendingCount: sql<number>`count(*) filter (where ${backups.status} in ('pending', 'running'))`,
        })
        .from(backups);

      const [row] = await (condition ? query.where(condition) : query);

      return {
        totalCount: Number(row?.totalCount ?? 0),
        totalSizeBytes: toNumber(row?.totalSizeBytes ?? null),
        manualCount: Number(row?.manualCount ?? 0),
        manualSizeBytes: toNumber(row?.manualSizeBytes ?? null),
        automaticCount: Number(row?.automaticCount ?? 0),
        automaticSizeBytes: toNumber(row?.automaticSizeBytes ?? null),
        failedCount: Number(row?.failedCount ?? 0),
        pendingCount: Number(row?.pendingCount ?? 0),
      };
    },

    async sumByOwner(filter) {
      const condition = whereFromFilter(filter);
      const query = db
        .select({
          key: backups.ownerId,
          backupCount: count(),
          totalSizeBytes: sum(backups.sizeBytes),
        })
        .from(backups)
        .groupBy(backups.ownerId);

      const rows = await (condition ? query.where(condition) : query);

      return rows.map((row) => ({
        key: row.key,
        backupCount: Number(row.backupCount),
        totalSizeBytes: toNumber(row.totalSizeBytes),
      }));
    },

    async sumByServer(filter) {
      const condition = whereFromFilter(filter);
      const query = db
        .select({
          key: backups.serverId,
          backupCount: count(),
          totalSizeBytes: sum(backups.sizeBytes),
        })
        .from(backups)
        .groupBy(backups.serverId);

      const rows = await (condition ? query.where(condition) : query);

      return rows.map((row) => ({
        key: row.key,
        backupCount: Number(row.backupCount),
        totalSizeBytes: toNumber(row.totalSizeBytes),
      }));
    },

    findScheduleByServer: loadScheduleByServer,

    findScheduleById: loadSchedule,

    async upsertSchedule(data) {
      const payload = { stopServer: data.stopServer };
      const existing = await loadScheduleByServer(data.serverId);

      if (existing) {
        const [row] = await db
          .update(schedules)
          .set({
            cronExpression: data.cronExpression,
            enabled: data.enabled,
            payload,
            nextRunAt: data.nextRunAt,
            updatedAt: new Date(),
          })
          .where(eq(schedules.id, existing.id))
          .returning();

        if (!row) {
          throw new Error(`Zeitplan ${existing.id} existiert nicht mehr.`);
        }

        return toScheduleRecord(row);
      }

      const [row] = await db
        .insert(schedules)
        .values({
          serverId: data.serverId,
          action: 'backup',
          cronExpression: data.cronExpression,
          payload,
          enabled: data.enabled,
          nextRunAt: data.nextRunAt,
        })
        .returning();

      if (!row) {
        throw new Error('Zeitplan konnte nicht angelegt werden.');
      }

      return toScheduleRecord(row);
    },

    async listDueSchedules(now) {
      const rows = await db
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.action, 'backup'),
            eq(schedules.enabled, true),
            isNotNull(schedules.nextRunAt),
            lte(schedules.nextRunAt, now),
          ),
        );

      return rows.map(toScheduleRecord);
    },

    async markScheduleRun(scheduleId, lastRunAt, nextRunAt) {
      await db
        .update(schedules)
        .set({ lastRunAt, nextRunAt, updatedAt: new Date() })
        .where(eq(schedules.id, scheduleId));
    },
  };
}

/** Drizzle-Umsetzung von {@link UserDirectory} – die Tabelle `users` gehört zu B1. */
export function createDrizzleUserDirectory(db: Database): UserDirectory {
  return {
    async findDisplayNames(userIds) {
      if (userIds.length === 0) {
        return new Map();
      }

      const rows = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...userIds]));

      return new Map(rows.map((row) => [row.id, row.displayName]));
    },
  };
}
