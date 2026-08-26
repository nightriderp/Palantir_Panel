/**
 * Archivierungsprozess für das Audit-Log (Pflichtenheft §6).
 *
 * „Ein separater, rein additiver Archivierungsprozess exportiert Einträge, die
 * älter als 24 Monate sind, in eine komprimierte Archivdatei und entfernt sie
 * anschließend aus der aktiven Tabelle."
 *
 * **Reihenfolge ist die ganze Zusicherung:** erst vollständig exportieren, dann
 * entfernen. Schlägt der Export fehl, bleibt die aktive Tabelle unverändert und
 * der Lauf endet mit `AUDIT_ARCHIVE_FAILED`. Ein halb geschriebenes Archiv
 * führt nie dazu, dass Einträge verschwinden.
 *
 * Der Lauf wird von Hand angestoßen – über die Admin-Oberfläche oder das
 * Kommando `pnpm --filter @palantir/backend audit:archive`. Bewusst kein
 * Hintergrundjob im Backend: Der Zeitpunkt bleibt für den Betreiber sichtbar,
 * genau wie bei Migrationen und Seed-Rollen.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { AUDIT_RETENTION_MONTHS, type AuditArchiveResultDto } from '@palantir/contracts';
import { type PermissionActor, hasPermission } from '../rbac/index.js';
import { type AuditArchiveRepository, type AuditEntryRecord, type AuditService } from './audit.js';
import { AdminError } from './errors.js';

/**
 * Schreibt die Archivdatei.
 *
 * Hinter einer Schnittstelle, damit der Ablauf – und vor allem die Reihenfolge
 * „erst schreiben, dann löschen" – ohne Dateisystem prüfbar bleibt
 * (CLAUDE.md §4, analog zum `ContainerRuntime`-Interface des Agents).
 */
export interface AuditArchiveWriter {
  write(fileName: string, entries: readonly AuditEntryRecord[]): Promise<AuditArchiveFile>;
}

export interface AuditArchiveFile {
  /** Ablageort der geschriebenen Datei auf der VPS. */
  readonly filePath: string;
  readonly sizeBytes: number;
}

/** Stichtag: alles davor darf archiviert werden. */
export function archiveCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - AUDIT_RETENTION_MONTHS);

  return cutoff;
}

/** Dateiname eines Laufs – enthält den Stichtag, damit Archive sortierbar bleiben. */
export function archiveFileName(cutoff: Date): string {
  const stamp = cutoff.toISOString().slice(0, 10);

  return `audit-log-bis-${stamp}.jsonl.gz`;
}

/**
 * Schreibt die Einträge als gzip-komprimiertes JSON Lines in ein Verzeichnis.
 *
 * JSON Lines statt eines großen JSON-Arrays: Ein Archiv lässt sich damit
 * zeilenweise lesen und durchsuchen, ohne es vollständig in den Speicher zu
 * laden – und ein abgeschnittenes Archiv fällt sofort auf.
 *
 * Bricht das Schreiben ab, wird die halbfertige Datei wieder entfernt und der
 * Fehler weitergereicht: Ein Torso im Archivverzeichnis würde später wie ein
 * vollständiger Export aussehen.
 */
export function createGzipArchiveWriter(directory: string): AuditArchiveWriter {
  return {
    async write(fileName, entries) {
      await mkdir(directory, { recursive: true });

      const filePath = path.join(directory, fileName);
      const lines = entries.map((entry) => `${JSON.stringify(serializeEntry(entry))}\n`);

      try {
        await pipeline(Readable.from(lines), createGzip(), createWriteStream(filePath));
      } catch (error: unknown) {
        await unlink(filePath).catch(() => undefined);
        throw error;
      }

      const { size } = await stat(filePath);

      return { filePath, sizeBytes: size };
    },
  };
}

function serializeEntry(entry: AuditEntryRecord): Record<string, unknown> {
  return {
    id: entry.id,
    action: entry.action,
    actorId: entry.actorId,
    actorDisplayName: entry.actorDisplayName,
    targetType: entry.targetType,
    targetId: entry.targetId,
    ipHint: entry.ipHint,
    metadata: entry.metadata,
    timestamp: entry.timestamp.toISOString(),
  };
}

export interface AuditArchiveDependencies {
  readonly repository: AuditArchiveRepository;
  readonly writer: AuditArchiveWriter;
  /**
   * Das Log über sich selbst: Der Lauf wird protokolliert
   * (`audit.archived`) – und zwar **nach** dem Entfernen, damit der neue
   * Eintrag nicht selbst Teil des Archivs werden kann.
   */
  readonly audit?: AuditService;
  /** Einspeisbar für Tests; ohne Angabe die aktuelle Uhrzeit. */
  readonly now?: () => Date;
}

/**
 * Führt einen Archivierungslauf aus.
 *
 * @param actor Wer den Lauf anstößt. `audit.view` ist die einzige Permission,
 *   die der Katalog für das Log kennt (Pflichtenheft §8); eine eigene
 *   `audit.manage` wäre eine Katalog-Erweiterung, die nicht zu diesem
 *   Arbeitspaket gehört. `null` steht für den Aufruf über das Kommando
 *   `audit:archive`, der auf der VPS bereits Systemzugang voraussetzt.
 */
export async function archiveAuditEntries(
  deps: AuditArchiveDependencies,
  actor: PermissionActor | null,
): Promise<AuditArchiveResultDto> {
  if (actor && !hasPermission(actor, 'audit.view')) {
    throw new AdminError('PERMISSION_DENIED');
  }

  const now = deps.now?.() ?? new Date();
  const cutoff = archiveCutoff(now);
  const entries = await deps.repository.listOlderThan(cutoff);

  if (entries.length === 0) {
    return {
      archivedCount: 0,
      archiveFilePath: null,
      archiveSizeBytes: null,
      cutoff: cutoff.toISOString(),
      oldestTimestamp: null,
      newestTimestamp: null,
      executedAt: now.toISOString(),
    };
  }

  let file: AuditArchiveFile;

  try {
    file = await deps.writer.write(archiveFileName(cutoff), entries);
  } catch (error: unknown) {
    // Die aktive Tabelle bleibt unangetastet – lieber ein gescheiterter Lauf
    // als ein Eintrag, der weder in der Tabelle noch im Archiv steht.
    throw new AdminError(
      'AUDIT_ARCHIVE_FAILED',
      `Das Archiv des Audit-Logs konnte nicht geschrieben werden: ${describe(error)}`,
    );
  }

  const removed = await deps.repository.deleteOlderThan(cutoff);

  const first = entries[0];
  const last = entries[entries.length - 1];

  const result: AuditArchiveResultDto = {
    archivedCount: removed,
    archiveFilePath: file.filePath,
    archiveSizeBytes: file.sizeBytes,
    cutoff: cutoff.toISOString(),
    oldestTimestamp: first ? first.timestamp.toISOString() : null,
    newestTimestamp: last ? last.timestamp.toISOString() : null,
    executedAt: now.toISOString(),
  };

  await deps.audit?.record({
    action: 'audit.archived',
    actorId: null,
    targetType: 'auditLog',
    targetId: null,
    metadata: {
      archivedCount: result.archivedCount,
      archiveFilePath: result.archiveFilePath,
      cutoff: result.cutoff,
    },
  });

  return result;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
