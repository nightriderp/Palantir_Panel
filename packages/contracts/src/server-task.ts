import { type ScheduleAction } from './schedule.js';

/**
 * Geplante Aufgaben eines Servers (Entität `Schedule`, Pflichtenheft §6,
 * Lastenheft §3.3: „täglicher Neustart oder Konsolenbefehl zu festem Zeitpunkt").
 *
 * **Abgrenzung zu `BackupScheduleDto` aus `schedule.ts` (B5):** Dort steht der
 * eine Backup-Zeitplan **pro Server** – genau ein Datensatz, ohne Namen, weil
 * die Backup-Verwaltung nur diesen einen kennt. Hier steht die allgemeine
 * Liste: mehrere benannte Aufgaben je Server, wie sie der Reiter „Aufgaben"
 * in F3 zeigt. Beide beschreiben dieselbe Entität aus §6, aus zwei Blickwinkeln
 * – die Zusammenführung ist als „Gefundener Punkt" vermerkt.
 *
 * Die Aktionen kommen unverändert aus `SCHEDULE_ACTIONS` (B5); ein zweiter,
 * abweichender Satz entsteht hier bewusst nicht.
 */

/** Ausgang des letzten Laufs. */
export const SERVER_TASK_RUN_RESULTS = ['success', 'failed', 'skipped'] as const;

export type ServerTaskRunResult = (typeof SERVER_TASK_RUN_RESULTS)[number];

export interface ServerTaskPermissions {
  canEdit: boolean;
  canDelete: boolean;
  /** Aufgabe pausieren und wieder aktivieren, ohne sie zu löschen. */
  canToggle: boolean;
}

export interface ServerTaskDto {
  id: string;
  serverId: string;
  /** Frei wählbarer Name, z. B. „Nächtlicher Neustart". */
  name: string;
  action: ScheduleAction;
  /**
   * Konsolenbefehl bei `action === 'command'`; sonst `null`. Entspricht dem
   * Feld `payload` der Entität aus Pflichtenheft §6.
   */
  command: string | null;
  /** Cron-Ausdruck mit fünf Feldern, ausgewertet in `timezone`. */
  cronExpression: string;
  /** IANA-Zeitzone, in der der Ausdruck gilt, z. B. `Europe/Berlin`. */
  timezone: string;
  enabled: boolean;
  /** ISO-8601-Zeitstempel des letzten Laufs; `null`, wenn nie gelaufen. */
  lastRunAt: string | null;
  lastRunResult: ServerTaskRunResult | null;
  /** ISO-8601-Zeitstempel des nächsten Laufs; `null`, wenn deaktiviert. */
  nextRunAt: string | null;
  permissions: ServerTaskPermissions;
}
