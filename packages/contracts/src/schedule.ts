/**
 * Geplante Aufgaben (Pflichtenheft §6, Entität `Schedule`; Lastenheft §3.3).
 *
 * Eine `Schedule` bindet eine wiederkehrende Aktion an einen Server:
 * `serverId`, `cronExpression`, `action`, `payload`.
 *
 * **Aufteilung zwischen den Arbeitspaketen:** Hier stehen nur die Bausteine, die
 * jedes Paket teilt (Aktionskatalog, Cron-Ausdruck) sowie der Ausschnitt, den B5
 * tatsächlich umsetzt: der Backup-Zeitplan eines Servers. Das vollständige
 * `ScheduleDto` samt CRUD für den Aufgaben-Tab (F3) bringt das Paket mit, das
 * diesen Tab baut – **additiv hier**, nicht als zweite, parallele Struktur
 * (CLAUDE.md §3).
 */

/**
 * Aktionen, die eine geplante Aufgabe auslösen kann (Lastenheft §3.3:
 * „täglicher Neustart zu fester Uhrzeit oder Konsolenbefehl zu festem Zeitpunkt").
 *
 * `backup` wird von B5 ausgeführt, `restart` und `command` von der
 * Server-Orchestrierung (B3) – der Katalog steht trotzdem gemeinsam hier, damit
 * die Datenbankspalte `schedules.action` für alle dieselbe Bedeutung hat.
 */
export const SCHEDULE_ACTIONS = ['backup', 'restart', 'command'] as const;

export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];

export function isScheduleAction(value: string): value is ScheduleAction {
  return (SCHEDULE_ACTIONS as readonly string[]).includes(value);
}

/**
 * Serverseitig berechnetes `permissions`-Objekt eines Backup-Zeitplans
 * (Pflichtenheft §5.2). Grundlage ist `backup.manage.own` / `backup.manage.any`.
 */
export interface BackupSchedulePermissions {
  canView: boolean;
  /** Zeitplan setzen, ändern oder abschalten. */
  canEdit: boolean;
}

/**
 * Backup-Zeitplan eines Servers (Lastenheft §3.3 „automatisch geplant").
 *
 * Je Server gibt es höchstens einen Backup-Zeitplan; `enabled === false`
 * bedeutet „eingerichtet, aber ausgesetzt". Backups aus diesem Zeitplan haben
 * `BackupDto.type === 'automatic'` und unterliegen damit der Aufbewahrungsregel
 * aus Lastenheft §3.3.
 */
export interface BackupScheduleDto {
  serverId: string;
  enabled: boolean;
  /**
   * Cron-Ausdruck mit fünf Feldern (Minute Stunde Tag Monat Wochentag) in der
   * Zeitzone des Backends. Auswertung im Backend, an genau einer Stelle.
   */
  cronExpression: string;
  /** ISO-8601-Zeitstempel des letzten Laufs; `null`, solange nie gelaufen. */
  lastRunAt: string | null;
  /** Nächster Lauf laut Cron-Ausdruck (ISO-8601); `null`, wenn abgeschaltet. */
  nextRunAt: string | null;
  /** Id des zuletzt aus diesem Zeitplan erzeugten Backups; `null`, solange keines existiert. */
  lastBackupId: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: BackupSchedulePermissions;
}

// ---------------------------------------------------------------------------
// Allgemeine Aufgabenliste (Reiter „Aufgaben" in F3)
// ---------------------------------------------------------------------------

/**
 * Zweite Sicht auf dieselbe Entität `Schedule` (Pflichtenheft §6).
 *
 * `BackupScheduleDto` oben ist der **eine** Backup-Zeitplan je Server, den die
 * Backup-Verwaltung (B5) auswertet. Hier steht die **allgemeine, benannte
 * Liste**, die Lastenheft §3.3 verlangt: „täglicher Neustart oder Konsolenbefehl
 * zu festem Zeitpunkt". Beides sind Zeilen derselben Tabelle `schedules` –
 * bewusst keine zweite Tabelle und kein zweiter Aktionskatalog.
 */

/** Ausgang des letzten Laufs. */
export const SCHEDULE_RUN_RESULTS = ['success', 'failed', 'skipped'] as const;

export type ScheduleRunResult = (typeof SCHEDULE_RUN_RESULTS)[number];

export interface SchedulePermissions {
  canEdit: boolean;
  canDelete: boolean;
  /** Aufgabe pausieren und wieder aktivieren, ohne sie zu löschen. */
  canToggle: boolean;
}

export interface ScheduleDto {
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
  lastRunResult: ScheduleRunResult | null;
  /** ISO-8601-Zeitstempel des nächsten Laufs; `null`, wenn deaktiviert. */
  nextRunAt: string | null;
  permissions: SchedulePermissions;
}
