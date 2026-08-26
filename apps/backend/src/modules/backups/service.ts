/**
 * Backup-Verwaltung (Lastenheft §3.3 und §3.7, Pflichtenheft §6).
 *
 * Der Service **orchestriert nur**: Er führt den Datensatz, prüft Rechte und
 * Zustände und schickt Befehle an den Agent. Auf Dateien des Homeservers greift
 * er nie selbst zu (STRUKTUR.md B5/A3, Pflichtenheft §2.3).
 *
 * Ablauf eines Backups:
 * 1. Server auflösen, Recht (`backup.manage.own`/`.any`) und Zustand prüfen
 * 2. Datensatz mit `status = 'pending'` anlegen und **sofort** ausliefern –
 *    ein Backup dauert Minuten, die REST-Antwort darf nicht darauf warten
 * 3. Im Hintergrund `CREATE_BACKUP` an den Agent, Ergebnis prüfen, Datensatz
 *    auf `completed` bzw. `failed` setzen
 * 4. Bei Erfolg die Aufbewahrungsregel für diesen Server anwenden
 *    (`retention.ts`), bei Fehlschlag `backup.failed` auslösen (Konsument: B6)
 *
 * Jede Methode prüft die Berechtigung selbst, zusätzlich zum Guard an der Route –
 * die Regel gilt damit auch für Aufrufer außerhalb des HTTP-Pfads (analog zum
 * Rollen-Service in B2).
 */

import {
  type BackupDto,
  type BackupOverviewDto,
  type BackupStorageBucket,
  type ErrorCode,
  isErrorCode,
} from '@palantir/contracts';
import {
  type BackupOverviewQuery,
  type CreateBackupInput,
  createBackupCommandResultSchema,
  deleteBackupCommandResultSchema,
  downloadBackupCommandResultSchema,
  restoreBackupCommandResultSchema,
} from '@palantir/validation';
import { type PermissionActor } from '../rbac/index.js';
import { BackupError } from './errors.js';
import {
  type BackupAgentGateway,
  type BackupEventPublisher,
  type BackupServerRecord,
  type Clock,
  type JobRunner,
  type ServerDirectory,
  type UserDirectory,
  fireAndForgetJobRunner,
  noopEventPublisher,
  systemClock,
} from './ports.js';
import {
  canManageBackupsOf,
  computeBackupOverviewPermissions,
  computeBackupPermissions,
  isOwnServer,
} from './permissions.js';
import type { BackupFilter, BackupRecord, BackupRepository } from './repository.js';
import { isRetentionProtected, retentionExpiresAt, selectExpiredBackups } from './retention.js';

/**
 * Größe eines Blocks beim Herunterladen.
 *
 * 4 MiB roh werden Base64-kodiert zu rund 5,5 MiB JSON. Das ist groß genug,
 * dass ein Gigabyte-Archiv nicht in Zehntausenden Runden übertragen wird, und
 * klein genug, dass ein Block die WebSocket-Verbindung zum Agent nicht für
 * andere Befehle blockiert.
 */
export const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

/** Ein Block des Archivs, wie ihn die Download-Route weiterreicht. */
export interface BackupDownloadChunk {
  readonly bytes: Buffer;
  readonly eof: boolean;
}

/** Kopfdaten des Downloads, bekannt nach dem ersten Block. */
export interface BackupDownload {
  readonly fileName: string;
  readonly totalBytes: number;
  /** Liefert die Blöcke in Reihenfolge, bis das Archiv vollständig ist. */
  chunks(): AsyncGenerator<BackupDownloadChunk>;
}

/** Ergebnis eines Aufbewahrungslaufs. */
export interface RetentionOutcome {
  /** Ids der entfernten Backups. */
  readonly removedBackupIds: string[];
  /** Insgesamt freigegebener Speicher in Byte. */
  readonly freedBytes: number;
}

export interface BackupServiceOptions {
  readonly repository: BackupRepository;
  readonly servers: ServerDirectory;
  readonly users: UserDirectory;
  readonly agent: BackupAgentGateway;
  readonly events?: BackupEventPublisher;
  readonly now?: Clock;
  readonly runJob?: JobRunner;
}

