/**
 * Geplante, automatische Backups (Lastenheft §3.3, Pflichtenheft §6).
 *
 * **Wer entscheidet wann:** Das Backend führt den Zeitplan und stellt fest, dass
 * ein Lauf fällig ist; ausgeführt wird das Backup danach vom Agent über
 * `CREATE_BACKUP`. Das folgt der Aufteilung aus STRUKTUR.md – das Backend
 * orchestriert, der Agent arbeitet auf dem Dateisystem. Der „Backup-Job“ in A3
 * ist die Agent-Seite desselben Vorgangs, kein zweiter Zeitgeber.
 *
 * Der Zeitplan liegt in der allgemeinen Tabelle `schedules` (Entität `Schedule`
 * aus Pflichtenheft §6) mit `action = 'backup'`; B5 wertet ausschließlich diese
 * Aktion aus. Die übrigen Aktionen (`restart`, `command`) trägt das Paket
 * nach, das den Aufgaben-Tab baut.
 */

import type { BackupScheduleDto } from '@palantir/contracts';
import type { UpdateBackupScheduleInput } from '@palantir/validation';
import { type PermissionActor } from '../rbac/index.js';
import { nextCronRun, parseCronExpression } from './cron.js';
import { BackupError } from './errors.js';
import { type Clock, type ServerDirectory, systemClock } from './ports.js';
import {
  canManageBackupsOf,
  computeBackupSchedulePermissions,
  isOwnServer,
} from './permissions.js';
import type { BackupScheduleRecord, BackupRepository } from './repository.js';
import type { BackupService } from './service.js';

/** Ergebnis eines Scheduler-Durchlaufs. */
export interface ScheduleTickResult {
  /** Zeitpläne, für die ein Backup angestoßen wurde. */
  readonly startedScheduleIds: string[];
  /** Zeitpläne, deren Lauf ausfiel (z. B. weil schon ein Backup läuft). */
  readonly skippedScheduleIds: string[];
}

export interface BackupScheduleServiceOptions {
  readonly repository: BackupRepository;
  readonly servers: ServerDirectory;
  readonly backups: BackupService;
  readonly now?: Clock;
}

export interface BackupScheduleService {
  get(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
  ): Promise<BackupScheduleDto | null>;
  set(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
    input: UpdateBackupScheduleInput,
  ): Promise<BackupScheduleDto>;
  /**
   * Ein Durchlauf des Zeitgebers: alle fälligen Zeitpläne anstoßen.
   *
   * Bewusst als aufrufbare Funktion und nicht als eigener Timer im Modul – wer
   * den Takt vorgibt (Intervall beim Backend-Start, Test, Skript), entscheidet
   * der Aufrufer.
   */
  tick(): Promise<ScheduleTickResult>;
}

export function createBackupScheduleService(
  options: BackupScheduleServiceOptions,
): BackupScheduleService {
  const { repository, servers, backups } = options;
  const now = options.now ?? systemClock;

  async function requireManageableServer(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
  ) {
    const server = await servers.findById(serverId);

    if (!server) {
      throw new BackupError('SERVER_NOT_FOUND');
    }

    if (!canManageBackupsOf(actor, isOwnServer(actorUserId, server))) {
      // Wie beim Backup selbst: kein PERMISSION_DENIED, damit die Antwort die
      // Existenz fremder Server nicht verrät.
      throw new BackupError('SERVER_NOT_FOUND');
    }

    return server;
  }

  function toDto(
    actor: PermissionActor,
    record: BackupScheduleRecord,
    isOwn: boolean,
  ): BackupScheduleDto {
    return {
      serverId: record.serverId,
      enabled: record.enabled,
      cronExpression: record.cronExpression,
      lastRunAt: record.lastRunAt?.toISOString() ?? null,
      nextRunAt: record.enabled ? (record.nextRunAt?.toISOString() ?? null) : null,
      lastBackupId: null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      permissions: computeBackupSchedulePermissions(actor, isOwn),
    };
  }

  return {
    async get(actor, actorUserId, serverId) {
      const server = await requireManageableServer(actor, actorUserId, serverId);
      const record = await repository.findScheduleByServer(serverId);

      if (!record) {
        return null;
      }

      const dto = toDto(actor, record, isOwnServer(actorUserId, server));
      const lastFromSchedule = (await repository.listByServer(serverId)).find(
        (backup) => backup.scheduleId === record.id,
      );

      return { ...dto, lastBackupId: lastFromSchedule?.id ?? null };
    },

    async set(actor, actorUserId, serverId, input) {
      const server = await requireManageableServer(actor, actorUserId, serverId);

      // Wirft `SCHEDULE_INVALID_CRON`, bevor irgendetwas geschrieben wird – ein
      // gespeicherter Zeitplan, der nie auslöst, wäre schlimmer als eine
      // abgelehnte Eingabe.
      parseCronExpression(input.cronExpression);

      const record = await repository.upsertSchedule({
        serverId,
        cronExpression: input.cronExpression,
        enabled: input.enabled,
        stopServer: input.stopServer,
        nextRunAt: input.enabled ? nextCronRun(input.cronExpression, now()) : null,
      });

      return toDto(actor, record, isOwnServer(actorUserId, server));
    },

    async tick() {
      const moment = now();
      const due = await repository.listDueSchedules(moment);

      const startedScheduleIds: string[] = [];
      const skippedScheduleIds: string[] = [];

      for (const schedule of due) {
        // Der nächste Termin wird **vor** dem Lauf fortgeschrieben. Sonst
        // bliebe ein Zeitplan, dessen Backup scheitert, dauerhaft fällig und
        // löste bei jedem Durchlauf erneut aus.
        await repository.markScheduleRun(
          schedule.id,
          moment,
          nextCronRun(schedule.cronExpression, moment),
        );

        try {
          await backups.createScheduled(schedule.serverId, schedule.id, schedule.stopServer);
          startedScheduleIds.push(schedule.id);
        } catch {
          // Ein bereits laufendes Backup oder ein gelöschter Server darf die
          // übrigen Zeitpläne nicht aufhalten. Der nächste Termin steht schon.
          skippedScheduleIds.push(schedule.id);
        }
      }

      return { startedScheduleIds, skippedScheduleIds };
    },
  };
}
