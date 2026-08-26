/**
 * B8 – Admin-Funktionen (Lastenheft §3.7 und §3.8, STRUKTUR.md).
 *
 * Fünf Bereiche:
 *
 * - **Nodes** (`nodes.ts`) – Übersicht der Homeserver inkl. Auslastung,
 *   Kapazität und Status
 * - **Adressen** (`ports.ts`) – öffentlicher Port-Bereich der VPS und die
 *   Zuordnung Port ↔ Zielserver (Pflichtenheft §2.4)
 * - **Audit-Log** (`audit.ts`, `audit-archive.ts`) – append-only Protokoll aller
 *   sicherheitsrelevanten Aktionen plus Archivierung nach 24 Monaten
 * - **Speicherverwaltung** (`storage.ts`) – Storage-Explorer-API mit
 *   on-demand-Scan (Pflichtenheft §16)
 * - **Freischalt-Warteliste** (`registration-requests.ts`) – Anfragen neuer
 *   Registrierungen freigeben oder sperren
 *
 * Für andere Arbeitspakete besonders relevant:
 * - `AuditService.record()` – jede sicherheitsrelevante Aktion protokollieren
 * - `PortPoolService.allocateForServer()` / `.releaseForServer()` – B3 ruft sie
 *   bei Erstellung und Löschung eines Servers auf
 * - `HostNodeService.require()` – Node laden oder mit `NODE_NOT_FOUND` abbrechen
 */

export { AdminError, isAdminError } from './errors.js';

export { type AdminContext, contextOf } from './context.js';

export {
  AUDIT_SERVICE_METHODS,
  type AppendAuditEntry,
  type AuditArchiveRepository,
  type AuditEntryPage,
  type AuditEntryRecord,
  type AuditLogRepository,
  type AuditService,
  createAuditService,
  entryFor,
  toAuditLogEntryDto,
} from './audit.js';

export {
  type AuditArchiveDependencies,
  type AuditArchiveFile,
  type AuditArchiveWriter,
  archiveAuditEntries,
  archiveCutoff,
  archiveFileName,
  createGzipArchiveWriter,
} from './audit-archive.js';

export {
  type CreateHostNodeData,
  type HostNodeRecord,
  type HostNodeRepository,
  type HostNodeService,
  type HostNodeServiceDependencies,
  type NodePlacement,
  type NodePlacementSource,
  type NodeUsageSource,
  type UpdateHostNodeData,
  computeCapacity,
  computeHostNodePermissions,
  createHostNodeService,
  emptyNodePlacementSource,
  emptyNodeUsageSource,
} from './nodes.js';

export {
  type CreatePortRangeData,
  type PortAllocationRecord,
  type PortPoolRepository,
  type PortPoolService,
  type PortPoolServiceDependencies,
  type PortRangeRecord,
  type PortRequest,
  type UpdatePortRangeData,
  computePortAllocationPermissions,
  computePortRangePermissions,
  createPortPoolService,
  rangesOverlap,
} from './ports.js';

export {
  type KnownServerSource,
  type StorageEntryRemover,
  type StorageExplorerDependencies,
  type StorageExplorerService,
  type StorageRepository,
  type StorageScanGateway,
  type StorageSnapshotRecord,
  classifyEntry,
  createStorageExplorerService,
  emptyKnownServerSource,
  storageEntryId,
  toStorageEntryDto,
  unavailableStorageGateway,
  unavailableStorageRemover,
} from './storage.js';

export { type LinkedMethodRow, profileUrlFor, toLinkedAccountProfile } from './linked-profiles.js';

export {
  type RegistrationRequestDependencies,
  type RegistrationRequestRepository,
  type RegistrationRequestService,
  type WaitlistPage,
  type WaitlistRole,
  type WaitlistUserRecord,
  computeRegistrationRequestPermissions,
  createRegistrationRequestService,
  statusOf,
  toRegistrationRequestDto,
} from './registration-requests.js';

export {
  createDrizzleAuditArchiveRepository,
  createDrizzleAuditLogRepository,
  createDrizzleHostNodeRepository,
  createDrizzlePortPoolRepository,
  createDrizzleRegistrationRequestRepository,
  createDrizzleStorageRepository,
} from './repositories.js';

export { type AdminRouteServices, contextFrom, ipHintOf, registerAdminRoutes } from './routes.js';

export { type AdminModule, createAdminModule } from './module.js';
