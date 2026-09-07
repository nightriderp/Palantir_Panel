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

import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { AUDIT_RETENTION_MONTHS, type AuditArchiveResultDto } from '@palantir/contracts';
import { hasPermission } from '../rbac/index.js';
import {
  type AppendAuditEntry,
  type AuditArchiveRepository,
  type AuditEntryRecord,
  type AuditService,
  entryFor,
} from './audit.js';
import type { AdminContext } from './context.js';
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

/**
 * Stichtag: alles davor darf archiviert werden – als UTC-Datum
 * (Audit W2-16, backend-db-08).
 *
 * Der Datenbank-Trigger aus `0005_admin_ports_audit_storage.sql` rechnet
 * `now() - interval '24 months'` und lehnt jeden Löschversuch ab, der jünger
 * ist. Rechnet die Anwendung auch nur eine Stunde großzügiger, wandern Einträge
 * in die Archivdatei, die der Trigger anschließend nicht freigibt – die
 * **gesamte** Löschtransaktion rollt zurück und der Lauf endet als Fehler,
 * obwohl die Datei bereits geschrieben ist.
 *
 * Zwei Unterschiede zum früheren `setMonth()` sorgten genau dafür:
 *
 * 1. `setMonth()` rechnet in der **lokalen** Zeitzone des Backend-Prozesses.
 *    Steht die auf Europe/Berlin, während PostgreSQL in UTC läuft, verschiebt
 *    schon die Sommerzeit den Stichtag um eine Stunde.
 * 2. `setMonth()` lässt den Tag **überlaufen**: Der 29.02.2028 minus 24 Monate
 *    ergibt dort den 01.03.2026, PostgreSQL klemmt dagegen auf den 28.02.2026.
 *    Der App-Stichtag läge einen Tag später als der der Datenbank.
 *
 * Deshalb: alles in UTC, Klemmen wie PostgreSQL – und zusätzlich auf
 * Mitternacht abgeschnitten. Das Abschneiden geht immer nach **hinten** und
 * macht den Stichtag damit nie später als den der Datenbank; es lässt einen
 * angefangenen Tag stehen, der beim nächsten Lauf mitgeht, und ist zugleich der
 * Puffer für eine Datenbank-Sitzung, die nicht in UTC läuft.
 */
export function archiveCutoff(now: Date): Date {
  const verschoben = now.getUTCMonth() - AUDIT_RETENTION_MONTHS;
  const jahr = now.getUTCFullYear() + Math.floor(verschoben / 12);
  const monat = ((verschoben % 12) + 12) % 12;
  // Tag 0 des Folgemonats ist der letzte Tag des Zielmonats.
  const letzterTag = new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();

  return new Date(Date.UTC(jahr, monat, Math.min(now.getUTCDate(), letzterTag)));
}

/**
 * Dateiname eines Laufs (Audit W2-16, backend-admin-resources-11).
 *
 * Drei Bestandteile: der Stichtag, damit Archive sortierbar bleiben und man
 * ihnen ansieht, bis wohin sie reichen; der Zeitpunkt des Laufs; ein
 * Zufallsanteil.
 *
 * Der Stichtag allein reichte nicht: Zwei Läufe am selben Tag – etwa der
 * Cronjob auf der VPS und ein Klick in der Oberfläche – kamen auf denselben
 * Namen. Der Zeitstempel allein reicht ebenso wenig, zwei Läufe können in
 * dieselbe Sekunde fallen. Erst der Zufallsanteil macht den Namen eindeutig.
 */
