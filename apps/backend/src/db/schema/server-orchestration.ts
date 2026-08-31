/**
 * Tabellen des Arbeitspakets B3 – Server-Orchestrierung (Pflichtenheft §6, §9).
 *
 * Enthält die Entitäten `GameServer` und `ServerMember`.
 *
 * **`host_nodes` gehört B4** (`schema/resources.ts`) und wird hier nur
 * referenziert – die Kapazitätsprüfung aus Pflichtenheft §10 rechnet mit den
 * Ressourcenspalten dieser Tabelle, deshalb liegt sie dort. B3 legt bewusst
 * keine zweite an.
 */

import {
  type GameConfigValues,
  type ServerMemberLevel,
  type ServerResourceLimits,
  type ServerStatus,
} from '@palantir/contracts';
import {
  type ServerAutoShutdown,
  type ServerPortAssignment,
} from '../../modules/server-orchestration/types.js';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { hostNodes } from './resources.js';
import { users } from './users.js';

/**
 * Gameserver (Pflichtenheft §6 `GameServer`).
 *
 * Zusammengesetzte Werte (`assignedPorts`, `resourceLimits`, `configJson`,
 * `autoShutdown`, Absturzhistorie) liegen als `jsonb` und nicht als eigene
 * Tabellen: Sie werden immer als Ganzes gelesen und geschrieben, nie einzeln
 * abgefragt, und ihre Form gibt die `GameTypeDefinition` vor – eine eigene
 * Tabelle je Spiel-Konfigurationsfeld wäre eine Migration je neuem Spiel.
 * `$type` bindet die Spalten an die Typen aus `@palantir/contracts`.
 */
export const gameServers = pgTable(
  'game_servers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    hostId: uuid('host_id')
      .notNull()
      .references(() => hostNodes.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Kennung der `GameTypeDefinition` – die Registry ist Code, keine Tabelle (§11). */
    gameType: text('game_type').notNull(),

    // -- Lifecycle (Pflichtenheft §9) -----------------------------------------
    status: text('status').$type<ServerStatus>().notNull().default('creating'),
    statusMessage: text('status_message'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Letzter **erfolgreicher** Start; setzt die Schonfrist des Auto-Shutdown. */
    lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
    /** Zuletzt Spieler gesehen – Bezugspunkt des Inaktivitäts-Timeouts. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    /**
     * Absturz-Zeitpunkte im gleitenden Fenster des Crash-Loop-Schutzes
     * (ISO-8601). Bewusst am Server und nicht im Arbeitsspeicher: Ein Neustart
     * des Backends darf den Schutz nicht zurücksetzen.
     */
    crashTimestamps: text('crash_timestamps').array().$type<string[]>().notNull().default([]),

    // -- Container & Netz ------------------------------------------------------
    dockerContainerId: text('docker_container_id'),
    /**
     * Image, mit dem der Container angelegt wurde (Mockup-Abgleich 3.4).
     *
     * Grundlage für „Update verfügbar": Weicht der Wert vom `dockerImage` der
     * heutigen Spiel-Definition ab, läuft der Server auf einer älteren Fassung.
     * `null` bei Servern ohne Container – und bei allen, die vor dieser Spalte
     * angelegt wurden; für die lässt sich nichts mehr nachträglich feststellen.
     */
    imageRef: text('image_ref'),
    /**
     * Fingerabdruck des Bauplans, mit dem der Container angelegt wurde
     * (WORK_STATUS.md, Punkt 114).
     *
     * Umgebungsvariablen, Image, Ports und Grenzen bekommt ein Container beim
     * Anlegen; `RESTART` startet denselben Container mit denselben Werten.
     * Weicht der Fingerabdruck des heutigen Bauplans ab, wird der Container vor
     * dem naechsten Start neu gebaut. `null` bei Servern ohne Container – und
     * bei allen, die vor dieser Spalte angelegt wurden: Die werden beim
     * naechsten Start einmalig neu gebaut.
     */
    containerSpecHash: text('container_spec_hash'),
    subdomain: text('subdomain').notNull(),
    /** Kennung des DNS-Eintrags beim Anbieter, für die spätere Löschung (§13). */
    dnsRecordId: text('dns_record_id'),
    assignedPorts: jsonb('assigned_ports').$type<ServerPortAssignment[]>().notNull().default([]),

    // -- Konfiguration ---------------------------------------------------------
    resourceLimits: jsonb('resource_limits').$type<ServerResourceLimits>().notNull(),
    configJson: jsonb('config_json').$type<GameConfigValues>().notNull().default({}),
    /** Freie Startparameter des Servers (Lastenheft §3.3). */
    startupParameters: text('startup_parameters').notNull().default(''),
    autoShutdown: jsonb('auto_shutdown').$type<ServerAutoShutdown>().notNull(),
    /** Einstellung geändert, die erst nach einem Neustart wirkt (Lastenheft §3.3). */
    restartRequired: boolean('restart_required').notNull().default(false),

    /**
     * Herkunft beim Klonen (§9).
     *
     * `ON DELETE SET NULL`: Wird die Vorlage gelöscht, bleibt der Klon
     * selbstverständlich bestehen – er ist ein eigenständiger Server.
     */
    clonedFromServerId: uuid('cloned_from_server_id').references(
      (): AnyPgColumn => gameServers.id,
      { onDelete: 'set null' },
    ),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Eindeutigkeit der Subdomain (Pflichtenheft §13) – in der Datenbank
     * abgesichert und nicht nur in der Anwendung: Zwei gleichzeitige
     * Anlegevorgänge mit derselben Subdomain würden die Prüfung im Dienst
     * sonst beide bestehen. Die Werte sind beim Schreiben bereits
     * kleingeschrieben (`subdomainSchema`), daher genügt ein einfacher Index.
     */
    uniqueIndex('game_servers_subdomain_idx').on(table.subdomain),
    index('game_servers_owner_id_idx').on(table.ownerId),
    index('game_servers_host_id_idx').on(table.hostId),
    index('game_servers_status_idx').on(table.status),
    /** Zuordnung Container → Server für den Soll/Ist-Abgleich (§2.2). */
    uniqueIndex('game_servers_docker_container_id_idx').on(table.dockerContainerId),
  ],
);

/**
 * Mitglied eines Servers (Pflichtenheft §6 `ServerMember`, Lastenheft §3.3).
 *
 * Beide Fremdschlüssel löschen mit: Verschwindet der Server oder das Konto,
 * hätte die Zuordnung keine Bedeutung mehr.
 */
export const serverMembers = pgTable(
  'server_members',
  {
    serverId: uuid('server_id')
      .notNull()
      .references(() => gameServers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `viewer` | `operator` | `manager` (`SERVER_MEMBER_LEVELS` in den Contracts). */
    permissionLevel: text('permission_level').$type<ServerMemberLevel>().notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.userId] }),
    index('server_members_user_id_idx').on(table.userId),
  ],
);

