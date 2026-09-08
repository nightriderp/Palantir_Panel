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

import type { Pool } from 'pg';
import type { Database, DbConnection } from '../../db/index.js';
import type { RoleService } from '../rbac/index.js';
import {
  type AuditArchiveDependencies,
  archiveAuditEntries,
  createGzipArchiveWriter,
} from './audit-archive.js';
import { type AuditService, createAuditService } from './audit.js';
import {
  type HostNodeService,
  type NodeConnectionSource,
  type NodePlacementSource,
  type NodeUsageSource,
  createHostNodeService,
} from './nodes.js';
import { type PortPoolService, createPortPoolService } from './ports.js';
import {
  createDrizzleInstanceSettingsRepository,
  createInstanceSettingsService,
  type FontDirectory,
  type InstanceSettingsService,
} from './instance-settings.js';
import {
  type AccountBlockSink,
  type RegistrationRequestService,
  createRegistrationRequestService,
  type QuotaSummaryReader,
  type ServerCountReader,
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
  /**
   * Verbindungspool derselben Datenbank (`getPool()`).
   *
   * Zusätzlich zur Drizzle-Instanz, weil der Archivierungslauf einen
   * Advisory-Lock auf Sitzungsebene hält und dafür für seine Dauer eine feste
   * Verbindung braucht (Audit W2-16, siehe `repositories.ts`).
   */
  readonly pool: Pool;
  /** Rollenverwaltung aus B2 – für die Freigabe wartender Konten. */
  readonly roles: RoleService;
  /** Ablageort der Audit-Archive auf der VPS (`AUDIT_ARCHIVE_DIR`). */
  readonly auditArchiveDir?: string;
  /** Anschluss an B3: Belegung der Nodes. */
  readonly nodePlacements?: NodePlacementSource;
  /** Anschluss an B4: gemessene Auslastung der Nodes. */
  readonly nodeUsage?: NodeUsageSource;
  /**
   * Anschluss an B3: offene Agent-Verbindungen.
   *
   * Gebraucht beim Ende einer Wartung, um die Node mit dem Zustand
   * einzutragen, der der Wirklichkeit entspricht (`nodes.ts`).
   */
  readonly nodeConnections?: NodeConnectionSource;
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
  /** Anschluss an B3: Serveranzahl je Konto in der Nutzerliste (Gefundener Punkt 90). */
  readonly serverCounts?: ServerCountReader;
  /**
   * Anschluss an B7: Empfaenger der Kontosperre (Audit W2-2). Der Chat schliesst
   * daraufhin die offenen Live-Verbindungen des Kontos.
   */
  readonly sessions?: AccountBlockSink;
  /**
   * Anschluss an S-2: Bestand der Schriften.
   *
   * Nur damit lassen sich `uiFontId`/`monospaceFontId` in den
   * Instanz-Einstellungen setzen – ohne den Anschluss gilt jede Kennung als
   * unbekannt (`FONT_NOT_FOUND`), was der sichere Zustand ist.
   */
  readonly fonts?: FontDirectory;
}

export interface AdminModule {
  readonly services: AdminRouteServices;
  readonly nodes: HostNodeService;
  readonly ports: PortPoolService;
  /**
   * Derselbe Port-Pool, gebunden an eine **andere** Verbindung – etwa an eine
   * laufende Transaktion (Fundpunkt 135).
   *
   * B3 vergibt die Ports eines neuen Servers innerhalb der Transaktion, in der
   * der Server entsteht. Dafür braucht es den Dienst über dem
   * Transaktions-Handle: Repository **und** Audit-Log schreiben dann in
   * dieselbe Transaktion, und ein Rollback nimmt beides mit.
   *
   * {@link AdminModule.ports} ist genau dieser Aufruf mit dem Pool.
   */
  readonly portPoolFor: (connection: DbConnection) => PortPoolService;
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

  /*
   * Der Port-Pool über einer frei wählbaren Verbindung (Fundpunkt 135).
   *
   * Er entsteht vor der Node-Verwaltung: Letztere fragt beim Löschen einer Node
   * nach den an sie gebundenen Bereichen (Audit W3-6). Umgekehrt kennt die
   * Port-Verwaltung die Nodes nicht – die Richtung bleibt eindeutig.
   *
   * Das Audit-Log wird hier **mit** gebunden: Vergibt B3 die Ports innerhalb
   * der Transaktion, in der der Server entsteht, dann gehört auch der Eintrag
   * `address.portAllocated` in diese Transaktion. Sonst bliebe er stehen, wenn
   * das Anlegen scheitert – ein Protokoll, das eine Vergabe behauptet, die
   * niemals bestand, und dessen `targetId` auf einen Server zeigt, den es nie
   * gab.
   */
  const portPoolFor = (connection: DbConnection): PortPoolService =>
    createPortPoolService({
      repository: createDrizzlePortPoolRepository(connection),
      // Über dem Pool bleibt es der gemeinsame Dienst des Moduls; über einer
      // Transaktion braucht es einen, der in genau diese schreibt.
      audit:
        connection === db ? audit : createAuditService(createDrizzleAuditLogRepository(connection)),
      ...(options.serverNames ? { serverNames: options.serverNames } : {}),
    });

  const ports = portPoolFor(db);

  const nodes = createHostNodeService({
    repository: createDrizzleHostNodeRepository(db),
    audit,
    portBindings: ports,
    ...(options.nodePlacements ? { placements: options.nodePlacements } : {}),
    ...(options.nodeUsage ? { usage: options.nodeUsage } : {}),
    ...(options.nodeConnections ? { connections: options.nodeConnections } : {}),
  });

  const storage = createStorageExplorerService({
    repository: createDrizzleStorageRepository(db),
    nodes,
    audit,
    ...(options.storageGateway ? { gateway: options.storageGateway } : {}),
    ...(options.storageRemover ? { remover: options.storageRemover } : {}),
    ...(options.knownServers ? { knownServers: options.knownServers } : {}),
  });

  const instanceSettings = createInstanceSettingsService({
    repository: createDrizzleInstanceSettingsRepository(db),
    // Änderungen an instanzweiten Schaltern gehören ins Log (Pflichtenheft §6).
    audit,
    ...(options.fonts ? { fonts: options.fonts } : {}),
  });

  const registrationRequests = createRegistrationRequestService({
    repository: createDrizzleRegistrationRequestRepository(db),
    roles: options.roles,
    audit,
    ...(options.quotas ? { quotas: options.quotas } : {}),
    ...(options.serverCounts ? { serverCounts: options.serverCounts } : {}),
    ...(options.sessions ? { sessions: options.sessions } : {}),
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
        repository: createDrizzleAuditArchiveRepository(db, options.pool),
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
    portPoolFor,
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