export function archiveFileName(cutoff: Date, now: Date): string {
  const stichtag = cutoff.toISOString().slice(0, 10);
  const zeitpunkt = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const zufall = randomBytes(4).toString('hex');

  return `audit-log-bis-${stichtag}-${zeitpunkt}-${zufall}.jsonl.gz`;
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
 *
 * Geschrieben wird mit `flags: 'wx'` – eine vorhandene Datei wird nie
 * überschrieben (Audit W2-16, backend-admin-resources-11). Der Archivlauf ist
 * bereits über einen Advisory-Lock serialisiert und der Dateiname trägt einen
 * Zufallsanteil; das Flag ist die letzte Schranke für den Fall, dass beides
 * versagt. Ein überschriebenes Archiv wäre der schlimmste denkbare Ausgang:
 * Die Einträge stehen danach weder in der Tabelle noch in der Datei.
 */
export function createGzipArchiveWriter(directory: string): AuditArchiveWriter {
  return {
    async write(fileName, entries) {
      await mkdir(directory, { recursive: true });

      const filePath = path.join(directory, fileName);
      const lines = entries.map((entry) => `${JSON.stringify(serializeEntry(entry))}\n`);

      try {
        await pipeline(
          Readable.from(lines),
          createGzip(),
          createWriteStream(filePath, { flags: 'wx' }),
        );
      } catch (error: unknown) {
        // Bei EEXIST gehört die Datei einem anderen Lauf – sie zu entfernen
        // hieße, ein fremdes Archiv zu löschen.
        if (!istBereitsVorhanden(error)) {
          await unlink(filePath).catch(() => undefined);
        }

        throw error;
      }

      const { size } = await stat(filePath);

      return { filePath, sizeBytes: size };
    },
  };
}

/** Erkennt den Fehler „Datei existiert bereits" von `flags: 'wx'`. */
function istBereitsVorhanden(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
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
 * **Genau einer zur Zeit** (Audit W2-16, backend-admin-resources-11): Der Lauf
 * belegt vorab eine Sperre in der Datenbank und gibt sie am Ende wieder frei.
 * Zwei gleichzeitige Läufe – etwa der Cronjob auf der VPS und ein Klick in der
 * Oberfläche – lasen sonst dieselben Einträge, schrieben ineinander verschränkt
 * in dieselbe Datei und löschten anschließend beide: Die einzige Kopie der
 * Alt-Einträge wäre ein kaputtes gzip. Der zweite Lauf endet stattdessen sofort
 * mit `AUDIT_ARCHIVE_FAILED` und lässt Tabelle wie Datei unangetastet.
 *
 * @param ctx Wer den Lauf anstößt. Verlangt `audit.manage` (Gefundener Punkt
 *   46) – nicht `audit.view`: Lesen und Verkürzen sind zwei verschiedene Dinge,
 *   und dieser Lauf ist der einzige Weg, auf dem Einträge die Tabelle verlassen.
 *   `null` steht für den Aufruf über das Kommando `audit:archive`, der auf der
 *   VPS bereits Systemzugang voraussetzt.
 *
 *   Bewusst der volle {@link AdminContext} statt nur der Rechte: Der
 *   Selbstprotokoll-Eintrag trug bisher `actorId: null` und war damit nicht vom
 *   Kommandozeilen-Lauf zu unterscheiden (Pflichtenheft §6).
 */
export async function archiveAuditEntries(
  deps: AuditArchiveDependencies,
  ctx: AdminContext | null,
): Promise<AuditArchiveResultDto> {
  if (ctx && !hasPermission(ctx.actor, 'audit.manage')) {
    throw new AdminError('PERMISSION_DENIED');
  }

  const lock = await deps.repository.acquireLock();

  if (!lock) {
    throw new AdminError(
      'AUDIT_ARCHIVE_FAILED',
      'Es läuft bereits ein Archivierungslauf des Audit-Logs. Bitte dessen Ende abwarten.',
    );
  }

  try {
    return await fuehreLaufAus(deps, ctx);
  } finally {
    await lock.release();
  }
}

/**
 * Der eigentliche Lauf – aufgerufen ausschließlich mit gehaltenem Lock.
 *
 * Getrennt von {@link archiveAuditEntries}, damit die Freigabe des Locks in
 * genau einem `finally` steht und kein Rückgabepfad daran vorbeikommt.
 */
async function fuehreLaufAus(
  deps: AuditArchiveDependencies,
  ctx: AdminContext | null,
): Promise<AuditArchiveResultDto> {
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
    file = await deps.writer.write(archiveFileName(cutoff, now), entries);
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

  const eintrag: Omit<AppendAuditEntry, 'actorId' | 'actorDisplayName' | 'ipHint'> = {
    action: 'audit.archived',
    targetType: 'auditLog',
    targetId: null,
    metadata: {
      archivedCount: result.archivedCount,
      archiveFilePath: result.archiveFilePath,
      cutoff: result.cutoff,
    },
  };

  // Mit Kontext trägt der Eintrag den Handelnden, ohne Kontext bleibt er wie
  // bisher ohne Identität – dort ist der Systemzugang auf der VPS der Nachweis.
  await deps.audit?.record(
    ctx ? entryFor(ctx, eintrag) : { ...eintrag, actorId: null, actorDisplayName: null },
  );

  return result;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
