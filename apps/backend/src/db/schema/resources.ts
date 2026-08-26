/**
 * Tabellen des Arbeitspakets B4 – Ressourcen & Kapazität (Pflichtenheft §6, §10).
 *
 * Enthält die Entitäten `UserResourceLimit` und `HostNode`.
 *
 * **Warum `host_nodes` aus B4 heraus entsteht:** Die harte Kapazitätsprüfung aus
 * Pflichtenheft §10 misst gegen die tatsächlich verfügbaren Ressourcen der
 * Ziel-VM. Diese Werte dürfen laut Arbeitsauftrag nicht im Code stehen
 * (Lastenheft §5 beschreibt nur die *erste* Node), sondern gehören an die
 * Entität `HostNode` – ohne diese Tabelle hätte die Prüfung keine Datenquelle.
 * Die Node-**Verwaltung** (Anlegen, Bearbeiten, Storage-Explorer) bleibt bei B8;
 * die Tabelle ist bewusst auf die Felder aus Pflichtenheft §6 beschränkt und
 * von B8 additiv erweiterbar. Vermerkt in WORK_STATUS.md unter „Gefundene Punkte".
 */

import { type HostNodeStatus } from '@palantir/contracts';
import {
  doublePrecision,
  integer,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Homeserver-Node, auf der Gameserver-Container laufen (Pflichtenheft §6).
 *
 * `totalResources` aus §6 liegt hier als drei einzelne Spalten statt als JSON:
 * die Kapazitätsprüfung rechnet damit, und einzelne Spalten bleiben in SQL
 * vergleich- und summierbar. Die Zusammenfassung zum Objekt `NodeResources`
 * passiert im Repository, nicht in der Datenbank.
 *
 * `name` steht nicht wörtlich in §6, ist aber bereits Teil des Vertrags:
 * `GameServerDto.hostName` erwartet einen Anzeigenamen.
 */
export const hostNodes = pgTable(
  'host_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    /** Feste interne Tunnel-Adresse der Node (Pflichtenheft §2.1), z. B. `10.10.0.2`. */
    wireguardIp: text('wireguard_ip').notNull().unique(),
    /**
     * `$type` bindet die Spalte an `HOST_NODE_STATUSES` aus `@palantir/contracts`.
     * Bewusst `text` statt eines Postgres-Enums: ein zusätzlicher Status wäre
     * sonst eine Migration am Typ, nicht nur am Katalog.
     */
    status: text('status').$type<HostNodeStatus>().notNull().default('offline'),
    /**
     * Nutzbare Gesamt-Ressourcen der Gameserver-VM – nicht die Hardware des
     * Blechs darunter (Lastenheft §5: von 2,5 TB sind 2 TB für die VM nutzbar).
     */
    totalRamMb: integer('total_ram_mb').notNull(),
    /** Nachkommastellen erlaubt, deshalb `double precision` und nicht `integer`. */
    totalCpuCores: doublePrecision('total_cpu_cores').notNull(),
    totalDiskMb: integer('total_disk_mb').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('host_nodes_status_idx').on(table.status)],
);

/**
 * Optionales Ressourcen-Kontingent eines Nutzers (Pflichtenheft §6 und §10,
 * Lastenheft §3.4).
 *
 * `user_id` ist zugleich Primärschlüssel: je Nutzer gibt es höchstens einen
 * Datensatz. Fehlt der Datensatz ganz, gilt kein Limit – genauso wie bei einem
 * Datensatz, dessen vier Spalten alle `NULL` sind. Beide Fälle behandelt der
 * Service identisch (`NO_USER_RESOURCE_LIMITS`).
 *
 * Alle vier Grenzen sind **nullable**; `NULL` heißt ausdrücklich „für diese
 * Ressource gilt kein Limit" und ist nicht mit `0` zu verwechseln – `0` ist eine
 * gesetzte Grenze, die jeden Start ablehnt.
 *
 * Löscht der Betreiber ein Konto, verschwindet das Kontingent mit
 * (`ON DELETE CASCADE`) – ein verwaister Eintrag hätte keine Bedeutung.
 */
export const userResourceLimits = pgTable('user_resource_limits', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  maxRamMb: integer('max_ram_mb'),
  maxCpuCores: doublePrecision('max_cpu_cores'),
  maxDiskMb: integer('max_disk_mb'),
  maxConcurrentServers: integer('max_concurrent_servers'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HostNodeRow = typeof hostNodes.$inferSelect;
export type NewHostNodeRow = typeof hostNodes.$inferInsert;
export type UserResourceLimitRow = typeof userResourceLimits.$inferSelect;
export type NewUserResourceLimitRow = typeof userResourceLimits.$inferInsert;
