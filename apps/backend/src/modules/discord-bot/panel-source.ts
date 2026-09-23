/**
 * Stand aus dem Panel für den Abgleich und die Kacheln (Pflichtenheft §14a.4, §14a.5).
 *
 * Nur lesend und nur über die Schnittstellen der zuständigen Module – Server
 * und Mitglieder aus der Server-Orchestrierung, Konten über
 * {@link loadPanelAccounts}. Der Bot führt keinen eigenen Stand über Server.
 */

import type { ServerRecord } from '../server-orchestration/repository.js';
import type { PanelAccounts } from './repository.js';
import type { DiscordSyncSource, PanelState } from './sync.js';
import type { TileSnapshot } from './tile.js';

export interface PanelSourceDeps {
  readonly servers: {
    listAll(): Promise<readonly ServerRecord[]>;
    listMembersOf(
      serverIds: readonly string[],
    ): Promise<ReadonlyMap<string, readonly { userId: string }[]>>;
  };
  readonly accounts: () => Promise<PanelAccounts>;
  readonly orchestration: {
    addressFor(server: ServerRecord): { hostname: string; port: number | null };
    latestPlayerCount(serverId: string): { online: number; max: number | null } | null;
  };
  /** Anzeigename des Spieltyps; `null` für einen unbekannten. */
  readonly gameTypeName: (gameType: string) => string | null;
  readonly webUrl: string;
}

export function createPanelSource(deps: PanelSourceDeps): DiscordSyncSource {
  return {
    async loadPanelState(): Promise<PanelState> {
      const [servers, accounts] = await Promise.all([deps.servers.listAll(), deps.accounts()]);
      const mitglieder = await deps.servers.listMembersOf(servers.map((s) => s.id));

      return {
        servers: servers.map((server) => ({
          id: server.id,
          name: server.name,
          ownerId: server.ownerId,
          ownerName: server.ownerDisplayName ?? '',
          createdAt: server.createdAt,
        })),
        membersByServer: new Map(
          [...mitglieder].map(([serverId, liste]) => [serverId, liste.map((m) => m.userId)]),
        ),
        adminUserIds: accounts.adminUserIds,
        linkedDiscordIds: accounts.linkedDiscordIds,
      };
    },

    async loadSnapshots(serverIds) {
      const gewollt = serverIds ? new Set(serverIds) : null;
      const servers = (await deps.servers.listAll()).filter((s) => !gewollt || gewollt.has(s.id));
      const snapshots = new Map<string, TileSnapshot>();

      for (const server of servers) {
        snapshots.set(server.id, snapshotOf(server, deps));
      }

      return snapshots;
    },
  };
}

function snapshotOf(server: ServerRecord, deps: PanelSourceDeps): TileSnapshot {
  let address: string | null = null;

  try {
    const { hostname, port } = deps.orchestration.addressFor(server);
    address = port === null ? hostname : `${hostname}:${String(port)}`;
  } catch {
    // Unbekannter Spieltyp (etwa nach Entfernen aus der Registry): ohne Adresse.
  }

  return {
    name: server.name,
    gameTypeName: deps.gameTypeName(server.gameType) ?? server.gameType,
    status: server.status,
    address,
    players: server.status === 'running' ? deps.orchestration.latestPlayerCount(server.id) : null,
    runningSince: server.lastStartedAt ? new Date(server.lastStartedAt) : null,
    panelUrl: `${deps.webUrl}/servers/${server.id}`,
  };
}