export interface BackupService {
  listForServer(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
  ): Promise<BackupDto[]>;
  /** Alle Backups eines Nutzers – speist „Meine Backups“ (F4). */
  listForOwner(actor: PermissionActor, actorUserId: string, ownerId: string): Promise<BackupDto[]>;
  get(actor: PermissionActor, actorUserId: string, backupId: string): Promise<BackupDto>;
  /** Manuelles Backup auf Knopfdruck (Lastenheft §3.3). */
  createManual(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
    input: CreateBackupInput,
  ): Promise<BackupDto>;
  /** Vollständiger Datenexport – ein manuelles Backup mit `isExport` (Lastenheft §3.3). */
  createExport(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
    input: CreateBackupInput,
  ): Promise<BackupDto>;
  /** Geplantes Backup aus einem Zeitplan – ohne Aufrufer, deshalb ohne Rechteprüfung. */
  createScheduled(serverId: string, scheduleId: string, stopServer: boolean): Promise<BackupDto>;
  remove(actor: PermissionActor, actorUserId: string, backupId: string): Promise<void>;
  restore(actor: PermissionActor, actorUserId: string, backupId: string): Promise<BackupDto>;
  openDownload(
    actor: PermissionActor,
    actorUserId: string,
    backupId: string,
  ): Promise<BackupDownload>;
  /** Globale Übersicht inkl. Speicherverbrauch (Lastenheft §3.7, Admin-Ansicht F10). */
  overview(actor: PermissionActor, query: BackupOverviewQuery): Promise<BackupOverviewDto>;
  /** Aufbewahrungsregel für einen Server anwenden (Lastenheft §3.3). */
  applyRetention(serverId: string): Promise<RetentionOutcome>;
}

/** Fehlercode aus einer Agent-Antwort, notfalls der allgemeine Ausführungsfehler. */
function agentErrorCode(code: string | undefined): ErrorCode {
  return code !== undefined && isErrorCode(code) ? code : 'AGENT_COMMAND_FAILED';
}

