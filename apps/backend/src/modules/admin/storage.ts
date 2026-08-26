/**
 * Storage-Explorer-API (Lastenheft §3.8, Pflichtenheft §16).
 *
 * Ablauf:
 * 1. Ein Admin stößt einen Scan an (`scan()`), das Backend schickt
 *    `GET_STORAGE_BREAKDOWN` an den Agent der Node.
 * 2. Das rohe Ergebnis wird **unverändert** mit Zeitstempel zwischengespeichert
 *    (`storage_snapshots`). Der Scan läuft on demand, nicht dauerhaft im
 *    Hintergrund.
 * 3. Bei jedem Abruf wird die Übersicht neu bewertet: Ob ein Posten löschbar
 *    ist, hängt vom aktuellen Datenbestand ab und nicht vom Zeitpunkt des Scans.
 *
 * **Die Kernregel des Arbeitspakets (Lastenheft §3.8):** Aktive
 * Server-Datenordner sind hierüber **nicht** löschbar – nur über den dedizierten
 * Server-Löschen-Vorgang. Löschbar sind ausschließlich Backups, ungenutzte
 * Container-Images und eindeutig verwaiste Daten.
 *
 * Diese Regel ist bewusst restriktiv ausgelegt: Ein Datenordner, dessen Server
 * das Backend nicht kennt, gilt **nicht** automatisch als verwaist, sondern
 * landet in der Kategorie `other` und bleibt gesperrt. Solange B3 die
 * Server-Tabelle noch nicht mitbringt, ist die Serverliste leer – ohne diese
 * Auslegung wäre in dem Zustand jeder Datenordner löschbar. Verwaist ist nur,
 * was der Agent selbst als verwaist meldet (`orphaned`): Dort liegen Daten
 * unterhalb der Palantir-Verzeichnisse, die zu keinem Container gehören.
 */

import {
  type AgentStorageEntry,
  type ApiResponse,
  type GetStorageBreakdownCommandPayload,
  type GetStorageBreakdownCommandResult,
  type StorageBreakdownDto,
  type StorageCategorySummaryDto,
  type StorageDeleteBlockReason,
  type StorageEntryDto,
  type StorageEntryKind,
  type StorageEntryPermissions,
  type StorageSnapshotDto,
  type StorageSnapshotPermissions,
  isFail,
} from '@palantir/contracts';
import { type StartStorageScanInput, getStorageBreakdownResultSchema } from '@palantir/validation';
import { type PermissionActor, hasAnyPermission, hasPermission } from '../rbac/index.js';
import type { AdminContext } from './context.js';
import { AdminError } from './errors.js';
import type { HostNodeRecord, HostNodeService } from './nodes.js';

/** Zwischengespeicherter Scan einer Node. */
export interface StorageSnapshotRecord {
  readonly nodeId: string;
  readonly scannedAt: Date;
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly freeBytes: number;
  readonly entries: readonly AgentStorageEntry[];
}

export interface StorageRepository {
  findSnapshot(nodeId: string): Promise<StorageSnapshotRecord | null>;
  /** Ersetzt den Scan der Node – es gibt genau einen je Node. */
  saveSnapshot(snapshot: StorageSnapshotRecord): Promise<void>;
}

/**
 * Server, die das Backend kennt – geliefert von B3.
 *
 * Ohne diese Liste bleibt jeder gemeldete Datenordner in der Kategorie `other`
 * und damit gesperrt (siehe Kopfkommentar).
 */
export interface KnownServerSource {
  load(): Promise<ReadonlyMap<string, { readonly name: string }>>;
}

export function emptyKnownServerSource(): KnownServerSource {
  return { load: async () => new Map() };
}

/**
 * Zugang zum Agent für den Scan.
 *
 * Der Kanal selbst gehört zu B3 (WebSocket-Endpunkt `/agent`); B8 kennt nur
 * diese eine Methode. Bis der Kanal steht, liefert
 * {@link unavailableStorageGateway} `AGENT_RUNTIME_UNAVAILABLE`.
 */
