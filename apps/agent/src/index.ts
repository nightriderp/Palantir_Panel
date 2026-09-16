import {
  AgentConnection,
  ContainerRuntimeAdapter,
  createNodeStatsReader,
  createWebSocketTransportFactory,
  startRuntimeLink,
} from './connection/index.js';
import path from 'node:path';
import { createAgentJobs } from './jobs/index.js';
import { QuiesceMarker } from './jobs/backup/quiesce-marker.js';
import { createContainerRuntimeFromEnv } from './runtime/index.js';
import { env } from './config/env.js';
import { AGENT_VERSION } from './version.js';

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
    // (Pflichtenheft §2.2, Entwicklungsregeln §2).
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

  /*
   * Merkzettel offener Schreibstopps (HM-10). Er liegt im Ablageordner des
   * Agents und nicht im Datenordner eines Servers: Dort waere er ueber den
   * Datei-Manager sichtbar und loeschbar und wanderte in jede Sicherung.
   */
  const quiesceMarker = new QuiesceMarker(path.join(env.AGENT_BACKUP_DIR, '.schreibstopp'));

  const adapter = new ContainerRuntimeAdapter({ runtime, jobs, quiesceMarker });

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

  // Verbindet die Runtime und hängt den Adapter an - mit Wiederholung, falls
  // der Docker-Socket-Proxy beim Start noch nicht antwortet (Audit
  // agent-conn-01). Ohne sie bliebe der Agent dauerhaft ohne Ereignisstrom.
  const runtimeLink = startRuntimeLink({
    runtime,
    adapter,
    emit: (event) => connection.sendEvent(event),
  });

  halter.verbindung = connection;

  /*
   * Vor der ersten Verbindung: Ein Merkzettel, der einen Prozessstart ueberlebt
   * hat, gehoert zu einer Sicherung, die mitten im Schreibstopp abgerissen ist
   * (HM-10). Der Spielserver laeuft dann weiter, nimmt Spieler an und schreibt
   * nichts mehr auf die Platte - beim naechsten Absturz waere alles seit der
   * Sicherung weg.
   *
   * Der Start haengt nicht daran: Was nicht gelingt, bleibt liegen und wird beim
   * naechsten Mal erneut versucht.
   */
  void adapter
    .offeneSchreibstoppsAufheben()
    .then((anzahl) => {
      if (anzahl > 0) {
        console.warn('[agent] Offene Schreibstopps aufgehoben', { anzahl });
      }
    })
    .catch((fehler: unknown) => {
      console.warn('[agent] Offene Schreibstopps konnten nicht aufgehoben werden', {
        fehler: fehler instanceof Error ? fehler.message : String(fehler),
      });
    });

  connection.start();

  let beendet = false;

  const shutdown = (grund: string, exitCode = 0): void => {
    // Nur einmal: Eine Ausnahme während des Beendens oder ein zweites Signal
    // darf den Ablauf nicht erneut anstoßen.
    if (beendet) {
      return;
    }

    beendet = true;
    console.info(`[agent] Beende auf ${grund}`);
    jobs.stop();
    runtimeLink.stop();
    adapter.stop();
    connection.stop();
    void runtime
      .dispose()
      .catch((fehler: unknown) => {
        console.error('[agent] Container-Runtime konnte nicht sauber getrennt werden', {
          fehler: fehler instanceof Error ? fehler.message : String(fehler),
        });
      })
      .finally(() => process.exit(exitCode));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Prozess-Wächter (Audit W0-5, Fundpunkt 126): Node beendet den Prozess bei
  // der ersten unbehandelten Promise-Ablehnung. Der Agent loggt sie und läuft
  // weiter – die Container auf der Node brauchen weiter jemanden, der sie
  // meldet. Eine unbehandelte Ausnahme hinterlässt dagegen einen unbekannten
  // Zustand: loggen, geordnet beenden, Neustart dem Container-Betrieb überlassen.
  process.on('unhandledRejection', (grund: unknown) => {
    console.error('[agent] Unbehandelte Promise-Ablehnung – der Agent läuft weiter', {
      fehler: grund instanceof Error ? grund.message : String(grund),
      stack: grund instanceof Error ? grund.stack : undefined,
    });
  });
  process.on('uncaughtException', (fehler: Error) => {
    console.error('[agent] Unbehandelte Ausnahme – der Agent wird beendet', {
      fehler: fehler.message,
      stack: fehler.stack,
    });
    shutdown('uncaughtException', 1);
  });
}

main();
