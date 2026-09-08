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
  type PanelBackupStatus,
  type PanelBackupTrigger,
  type ScheduleAction,
  type ScheduleRunResult,
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
import { hostNodes } from './resources.js';
import { gameServers } from './server-orchestration.js';
import { users } from './users.js';

/**
 * Geplante Aufgabe (Pflichtenheft §6, Entität `Schedule`).
 *
 * `server_id` löscht mit (`ON DELETE CASCADE`, nachgetragen in R3): Eine
 * geplante Aufgabe ohne Server hat keine Bedeutung.
 */
export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => gameServers.id, { onDelete: 'cascade' }),
    /**
     * Frei gewählter Name der Aufgabe (`ScheduleDto.name`, F3-Reiter „Aufgaben").
     *
     * Bewusst `null`-fähig: Der Backup-Zeitplan aus B5 ist der eine Zeitplan je
     * Server und trägt keinen eigenen Namen – die Oberfläche zeigt ihn unter
     * „Sicherungen" und nicht in der Aufgabenliste. Eine Spalte mit
     * Pflicht-Vorgabe müsste dort einen erfundenen Namen ablegen.
     */
    name: text('name'),
    action: text('action').$type<ScheduleAction>().notNull(),
    /** Cron-Ausdruck mit fünf Feldern; ausgewertet in `modules/backups/cron.ts`. */
    cronExpression: text('cron_expression').notNull(),
    /**
     * IANA-Zeitzone, in der `cron_expression` ausgewertet wird, z. B.
     * `Europe/Berlin`. `null` bedeutet „lokale Zeit des Backends" – so wertet
     * der Backup-Zeitplan aus B5 seinen Ausdruck seit jeher aus.
     */
    timezone: text('timezone'),
    /** Aktions-spezifische Nutzdaten, z. B. `{ stopServer: true }` beim Backup. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    /** Ausgang des letzten Laufs (`ScheduleDto.lastRunResult`); `null`, solange nie gelaufen. */
    lastRunResult: text('last_run_result').$type<ScheduleRunResult>(),
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
    /**
     * Trägt die Kaskade beim Löschen eines Servers (Audit backend-db-07).
     *
     * Der Unique-Index oben steht zwar auf derselben Spalte, ist aber auf
     * `action = 'backup'` eingeschränkt – für `delete from schedules where
     * server_id = …` taugt er nicht, weil diese Bedingung dort nicht
     * mitgegeben wird. Mit den Aufgaben-Zeitplänen (`restart`, `command`)
     * wächst die Tabelle über den einen Backup-Zeitplan je Server hinaus.
     */
    index('schedules_server_id_idx').on(table.serverId),
  ],
);

/**
 * Backup eines Gameservers (Pflichtenheft §6, Entität `Backup`).
 *
 * `owner_id` ist bewusst eine Kopie des Server-Besitzers und keine reine
 * Ableitung: die `.own`/`.any`-Prüfung (Pflichtenheft §8) und die globale
 * Übersicht mit Speicherverbrauch je Nutzer (Lastenheft §3.7) müssen auch dann
 * funktionieren, wenn der zugehörige Server längst gelöscht ist – ein Backup
 * überlebt seinen Server bewusst. Der Fremdschlüssel auf `game_servers` setzt
 * `server_id` beim Löschen des Servers deshalb auf `NULL` (R3), statt das Backup
 * mit zu löschen.
 *
 * Das Konto überlebt ein Backup dagegen **nicht**: `owner_id` steht auf
 * `RESTRICT`, weil die Archivdatei auf der Node nur der Agent entfernt – siehe
 * die Anmerkung an der Spalte (Audit backend-db-02).
 *
 * `host_id` hält fest, auf **welcher** Node das Archiv liegt (Fundpunkt 174).
 * Weil `server_id` wegfallen darf, wäre die Node sonst mit dem Server
 * verschwunden – und `DOWNLOAD_BACKUP`/`DELETE_BACKUP` gingen ab der zweiten
 * Node an die falsche Maschine.
 */
