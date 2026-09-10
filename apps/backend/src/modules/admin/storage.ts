/**
 * Storage-Explorer-API (Lastenheft §3.8, Pflichtenheft §16).
 *
 * Ablauf:
 * 1. Ein Admin stößt einen Scan an (`scan()`), das Backend schickt
 *    `GET_STORAGE_BREAKDOWN` an den Agent der Node.
 * 2. Das rohe Ergebnis wird mit Zeitstempel zwischengespeichert
 *    (`storage_snapshots`) – ohne jede Umdeutung; einzig Posten, die dem
 *    vereinbarten Format nicht entsprechen, bleiben außen vor (siehe `scan()`).
 *    Der Scan läuft on demand, nicht dauerhaft im Hintergrund.
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
 *
 * **Auch ein `orphaned` des Agents ist nur ein Verdacht** (Fundpunkt 136): Der
 * Agent vergibt ihn, wenn er zu einem Datenordner **keinen Container** findet –
 * und ein Container kann fehlen, obwohl das Panel den Server noch führt (Prune
 * auf der Node, neu aufgesetzter Docker-Host, von Hand entfernter Container).
 * Bis hierher griff die Sperre nur für `serverData`, und genau dieser Ordner
 * ließ sich über den Speicher-Explorer entfernen – der Spielstand eines
 * Servers, den das Panel weiterhin anzeigt. Deshalb wird zusätzlich der
 * **Ordnername** gegen die bekannten Server geprüft: Passt er auf einen, ist es
 * der Datenordner dieses Servers und bleibt gesperrt. Ein wirklich gelöschter
 * Server steht in der Liste nicht mehr – seine Reste bleiben löschbar.
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
import {
  type StartStorageScanInput,
  agentStorageEntrySchema,
  getStorageBreakdownResultSchema,
} from '@palantir/validation';
import { z } from 'zod';
import { type PermissionActor, hasAnyPermission, hasPermission } from '../rbac/index.js';
import { type AuditService, entryFor } from './audit.js';
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
 * Letzter Namensbestandteil eines Pfades vom Homeserver.
 *
 * Bewusst ohne `node:path`: Der Pfad kommt von einer Linux-Node, die Tests
 * laufen auch unter Windows – `path.basename()` würde dort an `/` nicht
 * trennen. Beide Trennzeichen abzudecken kostet eine Zeile und macht die
 * Auswertung vom Betriebssystem des Backends unabhängig.
 */
function ordnernameAus(pfad: string | null): string | null {
  if (pfad === null) {
    return null;
  }

  const teile = pfad.split(/[\\/]+/).filter((teil) => teil.length > 0);

  return teile[teile.length - 1] ?? null;
}

/**
 * Der Server, zu dem ein Posten gehört – sofern das Panel ihn noch führt
 * (Fundpunkt 136).
 *
 * Zwei Wege, in dieser Reihenfolge:
 *
 * 1. Die vom Agent gemeldete `serverId`. Die setzt er nur, wenn er einen
 *    passenden **Container** gefunden hat.
 * 2. Der **Ordnername**. Der Datenordner heißt auf der Node wie die Server-Id
 *    (`<AGENT_DATA_DIR>/<serverId>`); der Agent legt ihn so an. Damit bleibt
 *    der Bezug erhalten, wenn der Container fehlt – der Fall, in dem der Agent
 *    `orphaned` meldet, obwohl der Server im Panel weiterlebt.
 *
 * Der Vergleich läuft klein geschrieben: Der Agent normalisiert Ordnernamen
 * ebenso (`storage-scanner.ts`), und PostgreSQL liefert UUIDs klein.
 */
