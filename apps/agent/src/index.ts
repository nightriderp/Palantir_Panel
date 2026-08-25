import { createAgentConnection, createUnavailableRuntimePort } from './connection/index.js';
import { env } from './config/env.js';

/**
 * Einstiegspunkt des Homeserver-Agents.
 *
 * Mit A1 (Core-Verbindung) hält der Agent hier die persistente, ausgehende
 * WebSocket-Verbindung zum Backend offen (Pflichtenheft §2.2). Die weiteren
 * Arbeitspakete hängen sich daran:
 *   - A2 Container-Runtime → src/runtime  (ersetzt den Platzhalter-Port unten)
 *   - A3 Jobs & Scheduler  → src/jobs     (meldet Ereignisse über sendEvent)
 */
function main(): void {
  console.info('[agent] Start', {
    nodeEnv: env.NODE_ENV,
    backendWsUrl: env.AGENT_BACKEND_WS_URL,
    tokenKonfiguriert: Boolean(env.AGENT_TOKEN),
  });

  if (!env.AGENT_TOKEN) {
    // Kein Verbindungsversuch ohne Pre-Shared-Token – auch nicht "vorläufig"
    // (Pflichtenheft §2.2, CLAUDE.md §2).
    console.error(
      '[agent] AGENT_TOKEN ist nicht gesetzt – ohne Pre-Shared-Token wird keine Verbindung aufgebaut. Wert in der zentralen .env im Repo-Root ergänzen.',
    );
    process.exitCode = 1;
    return;
  }

  const connection = createAgentConnection({
    backendWsUrl: env.AGENT_BACKEND_WS_URL,
    token: env.AGENT_TOKEN,
    agentVersion: AGENT_VERSION,
    // Platzhalter, bis A2 die Container-Runtime anbindet: Befehle werden ehrlich
    // mit einem Fehler beantwortet, statt Erfolg vorzutäuschen.
    runtime: createUnavailableRuntimePort(),
  });

  connection.start();

  const shutdown = (signal: string): void => {
    console.info(`[agent] Beende auf ${signal}`);
    connection.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/** Version aus package.json; nur für Diagnose im `hello`-Frame. */
const AGENT_VERSION = '0.1.0';

main();
