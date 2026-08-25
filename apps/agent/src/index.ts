import { env } from './config/env.js';

/**
 * Einstiegspunkt des Homeserver-Agents.
 *
 * Im Grundgerüst wird hier nur die Konfiguration geladen und der Prozess
 * sauber beendet bzw. offen gehalten. Die eigentliche Logik entsteht in den
 * Arbeitspaketen aus STRUKTUR.md:
 *   - A1 Core-Verbindung  → src/connection
 *   - A2 Container-Runtime → src/runtime
 *   - A3 Jobs & Scheduler  → src/jobs
 */
function main(): void {
  console.info('[agent] Grundgerüst gestartet', {
    nodeEnv: env.NODE_ENV,
    backendWsUrl: env.AGENT_BACKEND_WS_URL,
    tokenKonfiguriert: Boolean(env.AGENT_TOKEN),
  });

  if (!env.AGENT_TOKEN) {
    console.warn('[agent] AGENT_TOKEN ist nicht gesetzt – Verbindung zum Backend nicht möglich.');
  }

  const shutdown = (signal: string): void => {
    console.info(`[agent] Beende auf ${signal}`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
