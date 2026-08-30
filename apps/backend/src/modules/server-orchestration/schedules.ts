/**
 * Geplante Aufgaben eines Servers – Neustart oder Konsolenbefehl zu fester Zeit
 * (Lastenheft §3.3, Pflichtenheft §6; Reiter „Aufgaben" der Detailansicht).
 *
 * **Abgrenzung zum Backup-Zeitplan (B5).** Beides sind Zeilen derselben Tabelle
 * `schedules`. B5 führt die eine Zeile mit `action = 'backup'` je Server und
 * zeigt sie unter „Sicherungen"; dieses Modul führt die benannte Liste mit
 * `restart` und `command`. Die Trennung ist absichtlich scharf: Der
 * Backup-Zeitplan trägt eigene Nutzdaten (`stopServer`) und wird in der lokalen
 * Zeit des Backends ausgewertet, die Aufgaben hier tragen eine eigene Zeitzone.
 * Ein Anlegen über beide Wege hätte zwei Auslegungen desselben Cron-Ausdrucks
 * zur Folge – deshalb weisen `create()`/`update()` die Aktion `backup` ab.
 *
 * **Wer führt aus.** Fällig wird eine Aufgabe hier, ausgeführt wird sie über die
 * vorhandenen Wege der Orchestrierung: `restart` über den Lifecycle (mit
 * Ressourcenprüfung und Health-Check), `command` über die Konsole und damit
 * über den Agent-Kanal. Kein zweiter Weg an der State Machine vorbei
 * (CLAUDE.md §4).
 *
 * **Kein eigener Timer.** `tick()` ist eine aufrufbare Funktion; den Takt gibt
 * `scheduler.ts` vor – dieselbe Aufteilung wie beim Backup-Zeitplan.
 */

import { type ScheduleDto, type SchedulePermissions } from '@palantir/contracts';
import { type ScheduleInput } from '@palantir/validation';
import { isSupportedTimeZone, nextCronRunInZone } from '../backups/cron.js';
import { ServerOrchestrationError } from './errors.js';
import {
  type ServerScheduleAction,
  type ServerScheduleRecord,
  type ServerScheduleRepository,
  isServerScheduleAction,
} from './schedule-repository.js';

/** Ausschnitt der Orchestrierung, den eine fällige Aufgabe braucht. */
export interface ScheduleExecutor {
  restartServer(serverId: string, actorUserId: string): Promise<unknown>;
  execConsole(serverId: string, commandLine: string): Promise<unknown>;
}

/** Ausschnitt des Server-Repositories: die Aufgabe braucht nur den Besitzer. */
export interface ScheduleServerDirectory {
  findById(serverId: string): Promise<{ readonly ownerId: string } | null>;
}

/** Ergebnis eines Durchlaufs des Zeitgebers. */
export interface ServerScheduleTickResult {
  readonly executedScheduleIds: string[];
  readonly failedScheduleIds: string[];
}

export interface ServerScheduleServiceOptions {
  readonly repository: ServerScheduleRepository;
  readonly servers: ScheduleServerDirectory;
  readonly executor: ScheduleExecutor;
  /** Nur für Tests: feste Uhr. */
  readonly now?: () => Date;
}

export interface ServerScheduleService {
  list(serverId: string): Promise<readonly ServerScheduleRecord[]>;
  create(serverId: string, input: ScheduleInput): Promise<ServerScheduleRecord>;
  update(serverId: string, scheduleId: string, input: ScheduleInput): Promise<ServerScheduleRecord>;
  remove(serverId: string, scheduleId: string): Promise<void>;
  tick(): Promise<ServerScheduleTickResult>;
}

/** Zeitzone des Backends – Rückfallwert für Zeilen ohne eigene Angabe. */
function backendTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Anzeigename für Zeilen ohne eigenen Namen (kommt nur bei Altbestand vor). */
function fallbackName(record: ServerScheduleRecord): string {
  return record.action === 'restart' ? 'Neustart' : 'Konsolenbefehl';
}

export function toScheduleDto(
  record: ServerScheduleRecord,
  permissions: SchedulePermissions,
): ScheduleDto {
  return {
    id: record.id,
    serverId: record.serverId,
    name: record.name ?? fallbackName(record),
    action: record.action,
    command: record.command,
    cronExpression: record.cronExpression,
    timezone: record.timezone ?? backendTimeZone(),
    enabled: record.enabled,
    lastRunAt: record.lastRunAt?.toISOString() ?? null,
    lastRunResult: record.lastRunResult,
    // Eine abgeschaltete Aufgabe hat keinen nächsten Lauf – der gespeicherte
    // Wert bleibt trotzdem stehen, damit das Einschalten ihn nicht neu raten muss.
    nextRunAt: record.enabled ? (record.nextRunAt?.toISOString() ?? null) : null,
    permissions,
  };
}