export const backups = pgTable(
  'backups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Gesicherter Server; `null`, sobald er gelöscht wurde.
     *
     * `ON DELETE SET NULL` statt `CASCADE` – ein Backup überlebt seinen Server
     * bewusst (Lastenheft §3.3). `RESTRICT` scheidet aus: Das Löschen eines
     * Servers darf nicht daran scheitern, dass es noch Sicherungen gibt.
     */
    serverId: uuid('server_id').references(() => gameServers.id, { onDelete: 'set null' }),
    /**
     * Node, auf der das Archiv tatsächlich liegt (Fundpunkt 174).
     *
     * Bewusst am Backup festgehalten und nicht über `server_id` erschlossen:
     * Ein Backup überlebt seinen Server (`ON DELETE SET NULL` oben), und mit
     * dem Server verschwände auch der einzige Weg zu seiner Node. Dieselbe
     * Linie wie `owner_id` – eine Tatsache, die eine spätere Entscheidung
     * trägt, wird festgehalten statt aus etwas rekonstruiert, das wegfallen
     * darf. Solange genau eine Node läuft, ist das folgenlos; ab der zweiten
     * bestimmt diese Spalte, an welche Maschine `DOWNLOAD_BACKUP` und
     * `DELETE_BACKUP` gehen (`server-orchestration/backup-ports.ts`).
     *
     * `ON DELETE SET NULL` – aus denselben Gründen wie bei `server_id`:
     *
     * - `CASCADE` scheidet aus: Mit der Node verschwände der **Datensatz**, die
     *   einzige Spur, dass es die Sicherung gab (Größe, Besitzer, Ablageort).
     *   Der Speicherverbrauch je Konto (Lastenheft §3.7) verlöre still einen
     *   Posten.
     * - `RESTRICT` scheidet aus: Es ließe das Ausmustern einer Node an
     *   Sicherungen scheitern, die auf ihr lagen. Anders als bei `owner_id`
     *   gibt es dafür keinen regulären Ausweg – der Agent, der die Archive
     *   entfernen müsste, ist mit der Node ja gerade weg. Der Betreiber käme
     *   nur noch von Hand aus der Sperre.
     *
     * `null` heißt damit „Node unbekannt": eine Zeile von vor dieser Spalte,
     * die keiner Node eindeutig zuzuordnen war, oder eine ausgemusterte Node.
     * Für diesen Fall bleibt der bisherige Weg über `defaultHost()` – sichtbar
     * im Log, nicht stillschweigend.
     */
    hostId: uuid('host_id').references(() => hostNodes.id, { onDelete: 'set null' }),
    /**
     * Besitzer des Backups; trägt `.own`/`.any` und den Speicherverbrauch je
     * Konto (Lastenheft §3.7).
     *
     * `ON DELETE RESTRICT` statt `CASCADE` (Audit backend-db-02). Die Kaskade
     * entfernte die Zeilen **nur in der Datenbank**: Die Archivdatei unter
     * `storage_path` liegt auf der Node und wird ausschließlich vom Agent
     * entfernt (`DELETE_BACKUP`), den beim Kaskadenlauf niemand anstößt. Ein
     * gelöschtes Konto hinterließ so für immer unsichtbaren Speicherverbrauch –
     * genau das, was die globale Übersicht eigentlich zeigen soll.
     *
     * `RESTRICT` dreht das um: Ein Konto verschwindet erst, wenn seine
     * Sicherungen über den regulären Weg entfernt sind. Die Vorprüfung dazu
     * steht in `AuthService.deleteAccount` und antwortet mit
     * `ACCOUNT_HAS_SERVERS` (409) statt mit dem rohen Fremdschlüsselfehler.
     */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
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
     * Trägt das `ON DELETE SET NULL` beim Ausmustern einer Node (Fundpunkt 174,
     * dieselbe Regel wie in `schema-feinschliff.db.test.ts`: Ein Index kommt
     * dorthin, wo die Tabelle mit dem Betrieb wächst – Sicherungen tun das).
     * Ohne ihn läse PostgreSQL für jede gelöschte `host_nodes`-Zeile den
     * gesamten Bestand.
     */
    index('backups_host_id_idx').on(table.hostId),
    /**
     * Trägt das `ON DELETE SET NULL` beim Löschen eines Kontos (Audit
     * backend-db-07). `owner_id` steht auf `RESTRICT` und ist indiziert –
     * `created_by_user_id` ist der zweite Verweis auf `users` in dieser
     * Tabelle und wurde dabei übersehen.
     */
    index('backups_created_by_user_id_idx').on(table.createdByUserId),
    /**
     * Trägt zwei Wege (Audit backend-db-07): das `ON DELETE SET NULL` beim
     * Löschen eines Zeitplans und `findLatestByScheduleId` – die Abfrage, die
     * jeder Zeitplan-DTO für `lastBackupId` absetzt (`schedules.ts`). Letztere
     * filtert allein nach `schedule_id`; der bestehende
     * `backups_server_created_idx` trägt sie nicht, weil er auf `server_id`
     * führt. Bewusst nur die eine Spalte: Wie viele Sicherungen je Zeitplan
     * stehen bleiben, begrenzt die Aufbewahrung – die anschließende Sortierung
     * nach `created_at` läuft über eine Handvoll Zeilen.
     */
    index('backups_schedule_id_idx').on(table.scheduleId),
    /**
     * Höchstens ein laufendes Backup je Server. Zwei gleichzeitige Läufe würden
     * denselben Datenordner lesen, während er sich ändert – die Regel steht
     * deshalb in der Datenbank und nicht nur im Service.
     *
     * **Warum `server_id IS NULL` bewusst ausgenommen bleibt** (Audit
     * backend-db-06): NULL-Werte kollidieren im btree nicht, mehrere „aktive“
     * Backups gelöschter Server sind also möglich. Der Schutzzweck – kein
     * paralleler Lesezugriff auf denselben Datenordner – ist dabei nicht
     * verletzt, denn den Ordner gibt es nicht mehr. Die NULL-Fälle
     * mitzuzählen (etwa über `coalesce`) würde dagegen echten Schaden
     * anrichten: `ON DELETE SET NULL` schreibt beim Löschen eines Servers genau
     * diese Zeilen um, und ein zweiter server-loser Lauf ließe **das Löschen
     * des Servers** an einer Unique-Verletzung scheitern. Aufgeräumt werden die
     * Zombie-Zeilen deshalb im Service: `sweepOrphanedRuns()` setzt sie nach
     * ihrer Frist auf `failed` (Audit W1-6, bb-03).
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

/**
 * Sicherungen des Panels selbst (Mockup-Abgleich 12.5.1).
 *
 * Bewusst **neben** `backups` und nicht darin: Dort stehen die Sicherungen der
 * Gameserver – mit Besitzer, Server und Node. Eine Panel-Sicherung hat nichts
 * davon; sie gehört der Instanz. Ein gemeinsamer Tisch mit lauter leeren
 * Spalten wäre die schlechtere Ordnung.
 */
export const panelBackups = pgTable(
  'panel_backups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status').$type<PanelBackupStatus>().notNull().default('running'),
    trigger: text('trigger').$type<PanelBackupTrigger>().notNull(),
    /** Ablageort auf der VPS; `null`, solange nichts geschrieben wurde. */
    storagePath: text('storage_path'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    failureMessage: text('failure_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('panel_backups_started_idx').on(table.startedAt.desc()),
    /**
     * Höchstens ein laufender Abzug – zur selben Zeit, für die ganze Instanz
     * (Audit bb-11).
     *
     * Der Service prüft das zwar über `findRunning()`, aber Prüfen und Anlegen
     * sind zwei Schritte: Zwischen ihnen kann der Minuten-Takt oder ein zweiter
     * Admin dazwischenkommen. Ohne Zusicherung in der Datenbank entstünden zwei
     * `running`-Datensätze und zwei parallele `pg_dump`-Prozesse – bei
     * gleicher Millisekunde sogar auf denselben Zielpfad, also zwei Prozesse
     * auf einer Datei. Anders als bei den Server-Backups (B5) fing hier nichts.
     *
     * Der Index steht auf `status`, weil genau dieser Wert die Regel trägt; die
     * Bedingung macht ihn partiell, damit `completed`/`failed` beliebig oft
     * vorkommen dürfen.
     */
    uniqueIndex('panel_backups_one_running_idx')
      .on(table.status)
      .where(sql`${table.status} = 'running'`),
  ],
);

export type PanelBackupRow = typeof panelBackups.$inferSelect;
export type NewPanelBackupRow = typeof panelBackups.$inferInsert;
