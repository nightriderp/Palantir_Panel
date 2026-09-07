/**
 * Geplante, automatische Backups (Lastenheft §3.3, Pflichtenheft §6).
 *
 * **Wer entscheidet wann:** Das Backend führt den Zeitplan und stellt fest, dass
 * ein Lauf fällig ist; ausgeführt wird das Backup danach vom Agent über
 * `CREATE_BACKUP`. Das folgt der Aufteilung aus STRUKTUR.md – das Backend
 * orchestriert, der Agent arbeitet auf dem Dateisystem. Der „Backup-Job“ in A3
 * ist die Agent-Seite desselben Vorgangs, kein zweiter Zeitgeber.
 *
 * Der Zeitplan liegt in der allgemeinen Tabelle `schedules` (Entität `Schedule`
 * aus Pflichtenheft §6) mit `action = 'backup'`; B5 wertet ausschließlich diese
 * Aktion aus. Die übrigen Aktionen (`restart`, `command`) trägt das Paket
 * nach, das den Aufgaben-Tab baut.
 */

import type { BackupScheduleDto } from '@palantir/contracts';
import type { UpdateBackupScheduleInput } from '@palantir/validation';
import { type PermissionActor } from '../rbac/index.js';
import { nextCronRun, parseCronExpression } from './cron.js';
import { BackupError, ScheduleError } from './errors.js';
import { type Clock, type ServerDirectory, systemClock } from './ports.js';
import {
  canManageBackupsOf,
  computeBackupSchedulePermissions,
  isOwnServer,
} from './permissions.js';
import type { BackupScheduleRecord, BackupRepository } from './repository.js';
import type { BackupService } from './service.js';

/** Ergebnis eines Scheduler-Durchlaufs. */
export interface ScheduleTickResult {
  /** Zeitpläne, für die ein Backup angestoßen wurde. */
  readonly startedScheduleIds: string[];
  /** Zeitpläne, deren Lauf ausfiel (z. B. weil schon ein Backup läuft). */
  readonly skippedScheduleIds: string[];
}

export interface BackupScheduleServiceOptions {
  readonly repository: BackupRepository;
  readonly servers: ServerDirectory;
  readonly backups: BackupService;
  readonly now?: Clock;
}

export interface BackupScheduleService {
  get(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
  ): Promise<BackupScheduleDto | null>;
  set(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
    input: UpdateBackupScheduleInput,
  ): Promise<BackupScheduleDto>;
  /**
   * Ein Durchlauf des Zeitgebers: alle fälligen Zeitpläne anstoßen.
   *
   * Bewusst als aufrufbare Funktion und nicht als eigener Timer im Modul – wer
   * den Takt vorgibt (Intervall beim Backend-Start, Test, Skript), entscheidet
   * der Aufrufer.
   */
  tick(): Promise<ScheduleTickResult>;
}

/**
 * Nächster Termin eines **gespeicherten** Zeitplans; `null`, wenn er sich nicht
 * (mehr) auswerten lässt.
 *
 * `set()` lässt seit bb-13/bb-14 nur noch Ausdrücke durch, die zerlegbar
 * **und** erfüllbar sind. Ältere Datensätze können trotzdem einen Ausdruck
 * tragen, den die Auswertung heute ablehnt (etwa eine Schrittweite auf einem
 * Einzelwert). Ohne diesen Fänger risse ein einziger solcher Datensatz den
 * gesamten Durchlauf ab, und keiner der übrigen Zeitpläne käme zum Zug. Der
 * betroffene Plan bleibt danach ohne nächsten Termin stehen – sichtbar im DTO
 * als `nextRunAt: null`, korrigierbar durch einmaliges Speichern.
 */
function naechsterTermin(schedule: { readonly cronExpression: string }, moment: Date): Date | null {
  try {
    return nextCronRun(schedule.cronExpression, moment);
  } catch {
    return null;
  }
}