export function createServerScheduleService(
  options: ServerScheduleServiceOptions,
): ServerScheduleService {
  const { repository, servers, executor } = options;
  const now = options.now ?? ((): Date => new Date());

  /**
   * Prüft die Eingabe und rechnet den nächsten Lauf aus.
   *
   * Beides zusammen, weil beides an derselben Stelle scheitern soll: Ein
   * gespeicherter Zeitplan, der nie auslöst, wäre schlimmer als eine abgelehnte
   * Eingabe.
   */
  function planFrom(input: ScheduleInput): {
    readonly action: ServerScheduleAction;
    readonly command: string | null;
    readonly nextRunAt: Date | null;
  } {
    if (!isServerScheduleAction(input.action)) {
      throw new ServerOrchestrationError(
        'VALIDATION_FAILED',
        'Der Backup-Zeitplan wird unter „Sicherungen" verwaltet, nicht als geplante Aufgabe.',
      );
    }

    if (!isSupportedTimeZone(input.timezone)) {
      throw new ServerOrchestrationError(
        'VALIDATION_FAILED',
        `Die Zeitzone „${input.timezone}“ ist unbekannt.`,
      );
    }

    let nextRunAt: Date | null = null;

    if (input.enabled) {
      try {
        nextRunAt = nextCronRunInZone(input.cronExpression, now(), input.timezone);
      } catch {
        throw new ServerOrchestrationError('SCHEDULE_INVALID_CRON');
      }

      if (nextRunAt === null) {
        throw new ServerOrchestrationError(
          'SCHEDULE_INVALID_CRON',
          'Der Zeitplan hat in den nächsten vier Jahren keinen Termin.',
        );
      }
    }

    return {
      action: input.action,
      command: input.action === 'command' ? input.command : null,
      nextRunAt,
    };
  }

  /**
   * Lädt eine Aufgabe und stellt sicher, dass sie zu diesem Server gehört.
   *
   * Eine fremde Aufgabe wird wie eine fehlende gemeldet – die Antwort soll
   * nicht verraten, welche Aufgaben an anderen Servern hängen.
   */
  async function requireOwn(serverId: string, scheduleId: string): Promise<ServerScheduleRecord> {
    const record = await repository.findById(scheduleId);

    if (record === null || record.serverId !== serverId) {
      throw new ServerOrchestrationError('SCHEDULE_NOT_FOUND', undefined, {
        serverId,
        scheduleId,
      });
    }

    return record;
  }

  async function execute(record: ServerScheduleRecord): Promise<void> {
    if (record.action === 'command') {
      if (record.command === null) {
        throw new ServerOrchestrationError(
          'AGENT_COMMAND_INVALID',
          'Der geplanten Aufgabe fehlt der Konsolenbefehl.',
        );
      }

      await executor.execConsole(record.serverId, record.command);

      return;
    }

    const server = await servers.findById(record.serverId);

    if (server === null) {
      throw new ServerOrchestrationError('SERVER_NOT_FOUND', undefined, {
        serverId: record.serverId,
      });
    }

    // Ein geplanter Neustart hat keinen auslösenden Nutzer; als Akteur zählt
    // der Besitzer des Servers – ihm gehört die Aufgabe.
    await executor.restartServer(record.serverId, server.ownerId);
  }

  return {
    async list(serverId) {
      return repository.listByServer(serverId);
    },

    async create(serverId, input) {
      const plan = planFrom(input);

      return repository.create({
        serverId,
        name: input.name,
        action: plan.action,
        command: plan.command,
        cronExpression: input.cronExpression,
        timezone: input.timezone,
        enabled: input.enabled,
        nextRunAt: plan.nextRunAt,
      });
    },

    async update(serverId, scheduleId, input) {
      await requireOwn(serverId, scheduleId);

      const plan = planFrom(input);

      return repository.update(scheduleId, {
        name: input.name,
        action: plan.action,
        command: plan.command,
        cronExpression: input.cronExpression,
        timezone: input.timezone,
        enabled: input.enabled,
        nextRunAt: plan.nextRunAt,
      });
    },

    async remove(serverId, scheduleId) {
      await requireOwn(serverId, scheduleId);
      await repository.remove(scheduleId);
    },

    async tick() {
      const moment = now();
      const due = await repository.listDue(moment);

      const executedScheduleIds: string[] = [];
      const failedScheduleIds: string[] = [];

      for (const record of due) {
        const zone = record.timezone ?? backendTimeZone();
        let nextRunAt: Date | null = null;

        try {
          nextRunAt = nextCronRunInZone(record.cronExpression, moment, zone);
        } catch {
          // Ein Ausdruck, der nicht mehr auswertbar ist (etwa nach einem
          // Eingriff in der Datenbank), darf den Durchlauf nicht anhalten. Ohne
          // nächsten Termin ruht die Aufgabe, bis sie jemand neu speichert.
          nextRunAt = null;
        }

        // Vor der Ausführung fortschreiben – sonst bliebe eine Aufgabe, deren
        // Ausführung scheitert, dauerhaft fällig (wie beim Backup-Zeitplan).
        await repository.markRun(record.id, moment, nextRunAt);

        try {
          await execute(record);
          await repository.markResult(record.id, 'success');
          executedScheduleIds.push(record.id);
        } catch {
          // Eine gescheiterte Aufgabe hält die übrigen nicht auf; der nächste
          // Termin steht bereits.
          await repository.markResult(record.id, 'failed');
          failedScheduleIds.push(record.id);
        }
      }

      return { executedScheduleIds, failedScheduleIds };
    },
  };
}