export interface StorageScanGateway {
  requestBreakdown(
    node: HostNodeRecord,
    payload: GetStorageBreakdownCommandPayload,
  ): Promise<ApiResponse<GetStorageBreakdownCommandResult>>;
}

export function unavailableStorageGateway(): StorageScanGateway {
  return {
    requestBreakdown: async () => ({
      success: false,
      data: null,
      error: {
        code: 'AGENT_RUNTIME_UNAVAILABLE',
        message:
          'Es besteht keine Verbindung zum Agent dieser Node. Der Scan kann erst laufen, wenn der Agent-Kanal steht (Arbeitspaket B3).',
      },
    }),
  };
}

/**
 * Ausführung einer Löschung auf dem Homeserver.
 *
 * **Getrennt von der Entscheidung, ob gelöscht werden darf.** Die Entscheidung
 * trifft dieses Modul und ist getestet; das Entfernen selbst passiert auf dem
 * Homeserver und braucht einen Agent-Befehl, den das Protokoll noch nicht
 * kennt (Pflichtenheft §5.3 listet keinen Lösch-Befehl für Speicher-Posten).
 * Bis A3 ihn mitbringt, antwortet {@link unavailableStorageRemover} mit
 * `AGENT_COMMAND_NOT_IMPLEMENTED` – vermerkt in WORK_STATUS.md unter
 * „Gefundene Punkte".
 */
export interface StorageEntryRemover {
  remove(node: HostNodeRecord, entry: StorageEntryDto): Promise<ApiResponse<null>>;
}

export function unavailableStorageRemover(): StorageEntryRemover {
  return {
    remove: async () => ({
      success: false,
      data: null,
      error: {
        code: 'AGENT_COMMAND_NOT_IMPLEMENTED',
        message:
          'Das Entfernen von Speicher-Posten auf dem Homeserver ist noch nicht gebaut (Arbeitspaket A3).',
      },
    }),
  };
}

interface Classification {
  readonly kind: StorageEntryKind;
  readonly label: string;
  readonly serverId: string | null;
  readonly blockedReason: StorageDeleteBlockReason | null;
}

/**
 * Bewertet einen vom Agent gemeldeten Posten.
 *
 * Einzige Stelle, an der entschieden wird, ob etwas gelöscht werden darf – die
 * Regel steht damit genau einmal im Code (CLAUDE.md §4).
 */
export function classifyEntry(
  entry: AgentStorageEntry,
  knownServers: ReadonlyMap<string, { readonly name: string }>,
): Classification {
  switch (entry.kind) {
    case 'serverData': {
      const server = entry.serverId ? knownServers.get(entry.serverId) : undefined;

      if (server) {
        // Lastenheft §3.8: ausschließlich über den Server-Löschen-Vorgang.
        return {
          kind: 'serverData',
          label: server.name,
          serverId: entry.serverId,
          blockedReason: 'activeServerData',
        };
      }

      // Datenordner ohne bekannten Server: nicht eindeutig verwaist, also gesperrt.
      return {
        kind: 'other',
        label: entry.path ?? 'Unbekannter Datenordner',
        serverId: entry.serverId,
        blockedReason: 'notClearlyOrphaned',
      };
    }

    case 'backup':
      return {
        kind: 'backup',
        label: entry.backupFileName ?? entry.path ?? 'Backup',
        serverId: entry.serverId,
        blockedReason: null,
      };

    case 'dockerImage':
      return {
        kind: 'dockerImage',
        label: entry.imageTag ?? entry.imageId ?? 'Container-Image',
        serverId: null,
        // Ein benutztes Image zu entfernen würde laufende Server beschädigen.
        blockedReason: entry.inUse ? 'imageInUse' : null,
      };

    case 'orphaned':
      return {
        kind: 'orphaned',
        label: entry.path ?? 'Verwaiste Daten',
        serverId: null,
        blockedReason: null,
      };
  }
}

/** Stabile Kennung eines Postens innerhalb eines Scans. */
export function storageEntryId(entry: AgentStorageEntry): string {
  return entry.path ?? entry.imageId ?? entry.imageTag ?? 'unbekannt';
}

