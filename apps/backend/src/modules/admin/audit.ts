/**
 * Audit-Log (Lastenheft §3.7, Pflichtenheft §6 und §18) – **append-only**.
 *
 * Dieses Modul ist die einzige Stelle, über die sicherheitsrelevante Aktionen
 * protokolliert werden. Andere Arbeitspakete rufen `record()` auf; niemand
 * schreibt direkt in die Tabelle.
 *
 * **Unveränderlichkeit** ist an drei Stellen abgesichert, absichtlich
 * mehrfach – jede einzelne Schicht ließe sich umgehen, alle drei zusammen nicht
 * durch ein Versehen:
 *
 * 1. `AuditLogRepository` kennt keine Update- und keine allgemeine
 *    Delete-Operation. Es gibt also gar keinen Weg, den man aufrufen könnte.
 * 2. `AuditService` bietet nur `record()` und `list()` an – auch dem Owner.
 * 3. Ein Trigger in der Datenbank lehnt UPDATE, DELETE und TRUNCATE auf
 *    `audit_log` ab (Migration `0005_admin_ports_audit_storage`). Selbst
 *    ein direkter `psql`-Zugriff kommt daran nicht vorbei.
 *
 * Die einzige Ausnahme ist der Archivierungsprozess in `audit-archive.ts`, der
 * Einträge älter als 24 Monate zuerst exportiert und erst danach entfernt
 * (Pflichtenheft §6). Er bekommt dafür eine eigene, eng geschnittene
 * Schnittstelle: {@link AuditArchiveRepository}.
 */

import {
  type AuditAction,
  type AuditLogEntryDto,
  type AuditLogPageDto,
  type AuditTargetType,
} from '@palantir/contracts';
import type { AuditLogQuery } from '@palantir/validation';
import type { DbConnection } from '../../db/index.js';
import { type PermissionActor, hasPermission } from '../rbac/index.js';
import type { AdminContext } from './context.js';
import { AdminError } from './errors.js';

/** Eintrag, wie er in der Datenbank steht. */
export interface AuditEntryRecord {
  readonly id: string;
  readonly action: AuditAction;
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly targetType: AuditTargetType | null;
  readonly targetId: string | null;
  readonly ipHint: string | null;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
}