export function createBackupService(options: BackupServiceOptions): BackupService {
  const { repository, servers, users, agent } = options;
  const events = options.events ?? noopEventPublisher;
  const now = options.now ?? systemClock;
  const runJob = options.runJob ?? fireAndForgetJobRunner;

  async function loadServerOrFail(serverId: string): Promise<BackupServerRecord> {
    const server = await servers.findById(serverId);

    if (!server) {
      throw new BackupError('SERVER_NOT_FOUND');
    }

    return server;
  }

  /**
   * Lädt ein Backup und stellt sicher, dass der Aufrufer es verwalten darf.
   *
   * Fehlt das Recht, wird `BACKUP_NOT_FOUND` gemeldet und nicht
   * `PERMISSION_DENIED`: Sonst verriete die Antwort, dass es das Backup eines
   * fremden Nutzers gibt.
   */
  async function loadManageableBackup(
    actor: PermissionActor,
    actorUserId: string,
    backupId: string,
  ): Promise<{ backup: BackupRecord; server: BackupServerRecord | null }> {
    const backup = await repository.findById(backupId);

    if (!backup) {
      throw new BackupError('BACKUP_NOT_FOUND');
    }

    const server = await servers.findById(backup.serverId);
    const isOwn =
      server === null ? backup.ownerId === actorUserId : isOwnServer(actorUserId, server);

    if (!canManageBackupsOf(actor, isOwn)) {
      throw new BackupError('BACKUP_NOT_FOUND');
    }

    return { backup, server };
  }

  /** Baut das DTO inklusive `permissions` und der Anzeigefelder zur Aufbewahrung. */
  async function toDto(
    actor: PermissionActor,
    actorUserId: string,
    backup: BackupRecord,
    context: {
      serverName?: string | null;
      isOwn?: boolean;
      siblings?: readonly BackupRecord[];
      displayNames?: ReadonlyMap<string, string>;
    } = {},
  ): Promise<BackupDto> {
    const siblings = context.siblings ?? (await repository.listByServer(backup.serverId));
    const displayNames =
      context.displayNames ??
      (await users.findDisplayNames(
        [backup.ownerId, backup.createdByUserId].filter((id): id is string => id !== null),
      ));

    const isOwn = context.isOwn ?? backup.ownerId === actorUserId;
    const permissions = computeBackupPermissions(actor, backup, isOwn);
    const seesStoragePath = actor.permissions.has('backup.manage.any');

    return {
      id: backup.id,
      serverId: backup.serverId,
      serverName: context.serverName ?? null,
      ownerId: backup.ownerId,
      ownerDisplayName: displayNames.get(backup.ownerId) ?? null,
      type: backup.type,
      status: backup.status,
      isExport: backup.isExport,
      sizeBytes: backup.sizeBytes,
      // Der Ablageort ist Betriebswissen der Node und gehört nicht in die
      // Nutzeransicht (Pflichtenheft §5.2 verlangt Vollständigkeit, nicht die
      // Preisgabe von Interna gegenüber jedem Aufrufer).
      storagePath: seesStoragePath ? backup.storagePath : null,
      checksumSha256: backup.checksumSha256,
      createdByUserId: backup.createdByUserId,
      createdByDisplayName:
        backup.createdByUserId === null ? null : (displayNames.get(backup.createdByUserId) ?? null),
      createdAt: backup.createdAt.toISOString(),
      startedAt: backup.startedAt?.toISOString() ?? null,
      completedAt: backup.completedAt?.toISOString() ?? null,
      failureCode: backup.failureCode,
      failureMessage: backup.failureMessage,
      retentionProtected: isRetentionProtected(backup, siblings),
      expiresAt: retentionExpiresAt(backup, siblings)?.toISOString() ?? null,
      permissions,
    };
  }

  async function toDtoList(
    actor: PermissionActor,
    actorUserId: string,
    records: readonly BackupRecord[],
    isOwnByServer: ReadonlyMap<string, boolean>,
    serverNames: ReadonlyMap<string, string>,
  ): Promise<BackupDto[]> {
    const bySer = new Map<string, BackupRecord[]>();

    for (const record of records) {
      const list = bySer.get(record.serverId) ?? [];
      list.push(record);
      bySer.set(record.serverId, list);
    }

    const userIds = new Set<string>();

    for (const record of records) {
      userIds.add(record.ownerId);

      if (record.createdByUserId !== null) {
        userIds.add(record.createdByUserId);
      }
    }

    const displayNames = await users.findDisplayNames([...userIds]);

    return Promise.all(
      records.map((record) =>
        toDto(actor, actorUserId, record, {
          serverName: serverNames.get(record.serverId) ?? null,
          isOwn: isOwnByServer.get(record.serverId) ?? record.ownerId === actorUserId,
          siblings: bySer.get(record.serverId) ?? [record],
          displayNames,
        }),
      ),
    );
  }

  /**
   * Führt den eigentlichen Backup-Lauf aus.
   *
   * Läuft im Hintergrund; Fehler landen deshalb ausschließlich im Datensatz und
   * im Ereignis `backup.failed`, nie in einer HTTP-Antwort.
   */
  async function runBackupJob(backupId: string, server: BackupServerRecord, stopServer: boolean) {
    await repository.update(backupId, { status: 'running', startedAt: now() });

    const response = await agent.createBackup({
      backupId,
      serverId: server.id,
      sourcePath: server.dataHostPath,
      ...(server.dockerContainerId === null ? {} : { containerId: server.dockerContainerId }),
      stopContainer: stopServer,
    });

    if (!response.success) {
      await failBackup(
        backupId,
        server.id,
        agentErrorCode(response.error.code),
        response.error.message,
      );

      return;
    }

    const parsed = createBackupCommandResultSchema.safeParse(response.data);

    if (!parsed.success) {
      // Der Agent hat gemeldet „hat geklappt“, liefert aber kein verwertbares
      // Ergebnis. Das Backup gilt als fehlgeschlagen – ein Datensatz ohne
      // Ablageort wäre schlimmer als ein sichtbarer Fehler.
      await failBackup(
        backupId,
        server.id,
        'AGENT_COMMAND_INVALID',
        `Der Agent hat kein gültiges Backup-Ergebnis geliefert: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`)
          .join('; ')}`,
      );

      return;
    }

    await repository.update(backupId, {
      status: 'completed',
      sizeBytes: parsed.data.sizeBytes,
      storagePath: parsed.data.storagePath,
      checksumSha256: parsed.data.checksumSha256,
      containerStopped: parsed.data.containerStopped,
      startedAt: new Date(parsed.data.startedAt),
      completedAt: new Date(parsed.data.completedAt),
      failureCode: null,
      failureMessage: null,
    });

    // Aufbewahrungsregel erst nach einem erfolgreichen Lauf: Sonst könnte ein
    // Fehlschlag den Bestand ausdünnen, ohne etwas Neues beigesteuert zu haben.
    await applyRetentionInternal(server.id);
  }

  async function failBackup(
    backupId: string,
    serverId: string,
    code: ErrorCode,
    message: string,
  ): Promise<void> {
    await repository.update(backupId, {
      status: 'failed',
      completedAt: now(),
      failureCode: code,
      failureMessage: message,
    });

    // Konsument ist die Notification-Engine (B6, Pflichtenheft §14).
    await events.publish('backup.failed', { backupId, serverId, code, message });
  }

  /**
   * Legt den Datensatz an und stößt den Lauf an.
   *
   * Der Datensatz entsteht **vor** dem Agent-Befehl, damit ein abgerissener
   * Lauf sichtbar bleibt und nicht spurlos verschwindet.
   */
  async function startBackup(params: {
    server: BackupServerRecord;
    type: 'manual' | 'automatic';
    isExport: boolean;
    createdByUserId: string | null;
    scheduleId: string | null;
    stopServer: boolean;
  }): Promise<BackupRecord> {
    const active = await repository.findActiveByServer(params.server.id);

    if (active) {
      throw new BackupError('BACKUP_ALREADY_RUNNING');
    }

    const backup = await repository.create({
      serverId: params.server.id,
      ownerId: params.server.ownerId,
      type: params.type,
      isExport: params.isExport,
      createdByUserId: params.createdByUserId,
      scheduleId: params.scheduleId,
    });

    runJob(async () => {
      try {
        await runBackupJob(backup.id, params.server, params.stopServer);
      } catch (error) {
        await failBackup(
          backup.id,
          params.server.id,
          'AGENT_COMMAND_FAILED',
          error instanceof Error ? error.message : 'Unbekannter Fehler beim Sichern.',
        );
      }
    });

    return backup;
  }

  /** Entfernt ein Backup samt Archiv. Ein bereits fehlendes Archiv ist kein Fehler. */
  async function removeBackupAndArchive(backup: BackupRecord): Promise<number> {
    if (backup.storagePath !== null) {
      const response = await agent.deleteBackup({
        backupId: backup.id,
        storagePath: backup.storagePath,
      });

      if (!response.success) {
        throw new BackupError(agentErrorCode(response.error.code), response.error.message);
      }

      const parsed = deleteBackupCommandResultSchema.safeParse(response.data);

      // Der Datensatz verschwindet auch dann, wenn der Agent kein auswertbares
      // Ergebnis liefert: Das Archiv ist weg, ein Datensatz ohne Archiv wäre
      // irreführend.
      await repository.remove(backup.id);

      return parsed.success ? parsed.data.freedBytes : backup.sizeBytes;
    }

    await repository.remove(backup.id);

    return 0;
  }

  async function applyRetentionInternal(serverId: string): Promise<RetentionOutcome> {
    const all = await repository.listByServer(serverId);
    const expired = selectExpiredBackups(all, now());

    const removedBackupIds: string[] = [];
    let freedBytes = 0;

    for (const backup of expired) {
      try {
        freedBytes += await removeBackupAndArchive(backup);
        removedBackupIds.push(backup.id);
      } catch {
        // Ein einzelnes Archiv, das sich gerade nicht entfernen lässt (Node
        // offline), darf den Lauf nicht abbrechen: Der nächste Durchgang holt
        // es nach, weil der Datensatz stehen bleibt.
      }
    }

    return { removedBackupIds, freedBytes };
  }

  return {
    async listForServer(actor, actorUserId, serverId) {
      const server = await loadServerOrFail(serverId);
      const isOwn = isOwnServer(actorUserId, server);

      if (!canManageBackupsOf(actor, isOwn)) {
        throw new BackupError('SERVER_NOT_FOUND');
      }

      const records = await repository.listByServer(serverId);

      return toDtoList(
        actor,
        actorUserId,
        records,
        new Map([[serverId, isOwn]]),
        new Map([[serverId, server.name]]),
      );
    },

    async listForOwner(actor, actorUserId, ownerId) {
      const isOwn = ownerId === actorUserId;

      if (!canManageBackupsOf(actor, isOwn)) {
        throw new BackupError('PERMISSION_DENIED');
      }

      const records = await repository.listByOwner(ownerId);
      const serverIds = [...new Set(records.map((record) => record.serverId))];
      const serverRecords = await servers.findManyByIds(serverIds);

      return toDtoList(
        actor,
        actorUserId,
        records,
        new Map(serverRecords.map((server) => [server.id, isOwnServer(actorUserId, server)])),
        new Map(serverRecords.map((server) => [server.id, server.name])),
      );
    },

    async get(actor, actorUserId, backupId) {
      const { backup, server } = await loadManageableBackup(actor, actorUserId, backupId);

      return toDto(actor, actorUserId, backup, {
        serverName: server?.name ?? null,
        isOwn: server === null ? backup.ownerId === actorUserId : isOwnServer(actorUserId, server),
      });
    },

    async createManual(actor, actorUserId, serverId, input) {
      const server = await loadServerOrFail(serverId);

      if (!canManageBackupsOf(actor, isOwnServer(actorUserId, server))) {
        throw new BackupError('SERVER_NOT_FOUND');
      }

      const backup = await startBackup({
        server,
        type: 'manual',
        isExport: false,
        createdByUserId: actorUserId,
        scheduleId: null,
        stopServer: input.stopServer,
      });

      return toDto(actor, actorUserId, backup, { serverName: server.name, isOwn: true });
    },

    async createExport(actor, actorUserId, serverId, input) {
      const server = await loadServerOrFail(serverId);

      if (!canManageBackupsOf(actor, isOwnServer(actorUserId, server))) {
        throw new BackupError('SERVER_NOT_FOUND');
      }

      // Ein Export ist technisch ein manuelles Backup: Er unterliegt derselben
      // Ausnahme von der automatischen Löschung (Lastenheft §3.3) und wird über
      // dieselbe Download-Route abgeholt.
      const backup = await startBackup({
        server,
        type: 'manual',
        isExport: true,
        createdByUserId: actorUserId,
        scheduleId: null,
        stopServer: input.stopServer,
      });

      return toDto(actor, actorUserId, backup, { serverName: server.name, isOwn: true });
    },

    async createScheduled(serverId, scheduleId, stopServer) {
      const server = await loadServerOrFail(serverId);
      const backup = await startBackup({
        server,
        type: 'automatic',
        isExport: false,
        // Geplante Backups haben keinen Auslöser – das Feld bleibt leer, statt
        // dem Einrichter des Zeitplans etwas zuzuschreiben, das er nicht getan hat.
        createdByUserId: null,
        scheduleId,
        stopServer,
      });

      const siblings = await repository.listByServer(serverId);

      return toDto(
        // Für den Rückgabewert ist kein Aufrufer vorhanden; die Flags sind für
        // den Scheduler ohne Bedeutung.
        { isOwner: false, permissions: new Set() },
        '',
        backup,
        { serverName: server.name, isOwn: false, siblings },
      );
    },

    async remove(actor, actorUserId, backupId) {
      const { backup } = await loadManageableBackup(actor, actorUserId, backupId);

      if (backup.status === 'pending' || backup.status === 'running') {
        throw new BackupError('BACKUP_NOT_READY');
      }

      await removeBackupAndArchive(backup);
    },

    async restore(actor, actorUserId, backupId) {
      const { backup } = await loadManageableBackup(actor, actorUserId, backupId);

      if (backup.status !== 'completed' || backup.storagePath === null) {
        throw new BackupError('BACKUP_NOT_READY');
      }

      const server = await loadServerOrFail(backup.serverId);
      const active = await repository.findActiveByServer(server.id);

      if (active) {
        throw new BackupError('BACKUP_ALREADY_RUNNING');
      }

      const response = await agent.restoreBackup({
        backupId: backup.id,
        serverId: server.id,
        storagePath: backup.storagePath,
        targetPath: server.dataHostPath,
        ...(server.dockerContainerId === null ? {} : { containerId: server.dockerContainerId }),
      });

      if (!response.success) {
        throw new BackupError(agentErrorCode(response.error.code), response.error.message);
      }

      const parsed = restoreBackupCommandResultSchema.safeParse(response.data);

      if (!parsed.success) {
        throw new BackupError(
          'AGENT_COMMAND_INVALID',
          'Der Agent hat kein gültiges Ergebnis zur Wiederherstellung geliefert.',
        );
      }

      return toDto(actor, actorUserId, backup, {
        serverName: server.name,
        isOwn: isOwnServer(actorUserId, server),
      });
    },

    async openDownload(actor, actorUserId, backupId) {
      const { backup, server } = await loadManageableBackup(actor, actorUserId, backupId);

      if (backup.status !== 'completed' || backup.storagePath === null) {
        throw new BackupError('BACKUP_NOT_READY');
      }

      const storagePath = backup.storagePath;
      const fileName =
        `${server?.name ?? 'server'}-${backup.createdAt.toISOString().slice(0, 10)}-${backup.id}.tar.zst`
          .replace(/[^\w.-]+/g, '-')
          .toLowerCase();

      async function* chunks(): AsyncGenerator<BackupDownloadChunk> {
        let offset = 0;

        for (;;) {
          const response = await agent.downloadBackupChunk({
            backupId: backup.id,
            storagePath,
            offset,
            maxBytes: DOWNLOAD_CHUNK_BYTES,
          });

          if (!response.success) {
            throw new BackupError(agentErrorCode(response.error.code), response.error.message);
          }

          const parsed = downloadBackupCommandResultSchema.safeParse(response.data);

          if (!parsed.success) {
            throw new BackupError(
              'AGENT_COMMAND_INVALID',
              'Der Agent hat einen unbrauchbaren Block geliefert.',
            );
          }

          const bytes = Buffer.from(parsed.data.contentBase64, 'base64');
          offset += parsed.data.bytesRead;

          yield { bytes, eof: parsed.data.eof };

          if (parsed.data.eof) {
            return;
          }

          if (parsed.data.bytesRead === 0) {
            // Kein Fortschritt und kein Dateiende: Weiterfragen würde endlos
            // laufen.
            throw new BackupError(
              'AGENT_COMMAND_FAILED',
              'Der Agent liefert keine weiteren Daten, meldet aber kein Dateiende.',
            );
          }
        }
      }

      return { fileName, totalBytes: backup.sizeBytes, chunks };
    },

    async overview(actor, query) {
      if (!actor.permissions.has('backup.manage.any')) {
        throw new BackupError('PERMISSION_DENIED');
      }

      const filter: BackupFilter = {
        ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
        ...(query.serverId === undefined ? {} : { serverId: query.serverId }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.status === undefined ? {} : { status: query.status }),
      };

      const [totals, byOwner, byServer] = await Promise.all([
        repository.totals(filter),
        repository.sumByOwner(filter),
        repository.sumByServer(filter),
      ]);

      const [displayNames, serverRecords] = await Promise.all([
        users.findDisplayNames(byOwner.map((entry) => entry.key)),
        servers.findManyByIds(byServer.map((entry) => entry.key)),
      ]);

      const serverNames = new Map(serverRecords.map((server) => [server.id, server.name]));

      const toBucket = (
        entry: { key: string; backupCount: number; totalSizeBytes: number },
        names: ReadonlyMap<string, string>,
      ): BackupStorageBucket => ({
        id: entry.key,
        name: names.get(entry.key) ?? null,
        backupCount: entry.backupCount,
        totalSizeBytes: entry.totalSizeBytes,
      });

      return {
        ...totals,
        perUser: byOwner.map((entry) => toBucket(entry, displayNames)),
        perServer: byServer.map((entry) => toBucket(entry, serverNames)),
        generatedAt: now().toISOString(),
        permissions: computeBackupOverviewPermissions(actor),
      };
    },

    applyRetention: applyRetentionInternal,
  };
}
