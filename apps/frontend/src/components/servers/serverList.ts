import { type GameServerDto, type ServerStatus } from '@palantir/contracts';

/**
 * Aufbereitung der Serverübersicht (Lastenheft §3.3, Mockup „Übersicht").
 *
 * Reine Funktionen ohne React, damit Filter, Suche und Gruppierung geprüft
 * werden können – die Ansicht ruft sie nur auf. Berechtigungen spielen hier
 * keine Rolle: Was der Aufrufer überhaupt sehen darf, entscheidet das Backend
 * über die gelieferte Liste und über `permissions.canView` (Pflichtenheft §5.2).
 */

export const SERVER_FILTERS = ['all', 'online', 'offline'] as const;

export type ServerFilter = (typeof SERVER_FILTERS)[number];

/** Beschriftungen des Umschalters über der Liste (Lastenheft §4: Deutsch). */
export const SERVER_FILTER_LABELS: Record<ServerFilter, string> = {
  all: 'Alle',
  online: 'Online',
  offline: 'Offline',
};

/**
 * Zählt ein Zustand als „online"?
 *
 * `starting` und `stopping` gehören dazu, weil dort bereits etwas läuft – wer
 * nach laufenden Servern filtert, will diese Übergänge sehen und nicht erst,
 * wenn sie durch sind.
 */
export function isOnlineStatus(status: ServerStatus): boolean {
  return status === 'running' || status === 'starting' || status === 'stopping';
}

export function matchesFilter(server: GameServerDto, filter: ServerFilter): boolean {
  if (filter === 'all') return true;
  const online = isOnlineStatus(server.status);
  return filter === 'online' ? online : !online;
}

/**
 * Passt ein Server zum Suchbegriff?
 *
 * Gesucht wird über Name, Spiel, Subdomain und Besitzer – also über das, was
 * auf der Karte steht. Groß-/Kleinschreibung spielt keine Rolle.
 */
export function matchesSearch(server: GameServerDto, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return true;

  const haystack = [
    server.name,
    server.gameTypeName,
    server.subdomain,
    server.ownerDisplayName ?? '',
    server.hostName ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}

/** Reihenfolge der Zustände in der Liste: Störungen zuerst, Ruhendes zuletzt. */
const STATUS_ORDER: Record<ServerStatus, number> = {
  crashed: 0,
  error: 1,
  starting: 2,
  stopping: 3,
  creating: 4,
  running: 5,
  stopped: 6,
};

/**
 * Sortierung innerhalb einer Gruppe.
 *
 * Zuerst das, was Aufmerksamkeit braucht (abgestürzt, Fehler, in Bewegung),
 * danach alphabetisch nach Name – damit die Reihenfolge zwischen zwei
 * Aktualisierungen ruhig bleibt.
 */
export function compareServers(a: GameServerDto, b: GameServerDto): number {
  const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  return a.name.localeCompare(b.name, 'de');
}

export interface ServerGroup {
  key: 'pinned' | 'own' | 'other';
  title: string;
  servers: GameServerDto[];
}

export interface GroupServersOptions {
  servers: readonly GameServerDto[];
  filter: ServerFilter;
  search: string;
  /** Id des angemeldeten Nutzers – trennt „Deine Server" von „Andere Server". */
  currentUserId: string | null;
  pinnedIds: readonly string[];
}

export interface GroupedServers {
  groups: ServerGroup[];
  /** Anzahl nach Filter und Suche – Grundlage für den passenden Leerzustand. */
  visibleCount: number;
  /** Gesamtzahl vor Filter und Suche. */
  totalCount: number;
}

/**
 * Liste in die drei Abschnitte der Übersicht aufteilen.
 *
 * Ein angehefteter Server erscheint **nur** oben, nicht zusätzlich in seiner
 * eigentlichen Gruppe – sonst stünde er doppelt auf der Seite.
 */
export function groupServers({
  servers,
  filter,
  search,
  currentUserId,
  pinnedIds,
}: GroupServersOptions): GroupedServers {
  const pinned = new Set(pinnedIds);
  const visible = servers
    .filter((server) => matchesFilter(server, filter) && matchesSearch(server, search))
    .sort(compareServers);

  const groups: ServerGroup[] = [];

  const pinnedServers = visible.filter((server) => pinned.has(server.id));
  if (pinnedServers.length > 0) {
    groups.push({ key: 'pinned', title: 'Angepinnt', servers: pinnedServers });
  }

  const rest = visible.filter((server) => !pinned.has(server.id));

  const ownServers = rest.filter(
    (server) => currentUserId !== null && server.ownerId === currentUserId,
  );
  if (ownServers.length > 0) {
    groups.push({ key: 'own', title: 'Deine Server', servers: ownServers });
  }

  const otherServers = rest.filter(
    (server) => currentUserId === null || server.ownerId !== currentUserId,
  );
  if (otherServers.length > 0) {
    groups.push({ key: 'other', title: 'Andere Server', servers: otherServers });
  }

  return { groups, visibleCount: visible.length, totalCount: servers.length };
}
