import {
  AgentConnection,
  ContainerRuntimeAdapter,
  createNodeStatsReader,
  createWebSocketTransportFactory,
} from './connection/index.js';
import { createAgentJobs } from './jobs/index.js';
import { createContainerRuntimeFromEnv } from './runtime/index.js';
import { env } from './config/env.js';

/**
 * Einstiegspunkt des Homeserver-Agents.
 *
 * Hier werden die Arbeitspakete zusammengesteckt:
 *   - A1 Core-Verbindung   → src/connection (persistente, ausgehende Verbindung)
 *   - A2 Container-Runtime → src/runtime    (Docker über den Socket-Proxy)
 *   - A3 Jobs & Scheduler  → src/jobs       (Abfrage, Backups, Speicher)
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

  // Ringschluss: Die Jobs (A3) brauchen die Ereignis-Senke der Verbindung, die
  // Verbindung braucht den Adapter, und der Adapter braucht die Jobs. Der
  // Halter löst ihn auf, ohne dass eine der drei Seiten die andere schon im
  // Konstruktor haben muss – gesendet wird erst, wenn alles steht. Der Adapter
  // (A2) bekommt seine Senke aus demselben Grund erst bei start().
  const halter: { verbindung?: AgentConnection } = {};
  const jobs = createAgentJobs(env, {
    runtime,
    emit: (event) => halter.verbindung?.sendEvent(event),
    onJobError: (jobName, fehler) => {
      console.warn('[agent] Job fehlgeschlagen', {
        job: jobName,
        fehler: fehler instanceof Error ? fehler.message : String(fehler),
      });
    },
  });

  const adapter = new ContainerRuntimeAdapter({ runtime, jobs });

  const connection = new AgentConnection({
    transportFactory: createWebSocketTransportFactory({
      url: env.AGENT_BACKEND_WS_URL,
      token: env.AGENT_TOKEN,
    }),
    agentVersion: AGENT_VERSION,
    ...(env.AGENT_NODE_ID === undefined ? {} : { nodeId: env.AGENT_NODE_ID }),
    runtime: adapter,
    // Gemessene Node-Ressourcen vom Dateisystem der Server-Datenordner
    // (Pflichtenheft §11). Begleiten jeden Ist-Zustands-Bericht.
    readNodeStats: createNodeStatsReader(env.AGENT_DATA_DIR),
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

  halter.verbindung = connection;
  connection.start();

  const shutdown = (signal: string): void => {
    console.info(`[agent] Beende auf ${signal}`);
    jobs.stop();
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