/**
 * Stichproben der Live-Messwerte (Lastenheft §3.3 „Verlaufsdarstellung";
 * Arbeitspaket P5).
 *
 * Eine Zeile je Server und Messzeitpunkt. Bewusst **keine** eigene `id`: Der
 * Schlüssel ist der Messzeitpunkt je Server, eine zusätzliche UUID wäre in
 * einer Reihe, die im Minutentakt wächst, nur Ballast. Aus demselben Grund gibt
 * es eine Aufbewahrungsfrist (`STATS_HISTORY_RETENTION_HOURS`) – ein Verlauf
 * ohne Ende wäre die größte Tabelle der Installation, ohne dass jemand über
 * Wochen zurückblickt.
 *
 * Die Spalten spiegeln `ServerLiveStats` aus den Contracts; alle sind
 * `null`-fähig, weil nicht jede Quelle jeden Wert liefert (die Container-Engine
 * kennt keine Spielerzahl, die Server-Abfrage kein RAM).
 */
export const serverStatsSamples = pgTable(
  'server_stats_samples',
  {
    serverId: uuid('server_id')
      .notNull()
      .references(() => gameServers.id, { onDelete: 'cascade' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    /** Prozent eines Kerns (250 = 2,5 Kerne ausgelastet), wie `AgentContainerStats`. */
    cpuPercent: doublePrecision('cpu_percent'),
    ramUsedMb: integer('ram_used_mb'),
    diskUsedMb: integer('disk_used_mb'),
    pingMs: integer('ping_ms'),
    playersOnline: integer('players_online'),
    playersMax: integer('players_max'),
    /** `bigint`: Der Zähler läuft seit dem Serverstart und überschreitet 2 GiB. */
    networkRxBytes: bigint('network_rx_bytes', { mode: 'number' }),
    networkTxBytes: bigint('network_tx_bytes', { mode: 'number' }),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.recordedAt] }),
    /** Trägt beide Abfragen: Verlauf eines Servers und das Wegräumen nach Frist. */
    index('server_stats_samples_recorded_idx').on(table.recordedAt),
  ],
);

export type GameServerRow = typeof gameServers.$inferSelect;
export type NewGameServerRow = typeof gameServers.$inferInsert;
export type ServerMemberRow = typeof serverMembers.$inferSelect;
export type NewServerMemberRow = typeof serverMembers.$inferInsert;
export type ServerStatsSampleRow = typeof serverStatsSamples.$inferSelect;
export type NewServerStatsSampleRow = typeof serverStatsSamples.$inferInsert;
