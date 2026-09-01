/**
 * Tabellen des Arbeitspakets B8 – Admin-Funktionen (Pflichtenheft §6).
 *
 * Enthält:
 * - `port_ranges` / `port_allocations` – der öffentliche Port-Bereich der VPS
 *   und die Zuordnung Port ↔ Zielserver (Pflichtenheft §2.4)
 * - `audit_log` – append-only Protokoll aller sicherheitsrelevanten Aktionen
 * - `storage_snapshots` – zwischengespeichertes Ergebnis des Agent-Befehls
 *   `GET_STORAGE_BREAKDOWN` (Pflichtenheft §16)
 *
 * **`host_nodes` liegt bewusst nicht hier.** Die Tabelle kam aus B4
 * (`schema/resources.ts`), weil die harte Kapazitätsprüfung aus Pflichtenheft §10
 * ohne sie keine Datenquelle hätte. B8 verwaltet dieselbe Tabelle und hat sie
 * dort **additiv** um `status_message` und `last_seen_at` erweitert – keine
 * zweite Node-Tabelle daneben (CLAUDE.md §3).
 *
 * **`audit_log` ist append-only.** Das ist nicht nur eine Regel im
 * Anwendungscode: Die zugehörige Migration legt zusätzlich einen Trigger an,
 * der UPDATE, DELETE und TRUNCATE auf dieser Tabelle in der Datenbank ablehnt.
 * Die einzige Ausnahme ist der Archivierungsprozess aus Pflichtenheft §6, der
 * sich über die Sitzungsvariable `palantir.audit_archive` ausweist und
 * ausschließlich Einträge älter als 24 Monate entfernen darf – nachdem sie
 * exportiert wurden. Siehe `apps/backend/src/modules/admin/audit-archive.ts`.
 */

import {
  type AgentStorageEntry,
  type AuditAction,
  type AuditTargetType,
  type PortProtocol,
} from '@palantir/contracts';
import {
  bigint,
  boolean,
  index,
  integer,
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
 * Zusammenhängender Bereich öffentlicher Ports auf der VPS (Pflichtenheft §2.4).
 *
 * Ob sich zwei Bereiche überschneiden, prüft der Service beim Anlegen – eine
 * Ausschluss-Bedingung in der Datenbank bräuchte die Erweiterung `btree_gist`,
 * und eine zusätzliche Erweiterung ist für diesen einen Fall nicht
 * gerechtfertigt (CLAUDE.md §1).
 */
export const portRanges = pgTable(
  'port_ranges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: text('label').notNull(),
    startPort: integer('start_port').notNull(),
    endPort: integer('end_port').notNull(),
    protocol: text('protocol').$type<PortProtocol>().notNull(),
    /** Node, für die der Bereich gilt; `null` = für alle Nodes. */
    nodeId: uuid('node_id').references(() => hostNodes.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('port_ranges_protocol_idx').on(table.protocol)],
);

/**
 * Zuordnung Port ↔ Zielserver (Pflichtenheft §2.4).
 *
 * Entsteht bei der Erstellung eines Servers und verschwindet mit seiner
 * Löschung – nie von Hand gepflegt.
 *
 * `server_id` löscht mit (`ON DELETE CASCADE`, nachgetragen in R3): Ohne den
 * Fremdschlüssel räumte allein `releaseForServer()` auf, und ein Server-Löschen
 * an dieser Methode vorbei hinterließ eine verwaiste Zuordnung – der Port bliebe
 * dauerhaft belegt.
 */
export const portAllocations = pgTable(
  'port_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rangeId: uuid('range_id')
      .notNull()
      .references(() => portRanges.id, { onDelete: 'restrict' }),
    port: integer('port').notNull(),
    protocol: text('protocol').$type<PortProtocol>().notNull(),
    serverId: uuid('server_id').references(() => gameServers.id, { onDelete: 'cascade' }),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Derselbe Port darf je Protokoll nur einmal vergeben sein – die Regel, die
     * den ganzen Pool zusammenhält, liegt damit in der Datenbank und nicht
     * allein im Anwendungscode.
     */
    uniqueIndex('port_allocations_port_protocol_idx').on(table.port, table.protocol),
    index('port_allocations_server_id_idx').on(table.serverId),
    index('port_allocations_range_id_idx').on(table.rangeId),
  ],
);

