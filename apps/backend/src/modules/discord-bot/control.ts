/**
 * Anbindung der Knöpfe an die Server-Orchestrierung (Pflichtenheft §14a.3, §14a.5).
 *
 * **Keine zweite Rechtelogik.** Was ein Konto an einem Server darf, rechnet
 * dieselbe Funktion aus wie für den Server-DTO im Panel
 * (`computeGameServerPermissions`) – mit demselben Akteur aus dem Auth-Modul
 * und derselben Mitgliedsstufe. Ausgeführt wird über dieselben
 * Service-Methoden wie bei den REST-Routen; die Zustandsmaschine entscheidet
 * dort, ob der Übergang erlaubt ist.
 */

import type { GameServerPermissions, ServerStatus } from '@palantir/contracts';
import type { UserRecord } from '../auth/types.js';
import type { PermissionActor } from '../rbac/index.js';
import { computeGameServerPermissions } from '../server-orchestration/permissions.js';
import type { ServerMemberRecord, ServerRecord } from '../server-orchestration/repository.js';

/** Stand eines Servers aus Sicht eines Kontos. */
export interface ServerControlView {
  readonly name: string;
  readonly status: ServerStatus;
  readonly permissions: GameServerPermissions;
  readonly consoleEnabled: boolean;
  readonly supportsConsole: boolean;
}

export interface ServerControlPort {
  /** `null`, wenn es den Server oder das Konto nicht gibt. */
  load(serverId: string, userId: string): Promise<ServerControlView | null>;
  start(serverId: string, userId: string): Promise<void>;
  stop(serverId: string): Promise<void>;
  restart(serverId: string, userId: string): Promise<void>;
  backup(serverId: string, userId: string): Promise<void>;
  players(serverId: string): {
    readonly names: readonly string[];
    readonly count: { online: number; max: number | null } | null;
  };
  console(serverId: string, command: string): Promise<{ stdout: string; stderr: string }>;
}

export interface ServerControlDeps {
  readonly servers: {
    findById(serverId: string): Promise<ServerRecord | null>;
    listMembers(serverId: string): Promise<readonly ServerMemberRecord[]>;
  };
  readonly users: { findUserById(userId: string): Promise<UserRecord | null> };
  readonly buildActor: (user: UserRecord) => Promise<PermissionActor>;
  readonly supportsConsole: (gameType: string) => boolean;
  readonly orchestration: {
    startServer(serverId: string, userId: string): Promise<unknown>;
    stopServer(serverId: string): Promise<unknown>;
    restartServer(serverId: string, userId: string): Promise<unknown>;
    execConsole(serverId: string, command: string): Promise<{ stdout: string; stderr: string }>;
    latestPlayers(serverId: string): readonly string[];
    latestPlayerCount(serverId: string): { online: number; max: number | null } | null;
  };
  readonly backups: {
    createManual(
      actor: PermissionActor,
      userId: string,
      serverId: string,
      user: UserRecord,
    ): Promise<unknown>;
  };
}

export function createServerControl(deps: ServerControlDeps): ServerControlPort {
  async function kontoUndAkteur(
    userId: string,
  ): Promise<{ user: UserRecord; actor: PermissionActor } | null> {
    const user = await deps.users.findUserById(userId);

    return user ? { user, actor: await deps.buildActor(user) } : null;
  }

  return {
    async load(serverId, userId) {
      const [server, konto] = await Promise.all([
        deps.servers.findById(serverId),
        kontoUndAkteur(userId),
      ]);

      if (!server || !konto) return null;

      const mitglieder = await deps.servers.listMembers(serverId);
      const stufe = mitglieder.find((m) => m.userId === userId)?.level ?? null;

      return {
        name: server.name,
        status: server.status,
        permissions: computeGameServerPermissions(konto.actor, {
          ownerId: server.ownerId,
          status: server.status,
          viewerId: userId,
          viewerMemberLevel: stufe,
        }),
        consoleEnabled: server.discordConsoleEnabled ?? false,
        supportsConsole: deps.supportsConsole(server.gameType),
      };
    },

    async start(serverId, userId) {
      await deps.orchestration.startServer(serverId, userId);
    },

    async stop(serverId) {
      await deps.orchestration.stopServer(serverId);
    },

    async restart(serverId, userId) {
      await deps.orchestration.restartServer(serverId, userId);
    },

    async backup(serverId, userId) {
      const konto = await kontoUndAkteur(userId);

      if (!konto) throw new Error('Konto nicht gefunden');

      await deps.backups.createManual(konto.actor, userId, serverId, konto.user);
    },

    players(serverId) {
      return {
        names: deps.orchestration.latestPlayers(serverId),
        count: deps.orchestration.latestPlayerCount(serverId),
      };
    },

    console(serverId, command) {
      return deps.orchestration.execConsole(serverId, command);
    },
  };
}
