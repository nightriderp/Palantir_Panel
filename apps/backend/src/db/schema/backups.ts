/**
 * Tabellen des Arbeitspakets B5 – Backup-Verwaltung (Pflichtenheft §6,
 * Lastenheft §3.3).
 *
 * Enthält die Entitäten `Backup` und `Schedule`. `Schedule` steht hier, weil B5
 * als erstes Paket eine geplante Aufgabe braucht (den Backup-Zeitplan); die
 * Tabelle ist trotzdem allgemein nach Pflichtenheft §6 aufgebaut. Andere
 * Aktionen (`restart`, `command`) tragen ihre Auswertung **additiv** nach –
 * keine zweite Zeitplan-Tabelle daneben (CLAUDE.md §3).
 */

import {
  type BackupStatus,
  type BackupType,
  type ErrorCode,
  type ScheduleAction,
} from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Geplante Aufgabe (Pflichtenheft §6, Entität `Schedule`).
 *
 * `server_id` trägt bewusst noch **keinen** Fremdschlüssel: die Tabelle
 * `game_servers` gehört zu B3 und existiert noch nicht. Der Fremdschlüssel wird
 * dort nachgetragen (vermerkt in WORK_STATUS.md unter „Gefundene Punkte").
 */
export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id').notNull(),
    action: text('action').$type<ScheduleAction>().notNull(),
    /** Cron-Ausdruck mit fünf Feldern; ausgewertet in `modules/backups/cron.ts`. */
    cronExpression: text('cron_expression').notNull(),
    /** Aktions-spezifische Nutzdaten, z. B. `{ stopServer: true }` beim Backup. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    /**
     * Nächster fälliger Lauf. Bewusst gespeichert statt bei jedem Durchlauf neu
     * gerechnet: so findet der Scheduler die fälligen Zeitpläne mit einem
     * einzigen indizierten Vergleich, statt jeden Cron-Ausdruck auszuwerten.
     */
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Höchstens ein Backup-Zeitplan je Server (Lastenheft §3.3 kennt genau
     * einen). Für andere Aktionen bleibt die Mehrfachvergabe offen – ein Server
     * darf mehrere Neustart- oder Befehls-Aufgaben haben.
     */
    uniqueIndex('schedules_one_backup_per_server_idx')
      .on(table.serverId)
      .where(sql`${table.action} = 'backup'`),
    index('schedules_due_idx')
      .on(table.nextRunAt)
      .where(sql`${table.enabled}`),
  ],
);

/**
 * Backup eines Gameservers (Pflichtenheft §6, Entität `Backup`).
 *
 * `owner_id` ist bewusst eine Kopie des Server-Besitzers und keine reine
 * Ableitung: die `.own`/`.any`-Prüfung (Pflichtenheft §8) und die globale
 * Übersicht mit Speicherverbrauch je Nutzer (Lastenheft §3.7) müssen auch dann
 * funktionieren, wenn der zugehörige Server längst gelöscht ist – ein Backup
 * überlebt seinen Server bewusst.
 */
export const backups = pgTable(
  'backups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `manual` oder `automatic` – trägt die Aufbewahrungsregel (Lastenheft §3.3). */
    type: text('type').$type<BackupType>().notNull(),
    status: text('status').$type<BackupStatus>().notNull().default('pending'),
    /** Vom Nutzer angestoßener Volldatenexport; technisch ein manuelles Backup. */
    isExport: boolean('is_export').notNull().default(false),
    /** Größe des Archivs; `bigint`, weil ein Serverordner die 2-GiB-Grenze von `integer` überschreitet. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    storagePath: text('storage_path'),
    checksumSha256: text('checksum_sha256'),
    /** Auslösender Nutzer; `null` bei geplanten Backups oder gelöschtem Konto. */
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Zeitplan, aus dem das Backup entstand; `null` bei manuellen Backups. */
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    /** Korrelations-ID des laufenden Agent-Befehls (Pflichtenheft §2.2). */
    correlationId: uuid('correlation_id'),
    /** War der Server während des Sicherns angehalten? Bestimmt die Verlässlichkeit des Spielstands. */
    containerStopped: boolean('container_stopped').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Benannter Code aus `ERROR_CATALOG` bei `status = 'failed'` – nie Freitext (CLAUDE.md §5). */
    failureCode: text('failure_code').$type<ErrorCode>(),
    failureMessage: text('failure_message'),
  },
  (table) => [
    /** Trägt die Aufbewahrungsprüfung: Backups eines Servers, neueste zuerst. */
    index('backups_server_created_idx').on(table.serverId, table.createdAt.desc()),
    index('backups_owner_idx').on(table.ownerId),
    index('backups_status_idx').on(table.status),
    /**
     * Höchstens ein laufendes Backup je Server. Zwei gleichzeitige Läufe würden
     * denselben Datenordner lesen, während er sich ändert – die Regel steht
     * deshalb in der Datenbank und nicht nur im Service.
     */
    uniqueIndex('backups_one_active_per_server_idx')
      .on(table.serverId)
      .where(sql`${table.status} in ('pending', 'running')`),
  ],
);

export type BackupRow = typeof backups.$inferSelect;
export type NewBackupRow = typeof backups.$inferInsert;
export type ScheduleRow = typeof schedules.$inferSelect;
export type NewScheduleRow = typeof schedules.$inferInsert;