function bekannterServerZu(
  entry: AgentStorageEntry,
  knownServers: ReadonlyMap<string, { readonly name: string }>,
): { readonly id: string; readonly name: string } | null {
  for (const kandidat of [entry.serverId, ordnernameAus(entry.path)]) {
    if (kandidat === null) {
      continue;
    }

    const id = kandidat.toLowerCase();
    const server = knownServers.get(id);

    if (server) {
      return { id, name: server.name };
    }
  }

  return null;
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
      const server = bekannterServerZu(entry, knownServers);

      if (server) {
        // Lastenheft §3.8: ausschließlich über den Server-Löschen-Vorgang.
        return {
          kind: 'serverData',
          label: server.name,
          serverId: server.id,
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

    case 'orphaned': {
      /*
       * Der Agent meldet `orphaned`, wenn zum Ordner **kein Container**
       * existiert – nicht, wenn es den Server nicht mehr gibt (Fundpunkt 136).
       * Führt das Panel einen Server dieses Namens weiter, ist das sein
       * Datenordner: Ein Prune auf der Node oder ein neu aufgesetzter
       * Docker-Host hat den Container entfernt, den Spielstand aber nicht. Er
       * gehört damit unter dieselbe Sperre wie jeder aktive Datenordner
       * (Lastenheft §3.8) – entfernt wird er nur über das Löschen des Servers.
       */
      const server = bekannterServerZu(entry, knownServers);

      if (server) {
        return {
          kind: 'serverData',
          label: server.name,
          serverId: server.id,
          blockedReason: 'activeServerData',
        };
      }

      // Echte Waise: kein Container, kein Server im Panel – löschbar wie bisher.
      return {
        kind: 'orphaned',
        label: entry.path ?? 'Verwaiste Daten',
        serverId: null,
        blockedReason: null,
      };
    }

    default:
      /*
       * Eine Postenart, die dieser Code nicht kennt (Audit 2026-09-10,
       * Fundpunkt 224).
       *
       * Über die Union ist die Fallunterscheidung vollständig – der Wert kommt
       * aber aus `storage_snapshots.entries`, einer `jsonb`-Spalte, und die
       * prüft zur Laufzeit niemand nach. Beim **Empfang** tut es
       * `agentStorageEntrySchema` Posten für Posten, ausdrücklich damit ein
       * einzelner Ordner nicht die ganze Übersicht zerlegt; beim **Lesen** aus
       * der Datenbank fehlte dieselbe Vorsicht. Ohne diesen Zweig lieferte
       * `classifyEntry` `undefined`, `toStorageEntryDto` griff darauf zu und
       * die ganze Node-Platz-Seite antwortete mit HTTP 500 – dauerhaft, denn
       * der Scan liegt gespeichert, und über die Oberfläche gibt es keinen Weg
       * zurück.
       *
       * Erreichbar wird das, sobald eine spätere Agent-Fassung eine Postenart
       * ergänzt und das Schema mitzieht, dieser Code aber nicht. Die Zeile ist
       * dann nicht löschbar (`notClearlyOrphaned`) und steht unter `other` –
       * sichtbar, aber ohne Wirkung. Der Rest der Seite bleibt benutzbar.
       */
      return {
        kind: 'other',
        label: entry.path ?? 'Unbekannter Posten',
        serverId: entry.serverId,
        blockedReason: 'notClearlyOrphaned',
      };
  }
}

/**
 * Stabile Kennung eines Postens innerhalb eines Scans.
 *
 * Die Kennung ist die einzige Handhabe, mit der ein Client einen Posten zum
 * Löschen benennt – sie muss innerhalb eines Scans eindeutig sein
 * (Audit-Fundstelle backend-admin-resources-10). Bis hierher fielen alle Posten
 * ohne Pfad, Image-Id und Image-Tag auf den festen Wert `'unbekannt'` zurück:
 * Zwei solche Posten teilten sich eine Kennung, das Löschen bewertete den
 * ersten und entfernte **beide** aus dem Zwischenspeicher – der zweite
 * verschwand aus der Anzeige, ohne von der Platte zu sein.
 *
 * Die Reihenfolge der natürlichen Merkmale ist Vertrag, nicht Geschmack: Bei
 * `dockerImage` reicht der Remover die Kennung unverändert als `imageId` an den
 * Agent weiter (`createAgentStorageEntryRemover` in B3). Deshalb bleibt dort
 * `entry.imageId` die Kennung – ohne Präfix, ohne Umformung.
 *
 * Bleibt kein natürliches Merkmal übrig, tritt ein Fingerabdruck über den
 * Inhalt des Postens an die Stelle des alten Festwerts. Er hängt bewusst nicht
 * an der Position in der Liste – die verschiebt sich, sobald ein Posten
 * gelöscht wird, und eine wandernde Kennung träfe beim nächsten Klick den
 * falschen Posten. Zwei in **jedem** Feld gleiche Posten bleiben damit
 * ununterscheidbar; für die verweigert {@link StorageExplorerService.deleteEntry}
 * die Löschung, statt zu raten.
 */
export function storageEntryId(entry: AgentStorageEntry): string {
  return (
    entry.path ??
    entry.imageId ??
    entry.imageTag ??
    entry.backupFileName ??
    [
      'posten',
      entry.kind,
      entry.serverId ?? '-',
      String(entry.sizeBytes),
      entry.inUse ? 'benutzt' : 'frei',
      entry.lastModifiedAt ?? '-',
    ].join(':')
  );
}

/**
 * Der Rahmen einer Scan-Meldung – Zeitstempel und Belegung streng geprüft, die
 * Postenliste zunächst nur als Liste.
 *
 * Die Posten prüft {@link agentStorageEntrySchema} anschließend einzeln
 * (Audit-Fundstelle contracts-validation-02): Ein einziger Ordner, mit dem das
 * Schema nichts anfangen kann, darf nicht die gesamte Speicherübersicht der
 * Node unbenutzbar machen. Der Rahmen dagegen bleibt hart – ohne Zeitstempel
 * und Belegung ist die Meldung als Ganzes wertlos.
 */
const storageBreakdownFrameSchema = getStorageBreakdownResultSchema.extend({
  entries: z.array(z.unknown()),
});

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
  /**
   * Audit-Log für die Löschung eines Postens (Pflichtenheft §6).
   *
   * Nicht optional – wie bei `nodes` und `ports`: Seit A3 den Remover
   * mitbringt, verschwinden hier echte Daten vom Homeserver. Ein Aufbau ohne
   * Log wäre genau die Lücke, die dieser Eintrag schließt.
   */
  readonly audit: AuditService;
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
      // wie jede andere und wird geprüft, bevor es gespeichert wird – aber in
      // zwei Stufen (Audit-Fundstelle contracts-validation-02).
      //
      // Zuerst der Rahmen: Stimmt er nicht, ist die Meldung als Ganzes
      // unbrauchbar und wird wie bisher abgelehnt.
      const frame = storageBreakdownFrameSchema.safeParse(response.data);

      if (!frame.success) {
        throw new AdminError(
          'AGENT_COMMAND_INVALID',
          'Die Speicherübersicht des Agents entspricht nicht dem vereinbarten Format.',
        );
      }

      // Dann die Posten einzeln. Was hier liegt, hat der Homeserver auf der
      // Platte gefunden – darunter auch von Hand angelegte Ordner, die niemand
      // vorhergesehen hat. Ein solcher Posten wird übergangen; früher zerlegte
      // er das gesamte Ergebnis und der Storage-Explorer der Node blieb
      // unbenutzbar, bis jemand den Ordner an der Konsole entfernte. Genau
      // dieses Aufräumen ist aber der Zweck der Ansicht.
      const entries: AgentStorageEntry[] = [];

      for (const candidate of frame.data.entries) {
        const parsed = agentStorageEntrySchema.safeParse(candidate);

        if (parsed.success) {
          entries.push(parsed.data);
        }
      }

      // Kein einziger brauchbarer Posten aus einer nicht leeren Meldung: Das
      // ist kein fremder Ordner mehr, sondern ein auseinandergelaufenes
      // Protokoll. Dann lieber der alte Fehler als ein leerer Scan, der
      // aussieht, als läge auf dem Homeserver nichts.
      if (entries.length === 0 && frame.data.entries.length > 0) {
        throw new AdminError(
          'AGENT_COMMAND_INVALID',
          'Kein einziger Posten der Speicherübersicht entspricht dem vereinbarten Format.',
        );
      }

      const snapshot: StorageSnapshotRecord = {
        nodeId,
        scannedAt: new Date(frame.data.scannedAt),
        totalBytes: frame.data.totalBytes,
        usedBytes: frame.data.usedBytes,
        freeBytes: frame.data.freeBytes,
        entries,
      };

      await deps.repository.saveSnapshot(snapshot);

      return toSnapshotDto(ctx.actor, nodeId, snapshot);
    },

    async deleteEntry(ctx, nodeId, entryId) {
      requireStorageManage(ctx.actor);

      const node = await deps.nodes.require(nodeId);
      const snapshot = await requireSnapshot(nodeId);
      const servers = await knownServers.load();

      // Alle Treffer, nicht nur den ersten (Audit-Fundstelle
      // backend-admin-resources-10): Eine Kennung, die auf mehrere Posten
      // passt, ist keine Anweisung, sondern eine offene Frage.
      const treffer = snapshot.entries.filter((entry) => storageEntryId(entry) === entryId);

      if (treffer.length > 1) {
        /*
         * Mehrdeutig – hier wird nicht geraten, welcher Posten gemeint ist.
         * Das kann nur passieren, wenn zwei Posten in jedem Feld gleich sind
         * (siehe `storageEntryId`); die Abhilfe ist dieselbe wie bei einem
         * fehlenden Scan: neu scannen und erneut versuchen. Der Grund ist ein
         * anderer, deshalb ein eigener Code – die Übersicht ist ja da.
         */
        throw new AdminError('STORAGE_ENTRY_AMBIGUOUS');
      }

      const raw = treffer[0];

      if (raw === undefined) {
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

      // Entfernt wird genau der bewertete Posten – über die Objektidentität,
      // nicht über die Kennung. Ein Filter über die Kennung riss früher alle
      // Namensvettern mit aus dem Zwischenspeicher, obwohl auf der Platte nur
      // einer verschwunden war (Audit-Fundstelle backend-admin-resources-10).
      const remaining = snapshot.entries.filter((candidate) => candidate !== raw);

      // Der zwischengespeicherte Scan wird nachgezogen, damit die Oberfläche
      // den entfernten Posten nicht weiter anzeigt. Die Größenangaben bleiben
      // die des Scans – korrekt werden sie erst beim nächsten Lauf.
      await deps.repository.saveSnapshot({ ...snapshot, entries: remaining });

      // Erst nach dem Erfolg auf dem Homeserver: Ein abgelehnter Versuch hat
      // nichts entfernt und gehört nicht als Löschung ins Log. Die Größe steht
      // im Eintrag, weil sich später nicht mehr rekonstruieren lässt, wie viel
      // an dieser Stelle lag (Pflichtenheft §6).
      await deps.audit.record(
        entryFor(ctx, {
          action: 'storage.entryDeleted',
          targetType: 'storageEntry',
          targetId: entry.id,
          metadata: {
            nodeId,
            kind: entry.kind,
            sizeBytes: entry.sizeBytes,
            path: entry.path,
          },
        }),
      );

      return entry;
    },
  };
}
