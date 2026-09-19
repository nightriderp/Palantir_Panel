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
import { startLebenszeichen } from './lebenszeichen.js';
import { fehlerFeld, log } from './log.js';

/**
 * So lange dürfen laufende Befehle und Jobs beim Herunterfahren noch zu Ende
 * kommen (Review 2026-09-16, Befund 11.6). Unter der `stop_grace_period` des
 * Agent-Containers (20 s in `deploy/gamenode/docker-compose.yml`) – sonst
 * käme Dockers SIGKILL vor unserem Ende.
 */
const SHUTDOWN_FRIST_MS = 15_000;

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
  log.info(
    {
      nodeEnv: env.NODE_ENV,
      backendWsUrl: env.AGENT_BACKEND_WS_URL,
      tokenKonfiguriert: Boolean(env.AGENT_TOKEN),
      version: AGENT_VERSION,
    },
    'Start',
  );

  if (!env.AGENT_TOKEN) {
    // Kein Verbindungsversuch ohne Pre-Shared-Token – auch nicht "vorläufig"
    // (Pflichtenheft §2.2, Entwicklungsregeln §2).
    log.error(
      'AGENT_TOKEN ist nicht gesetzt – ohne Pre-Shared-Token wird keine Verbindung aufgebaut. Wert in der zentralen .env im Repo-Root ergänzen.',
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
      log.warn({ job: jobName, ...fehlerFeld(fehler) }, 'Job fehlgeschlagen');
    },
  });

  /*
   * Merkzettel offener Schreibstopps (HM-10). Er liegt im Ablageordner des
   * Agents und nicht im Datenordner eines Servers: Dort waere er ueber den
   * Datei-Manager sichtbar und loeschbar und wanderte in jede Sicherung.
   */
  const quiesceMarker = new QuiesceMarker(path.join(env.AGENT_BACKUP_DIR, '.schreibstopp'));

  const adapter = new ContainerRuntimeAdapter({
    runtime,
    jobs,
    quiesceMarker,
    statsTakt: {
      minIntervalMs: env.AGENT_STATS_MIN_INTERVAL_MS,
      maxIntervalMs: env.AGENT_STATS_MAX_INTERVAL_MS,
    },
  });

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
        log.warn({ anzahl }, 'Offene Schreibstopps aufgehoben');
      }
    })
    .catch((fehler: unknown) => {
      log.warn(fehlerFeld(fehler), 'Offene Schreibstopps konnten nicht aufgehoben werden');
    });

  connection.start();

  // Lebenszeichen für den Docker-Healthcheck (Review 2026-09-16, Befund 8.3):
  // nur die Ereignisschleife, nicht die Verbindung – siehe `lebenszeichen.ts`.
  const lebenszeichen = startLebenszeichen({
    zustand: () => (connection.isReady ? 'verbunden' : 'getrennt'),
    onError: (fehler) => {
      log.warn(fehlerFeld(fehler), 'Lebenszeichen konnte nicht geschrieben werden');
    },
  });

  let beendet = false;

  /**
   * Geordnetes Ende (Befund 11.6): erst keine neuen Befehle mehr annehmen und
   * die laufenden – Sicherungen, Uploads, Welt-Importe – zu Ende bringen, dann
   * Verbindung und Runtime schließen. Vorher riss `stop()` sofort alles ab,
   * und ein halbes Archiv blieb liegen. Ein zweites Signal beendet sofort.
   */
  const shutdown = (grund: string, exitCode = 0): void => {
    if (beendet) {
      log.warn({ grund }, 'Zweites Signal – sofortiges Ende');
      process.exit(exitCode === 0 ? 130 : exitCode);
    }

    beendet = true;
    log.info({ grund, fristMs: SHUTDOWN_FRIST_MS }, 'Beende – laufende Aufträge werden abgewartet');
    lebenszeichen.stop();

    void (async () => {
      let frist: ReturnType<typeof setTimeout> | undefined;
      const ergebnis = await Promise.race([
        Promise.all([jobs.drain(), connection.drain(SHUTDOWN_FRIST_MS)]).then(
          ([, verbindung]) => verbindung,
        ),
        new Promise<'frist'>((weiter) => {
          frist = setTimeout(() => weiter('frist'), SHUTDOWN_FRIST_MS);
        }),
      ]);
      if (frist !== undefined) clearTimeout(frist);

      if (ergebnis === 'frist') {
        log.warn(
          { fristMs: SHUTDOWN_FRIST_MS },
          'Frist verstrichen – laufende Aufträge abgebrochen',
        );
      } else if (ergebnis.offen > 0) {
        log.warn(
          { offen: ergebnis.offen },
          'Befehle nicht zu Ende gekommen – Verbindung wird geschlossen',
        );
      }

      runtimeLink.stop();
      adapter.stop();
      connection.stop();

      try {
        await runtime.dispose();
      } catch (fehler: unknown) {
        log.error(fehlerFeld(fehler), 'Container-Runtime konnte nicht sauber getrennt werden');
      }

      process.exit(exitCode);
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Prozess-Wächter (Audit W0-5, Fundpunkt 126): Node beendet den Prozess bei
  // der ersten unbehandelten Promise-Ablehnung. Der Agent loggt sie und läuft
  // weiter – die Container auf der Node brauchen weiter jemanden, der sie
  // meldet. Eine unbehandelte Ausnahme hinterlässt dagegen einen unbekannten
  // Zustand: loggen, geordnet beenden, Neustart dem Container-Betrieb überlassen.
  process.on('unhandledRejection', (grund: unknown) => {
    log.error(fehlerFeld(grund), 'Unbehandelte Promise-Ablehnung – der Agent läuft weiter');
  });
  process.on('uncaughtException', (fehler: Error) => {
    log.error(fehlerFeld(fehler), 'Unbehandelte Ausnahme – der Agent wird beendet');
    shutdown('uncaughtException', 1);
  });
}

main();
