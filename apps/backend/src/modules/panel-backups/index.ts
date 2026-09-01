/**
 * Sicherungen des Panels selbst (Mockup-Abgleich 12.5.1 und 12.5.2).
 *
 * Gesichert wird die **Panel-Datenbank** als `pg_dump`-Abzug in ein Verzeichnis
 * auf der VPS. Die Weltdaten der Gameserver sind bewusst nicht dabei: Die
 * liegen auf dem Homeserver und haben mit den Server-Backups (B5) einen
 * eigenen, vollständigen Weg – zwei Mechanismen für dieselben Daten wären zwei
 * Wahrheiten über den Stand einer Sicherung.
 *
 * **Warum `pg_dump` und kein eigener Abzug:** Ein selbst geschriebener Dump
 * müsste Schema, Reihenfolge, Fremdschlüssel und Datentypen nachbauen – genau
 * die Sorte Code, die man nicht selbst schreibt. Fehlt das Programm auf der
 * VPS, meldet der Lauf das benannt (`PANEL_BACKUP_NOT_CONFIGURED`) statt still
 * nichts zu tun.
 *
 * **Kein Download über das Panel.** Der Abzug enthält jedes Konto, jede Rolle
 * und jedes Geheimnis der Instanz. Wer ihn braucht, holt ihn über denselben
 * Weg, über den er auch die VPS verwaltet.
 */

import { type PanelBackupDto, type PanelBackupTrigger } from '@palantir/contracts';
import { type PermissionActor, hasPermission } from '../rbac/index.js';
import { PanelBackupError } from './errors.js';

export { PanelBackupError, isPanelBackupError } from './errors.js';

