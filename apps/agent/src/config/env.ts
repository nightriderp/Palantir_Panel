import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Der Agent liest dieselbe zentrale `.env` wie das Backend (Pflichtenheft
 * §12.1), aber nur die für ihn relevanten Variablen.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** WebSocket-Endpunkt des Backends, erreichbar über den WireGuard-Tunnel. */
  AGENT_BACKEND_WS_URL: z.string().url().default('ws://10.10.0.1:4000/agent'),
  /** Pre-Shared-Token zur Authentifizierung des Agents (Pflichtenheft §2.2). */
  AGENT_TOKEN: z.string().min(1).optional(),
  /** Docker-Socket-Proxy – der Agent spricht nie direkt mit dem Docker-Socket. */
  DOCKER_SOCKET_PROXY_URL: z.string().url().default('http://127.0.0.1:2375'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Ungültige Umgebungskonfiguration für den Agent:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
