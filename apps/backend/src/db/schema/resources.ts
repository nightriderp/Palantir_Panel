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

import { type HostNodeStatus, type QuotaRequestStatus } from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  integer,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
    /**
     * Erläuterung zum Status, z. B. der Grund einer Wartung.
     *
     * Additive Ergänzung aus B8 (Node-Verwaltung), wie in der Notiz oben
     * vorgesehen. Die Kapazitätsprüfung aus B4 wertet das Feld nicht aus – sie
     * schaut ausschließlich auf `status`.
     */
    statusMessage: text('status_message'),
    /**
     * Letzter Kontakt des Agents; `null`, solange die Node nie verbunden war.
     *
     * Ebenfalls additiv aus B8: Die Node-Übersicht zeigt, wie aktuell der
     * gemeldete Zustand ist. Gesetzt wird das Feld vom Agent-Kanal (B3).
     */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /**
     * SHA-256 des Agent-Tokens dieser Node (WORK_STATUS.md, Gefundener Punkt 57).
     *
     * `null`, solange kein Token vergeben wurde – dann meldet sich der Agent
     * dieser Node über das gemeinsame `AGENT_TOKEN` aus der zentralen `.env`,
     * wie in Phase 1 mit genau einem Homeserver.
     *
     * Gespeichert wird nur der Hash: Ein Datenbank-Auszug soll keine gültigen
     * Agent-Zugänge enthalten. SHA-256 ohne Salt genügt hier – anders als ein
     * Passwort ist das Token 256 Bit Zufall aus `randomBytes()`, ein
     * Wörterbuchangriff greift daran nicht (Pflichtenheft §7 verlangt Argon2id
     * für **Passwörter**).
     */
    agentTokenHash: text('agent_token_hash').unique(),
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

/**
 * Anfragen auf mehr Kontingent (Mockup-Abgleich 12.3.1).
 *
 * Ein Nutzer stößt an seine Grenze, begründet, was er braucht, und ein
 * Administrator entscheidet. Entschieden wird genau einmal – danach steht der
 * Vorgang als Beleg da und wird nicht mehr angefasst.
 *
 * Der partielle Unique-Index lässt **eine** offene Anfrage je Konto zu. Zwei
 * gleichzeitig hülfen niemandem: Der Administrator sähe zwei Wünsche desselben
 * Kontos und wüsste nicht, welcher gilt.
 */
export const quotaRequests = pgTable(
  'quota_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Gewünschter Arbeitsspeicher in MB; `null`, wenn nicht Teil der Anfrage. */
    requestedRamMb: integer('requested_ram_mb'),
    /** Gewünschte Zahl gleichzeitig laufender Server; `null`, wenn nicht Teil der Anfrage. */
    requestedMaxConcurrentServers: integer('requested_max_concurrent_servers'),
    reason: text('reason').notNull(),
    status: text('status').$type<QuotaRequestStatus>().notNull().default('pending'),
    decisionNote: text('decision_note'),
    decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Eine offene Anfrage je Konto (siehe Kopfkommentar).
    uniqueIndex('quota_requests_open_per_user_idx')
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index('quota_requests_status_created_idx').on(table.status, table.createdAt.desc()),
  ],
);
