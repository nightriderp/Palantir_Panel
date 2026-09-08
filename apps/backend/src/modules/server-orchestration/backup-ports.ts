/**
 * Umsetzung der Backup-Schnittstellen aus B5 (`modules/backups/ports.ts`).
 *
 * B5 orchestriert nur und kennt weder `game_servers` noch den Agent-Kanal; es
 * spricht ausschließlich über {@link ServerDirectory} und
 * {@link BackupAgentGateway}. Beides gehört hierher: Die Server-Tabelle liegt in
 * B3, und der WebSocket-Endpunkt `/agent` ebenfalls (Pflichtenheft §2.2, §5.3).
 * Ohne diese Datei lassen sich die Routen aus `registerBackupRoutes()` gar nicht
 * erst registrieren – Backups wären über die API nicht erreichbar.
 *
 * Die Schnittstellen selbst bleiben unverändert; hier steht nur, was B5 bewusst
 * offen gelassen hat.
 */

import {
  type AgentCommandName,
  type AgentCommandPayloads,
  type AgentCommandResults,
  type ApiResponse,
  type CreateBackupCommandPayload,
  type DeleteBackupCommandPayload,
  type DownloadBackupCommandPayload,
  type RestoreBackupCommandPayload,
  type ServerExportManifest,
  fail,
  ok,
} from '@palantir/contracts';
import { eq, inArray } from 'drizzle-orm';
import { type Database } from '../../db/client.js';
import { gameServers, serverMembers } from '../../db/schema.js';
import {
  type BackupAgentGateway,
  type BackupArchiveLocation,
  type BackupServerRecord,
  type ServerDirectory,
  type ServerExportManifestSource,
} from '../backups/index.js';
import { type AgentGatewayLogger, type AgentRegistry } from './agent-gateway.js';
import { isServerOrchestrationError } from './errors.js';
import { dataHostPathFor } from './service.js';

/**
 * Server-Verzeichnis über `game_servers`.
 *
 * Bewusst eine eigene, schmale Abfrage statt einer Umformung von
 * `ServerRecord`: B5 braucht die Mitverwalter (`memberUserIds`) für die
 * `.own`-Prüfung, `ServerRecord` führt sie nicht mit. Umgekehrt braucht B5
 * weder Ports noch DNS noch Konfiguration.
 */
export function createDrizzleBackupServerDirectory(db: Database): ServerDirectory {
  async function load(serverIds: readonly string[]): Promise<BackupServerRecord[]> {
    if (serverIds.length === 0) {
      return [];
    }

    const rows = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        ownerId: gameServers.ownerId,
        // Node des Servers – B5 hält sie beim Anlegen am Backup fest
        // (Fundpunkt 174).
        hostId: gameServers.hostId,
        status: gameServers.status,
        dockerContainerId: gameServers.dockerContainerId,
      })
      .from(gameServers)
      .where(
        serverIds.length === 1
          ? eq(gameServers.id, serverIds[0] as string)
          : inArray(gameServers.id, [...serverIds]),
      );

    if (rows.length === 0) {
      return [];
    }

    const memberRows = await db
      .select({ serverId: serverMembers.serverId, userId: serverMembers.userId })
      .from(serverMembers)
      .where(
        inArray(
          serverMembers.serverId,
          rows.map((row) => row.id),
        ),
      );

    const membersByServer = new Map<string, string[]>();

    for (const row of memberRows) {
      const list = membersByServer.get(row.serverId) ?? [];
      list.push(row.userId);
      membersByServer.set(row.serverId, list);
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      hostId: row.hostId,
      status: row.status,
      dockerContainerId: row.dockerContainerId,
      dataHostPath: dataHostPathFor(row.id),
      memberUserIds: membersByServer.get(row.id) ?? [],
    }));
  }

  return {
    async findById(serverId: string): Promise<BackupServerRecord | null> {
      return (await load([serverId]))[0] ?? null;
    },

    findManyByIds(serverIds: readonly string[]): Promise<BackupServerRecord[]> {
      return load(serverIds);
    },
  };
}

/**
 * Was das Gateway von der Server-Tabelle braucht – mehr nicht.
 *
 * Bewusst schmaler als `ServerRepository` (das sie erfüllt): Für „an welche
 * Node geht dieser Befehl?" braucht es keinen vollständigen Serverdatensatz,
 * und der Test braucht keinen Nachbau von achtzehn Methoden.
 */
export interface BackupHostResolver {
  findById(serverId: string): Promise<{ readonly hostId: string } | null>;
  defaultHost(): Promise<{ readonly id: string } | null>;
}