/**
 * Audit-Log (Entität `AuditLog`, Pflichtenheft §6) – **append-only**.
 *
 * Es gibt bewusst keine `updatedAt`-Spalte: Ein Eintrag wird nie geändert.
 *
 * `actor_id` löscht absichtlich **nicht** mit (`ON DELETE SET NULL`): Wird ein
 * Konto entfernt, bleibt der Protokolleintrag bestehen – sonst ließe sich ein
 * Log durch Kontolöschung lichten. Der Anzeigename ist zusätzlich als Kopie in
 * `actor_display_name` festgehalten, damit der Eintrag auch dann lesbar bleibt.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: text('action').$type<AuditAction>().notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorDisplayName: text('actor_display_name'),
    targetType: text('target_type').$type<AuditTargetType>(),
    targetId: text('target_id'),
    /** Grobe Herkunft des Requests, analog zu `Session.ipHint`. */
    ipHint: text('ip_hint'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /** Spaltenname wie das Entitätsfeld in Pflichtenheft §6. */
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_timestamp_idx').on(table.timestamp),
    index('audit_log_action_idx').on(table.action),
    index('audit_log_actor_id_idx').on(table.actorId),
    index('audit_log_target_idx').on(table.targetType, table.targetId),
  ],
);

/**
 * Zwischengespeicherte Speicherübersicht je Node (Pflichtenheft §16).
 *
 * Der Scan läuft on demand; hier liegt jeweils das Ergebnis des letzten Laufs.
 * Genau eine Zeile je Node – ein Verlauf ist nicht gefordert und würde die
 * Tabelle nur unbegrenzt wachsen lassen.
 */
/**
 * Einstellungen der Instanz (Mockup-Abgleich 12.1.1).
 *
 * Genau **eine** Zeile, festgehalten über den Primärschlüssel `id = 1`: Es gibt
 * eine Instanz, und zwei Zeilen wären zwei Wahrheiten. Fehlt die Zeile, gelten
 * die Vorgaben – die Instanz verhält sich dann wie bisher.
 */
export const instanceSettings = pgTable('instance_settings', {
  /** Immer `1`; der Wert hat keine Bedeutung außer „diese eine Zeile". */
  id: integer('id').primaryKey().default(1),
  /** Dürfen sich neue Konten selbst registrieren? Vorgabe: ja, wie bisher. */
  selfRegistrationEnabled: boolean('self_registration_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  /** Wer zuletzt geändert hat – für das Audit-Log ohnehin, hier zur Anzeige. */
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
});

export const storageSnapshots = pgTable('storage_snapshots', {
  nodeId: uuid('node_id')
    .primaryKey()
    .references(() => hostNodes.id, { onDelete: 'cascade' }),
  /** Zeitpunkt des Agent-Scans, nicht des Abrufs. */
  scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
  /**
   * Größen als `bigint`: Ein 2-TB-Datenträger sprengt den Wertebereich von
   * `integer`. Der Modus `number` ist hier sicher – JavaScript rechnet mit
   * ganzen Zahlen bis 2^53 exakt, das sind gut 9 Petabyte.
   */
  totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
  usedBytes: bigint('used_bytes', { mode: 'number' }).notNull(),
  freeBytes: bigint('free_bytes', { mode: 'number' }).notNull(),
  /**
   * Rohe Posten, wie der Agent sie gemeldet hat (`AgentStorageEntry[]`).
   * Bewusst unverändert abgelegt: Ob ein Posten löschbar ist, entscheidet das
   * Backend bei jedem Abruf neu – die Antwort hängt vom aktuellen Datenbestand
   * ab, nicht vom Zeitpunkt des Scans.
   */
  entries: jsonb('entries').$type<AgentStorageEntry[]>().notNull(),
});

export type PortRangeRow = typeof portRanges.$inferSelect;
export type PortAllocationRow = typeof portAllocations.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type StorageSnapshotRow = typeof storageSnapshots.$inferSelect;
