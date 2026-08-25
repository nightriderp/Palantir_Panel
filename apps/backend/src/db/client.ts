import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema.js';

/**
 * Datenbank-Client (Drizzle ORM über `pg`, Pflichtenheft §3).
 *
 * Pool und Drizzle-Instanz werden erst beim ersten Zugriff erzeugt. Damit
 * startet das Backend (und laufen die bestehenden Tests) auch ohne gesetzte
 * `DATABASE_URL` – geprüft wird erst, wenn die Datenbank tatsächlich gebraucht
 * wird. Sobald das erste Arbeitspaket die Datenbank am Request-Pfad benötigt,
 * kann `DATABASE_URL` in `config/env.ts` auf Pflicht hochgestuft werden.
 */

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let database: Database | undefined;

/** Liefert `DATABASE_URL` oder bricht mit einer verständlichen Meldung ab. */
export function requireDatabaseUrl(): string {
  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL ist nicht gesetzt. Bitte die zentrale .env im Repo-Root ausfüllen (siehe .env.example und SETUP.md §2).',
    );
  }

  return env.DATABASE_URL;
}

/** Verbindungspool zur Datenbank (einmalig erzeugt). */
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: requireDatabaseUrl() });

  return pool;
}

/** Drizzle-Instanz für alle Backend-Module. */
export function getDb(): Database {
  database ??= drizzle(getPool(), { schema });

  return database;
}

/** Verbindungen schließen – für Shutdown und Tests. */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    database = undefined;
  }
}