export interface PanelBackupRecord {
  readonly id: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly trigger: PanelBackupTrigger;
  readonly storagePath: string | null;
  readonly sizeBytes: number;
  readonly failureMessage: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export interface PanelBackupRepository {
  create(trigger: PanelBackupTrigger, storagePath: string): Promise<PanelBackupRecord>;
  finish(id: string, sizeBytes: number): Promise<PanelBackupRecord>;
  fail(id: string, message: string): Promise<PanelBackupRecord>;
  findById(id: string): Promise<PanelBackupRecord | null>;
  list(limit: number): Promise<PanelBackupRecord[]>;
  /** Jüngster Lauf – egal mit welchem Ausgang; Grundlage des Takts. */
  findLatest(): Promise<PanelBackupRecord | null>;
  /** Läuft gerade einer? Zwei gleichzeitig ergäben zwei halbe Abzüge. */
  findRunning(): Promise<PanelBackupRecord | null>;
  remove(id: string): Promise<void>;
  /**
   * Beendete Läufe, die vor dem Stichtag begonnen haben – für die Aufbewahrung.
   *
   * Beendet heißt `completed` **oder** `failed`: Ein gescheiterter Lauf kann
   * eine halbe Datei hinterlassen haben, und ohne ihn wüchse die Liste ewig.
   * Ein laufender bleibt unangetastet.
   */
  listFinishedBefore(before: Date): Promise<PanelBackupRecord[]>;
}

/**
 * Der eigentliche Abzug – einspeisbar, damit der Ablauf ohne laufendes
 * `pg_dump` prüfbar bleibt (CLAUDE.md §4).
 */
export interface DatabaseDumper {
  /** Schreibt den Abzug und liefert die Größe der Datei in Byte. */
  dump(targetPath: string): Promise<number>;
}

/** Entfernt eine Datei; fehlt sie bereits, ist das kein Fehler. */
export interface BackupFileRemover {
  remove(path: string): Promise<void>;
}

export interface PanelBackupService {
  list(actor: PermissionActor): Promise<PanelBackupDto[]>;
  /** Lauf starten. Wartet auf das Ende – ein Abzug dauert Sekunden, nicht Minuten. */
  start(actor: PermissionActor, trigger: PanelBackupTrigger): Promise<PanelBackupDto>;
  remove(actor: PermissionActor, id: string): Promise<void>;
  /**
   * Geplanter Lauf für den Zeitgeber; ohne Actor und ohne Rechteprüfung.
   *
   * Gibt `null` zurück, wenn nichts zu tun war – weil die Sicherung nicht
   * eingerichtet ist, weil der Takt noch nicht um ist oder weil bereits ein Lauf
   * unterwegs ist. Der Zeitgeber soll daran nicht scheitern.
   */
  runScheduled(): Promise<PanelBackupDto | null>;
  /** Alte Abzüge nach der Aufbewahrungsfrist entfernen; liefert die Anzahl. */
  prune(): Promise<number>;
}

export interface PanelBackupDependencies {
  readonly repository: PanelBackupRepository;
  /** Ablageort auf der VPS (`PANEL_BACKUP_DIR`); `null`, wenn nicht eingerichtet. */
  readonly directory: string | null;
  readonly dumper: DatabaseDumper;
  readonly files: BackupFileRemover;
  /** Abstand zweier geplanter Läufe in Stunden; `null` schaltet sie ab. */
  readonly intervalHours: number | null;
  /** Aufbewahrung in Tagen; `null` heißt „nie automatisch löschen". */
  readonly retentionDays: number | null;
  readonly now?: () => Date;
  /** Wie viele Läufe die Übersicht zeigt. */
  readonly listLimit?: number;
}

const STUNDE_MS = 3_600_000;
const TAG_MS = 86_400_000;

/** Dateiname eines Abzugs – sortierbar und ohne Zeichen, die Pfade sprengen. */
export function backupFileName(at: Date): string {
  const stempel = at.toISOString().replace(/[:.]/g, '-');

  return `palantir-${stempel}.sql.gz`;
}

export function toPanelBackupDto(
  actor: PermissionActor,
  record: PanelBackupRecord,
): PanelBackupDto {
  return {
    id: record.id,
    status: record.status,
    trigger: record.trigger,
    storagePath: record.storagePath,
    sizeBytes: record.sizeBytes,
    failureMessage: record.failureMessage,
    startedAt: record.startedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    permissions: {
      // Ein laufender Abzug wird nicht gelöscht – die Datei entsteht gerade.
      canDelete: record.status !== 'running' && hasPermission(actor, 'backup.manage.any'),
    },
  };
}

export function createPanelBackupService(deps: PanelBackupDependencies): PanelBackupService {
  const jetzt = deps.now ?? ((): Date => new Date());
  const limit = deps.listLimit ?? 50;

  function requireBackupManage(actor: PermissionActor): void {
    if (!hasPermission(actor, 'backup.manage.any')) {
      throw new PanelBackupError('PERMISSION_DENIED');
    }
  }

  function eingerichtet(): boolean {
    return deps.directory !== null && deps.directory.trim() !== '';
  }

  function requireDirectory(): string {
    if (!eingerichtet()) {
      throw new PanelBackupError('PANEL_BACKUP_NOT_CONFIGURED');
    }

    return deps.directory as string;
  }

  /**
   * Einen Lauf durchführen.
   *
   * Der Datensatz entsteht **vor** dem Abzug: Bricht der Prozess mittendrin ab,
   * steht der Lauf als `running` da und ist als abgebrochen erkennbar – besser
   * als eine Sicherung, von der niemand weiß, dass sie versucht wurde.
   */
  async function fuehreAus(trigger: PanelBackupTrigger): Promise<PanelBackupRecord> {
    const verzeichnis = requireDirectory();

    if (await deps.repository.findRunning()) {
      throw new PanelBackupError('PANEL_BACKUP_ALREADY_RUNNING');
    }

    const pfad = `${verzeichnis.replace(/[\\/]+$/, '')}/${backupFileName(jetzt())}`;
    const lauf = await deps.repository.create(trigger, pfad);

    try {
      return await deps.repository.finish(lauf.id, await deps.dumper.dump(pfad));
    } catch (error: unknown) {
      const grund = error instanceof Error ? error.message : 'Unbekannter Fehler.';

      return deps.repository.fail(lauf.id, grund);
    }
  }

  return {
    async list(actor) {
      requireBackupManage(actor);

      const rows = await deps.repository.list(limit);

      return rows.map((row) => toPanelBackupDto(actor, row));
    },

    async start(actor, trigger) {
      requireBackupManage(actor);

      return toPanelBackupDto(actor, await fuehreAus(trigger));
    },

    async remove(actor, id) {
      requireBackupManage(actor);

      const record = await deps.repository.findById(id);

      if (!record) {
        throw new PanelBackupError('PANEL_BACKUP_NOT_FOUND');
      }

      if (record.status === 'running') {
        throw new PanelBackupError('PANEL_BACKUP_ALREADY_RUNNING');
      }

      // Erst die Datei, dann der Datensatz: Andersherum bliebe eine Datei
      // liegen, die niemand mehr zuordnen kann.
      if (record.storagePath !== null) {
        await deps.files.remove(record.storagePath);
      }

      await deps.repository.remove(id);
    },

    async runScheduled() {
      if (!eingerichtet() || deps.intervalHours === null) {
        return null;
      }

      if (await deps.repository.findRunning()) {
        return null;
      }

      /*
       * Fällig wird der nächste Lauf am Abstand zum vorigen – nicht zu einer
       * festen Uhrzeit. Nach einem Neustart des Backends fehlte sonst genau der
       * Lauf, dessen Uhrzeit in die Ausfallzeit fiel.
       */
      const letzter = await deps.repository.findLatest();
      const faellig =
        letzter === null ||
        jetzt().getTime() - letzter.startedAt.getTime() >= deps.intervalHours * STUNDE_MS;

      if (!faellig) {
        return null;
      }

      const record = await fuehreAus('scheduled');

      // Ohne Actor gibt es keine Rechte – der Zeitgeber zeigt nichts an.
      return toPanelBackupDto({ isOwner: false, permissions: new Set() }, record);
    },

    async prune() {
      if (deps.retentionDays === null) {
        return 0;
      }

      const stichtag = new Date(jetzt().getTime() - deps.retentionDays * TAG_MS);
      const alte = await deps.repository.listFinishedBefore(stichtag);

      for (const record of alte) {
        if (record.storagePath !== null) {
          await deps.files.remove(record.storagePath);
        }

        await deps.repository.remove(record.id);
      }

      return alte.length;
    },
  };
}
