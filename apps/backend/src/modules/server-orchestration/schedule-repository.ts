/**
 * Datenzugriff der geplanten Aufgaben (Pflichtenheft §6, Entität `Schedule`;
 * Lastenheft §3.3, Reiter „Aufgaben").
 *
 * Gelesen und geschrieben wird die **bestehende** Tabelle `schedules` aus
 * `db/schema/backups.ts`. Sie ist von Anfang an allgemein angelegt; der
 * Backup-Zeitplan (B5) ist nur die Zeile mit `action = 'backup'`. Eine zweite
 * Zeitplan-Tabelle daneben wäre genau die parallele Struktur, die CLAUDE.md §3
 * ausschließt – und der Zeitgeber müsste zwei Fälligkeitsabfragen führen.
 *
 * Die Abgrenzung läuft deshalb über die Aktion: Dieses Repository sieht
 * ausschließlich `restart` und `command`, B5 ausschließlich `backup`. Keine der
 * beiden Seiten fasst die Zeilen der anderen an.
 */

import { type ScheduleAction, type ScheduleRunResult } from '@palantir/contracts';
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { schedules } from '../../db/schema.js';

/** Aktionen, die dieses Modul verwaltet – `backup` gehört B5. */
export const SERVER_SCHEDULE_ACTIONS = ['restart', 'command'] as const;

export type ServerScheduleAction = (typeof SERVER_SCHEDULE_ACTIONS)[number];

export function isServerScheduleAction(action: ScheduleAction): action is ServerScheduleAction {
  return (SERVER_SCHEDULE_ACTIONS as readonly ScheduleAction[]).includes(action);
}

/** Eine geplante Aufgabe, wie der Dienst sie braucht. */
export interface ServerScheduleRecord {
  readonly id: string;
  readonly serverId: string;
  /** `null` bei Zeilen ohne eigenen Namen (Backup-Zeitplan aus B5). */
  readonly name: string | null;
  readonly action: ServerScheduleAction;
  /** Konsolenbefehl bei `action === 'command'`; sonst `null`. */
  readonly command: string | null;
  readonly cronExpression: string;
  /** `null` bedeutet „lokale Zeit des Backends". */
  readonly timezone: string | null;
  readonly enabled: boolean;
  readonly lastRunAt: Date | null;
  readonly lastRunResult: ScheduleRunResult | null;
  readonly nextRunAt: Date | null;
}

export interface CreateServerScheduleData {
  readonly serverId: string;
  readonly name: string;
  readonly action: ServerScheduleAction;
  readonly command: string | null;
  readonly cronExpression: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly nextRunAt: Date | null;
}

export type UpdateServerScheduleData = Omit<CreateServerScheduleData, 'serverId'>;

export interface ServerScheduleRepository {
  listByServer(serverId: string): Promise<readonly ServerScheduleRecord[]>;
  findById(scheduleId: string): Promise<ServerScheduleRecord | null>;
  create(data: CreateServerScheduleData): Promise<ServerScheduleRecord>;
  update(scheduleId: string, data: UpdateServerScheduleData): Promise<ServerScheduleRecord>;
  remove(scheduleId: string): Promise<void>;
  /** Aufgaben, deren nächster Lauf erreicht ist – aufsteigend nach Fälligkeit. */
  listDue(now: Date): Promise<readonly ServerScheduleRecord[]>;
  /**
   * Schreibt den Lauf fort, **bevor** die Aktion ausgeführt wird.
   *
   * Genauso wie beim Backup-Zeitplan (B5): Sonst bliebe eine Aufgabe, deren
   * Ausführung scheitert, dauerhaft fällig und löste in jedem Durchlauf erneut
   * aus.
   */
  markRun(scheduleId: string, lastRunAt: Date, nextRunAt: Date | null): Promise<void>;
  /** Trägt den Ausgang nach – erst danach steht `lastRunResult` im DTO. */
  markResult(scheduleId: string, result: ScheduleRunResult): Promise<void>;
}

