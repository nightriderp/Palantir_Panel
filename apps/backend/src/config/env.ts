import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Zentrale `.env` im Repo-Root (Pflichtenheft §12.1): dieselbe Datei wird auf
 * VPS und Homeserver eingesetzt, jede Komponente liest nur die für sie
 * relevanten Variablen. Hier werden daher ausschließlich die Variablen
 * geprüft, die das Backend zum Start benötigt.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_HOST: z.string().default('0.0.0.0'),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Verbindungs-URL für PostgreSQL (Pflichtenheft §3, .env.example Abschnitt 3).
   *
   * Bewusst optional: das Backend startet aktuell noch ohne Datenbank, weil
   * noch kein fachliches Modul sie am Request-Pfad braucht. Der Datenbank-
   * Client (`src/db/client.ts`) bricht beim ersten Zugriff mit einer
   * verständlichen Meldung ab, wenn der Wert fehlt. Sobald das erste Modul
   * die Datenbank benötigt, wird der Wert hier auf Pflicht hochgestuft.
   */
  DATABASE_URL: z.string().min(1).optional(),

  /**
   * Schwellwerte der Ressourcen-Warnungen (Pflichtenheft §10, Event
   * `resource.low`; .env.example Abschnitt 13).
   *
   * `RESOURCE_WARN_NODE_PERCENT` misst die Auslastung der Ziel-VM,
   * `RESOURCE_WARN_SERVER_PERCENT` den Verbrauch eines einzelnen Servers gegen
   * sein eigenes Limit. Beide bewusst getrennt: eine Node darf länger gut
   * gefüllt laufen, ein einzelner Server nahe an seinem RAM-Limit ist dagegen
   * kurz vor dem Absturz.
   */
  RESOURCE_WARN_NODE_PERCENT: z.coerce.number().min(1).max(100).default(85),
  RESOURCE_WARN_SERVER_PERCENT: z.coerce.number().min(1).max(100).default(90),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Ungültige Umgebungskonfiguration für das Backend:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