export interface BackupAgentGatewayOptions {
  readonly agents: AgentRegistry;
  /** Auflösung Server → Node und die Node der Installation (Pflichtenheft §2.1). */
  readonly repository: BackupHostResolver;
  /**
   * Wohin der Rückfall auf `defaultHost()` gemeldet wird (Fundpunkt 174).
   *
   * Verpflichtend, aus demselben Grund wie {@link backupTimeoutMs}: Eine
   * vergessene Verdrahtung ließe genau den Fall still verschwinden, den dieser
   * Wert sichtbar machen soll – eine Sicherung ohne bekannte Node, die auf gut
   * Glück an die Node der Installation geschickt wird.
   */
  readonly log: AgentGatewayLogger;
  /**
   * Frist für `CREATE_BACKUP` und `RESTORE_BACKUP` (`BACKUP_COMMAND_TIMEOUT_MS`).
   *
   * Ohne Angabe verpflichtend, nicht optional: Eine vergessene Verdrahtung
   * fiele auf die übliche 30-s-Frist zurück und damit genau in den Fehler, den
   * dieser Wert behebt (Audit W1-5, bb-02).
   */
  readonly backupTimeoutMs: number;
}

/**
 * Backup-Befehle über den Agent-Kanal (Pflichtenheft §5.3).
 *
 * Zwei Eigenheiten gegenüber den übrigen Befehlen von B3:
 *
 * 1. **Fehler werden nicht geworfen, sondern als Envelope zurückgegeben.**
 *    `AgentSession.sendCommand()` wirft einen `ServerOrchestrationError`; die
 *    Schnittstelle aus B5 verlangt dagegen einen `ApiResponse`. B5 entscheidet
 *    anhand des Fehlercodes, ob ein Backup auf `failed` geht – ein geworfener
 *    Fehler im Hintergrundlauf würde dort nur unbeachtet verpuffen.
 * 2. **Die Node wird je Befehl aufgelöst.** `CREATE_BACKUP` und
 *    `RESTORE_BACKUP` tragen eine `serverId` und gehen an dessen Node.
 *    `DOWNLOAD_BACKUP` und `DELETE_BACKUP` arbeiten nur auf einem Archivpfad
 *    und kennen keinen Server mehr – ein Backup soll seinen Server überleben
 *    (siehe Löschregel in `db/schema/backups.ts`). Ihre Node kommt deshalb vom
 *    Aufrufer: B5 hält sie beim Anlegen der Sicherung in `backups.host_id`
 *    fest und reicht sie als {@link BackupArchiveLocation} herein
 *    (Fundpunkt 174). Erst wenn dort nichts steht – eine Zeile von vor der
 *    Spalte oder eine ausgemusterte Node –, greift der bisherige Weg über die
 *    Node der Installation (`defaultHost()`). Dieser Rückfall ist eine
 *    Vermutung und keine Auskunft: Er steht als Warnung im Log, statt die
 *    Sicherung stillschweigend an die falsche Maschine zu schicken.
 * 3. **`CREATE_BACKUP` und `RESTORE_BACKUP` bekommen eine eigene, lange Frist.**
 *    Der Agent antwortet auf beide erst nach Fertigstellung; über Gigabyte an
 *    Weltdaten dauert tar+zstd länger als die übliche Befehlsfrist von 30 s
 *    (Audit W1-5, bb-02). Gleiches Muster wie `createTimeoutMs` in
 *    `service.ts` (Gefundener Punkt 111): eigener Wert je Befehlsart statt
 *    einer global hochgedrehten Frist, die ein hängendes `STOP` mitverschleppt.
 */
