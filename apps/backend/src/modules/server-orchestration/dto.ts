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
  buildServerHostname,
  type GameTypeDefinition,
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
  /**
   * Hat der Aufrufer den Server angeheftet (Gefundener Punkt 50)?
   *
   * Voreinstellung `false`: Aufrufer ohne Konto - etwa der Live-Kanal beim
   * Nachreichen eines Zustands - heften nichts an.
   */
  readonly pinned?: boolean;
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

/**
 * Ersatz-Definition für einen Spieltyp, den der Katalog nicht mehr kennt
 * (Fundpunkt 247).
 *
 * Der Server bleibt sichtbar und – vor allem – löschbar. Alles, was eine
 * gültige Definition bräuchte, steht auf der vorsichtigen Seite: kein
 * Hostname-Routing (also zeigt die Adresse ihren Port), keine Konsole, keine
 * Schnellbefehle, kein Update-Hinweis. Der Name ist die rohe Kennung – wer sie
 * sieht, weiß sofort, was fehlt.
 */
function ersatzDefinition(
  gameType: string,
): Pick<
  GameTypeDefinition,
  'name' | 'dockerImage' | 'supportsVirtualHostRouting' | 'consoleQuickCommands' | 'console'
> {
  return {
    name: `Unbekannter Spieltyp (${gameType})`,
    // Gleich der gespeicherten Fassung zu setzen ist nicht möglich – deshalb
    // ein Wert, der nie zu einem Image passt, und `updateAvailable` unten
    // fängt den Fall ausdrücklich ab.
    dockerImage: '',
    supportsVirtualHostRouting: false,
    consoleQuickCommands: [],
    console: { kind: 'none' },
  };
}

export function toGameServerDto(server: ServerRecord, context: ServerDtoContext): GameServerDto {
  /*
   * Fundpunkt 247: `require()` würde werfen – und in der Serverliste nähme ein
   * einzelner Datensatz mit unbekannter Kennung allen Konten die ganze
   * Übersicht (gemessen: `GET /api/servers` → 404 GAME_TYPE_NOT_FOUND, nachdem
   * die Prüfstands-Spieltypen aus dem Katalog genommen wurden).
   */
  const bekannt = context.registry.find(server.gameType);
  const definition = bekannt ?? ersatzDefinition(server.gameType);

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
    // Immer gesetzt, notfalls leer – das Frontend soll nicht raten müssen.
    consoleQuickCommands: definition.consoleQuickCommands ?? [],
    // Ohne Angabe hat ein Spiel eine Konsole über die Standardeingabe; nur
    // `{ kind: 'none' }` sagt ausdrücklich, dass es keine gibt (Valheim).
    supportsConsole: definition.console?.kind !== 'none',
    status: server.status,
    statusMessage: server.statusMessage,
    hostId: server.hostId,
    hostName: server.hostName,
    subdomain: server.subdomain,
    address: permissions.canViewAddress
      ? {
          // Adresse aus den Contracts bilden, nicht von Hand zusammensetzen –
          // dieselbe Funktion nutzen DNS-Eintrag und Subdomain-Prüfung.
          hostname: buildServerHostname(server.subdomain, context.baseDomain),
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
    // Ohne bekannte Definition gibt es keine Soll-Fassung, gegen die sich
    // vergleichen ließe (Fundpunkt 247).
    updateAvailable:
      bekannt === null ? false : updateAvailable(server.imageRef, bekannt.dockerImage),
    memberCount: context.memberCount,
    pinned: context.pinned ?? false,
    lastStartedAt: server.lastStartedAt,
    createdAt: server.createdAt,
    permissions,
  };
}