type ScheduleRow = typeof schedules.$inferSelect;

/** Der Konsolenbefehl steht in `payload` – die Spalte trägt die Nutzdaten je Aktion. */
function commandOf(payload: Record<string, unknown>): string | null {
  const command = payload['command'];

  return typeof command === 'string' ? command : null;
}

function toRecord(row: ScheduleRow): ServerScheduleRecord {
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    // Die Abfragen filtern auf `SERVER_SCHEDULE_ACTIONS`; die Zusicherung
    // bildet nur ab, was die Datenbank schon garantiert hat.
    action: row.action as ServerScheduleAction,
    command: commandOf(row.payload),
    cronExpression: row.cronExpression,
    timezone: row.timezone,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    lastRunResult: row.lastRunResult,
    nextRunAt: row.nextRunAt,
  };
}

function payloadFor(data: UpdateServerScheduleData): Record<string, unknown> {
  return data.command === null ? {} : { command: data.command };
}

export function createDrizzleServerScheduleRepository(db: DbConnection): ServerScheduleRepository {
  const nurEigeneAktionen = inArray(schedules.action, [...SERVER_SCHEDULE_ACTIONS]);

  return {
    async listByServer(serverId) {
      const rows = await db
        .select()
        .from(schedules)
        .where(and(eq(schedules.serverId, serverId), nurEigeneAktionen))
        .orderBy(asc(schedules.createdAt));

      return rows.map(toRecord);
    },

    async findById(scheduleId) {
      const rows = await db
        .select()
        .from(schedules)
        .where(and(eq(schedules.id, scheduleId), nurEigeneAktionen))
        .limit(1);

      const row = rows[0];

      return row === undefined ? null : toRecord(row);
    },

    async create(data) {
      const [row] = await db
        .insert(schedules)
        .values({
          serverId: data.serverId,
          name: data.name,
          action: data.action,
          cronExpression: data.cronExpression,
          timezone: data.timezone,
          payload: payloadFor(data),
          enabled: data.enabled,
          nextRunAt: data.nextRunAt,
        })
        .returning();

      if (row === undefined) {
        throw new Error('Die geplante Aufgabe konnte nicht angelegt werden.');
      }

      return toRecord(row);
    },

    async update(scheduleId, data) {
      const [row] = await db
        .update(schedules)
        .set({
          name: data.name,
          action: data.action,
          cronExpression: data.cronExpression,
          timezone: data.timezone,
          payload: payloadFor(data),
          enabled: data.enabled,
          nextRunAt: data.nextRunAt,
          updatedAt: new Date(),
        })
        .where(and(eq(schedules.id, scheduleId), nurEigeneAktionen))
        .returning();

      if (row === undefined) {
        throw new Error(`Die geplante Aufgabe ${scheduleId} existiert nicht mehr.`);
      }

      return toRecord(row);
    },

    async remove(scheduleId) {
      await db.delete(schedules).where(and(eq(schedules.id, scheduleId), nurEigeneAktionen));
    },

    async listDue(now) {
      const rows = await db
        .select()
        .from(schedules)
        .where(
          and(
            nurEigeneAktionen,
            eq(schedules.enabled, true),
            isNotNull(schedules.nextRunAt),
            lte(schedules.nextRunAt, now),
          ),
        )
        .orderBy(asc(schedules.nextRunAt));

      return rows.map(toRecord);
    },

    async markRun(scheduleId, lastRunAt, nextRunAt) {
      await db
        .update(schedules)
        .set({ lastRunAt, nextRunAt, lastRunResult: null, updatedAt: new Date() })
        .where(eq(schedules.id, scheduleId));
    },

    async markResult(scheduleId, result) {
      await db
        .update(schedules)
        .set({ lastRunResult: result, updatedAt: new Date() })
        .where(eq(schedules.id, scheduleId));
    },
  };
}
