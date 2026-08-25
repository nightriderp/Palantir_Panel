import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

/**
 * Konfiguration für Drizzle Kit (Migrationen erzeugen und prüfen).
 *
 * Die Datei liegt bewusst außerhalb von `src/`: Drizzle Kit lädt sie selbst und
 * sie gehört nicht in das Build-Ergebnis des Backends.
 *
 * `DATABASE_URL` kommt aus der zentralen `.env` im Repo-Root
 * (Pflichtenheft §12.1) – dieselbe Datei, die auch das Backend liest.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL ist nicht gesetzt. Bitte die zentrale .env im Repo-Root ausfüllen (siehe .env.example und SETUP.md §2).',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: databaseUrl },
  // Warnt vor Datenverlust, statt ihn stillschweigend zu erzeugen.
  strict: true,
  verbose: true,
});