/** Nutzlast eines neuen Eintrags. Es gibt bewusst kein Gegenstück zum Ändern. */
export interface AppendAuditEntry {
  readonly action: AuditAction;
  readonly actorId?: string | null;
  readonly actorDisplayName?: string | null;
  readonly targetType?: AuditTargetType | null;
  readonly targetId?: string | null;
  readonly ipHint?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/** Ergebnis einer Leseabfrage. */
export interface AuditEntryPage {
  readonly entries: readonly AuditEntryRecord[];
  readonly total: number;
}

/**
 * Persistenz des Audit-Logs.
 *
 * **Bewusst unvollständig:** Weder `update` noch `remove` sind vorgesehen. Wer
 * hier eine solche Methode ergänzt, hebt die Zusicherung aus Pflichtenheft §6
 * auf – das ist keine Erweiterung, sondern ein Bruch (CLAUDE.md §2). Der
 * Archivierungsprozess nutzt {@link AuditArchiveRepository}.
 */
export interface AuditLogRepository {
  /**
   * Hängt einen Eintrag an.
   *
   * `connection` ist die laufende Transaktion, in der der Eintrag entstehen
   * soll (Fundpunkt 150). Ohne Angabe schreibt das Repository über seine eigene
   * Verbindung – das ist der Regelfall und die bisherige Aufrufform.
   */
  append(entry: AppendAuditEntry, connection?: DbConnection): Promise<AuditEntryRecord>;
  list(query: AuditLogQuery): Promise<AuditEntryPage>;
}

/**
 * Zusatz-Schnittstelle ausschließlich für den Archivierungsprozess
 * (Pflichtenheft §6).
 *
 * Getrennt von {@link AuditLogRepository}, damit kein gewöhnlicher Aufrufer
 * versehentlich daran gerät: Wer nur das Log schreibt und liest, bekommt diese
 * Schnittstelle gar nicht in die Hand.
 */
export interface AuditArchiveRepository {
  /**
   * Belegt den Archivlauf exklusiv; `null`, wenn bereits einer unterwegs ist
   * (Audit W2-16, backend-admin-resources-11).
   *
   * Die Sperre muss **prozessübergreifend** wirken: Der Lauf lässt sich sowohl
   * über die Admin-Oberfläche als auch über `pnpm … audit:archive` auf der VPS
   * anstoßen – zwei verschiedene Prozesse, die sich nur über die Datenbank
   * sehen. Ein Flag im Arbeitsspeicher würde den Fall gerade nicht abdecken.
   */
  acquireLock(): Promise<AuditArchiveLock | null>;
  /** Einträge, die älter als der Stichtag sind – aufsteigend nach Zeitstempel. */
  listOlderThan(cutoff: Date): Promise<AuditEntryRecord[]>;
  /**
   * Entfernt Einträge, die älter als der Stichtag sind, und liefert deren
   * Anzahl. Wird erst aufgerufen, wenn die Archivdatei geschrieben ist.
   */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

/**
 * Belegung eines Archivlaufs – wird am Ende des Laufs wieder freigegeben.
 *
 * Bewusst ein Handle statt zweier Methoden `lock()`/`unlock()` am Repository:
 * Die Freigabe gehört zu genau dieser Belegung, und der Aufrufer kann sie nicht
 * versehentlich für einen fremden Lauf aufrufen.
 */
export interface AuditArchiveLock {
  release(): Promise<void>;
}

/** Öffentliche Schnittstelle des Audit-Logs. Kein `update`, kein `delete`. */
export interface AuditService {
  /**
   * Hängt einen Eintrag an. Fehler werden **nicht** verschluckt: Lässt sich
   * eine sicherheitsrelevante Aktion nicht protokollieren, soll die Aktion
   * selbst scheitern, statt unbemerkt zu passieren.
   *
   * **Mit `connection`** entsteht der Eintrag innerhalb einer bereits laufenden
   * Transaktion (Fundpunkt 150). Genau das braucht ein Vorgang, dessen fachliche
   * Zeilen und dessen Protokolleintrag gemeinsam gelten müssen: Bisher lag der
   * Eintrag hinter dem Commit – scheiterte er, existierte der Vorgang, der Admin
   * sah aber einen Fehler und legte beim zweiten Anlauf alles ein zweites Mal
   * an. Innerhalb der Transaktion reißt ein gescheiterter Eintrag den ganzen
   * Vorgang zurück, und die Zusicherung „keine Aktion ohne Protokoll" gilt auch
   * dann noch.
   *
   * Ohne `connection` bleibt alles wie bisher – die weitaus meisten Aufrufer
   * protokollieren einen Vorgang, der aus genau einem Schreibzugriff besteht,
   * und brauchen keine Transaktion.
   */
  record(entry: AppendAuditEntry, connection?: DbConnection): Promise<void>;
  /** Seitenweise Abfrage für die Admin-Oberfläche; verlangt `audit.view`. */
  list(ctx: AdminContext, query: AuditLogQuery): Promise<AuditLogPageDto>;
}

/**
 * Methodennamen des Service.
 *
 * Bewusst als Konstante festgehalten und im Test geprüft: Kommt hier je ein
 * `update` oder `remove` dazu, fällt es sofort auf.
 */
export const AUDIT_SERVICE_METHODS = ['record', 'list'] as const;

function requireAuditRead(actor: PermissionActor): void {
  if (!hasPermission(actor, 'audit.view')) {
    throw new AdminError('PERMISSION_DENIED');
  }
}

export function toAuditLogEntryDto(
  actor: PermissionActor,
  entry: AuditEntryRecord,
): AuditLogEntryDto {
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
    // Nur `canView`: Es gibt keinen Weg zum Ändern oder Löschen, den ein Flag
    // beschreiben könnte (Pflichtenheft §6).
    permissions: { canView: hasPermission(actor, 'audit.view') },
  };
}

/**
 * Baut die Nutzlast eines Eintrags aus dem Aufrufkontext.
 *
 * Damit tragen alle Einträge dieses Moduls dieselben Angaben zum Handelnden,
 * ohne dass jede Aufrufstelle daran denken muss.
 */
export function entryFor(
  ctx: AdminContext,
  entry: Omit<AppendAuditEntry, 'actorId' | 'actorDisplayName' | 'ipHint'>,
): AppendAuditEntry {
  return {
    ...entry,
    actorId: ctx.userId,
    actorDisplayName: ctx.displayName,
    ipHint: ctx.ipHint,
  };
}

export function createAuditService(repository: AuditLogRepository): AuditService {
  return {
    async record(entry, connection) {
      await repository.append(entry, connection);
    },

    async list(ctx, query) {
      requireAuditRead(ctx.actor);

      const page = await repository.list(query);

      return {
        entries: page.entries.map((entry) => toAuditLogEntryDto(ctx.actor, entry)),
        total: page.total,
        limit: query.limit,
        offset: query.offset,
      };
    },
  };
}
