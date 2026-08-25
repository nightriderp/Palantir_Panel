import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from './client.js';

/**
 * Wendet alle noch nicht angewendeten Migrationen an
 * (`pnpm --filter @palantir/backend db:migrate`).
 *
 * Schema-Änderungen laufen ausschließlich über diesen Weg – nie manuell an der
 * laufenden Datenbank (CLAUDE.md §4).
 *
 * Das Skript läuft über `tsx` direkt gegen `src/`, damit es unabhängig vom
 * Build-Ergebnis auch beim allerersten Deployment funktioniert.
 */
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

async function main(): Promise<void> {
  console.log(`Migrationen werden angewendet aus: ${migrationsFolder}`);
  await migrate(getDb(), { migrationsFolder });
  console.log('Migrationen erfolgreich angewendet.');
}

try {
  await main();
} catch (error: unknown) {
  console.error('Migration fehlgeschlagen:', error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
