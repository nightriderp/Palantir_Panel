import {
  AgentConnection,
  ContainerRuntimeAdapter,
  createWebSocketTransportFactory,
} from './connection/index.js';
import { createContainerRuntimeFromEnv } from './runtime/index.js';
import { env } from './config/env.js';

/**
 * Einstiegspunkt des Homeserver-Agents.
 *
 * Hier werden die Arbeitspakete zusammengesteckt:
 *   - A1 Core-Verbindung   → src/connection (persistente, ausgehende Verbindung)
 *   - A2 Container-Runtime → src/runtime    (Docker über den Socket-Proxy)
 *   - A3 Jobs & Scheduler  → src/jobs       (noch offen)
 *
 * Der Adapter dazwischen übersetzt Protokoll-Befehle auf Runtime-Aufrufe und
 * Runtime-Ereignisse zurück ins Protokoll.
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

  const runtime = createContainerRuntimeFromEnv(env);

  // Adapter und Verbindung brauchen einander gegenseitig. Der Adapter bekommt
  // die Ereignis-Senke deshalb erst bei start() – so kommt beides ohne
  // Zwischenvariable aus.
  const adapter = new ContainerRuntimeAdapter({ runtime });

  const connection = new AgentConnection({
    transportFactory: createWebSocketTransportFactory({
      url: env.AGENT_BACKEND_WS_URL,
      token: env.AGENT_TOKEN,
    }),
    agentVersion: AGENT_VERSION,
    runtime: adapter,
  });

  void runtime
    .connect()
    .then(() => {
      adapter.start((event) => connection.sendEvent(event));
      console.info('[agent] Container-Runtime verbunden');
    })
    .catch((fehler: unknown) => {
      // Kein Abbruch: Der Agent hält die Backend-Verbindung offen und beantwortet
      // Befehle ehrlich mit AGENT_RUNTIME_UNAVAILABLE, statt stumm zu bleiben.
      console.error('[agent] Container-Runtime nicht erreichbar', {
        fehler: fehler instanceof Error ? fehler.message : String(fehler),
      });
    });

  connection.start();

  const shutdown = (signal: string): void => {
    console.info(`[agent] Beende auf ${signal}`);
    adapter.stop();
    connection.stop();
    void runtime.dispose().finally(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/** Version aus package.json; nur für Diagnose im `hello`-Frame. */
const AGENT_VERSION = '0.1.0';

main();