export function createBackupScheduleService(
  options: BackupScheduleServiceOptions,
): BackupScheduleService {
  const { repository, servers, backups } = options;
  const now = options.now ?? systemClock;

  async function requireManageableServer(
    actor: PermissionActor,
    actorUserId: string,
    serverId: string,
  ) {
    const server = await servers.findById(serverId);

    if (!server) {
      throw new BackupError('SERVER_NOT_FOUND');
    }

    if (!canManageBackupsOf(actor, isOwnServer(actorUserId, server))) {
      // Wie beim Backup selbst: kein PERMISSION_DENIED, damit die Antwort die
      // Existenz fremder Server nicht verrät.
      throw new BackupError('SERVER_NOT_FOUND');
    }

    return server;
  }

  /**
   * DTO eines Zeitplans – der **eine** Weg für `get()` und `set()`
   * (Audit bb-15).
   *
   * Vorher baute `set()` sein DTO mit fest verdrahtetem `lastBackupId: null`,
   * während `get()` das Feld füllte: Nach dem Speichern zeigte die Oberfläche
   * „noch nie gelaufen“, bis der Nutzer die Seite neu lud. Zwei Formen
   * derselben Antwort sind eine Fehlerquelle für sich (CLAUDE.md §3).
   *
   * `stopServer` gehört seit contracts-validation-03 dazu: Der Wert wurde seit
   * jeher gespeichert, aber nie ausgeliefert – ein Formular konnte den
   * Ist-Zustand weder anzeigen noch beim Umschalten von `enabled` wieder
   * mitschicken, und die Einstellung „sauberer Spielstand“ ging still verloren.
   */
  async function toDto(
    actor: PermissionActor,
    record: BackupScheduleRecord,
    isOwn: boolean,
  ): Promise<BackupScheduleDto> {
    // Gezielte Abfrage statt Vollscan über alle Backups des Servers (bb-15):
    // Gebraucht wird genau eine Id.
    const letztes = await repository.findLatestByScheduleId(record.id);

    return {
      serverId: record.serverId,
      enabled: record.enabled,
      cronExpression: record.cronExpression,
      stopServer: record.stopServer,
      lastRunAt: record.lastRunAt?.toISOString() ?? null,
      nextRunAt: record.enabled ? (record.nextRunAt?.toISOString() ?? null) : null,
      lastBackupId: letztes?.id ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      permissions: computeBackupSchedulePermissions(actor, isOwn),
    };
  }

  return {
    async get(actor, actorUserId, serverId) {
      const server = await requireManageableServer(actor, actorUserId, serverId);
      const record = await repository.findScheduleByServer(serverId);

      if (!record) {
        return null;
      }

      return toDto(actor, record, isOwnServer(actorUserId, server));
    },

    async set(actor, actorUserId, serverId, input) {
      const server = await requireManageableServer(actor, actorUserId, serverId);

      // Wirft `SCHEDULE_INVALID_CRON`, bevor irgendetwas geschrieben wird – ein
      // gespeicherter Zeitplan, der nie auslöst, wäre schlimmer als eine
      // abgelehnte Eingabe.
      parseCronExpression(input.cronExpression);

      /*
       * Formal gültig heißt nicht erfüllbar (Audit bb-14): `0 4 30 2 *`
       * (30. Februar) zerlegt sauber, trifft aber auf keinen Kalendertag. Ohne
       * diese Prüfung landete der Zeitplan mit `enabled = true` und
       * `nextRunAt = null` in der Datenbank; `listDueSchedules` filtert genau
       * solche Zeilen weg – der Plan wäre dauerhaft stumm, und der Nutzer
       * bekäme keinerlei Hinweis.
       *
       * Geprüft wird auch bei abgeschaltetem Zeitplan: Sonst schlüge die
       * Ablehnung erst beim späteren Einschalten zu, an einer Stelle, an der
       * der Nutzer den Ausdruck gar nicht mehr vor Augen hat.
       */
      const naechsterLauf = nextCronRun(input.cronExpression, now());

      if (naechsterLauf === null) {
        throw new ScheduleError(
          'SCHEDULE_UNSATISFIABLE',
          `Der Zeitplan „${input.cronExpression}“ trifft auf keinen Zeitpunkt zu – bitte Tag und Monat prüfen.`,
        );
      }

      const record = await repository.upsertSchedule({
        serverId,
        cronExpression: input.cronExpression,
        enabled: input.enabled,
        stopServer: input.stopServer,
        nextRunAt: input.enabled ? naechsterLauf : null,
      });

      return toDto(actor, record, isOwnServer(actorUserId, server));
    },

    async tick() {
      const moment = now();
      const due = await repository.listDueSchedules(moment);

      const startedScheduleIds: string[] = [];
      const skippedScheduleIds: string[] = [];

      for (const schedule of due) {
        // Der nächste Termin wird **vor** dem Lauf fortgeschrieben. Sonst
        // bliebe ein Zeitplan, dessen Backup scheitert, dauerhaft fällig und
        // löste bei jedem Durchlauf erneut aus.
        await repository.markScheduleRun(schedule.id, moment, naechsterTermin(schedule, moment));

        try {
          await backups.createScheduled(schedule.serverId, schedule.id, schedule.stopServer);
          startedScheduleIds.push(schedule.id);
        } catch {
          // Ein bereits laufendes Backup oder ein gelöschter Server darf die
          // übrigen Zeitpläne nicht aufhalten. Der nächste Termin steht schon.
          skippedScheduleIds.push(schedule.id);
        }
      }

      return { startedScheduleIds, skippedScheduleIds };
    },
  };
}
