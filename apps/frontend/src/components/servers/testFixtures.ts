import {
  type GameServerDto,
  type GameServerPermissions,
  type GameTypeDto,
  type ServerStatus,
} from '@palantir/contracts';

/**
 * Beispieldaten für die Tests dieses Arbeitspakets.
 *
 * Bewusst eine eigene Datei statt Kopien in jeder Testdatei: die DTOs sind
 * umfangreich, und ein neues Pflichtfeld soll nur an einer Stelle nachgetragen
 * werden müssen.
 */

/** Alle Flags aus, sofern nicht anders angegeben – der strengste Fall. */
export function permissions(overrides: Partial<GameServerPermissions> = {}) {
  return {
    canView: false,
    canViewAddress: false,
    canStart: false,
    canStop: false,
    canRestart: false,
    canManageSettings: false,
    canDelete: false,
    canClone: false,
    canManageMembers: false,
    canManageBackups: false,
    canManageFiles: false,
    canManageSchedules: false,
    canUseConsole: false,
    ...overrides,
  } satisfies GameServerPermissions;
}

/** Alle Flags an – der Besitzer eines eigenen Servers. */
export function ownerPermissions(): GameServerPermissions {
  return permissions({
    canView: true,
    canViewAddress: true,
    canStart: true,
    canStop: true,
    canRestart: true,
    canManageSettings: true,
    canDelete: true,
    canClone: true,
    canManageMembers: true,
    canManageBackups: true,
    canManageFiles: true,
    canManageSchedules: true,
    canUseConsole: true,
  });
}

export interface ServerFixtureOptions {
  id: string;
  name?: string;
  ownerId?: string;
  status?: ServerStatus;
  subdomain?: string;
  gameTypeName?: string;
  ownerDisplayName?: string | null;
  hostName?: string | null;
  permissions?: GameServerPermissions;
}

export function server(options: ServerFixtureOptions): GameServerDto {
  const name = options.name ?? `Server ${options.id}`;
  return {
    id: options.id,
    name,
    ownerId: options.ownerId ?? 'user-1',
    ownerDisplayName: options.ownerDisplayName ?? 'Alex',
    gameType: 'testserver',
    gameTypeName: options.gameTypeName ?? 'Testserver',
    status: options.status ?? 'stopped',
    statusMessage: null,
    hostId: 'node-1',
    hostName: options.hostName ?? 'Node Alpha',
    subdomain: options.subdomain ?? name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    address: { hostname: `${options.subdomain ?? 'welt'}.example.tld`, port: null },
    assignedPorts: [],
    resourceLimits: { ramMb: 4096, cpuCores: 2, diskMb: 20480 },
    autoShutdownEnabled: true,
    autoShutdownTimeoutMinutes: 30,
    startupParameters: '',
    config: {},
    dockerContainerId: null,
    pendingRestart: false,
    updateAvailable: false,
    pinned: false,
    memberCount: 0,
    lastStartedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: options.permissions ?? ownerPermissions(),
  };
}

export function gameType(overrides: Partial<GameTypeDto> = {}): GameTypeDto {
  return {
    id: 'testserver',
    name: 'Testserver',
    description: 'Einfacher Container, der auf einem Port lauscht.',
    iconUrl: null,
    coverImageUrl: null,
    supportsVirtualHostRouting: false,
    supportsWorldImport: true,
    defaultPorts: [25565],
    resourceDefaults: { ramMb: 2048, cpuCores: 1, diskMb: 10240 },
    configFields: [],
    available: true,
    unavailableReason: null,
    ...overrides,
  };
}
