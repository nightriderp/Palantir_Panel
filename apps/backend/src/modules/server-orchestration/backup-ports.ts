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
  type BackupServerRecord,
  type ServerDirectory,
  type ServerExportManifestSource,
} from '../backups/index.js';
import { type AgentRegistry } from './agent-gateway.js';
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
 *    (siehe Löschregel in `db/schema/backups.ts`). Sie gehen deshalb an die
 *    Node der Installation (`defaultHost()`, Phase 1 betreibt genau eine).
 */
export function createAgentBackupGateway(options: BackupAgentGatewayOptions): BackupAgentGateway {
  const { agents, repository } = options;

  async function hostOfServer(serverId: string): Promise<string | null> {
    const server = await repository.findById(serverId);

    return server?.hostId ?? null;
  }

  async function defaultHostId(): Promise<string | null> {
    return (await repository.defaultHost())?.id ?? null;
  }

  async function send<TCommand extends AgentCommandName>(
    command: TCommand,
    hostId: string | null,
    serverId: string | null,
    payload: AgentCommandPayloads[TCommand],
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
      return ok(await session.sendCommand(command, serverId, payload));
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
      return send('CREATE_BACKUP', await hostOfServer(payload.serverId), payload.serverId, payload);
    },

    async restoreBackup(payload: RestoreBackupCommandPayload): Promise<ApiResponse<unknown>> {
      return send(
        'RESTORE_BACKUP',
        await hostOfServer(payload.serverId),
        payload.serverId,
        payload,
      );
    },

    async downloadBackupChunk(
      payload: DownloadBackupCommandPayload,
    ): Promise<ApiResponse<unknown>> {
      return send('DOWNLOAD_BACKUP', await defaultHostId(), null, payload);
    },

    async deleteBackup(payload: DeleteBackupCommandPayload): Promise<ApiResponse<unknown>> {
      return send('DELETE_BACKUP', await defaultHostId(), null, payload);
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