export function createAgentBackupGateway(options: BackupAgentGatewayOptions): BackupAgentGateway {
  const { agents, repository, log, backupTimeoutMs } = options;

  async function hostOfServer(serverId: string): Promise<string | null> {
    const server = await repository.findById(serverId);

    return server?.hostId ?? null;
  }

  /**
   * Node eines Archivs (Fundpunkt 174).
   *
   * Steht sie am Datensatz, wird genau sie genommen. Steht dort nichts, bleibt
   * nur die Node der Installation – vor der zweiten Node war das der einzige
   * Weg, danach ist es eine Vermutung. Deshalb die Warnung: Findet der Agent
   * dort die Datei nicht, steht im Log, warum überhaupt dort gesucht wurde.
   */
  async function hostOfArchive(
    command: AgentCommandName,
    archive: BackupArchiveLocation,
    backupId: string,
  ): Promise<string | null> {
    if (archive.hostId !== null) {
      return archive.hostId;
    }

    const fallback = (await repository.defaultHost())?.id ?? null;

    log.warn(
      { command, backupId, hostId: fallback },
      'Sicherung ohne hinterlegte Node – der Befehl geht ersatzweise an die Node der Installation',
    );

    return fallback;
  }

  async function send<TCommand extends AgentCommandName>(
    command: TCommand,
    hostId: string | null,
    serverId: string | null,
    payload: AgentCommandPayloads[TCommand],
    commandOptions: { readonly timeoutMs?: number } = {},
  ): Promise<ApiResponse<AgentCommandResults[TCommand]>> {
    if (hostId === null) {
      return fail(
        'AGENT_NOT_CONNECTED',
        'Zu diesem Vorgang ist keine Node auffindbar, an die der Befehl gehen könnte.',
      );
    }

    const session = agents.get(hostId);

    if (session === null) {
      return fail('AGENT_NOT_CONNECTED');
    }

    try {
      return ok(await session.sendCommand(command, serverId, payload, commandOptions));
    } catch (error: unknown) {
      if (isServerOrchestrationError(error)) {
        return fail(error.code, error.message);
      }

      // Alles Übrige ist ein Fehler des Backends selbst und kein benannter Code
      // des Agents – er bekommt den allgemeinen Ausführungsfehler.
      return fail(
        'AGENT_COMMAND_FAILED',
        error instanceof Error ? error.message : 'Unbekannter Fehler.',
      );
    }
  }

  return {
    async createBackup(payload: CreateBackupCommandPayload): Promise<ApiResponse<unknown>> {
      return send(
        'CREATE_BACKUP',
        await hostOfServer(payload.serverId),
        payload.serverId,
        payload,
        { timeoutMs: backupTimeoutMs },
      );
    },

    async restoreBackup(payload: RestoreBackupCommandPayload): Promise<ApiResponse<unknown>> {
      return send(
        'RESTORE_BACKUP',
        await hostOfServer(payload.serverId),
        payload.serverId,
        payload,
        { timeoutMs: backupTimeoutMs },
      );
    },

    /*
     * Die beiden Übrigen bleiben bei der üblichen Frist: `DOWNLOAD_BACKUP` holt
     * das Archiv blockweise ab – jeder einzelne Aufruf liest nur ein paar
     * Megabyte –, und `DELETE_BACKUP` entfernt eine Datei. Beides ist kurz;
     * eine lange Frist würde hier nur einen hängenden Agent länger verdecken.
     */
    async downloadBackupChunk(
      payload: DownloadBackupCommandPayload,
      archive: BackupArchiveLocation,
    ): Promise<ApiResponse<unknown>> {
      return send(
        'DOWNLOAD_BACKUP',
        await hostOfArchive('DOWNLOAD_BACKUP', archive, payload.backupId),
        null,
        payload,
      );
    },

    async deleteBackup(
      payload: DeleteBackupCommandPayload,
      archive: BackupArchiveLocation,
    ): Promise<ApiResponse<unknown>> {
      return send(
        'DELETE_BACKUP',
        await hostOfArchive('DELETE_BACKUP', archive, payload.backupId),
        null,
        payload,
      );
    },
  };
}

/**
 * Export-Manifest eines Servers (Arbeitspaket P8, Lastenheft §3.3).
 *
 * B5 orchestriert den Export, kennt aber die Entität `GameServer` nicht – die
 * gehört B3. Deshalb steht die Umsetzung hier, neben den anderen Ports, die B3
 * für B5 stellt.
 *
 * **Was bewusst nicht im Manifest steht:** Node-Zuordnung, öffentliche Ports,
 * Container-Id, DNS-Eintrag und Besitzer. Das sind Angaben dieser Installation;
 * in einem Archiv, das der Nutzer weitergeben darf, hätten sie nichts verloren
 * und beim Einlesen auf einem anderen Panel wären sie ohnehin falsch. Was
 * bleibt, ist das, was den Server als Server ausmacht.
 */
export function createDrizzleServerExportManifestSource(
  db: Database,
  options: { readonly now?: () => Date } = {},
): ServerExportManifestSource {
  const now = options.now ?? ((): Date => new Date());

  return {
    async buildManifest(serverId: string): Promise<ServerExportManifest | null> {
      const rows = await db
        .select({
          id: gameServers.id,
          name: gameServers.name,
          gameType: gameServers.gameType,
          subdomain: gameServers.subdomain,
          startupParameters: gameServers.startupParameters,
          configJson: gameServers.configJson,
          resourceLimits: gameServers.resourceLimits,
          autoShutdown: gameServers.autoShutdown,
          createdAt: gameServers.createdAt,
        })
        .from(gameServers)
        .where(eq(gameServers.id, serverId))
        .limit(1);

      const row = rows[0];

      if (row === undefined) {
        return null;
      }

      return {
        formatVersion: 1,
        exportedAt: now().toISOString(),
        server: {
          id: row.id,
          name: row.name,
          gameType: row.gameType,
          subdomain: row.subdomain,
          startupParameters: row.startupParameters,
          config: row.configJson,
          resourceLimits: {
            ramMb: row.resourceLimits.ramMb,
            cpuCores: row.resourceLimits.cpuCores,
            diskMb: row.resourceLimits.diskMb,
          },
          autoShutdownEnabled: row.autoShutdown.enabled,
          autoShutdownTimeoutMinutes: row.autoShutdown.idleTimeoutMinutes,
          createdAt: row.createdAt.toISOString(),
        },
      };
    },
  };
}
