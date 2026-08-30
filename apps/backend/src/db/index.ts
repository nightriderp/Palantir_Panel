/**
 * Datenbank-Zugang des Backends (Drizzle ORM, Pflichtenheft §3).
 *
 * Module holen sich die Drizzle-Instanz über `getDb()` und definieren ihre
 * Tabellen in `schema.ts` – kein eigener Pool je Modul.
 */

export {
  type Database,
  type DbConnection,
  type Transaction,
  closeDb,
  getDb,
  getPool,
  requireDatabaseUrl,
} from './client.js';
export * as schema from './schema.js';
