/**
 * Zod-Schemas der Backup-Verwaltung (Lastenheft §3.3, Pflichtenheft §6).
 *
 * Gegenstück zu `BackupDto` und `BackupScheduleDto` aus `@palantir/contracts`.
 * Backend (Request-Validierung) und Frontend (Formulare in F3/F4/F10) nutzen
 * dieselben Schemas – kein zweiter, abweichender Regelsatz.
 */

import { BACKUP_STATUSES, BACKUP_TYPES } from '@palantir/contracts';
import { z } from 'zod';
import { idSchema } from './common.js';

export const backupTypeSchema = z.enum(BACKUP_TYPES);
export const backupStatusSchema = z.enum(BACKUP_STATUSES);

/**
 * Cron-Ausdruck mit fünf Feldern: Minute Stunde Tag Monat Wochentag.
 *
 * Geprüft wird hier nur die **Form** (fünf Felder aus erlaubten Zeichen). Ob
 * die Zahlen im gültigen Bereich liegen, entscheidet die Auswertung im Backend
 * (`SCHEDULE_INVALID_CRON`) – sie ist die einzige Stelle, die den Ausdruck
 * versteht, und beide Regelsätze auseinanderlaufen zu lassen wäre schlimmer als
 * eine Prüfung an einer Stelle.
 */
export const cronExpressionSchema = z
  .string()
  .trim()
  .regex(/^[\d*/,-]+(\s+[\d*/,-]+){4}$/, {
    message:
      'Der Zeitplan muss aus fünf Cron-Feldern bestehen (Minute Stunde Tag Monat Wochentag).',
  });

/**
 * Eingabe zum Auslösen eines manuellen Backups (F3 → Backend).
 *
 * `stopServer` steuert, ob der Server für einen sauberen Spielstand kurz
 * angehalten wird. Ohne Angabe wird **nicht** angehalten: ein unerwarteter
 * Serverstopp mitten im Spiel wäre die unangenehmere Überraschung.
 */
export const createBackupInputSchema = z.object({
  stopServer: z.boolean().default(false),
});

/** Eingabe für den vollständigen Datenexport (Lastenheft §3.3). */
export const createServerExportInputSchema = createBackupInputSchema;

/** Eingabe zum Setzen des Backup-Zeitplans eines Servers (F3 → Backend). */
export const updateBackupScheduleInputSchema = z.object({
  enabled: z.boolean(),
  cronExpression: cronExpressionSchema,
  stopServer: z.boolean().default(false),
});

/**
 * Filter der globalen Backup-Übersicht (F10 → Backend).
 *
 * Alle Felder optional: ohne Filter liefert die Übersicht den vollständigen
 * Stand aller Nutzer.
 */
export const backupOverviewQuerySchema = z.object({
  ownerId: idSchema.optional(),
  serverId: idSchema.optional(),
  type: backupTypeSchema.optional(),
  status: backupStatusSchema.optional(),
});

export type CreateBackupInput = z.infer<typeof createBackupInputSchema>;
export type CreateServerExportInput = z.infer<typeof createServerExportInputSchema>;
export type UpdateBackupScheduleInput = z.infer<typeof updateBackupScheduleInputSchema>;
export type BackupOverviewQuery = z.infer<typeof backupOverviewQuerySchema>;
