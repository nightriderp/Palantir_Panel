/**
 * Geplante Aufgaben eines Servers (Lastenheft §3.3, `Schedule` in
 * Pflichtenheft §6).
 *
 * Beispiele: täglicher Neustart zu fester Uhrzeit, Konsolenbefehl zu festem
 * Zeitpunkt, regelmäßige Sicherung. Der Zeitplan steht als Cron-Ausdruck in
 * `cronExpression`; `payload` trägt die Nutzdaten der jeweiligen Aktion.
 */

export const SCHEDULE_ACTIONS = ['start', 'stop', 'restart', 'backup', 'command'] as const;

export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];

export function isScheduleAction(value: string): value is ScheduleAction {
  return (SCHEDULE_ACTIONS as readonly string[]).includes(value);
}

/** Ausgang des letzten Laufs. */
export const SCHEDULE_RUN_RESULTS = ['success', 'failed', 'skipped'] as const;

export type ScheduleRunResult = (typeof SCHEDULE_RUN_RESULTS)[number];

export interface SchedulePermissions {
  canEdit: boolean;
  canDelete: boolean;
  /** Zeitplan aktivieren/deaktivieren, ohne ihn zu löschen. */
  canToggle: boolean;
}

export interface ScheduleDto {
  id: string;
  serverId: string;
  /** Frei wählbarer Name, z. B. „Nächtlicher Neustart". */
  name: string;
  action: ScheduleAction;
  /**
   * Konsolenbefehl bei `action === 'command'`; sonst `null`. Weitere Aktionen
   * brauchen bisher keine Nutzdaten.
   */
  command: string | null;
  /** Cron-Ausdruck mit fünf Feldern, ausgewertet in `timezone`. */
  cronExpression: string;
  /** IANA-Zeitzone, in der der Ausdruck gilt, z. B. `Europe/Berlin`. */
  timezone: string;
  enabled: boolean;
  /** ISO-8601-Zeitstempel des letzten Laufs; `null`, wenn nie gelaufen. */
  lastRunAt: string | null;
  lastRunResult: ScheduleRunResult | null;
  /** ISO-8601-Zeitstempel des nächsten Laufs; `null`, wenn deaktiviert. */
  nextRunAt: string | null;
  permissions: SchedulePermissions;
}
