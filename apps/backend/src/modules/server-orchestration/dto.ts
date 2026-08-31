/**
 * Abbildung eines Servers auf sein DTO (Pflichtenheft §5.2).
 *
 * „Jede Ressource wird immer vollständig ausgeliefert (kein Zuschneiden auf
 * einzelne Frontend-Ansichten); das Frontend entscheidet, was angezeigt wird."
 *
 * Zwei Ausnahmen, die keine Zuschnitte auf Ansichten sind, sondern
 * Berechtigungen abbilden:
 *
 * - `address` ist `null`, wenn `canViewAddress` fehlt. Wer den Server nicht
 *   betreten darf, soll seine Verbindungsadresse nicht bekommen.
 * - `dockerContainerId` ist `null` ohne Verwaltungsrecht. Die Container-ID ist
 *   ein Betriebsdetail des Homeservers und für die Anzeige ohne Nutzen.
 */

import {
  type GameServerDto,
  type GameServerPermissions,
  type ServerMemberLevel,
} from '@palantir/contracts';
import { type PermissionActor } from '../rbac/index.js';
import { type GameRegistry } from './game-registry.js';
import { computeGameServerPermissions } from './permissions.js';
import { type ServerRecord } from './repository.js';

export interface ServerDtoContext {
  readonly actor: PermissionActor;
  readonly viewerId: string | null;
  readonly viewerMemberLevel: ServerMemberLevel | null;
  readonly memberCount: number;
  readonly registry: GameRegistry;
  readonly baseDomain: string;
  readonly recentCrashCount: number;
}

/**
 * Läuft der Server auf einem älteren Image als dem der heutigen Definition?
 *
 * Verglichen wird, womit der Container **angelegt** wurde, gegen das, was die
 * Spiel-Definition jetzt vorsieht. Ändert ein Deployment die Fassung eines
 * Spiel-Images, fällt das damit auf, ohne die Registry zu fragen: Der
 * Vergleich braucht weder Zugangsdaten noch einen Netzaufruf je Server.
 *
 * Was er **nicht** erkennt: dasselbe Tag mit neuem Inhalt (`:latest` wandert).
 * Dafür wäre ein Digest-Vergleich gegen die Registry nötig – ein eigener
 * Vorgang mit Registry-Zugang, Zwischenspeicher und Frist, kein Nebenprodukt
 * der DTO-Bildung. Die Spiel-Images des Projekts tragen feste Fassungen, damit
 * greift der Vergleich für den Fall, um den es geht.
 *
 * `null` heißt „kein Container" oder „vor dieser Spalte angelegt" – beides ist
 * keine Aussage über eine ältere Fassung, also `false`.
 */
export function updateAvailable(imageRef: string | null, definitionImage: string): boolean {
  return imageRef !== null && imageRef !== definitionImage;
}

export function toGameServerDto(server: ServerRecord, context: ServerDtoContext): GameServerDto {
  const definition = context.registry.require(server.gameType);

  const permissions: GameServerPermissions = computeGameServerPermissions(context.actor, {
    ownerId: server.ownerId,
    status: server.status,
    viewerId: context.viewerId,
    viewerMemberLevel: context.viewerMemberLevel,
  });

  const primaryPort =
    server.assignedPorts.find((assignment) => assignment.primary)?.publicPort ?? null;

  return {
    id: server.id,
    name: server.name,
    ownerId: server.ownerId,
    ownerDisplayName: server.ownerDisplayName,
    gameType: server.gameType,
    gameTypeName: definition.name,
    status: server.status,
    statusMessage: server.statusMessage,
    hostId: server.hostId,
    hostName: server.hostName,
    subdomain: server.subdomain,
    address: permissions.canViewAddress
      ? {
          hostname: `${server.subdomain}.${context.baseDomain}`,
          // Bei Hostname-Routing sieht der Spieler keinen Port (§13).
          port: definition.supportsVirtualHostRouting ? null : primaryPort,
        }
      : null,
    assignedPorts: server.assignedPorts.map((assignment) => assignment.publicPort),
    resourceLimits: server.resourceLimits,
    autoShutdownEnabled: server.autoShutdown.enabled,
    autoShutdownTimeoutMinutes: server.autoShutdown.enabled
      ? server.autoShutdown.idleTimeoutMinutes
      : null,
    startupParameters: server.startupParameters,
    config: { ...server.configJson },
    /**
     * Container-ID nur mit Verwaltungsrecht: Sie ist ein Betriebsdetail des
     * Homeservers und für die Anzeige ohne Nutzen.
     */
    dockerContainerId: permissions.canManageSettings ? server.dockerContainerId : null,
    pendingRestart: server.restartRequired,
    updateAvailable: updateAvailable(server.imageRef, definition.dockerImage),
    memberCount: context.memberCount,
    lastStartedAt: server.lastStartedAt,
    createdAt: server.createdAt,
    permissions,
  };
}
