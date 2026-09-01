/**
 * Zusammenbau des Admin-Moduls für den Betrieb (B8).
 *
 * Hier werden die Drizzle-Repositories mit den Services verdrahtet. Die
 * Services selbst kennen keine Datenbank – deshalb lassen sie sich in Tests mit
 * Attrappen betreiben (CLAUDE.md §4), und deshalb steht diese Verdrahtung an
 * genau einer Stelle.
 *
 * Die Anschlusspunkte an andere Arbeitspakete sind optional und haben eine
 * ehrliche Vorgabe: Solange B3 (Server-Tabelle, Agent-Kanal), B4 (Messwerte)
 * und A3 (Speicher-Scanner) fehlen, liefern sie leere Ergebnisse bzw. einen
 * benannten Fehlercode – statt so zu tun, als wäre alles vorhanden.
 */

import type { Database } from '../../db/index.js';
import type { RoleService } from '../rbac/index.js';
import {
  type AuditArchiveDependencies,
  archiveAuditEntries,
  createGzipArchiveWriter,
} from './audit-archive.js';
import { type AuditService, createAuditService } from './audit.js';
import {
  type HostNodeService,
  type NodePlacementSource,
  type NodeUsageSource,
  createHostNodeService,
} from './nodes.js';
import { type PortPoolService, createPortPoolService } from './ports.js';
import {
  createDrizzleInstanceSettingsRepository,
  createInstanceSettingsService,
  type InstanceSettingsService,
} from './instance-settings.js';
import {
  type RegistrationRequestService,
  createRegistrationRequestService,
  type QuotaSummaryReader,
} from './registration-requests.js';
import {
  createDrizzleAuditArchiveRepository,
  createDrizzleAuditLogRepository,
  createDrizzleHostNodeRepository,
  createDrizzlePortPoolRepository,
  createDrizzleRegistrationRequestRepository,
  createDrizzleRoleMemberLookup,
  createDrizzleStorageRepository,
} from './repositories.js';
import { type RoleAdminService, createRoleAdminService } from './roles.js';
import type { AdminRouteServices } from './routes.js';
import {
  type KnownServerSource,
  type StorageEntryRemover,
  type StorageExplorerService,
  type StorageScanGateway,
  createStorageExplorerService,
} from './storage.js';

export interface AdminModuleOptions {
  readonly db: Database;
  /** Rollenverwaltung aus B2 – für die Freigabe wartender Konten. */
  readonly roles: RoleService;
  /** Ablageort der Audit-Archive auf der VPS (`AUDIT_ARCHIVE_DIR`). */
  readonly auditArchiveDir?: string;
  /** Anschluss an B3: Belegung der Nodes. */
  readonly nodePlacements?: NodePlacementSource;
  /** Anschluss an B4: gemessene Auslastung der Nodes. */
  readonly nodeUsage?: NodeUsageSource;
  /** Anschluss an B3: Agent-Kanal für den Speicher-Scan. */
  readonly storageGateway?: StorageScanGateway;
  /** Anschluss an A3/B5: Entfernen eines Speicher-Postens auf dem Homeserver. */
  readonly storageRemover?: StorageEntryRemover;
  /** Anschluss an B3: bekannte Server für die Bewertung der Datenordner. */
  readonly knownServers?: KnownServerSource;
  /** Anschluss an B3: Anzeigenamen der Server in der Port-Übersicht. */
  readonly serverNames?: () => Promise<ReadonlyMap<string, string>>;
  /** Anschluss an B4: Kontingente für die Spalte in der Nutzerliste (Abgleich 12.1.3). */
  readonly quotas?: QuotaSummaryReader;
}

export interface AdminModule {
  readonly services: AdminRouteServices;
  readonly nodes: HostNodeService;
  readonly ports: PortPoolService;
  readonly audit: AuditService;
  readonly storage: StorageExplorerService;
  readonly registrationRequests: RegistrationRequestService;
  readonly instanceSettings: InstanceSettingsService;
  readonly roles: RoleAdminService;
  /** Archivierungslauf ohne HTTP – genutzt vom Kommando `audit:archive`. */
  readonly archiveAuditLog: () => ReturnType<typeof archiveAuditEntries>;
}

export function createAdminModule(options: AdminModuleOptions): AdminModule {
  const { db } = options;

  const audit = createAuditService(createDrizzleAuditLogRepository(db));

  const nodes = createHostNodeService({
    repository: createDrizzleHostNodeRepository(db),
    audit,
    ...(options.nodePlacements ? { placements: options.nodePlacements } : {}),
    ...(options.nodeUsage ? { usage: options.nodeUsage } : {}),
  });

  const ports = createPortPoolService({
    repository: createDrizzlePortPoolRepository(db),
    audit,
    ...(options.serverNames ? { serverNames: options.serverNames } : {}),
  });

  const storage = createStorageExplorerService({
    repository: createDrizzleStorageRepository(db),
    nodes,
    ...(options.storageGateway ? { gateway: options.storageGateway } : {}),
    ...(options.storageRemover ? { remover: options.storageRemover } : {}),
    ...(options.knownServers ? { knownServers: options.knownServers } : {}),
  });

  const instanceSettings = createInstanceSettingsService({
    repository: createDrizzleInstanceSettingsRepository(db),
  });

  const registrationRequests = createRegistrationRequestService({
    repository: createDrizzleRegistrationRequestRepository(db),
    roles: options.roles,
    audit,
    ...(options.quotas ? { quotas: options.quotas } : {}),
  });

  // Rollenverwaltung: Die Regeln liegen im RoleService aus B2, hier kommen
  // nur das Audit-Log und die Existenzprüfung des Kontos dazu (roles.ts).
  const roleAdmin = createRoleAdminService({
    roles: options.roles,
    audit,
    users: createDrizzleRoleMemberLookup(db),
  });

  const auditArchive: AuditArchiveDependencies | undefined = options.auditArchiveDir
    ? {
        repository: createDrizzleAuditArchiveRepository(db),
        writer: createGzipArchiveWriter(options.auditArchiveDir),
        audit,
      }
    : undefined;

  return {
    services: {
      nodes,
      ports,
      audit,
      storage,
      registrationRequests,
      instanceSettings,
      roles: roleAdmin,
      ...(auditArchive ? { auditArchive } : {}),
    },
    nodes,
    ports,
    audit,
    storage,
    registrationRequests,
    instanceSettings,
    roles: roleAdmin,
    archiveAuditLog: async () => {
      if (!auditArchive) {
        throw new Error(
          'AUDIT_ARCHIVE_DIR ist nicht gesetzt. Bitte die zentrale .env im Repo-Root ausfüllen (siehe .env.example Abschnitt 14).',
        );
      }

      // Ohne Actor: Der Aufruf kommt vom Wartungs-Kommando auf der VPS, das
      // bereits Systemzugang voraussetzt.
      return archiveAuditEntries(auditArchive, null);
    },
  };
}
