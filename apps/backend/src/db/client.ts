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

/**
 * Der an einen `db.transaction(...)`-Callback übergebene Handle.
 *
 * Aus {@link Database} abgeleitet, damit keine Drizzle-internen Typen importiert
 * werden müssen. Repository-Fabriken nehmen {@link DbConnection}, sodass dieselbe
 * Abfrage einmal gegen den Pool und einmal innerhalb einer Transaktion laufen
 * kann – gebraucht für die serialisierte Kapazitätsprüfung (Pflichtenheft §10).
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Datenbank-Pool oder eine laufende Transaktion – für Repository-Fabriken. */
export type DbConnection = Database | Transaction;

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

/** Was der Pool zum Melden braucht – `app.log`, `console` oder eine Attrappe. */
export interface PoolErrorLogger {
  error(details: Record<string, unknown>, message: string): void;
}

/**
 * Registriert den `error`-Listener am Pool (Audit W0-5, backend-db-01).
 *
 * `pg.Pool` meldet Fehler wartender (idle) Verbindungen – etwa wenn PostgreSQL
 * neu startet, während gerade keine Abfrage läuft – als `error`-Ereignis am
 * Pool. Ohne Listener wirft Node eine solche Emission als unbehandelte
 * Ausnahme und beendet das Backend, obwohl die nächste Abfrage schlicht eine
 * neue Verbindung öffnen würde. Der Listener loggt; der Pool verwirft die
 * Verbindung selbst.
 */
export function attachPoolErrorHandler(
  pool: { on(event: 'error', listener: (error: Error) => void): unknown },
  log: PoolErrorLogger,
): void {
  pool.on('error', (error) => {
    log.error(
      { error: error.message },
      'Datenbank-Pool: Fehler an einer wartenden Verbindung – die Verbindung wird verworfen',
    );
  });
}

/**
 * Der Pool entsteht beim ersten Zugriff aus einem Modul heraus, das keinen
 * Fastify-Logger kennt; gemeldet wird deshalb über `console` – wie bei den
 * Datenbank-Skripten in diesem Verzeichnis.
 */
const poolLogger: PoolErrorLogger = {
  error(details, message) {
    console.error(message, details);
  },
};

/** Verbindungspool zur Datenbank (einmalig erzeugt). */
export function getPool(): pg.Pool {
  if (pool === undefined) {
    pool = new pg.Pool({ connectionString: requireDatabaseUrl() });
    attachPoolErrorHandler(pool, poolLogger);
  }

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