function computeEntryPermissions(
  actor: PermissionActor,
  blockedReason: StorageDeleteBlockReason | null,
): StorageEntryPermissions {
  return {
    canView: hasAnyPermission(actor, ['node.view', 'node.manage']),
    canDelete: blockedReason === null && hasPermission(actor, 'node.manage'),
  };
}

export function toStorageEntryDto(
  actor: PermissionActor,
  entry: AgentStorageEntry,
  knownServers: ReadonlyMap<string, { readonly name: string }>,
): StorageEntryDto {
  const classification = classifyEntry(entry, knownServers);
  const canManage = hasPermission(actor, 'node.manage');
  // Fehlt die Berechtigung, ist das der Grund – sonst bleibt der fachliche.
  const blockedReason = classification.blockedReason ?? (canManage ? null : 'permissionMissing');

  return {
    id: storageEntryId(entry),
    kind: classification.kind,
    label: classification.label,
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    serverId: classification.serverId,
    backupId: null,
    imageTag: entry.imageTag,
    inUse: entry.inUse,
    lastModifiedAt: entry.lastModifiedAt,
    deleteBlockedReason: blockedReason,
    permissions: computeEntryPermissions(actor, classification.blockedReason),
  };
}

function summarize(entries: readonly StorageEntryDto[]): StorageCategorySummaryDto[] {
  const summaries = new Map<StorageEntryKind, StorageCategorySummaryDto>();

  for (const entry of entries) {
    const current = summaries.get(entry.kind);

    summaries.set(entry.kind, {
      kind: entry.kind,
      sizeBytes: (current?.sizeBytes ?? 0) + entry.sizeBytes,
      entryCount: (current?.entryCount ?? 0) + 1,
    });
  }

  return [...summaries.values()].sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function computeSnapshotPermissions(actor: PermissionActor): StorageSnapshotPermissions {
  return {
    canView: hasAnyPermission(actor, ['node.view', 'node.manage']),
    canScan: hasPermission(actor, 'node.manage'),
  };
}

export interface StorageExplorerService {
  /** Zwischengespeicherte Übersicht; `breakdown` ist `null`, solange nie gescannt wurde. */
  getSnapshot(ctx: AdminContext, nodeId: string): Promise<StorageSnapshotDto>;
  /** Neuen Scan anstoßen und das Ergebnis zwischenspeichern. */
  scan(
    ctx: AdminContext,
    nodeId: string,
    input: StartStorageScanInput,
  ): Promise<StorageSnapshotDto>;
  /** Einen Posten entfernen – lehnt gesperrte Posten ab, bevor irgendetwas passiert. */
  deleteEntry(ctx: AdminContext, nodeId: string, entryId: string): Promise<StorageEntryDto>;
}

export interface StorageExplorerDependencies {
  readonly repository: StorageRepository;
  readonly nodes: HostNodeService;
  readonly gateway?: StorageScanGateway;
  readonly remover?: StorageEntryRemover;
  readonly knownServers?: KnownServerSource;
  readonly now?: () => Date;
}

function requireStorageRead(actor: PermissionActor): void {
  if (!hasAnyPermission(actor, ['node.view', 'node.manage'])) {
    throw new AdminError('PERMISSION_DENIED');
  }
}

function requireStorageManage(actor: PermissionActor): void {
  if (!hasPermission(actor, 'node.manage')) {
    throw new AdminError('PERMISSION_DENIED');
  }
}

export function createStorageExplorerService(
  deps: StorageExplorerDependencies,
): StorageExplorerService {
  const gateway = deps.gateway ?? unavailableStorageGateway();
  const remover = deps.remover ?? unavailableStorageRemover();
  const knownServers = deps.knownServers ?? emptyKnownServerSource();
  const now = deps.now ?? ((): Date => new Date());

  async function toSnapshotDto(
    actor: PermissionActor,
    nodeId: string,
    snapshot: StorageSnapshotRecord | null,
  ): Promise<StorageSnapshotDto> {
    if (!snapshot) {
      return {
        nodeId,
        breakdown: null,
        ageSeconds: null,
        permissions: computeSnapshotPermissions(actor),
      };
    }

    const servers = await knownServers.load();
    const entries = snapshot.entries.map((entry) => toStorageEntryDto(actor, entry, servers));

    const breakdown: StorageBreakdownDto = {
      nodeId: snapshot.nodeId,
      scannedAt: snapshot.scannedAt.toISOString(),
      totalBytes: snapshot.totalBytes,
      usedBytes: snapshot.usedBytes,
      freeBytes: snapshot.freeBytes,
      categories: summarize(entries),
      entries,
    };

    return {
      nodeId,
      breakdown,
      ageSeconds: Math.max(0, Math.floor((now().getTime() - snapshot.scannedAt.getTime()) / 1000)),
      permissions: computeSnapshotPermissions(actor),
    };
  }

  async function requireSnapshot(nodeId: string): Promise<StorageSnapshotRecord> {
    const snapshot = await deps.repository.findSnapshot(nodeId);

    if (!snapshot) {
      throw new AdminError('STORAGE_SCAN_MISSING');
    }

    return snapshot;
  }

  return {
    async getSnapshot(ctx, nodeId) {
      requireStorageRead(ctx.actor);
      await deps.nodes.require(nodeId);

      return toSnapshotDto(ctx.actor, nodeId, await deps.repository.findSnapshot(nodeId));
    },

    async scan(ctx, nodeId, input) {
      requireStorageManage(ctx.actor);

      const node = await deps.nodes.require(nodeId);
      const response = await gateway.requestBreakdown(node, { includeImages: input.includeImages });

      if (isFail(response)) {
        // Der Fehlercode des Agents wird unverändert weitergereicht – das
        // Frontend soll „Agent nicht erreichbar" von „noch nicht gebaut"
        // unterscheiden können.
        throw new AdminError(response.error.code, response.error.message);
      }

      // Der Agent läuft auf einer anderen Maschine; sein Ergebnis ist Eingabe
      // wie jede andere und wird geprüft, bevor es gespeichert wird.
      const parsed = getStorageBreakdownResultSchema.safeParse(response.data);

      if (!parsed.success) {
        throw new AdminError(
          'AGENT_COMMAND_INVALID',
          'Die Speicherübersicht des Agents entspricht nicht dem vereinbarten Format.',
        );
      }

      const snapshot: StorageSnapshotRecord = {
        nodeId,
        scannedAt: new Date(parsed.data.scannedAt),
        totalBytes: parsed.data.totalBytes,
        usedBytes: parsed.data.usedBytes,
        freeBytes: parsed.data.freeBytes,
        entries: parsed.data.entries,
      };

      await deps.repository.saveSnapshot(snapshot);

      return toSnapshotDto(ctx.actor, nodeId, snapshot);
    },

    async deleteEntry(ctx, nodeId, entryId) {
      requireStorageManage(ctx.actor);

      const node = await deps.nodes.require(nodeId);
      const snapshot = await requireSnapshot(nodeId);
      const servers = await knownServers.load();

      const raw = snapshot.entries.find((entry) => storageEntryId(entry) === entryId);

      if (!raw) {
        throw new AdminError('STORAGE_ENTRY_NOT_FOUND');
      }

      const entry = toStorageEntryDto(ctx.actor, raw, servers);

      if (!entry.permissions.canDelete) {
        // Lastenheft §3.8. Die Prüfung steht bewusst **vor** jedem Zugriff auf
        // den Homeserver: Ein gesperrter Posten wird nicht einmal angefasst.
        throw new AdminError('STORAGE_ENTRY_NOT_DELETABLE');
      }

      const response = await remover.remove(node, entry);

      if (isFail(response)) {
        throw new AdminError(response.error.code, response.error.message);
      }

      const remaining = snapshot.entries.filter(
        (candidate) => storageEntryId(candidate) !== entryId,
      );

      // Der zwischengespeicherte Scan wird nachgezogen, damit die Oberfläche
      // den entfernten Posten nicht weiter anzeigt. Die Größenangaben bleiben
      // die des Scans – korrekt werden sie erst beim nächsten Lauf.
      await deps.repository.saveSnapshot({ ...snapshot, entries: remaining });

      return entry;
    },
  };
}
