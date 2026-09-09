/**
 * Arbeitspaket A3 – Jobs & Scheduler.
 *
 * Öffentliche Fläche des Job-Moduls. Was hier drin liegt, ist alles, was der
 * Agent **selbst** tut, statt nur einen Container anzufassen:
 *
 *  - `scheduler.ts` – der Taktgeber für alles Wiederkehrende
 *  - `query/` – Erreichbarkeits- und Spielerabfrage (Pflichtenheft §9)
 *  - `backup/` – `CREATE_BACKUP`, `RESTORE_BACKUP`, `DOWNLOAD_BACKUP`,
 *    `DELETE_BACKUP` auf Dateiebene (Lastenheft §3.3)
 *  - `storage/` – `GET_STORAGE_BREAKDOWN` und `REMOVE_STORAGE_ENTRY`
 *    (Lastenheft §3.8, Pflichtenheft §16) sowie der belegte Plattenplatz je
 *    Server (`ServerDiskUsage`, Fundpunkt 168)
 *  - `files/` – `FILE_DELETE` host-seitig über den Datenordner und
 *    `UPLOAD_ARCHIVE_BLOCK`, das ein Archiv blockweise zusammensetzt
 *    (Lastenheft §3.3)
 *  - `router/` – die Routen-Dateien des Hostname-Routers, eine je Server mit
 *    `supportsVirtualHostRouting` (Pflichtenheft §2.4, §13)
 *
 * **Was hier bewusst nicht liegt.** Die Entscheidungen des Lifecycles gehören
 * ins Backend und sind dort fertig und geprüft: der Übergang
 * `starting → running` nach bestandenem Health-Check, der Crash-Loop-Schutz mit
 * begrenzten Neustarts im Zeitfenster und die Auto-Shutdown-Regel samt
 * Schonfrist – einschließlich des Sonderfalls, dass ein automatischer Neustart
 * nach einem Absturz als regulärer Start zählt und die Schonfrist neu setzt
 * (`state-machine.ts`, `crash-loop.ts`, `auto-shutdown.ts` in
 * `apps/backend/src/modules/server-orchestration`). `auto-shutdown.ts` zieht
 * dieselbe Grenze von der anderen Seite: „Die eigentliche Abfrage macht der
 * Agent (A3); hier steht ausschließlich die Entscheidung."
 *
 * Diese Aufteilung ist kein Zuschnitt aus Bequemlichkeit, sondern folgt
 * CLAUDE.md §3 und §4: Die Regel gehört an eine Stelle und muss ohne laufenden
 * Homeserver prüfbar sein; die Messung gehört dorthin, wo sie überhaupt möglich
 * ist. Der Agent liefert deshalb die Zahlen, die das Backend nicht selbst
 * erheben kann, und entscheidet nichts.
 */

import type { OutboundEvent } from '../connection/ports.js';
import type { ContainerRuntime } from '../runtime/index.js';
import type { RconClient } from '../runtime/rcon.js';
import { BackupJob, DEFAULT_DOWNLOAD_BLOCK_MAX_BYTES } from './backup/backup-job.js';
import { ArchiveUploadJob, DEFAULT_ARCHIVE_UPLOAD_MAX_BYTES } from './files/archive-upload.js';
import { RconConsole } from './console/rcon-console.js';
import { ServerFileJob } from './files/delete.js';
import { DEFAULT_ROUTER_LISTEN_PORT, HostnameRouterJob } from './router/hostname-routes.js';
import { createGamedigProbe } from './query/gamedig-probe.js';
import { createServerProbe, type ServerProbe } from './query/probe.js';
import { ServerQueryJob } from './query/server-query-job.js';
import { JobScheduler, type SchedulerTimers } from './scheduler.js';
import { ServerDiskUsage } from './storage/server-disk-usage.js';
import { StorageScanner } from './storage/storage-scanner.js';

export {
  JobScheduler,
  systemTimers,
  type JobSchedulerOptions,
  type ScheduledJob,
  type SchedulerTimers,
  type TimerHandle,
} from './scheduler.js';

export { createGamedigProbe, type GamedigQuery } from './query/gamedig-probe.js';

export {
  createPortConnectProbe,
  createServerProbe,
  unreachable,
  type ServerProbe,
  type ServerProbeResult,
  type ServerProbeTarget,
  type SocketFactory,
} from './query/probe.js';

export {
  ServerQueryJob,
  queryJobName,
  type ServerQueryJobOptions,
} from './query/server-query-job.js';

export {
  BackupJob,
  DEFAULT_DOWNLOAD_BLOCK_MAX_BYTES,
  type BackupJobOptions,
} from './backup/backup-job.js';

export {
  checksumOfFile,
  packDirectory,
  unpackArchive,
  type PackResult,
  type UnpackResult,
} from './backup/tar-gz.js';

export {
  ARCHIVE_UPLOAD_DIRNAME,
  ARCHIVE_UPLOAD_TTL_MS,
  ArchiveUploadJob,
  DEFAULT_ARCHIVE_UPLOAD_MAX_BYTES,
  type ArchiveUploadJobOptions,
} from './files/archive-upload.js';

export {
  deleteServerFile,
  ServerFileJob,
  type DeleteServerFileOptions,
  type ServerFileJobOptions,
} from './files/delete.js';

export {
  StorageScanner,
  type DiskUsage,
  type StorageScannerOptions,
} from './storage/storage-scanner.js';

export { directorySize, type DirectorySize } from './storage/directory-size.js';

export {
  DEFAULT_DISK_USAGE_TTL_MS,
  ServerDiskUsage,
  type ServerDiskUsageOptions,
} from './storage/server-disk-usage.js';

export {
  DEFAULT_ROUTER_LISTEN_PORT,
  HostnameRouterJob,
  PROXIES_DIRNAME,
  STAGING_DIRNAME,
  VIRTUAL_HOST_HOSTNAME_LABEL,
  VIRTUAL_HOST_TARGET_PORT_LABEL,
  routeFileContent,
  routeFromSpec,
  type HostnameRoute,
  type HostnameRouterJobOptions,
} from './router/hostname-routes.js';

export {
  DEFAULT_RCON_TIMEOUT_MS,
  RconConsole,
  type RconConsoleOptions,
} from './console/rcon-console.js';

export { RconError, rconCommand, type RconClient, type RconRequest } from '../runtime/rcon.js';

export {
  resolveWithinAny,
  resolveWithinDirectory,
  serverIdFromContainerName,
  serverIdFromDirectoryName,
} from './paths.js';

/** Alles, was der Befehls-Adapter (A1) von den Jobs braucht. */
export interface AgentJobs {
  readonly scheduler: JobScheduler;
  readonly query: ServerQueryJob;
  readonly backups: BackupJob;
  readonly storage: StorageScanner;
  /**
   * Belegter Plattenplatz je Server (Fundpunkt 168).
   *
   * Steht neben `storage` und nicht darin: Die Speicherübersicht ist ein
   * node-weiter Befehl auf Abruf, das hier ein Wert je Server mit eigener
   * Frist. Beide benutzen denselben Baumdurchlauf.
   */
  readonly serverDisk: ServerDiskUsage;
  readonly files: ServerFileJob;
  readonly archiveUploads: ArchiveUploadJob;
  /**
   * Routen-Dateien des Hostname-Routers (Pflichtenheft §2.4, §13).
   *
   * Ohne `AGENT_ROUTER_DIR` wirkungslos – eine Installation ohne Router soll
   * daran nicht scheitern.
   */
  readonly router: HostnameRouterJob;
  /**
   * Konsole über RCON (P2-9) – für Spiele, deren Definition einen
   * RCON-Anschluss nennt. Der Befehl geht an den Container im Spielenetz, die
   * Antwort kommt zurück statt nur im Log zu stehen.
   */
  readonly rcon: RconConsole;
  /** Beendet alle laufenden Jobs – beim Herunterfahren des Agents. */
  stop(): void;
}

/** Die Teilmenge der Agent-Konfiguration, die die Jobs brauchen. */
export interface JobsEnv {
  readonly AGENT_DATA_DIR: string;
  readonly AGENT_BACKUP_DIR: string;
  readonly AGENT_QUERY_INTERVAL_SECONDS: number;
  readonly AGENT_QUERY_TIMEOUT_MS: number;
  /**
   * Netz der Spielcontainer – dort fragt der Agent sie ab (Fundpunkt 188).
   * Optional, damit bestehende Testaufbauten mit der Vorgabe weiterlaufen.
   */
  readonly AGENT_CONTAINER_NETWORK?: string;
  /**
   * Nur für Agents auf dem Docker-Host selbst: Adresse, unter der die
   * Host-Ports der Spielcontainer erreichbar sind. Auf einer Node leer.
   */
  readonly AGENT_QUERY_HOST?: string | undefined;
  readonly AGENT_DOWNLOAD_BLOCK_MAX_BYTES: number;
  /**
   * Deckel der blockweisen Archiv-Übernahme (agent-conn-02). Optional, damit
   * bestehende Testaufbauten mit der Vorgabe weiterlaufen.
   */
  readonly AGENT_UPLOAD_ARCHIVE_MAX_BYTES?: number;
  /**
   * Ablage des Hostname-Routers auf der Node. Ohne Wert legt der Agent keine
   * Routen-Dateien an – der Router läuft dann schlicht nicht.
   */
  readonly AGENT_ROUTER_DIR?: string | undefined;
  /**
   * Port, auf dem der Router lauscht. Er steht in jeder Routen-Datei
   * (`listenTo`) und muss zu `frpc.toml` passen.
   */
  readonly MINECRAFT_ROUTER_PORT?: number;
}

export interface CreateAgentJobsOptions {
  readonly runtime: ContainerRuntime;
  /** Senke für die Ereignisse der Jobs – in der Regel `connection.sendEvent`. */
  readonly emit: (event: OutboundEvent) => void;
  /** Zeitgeber; ohne Angabe die globalen. */
  readonly timers?: SchedulerTimers;
  /** Sonde; ohne Angabe Port-Connect **und** `gamedig` (siehe `probe.ts`). */
  readonly probe?: ServerProbe;
  readonly onJobError?: (jobName: string, error: unknown) => void;
  readonly now?: () => Date;
  /** RCON-Client; ohne Angabe der echte (`rconCommand`). Für Tests. */
  readonly rconClient?: RconClient;
}

/**
 * Baut die Jobs aus der Konfiguration zusammen.
 *
 * Nur diese Funktion liest die Umgebung; die Jobs selbst bekommen alles
 * injiziert und bleiben ohne `.env` testbar – dieselbe Aufteilung wie in
 * `runtime/factory.ts`.
 */
export function createAgentJobs(env: JobsEnv, options: CreateAgentJobsOptions): AgentJobs {
  const scheduler = new JobScheduler({
    ...(options.timers === undefined ? {} : { timers: options.timers }),
    ...(options.onJobError === undefined ? {} : { onError: options.onJobError }),
  });

  const query = new ServerQueryJob({
    scheduler,
    // Beide Sonden: Port-Connect für den Test-Typ, `gamedig` für echte Spiele.
    probe: options.probe ?? createServerProbe(undefined, createGamedigProbe()),
    emit: options.emit,
    defaultIntervalSeconds: env.AGENT_QUERY_INTERVAL_SECONDS,
    timeoutMs: env.AGENT_QUERY_TIMEOUT_MS,
    // Die Abfrage geht an den Container im Spielenetz, nicht an den Host-Port
    // (Fundpunkt 188) – die Adresse kennt nur die Laufzeit.
    resolveAddress: (containerId) =>
      options.runtime.networkAddress(containerId, env.AGENT_CONTAINER_NETWORK ?? 'palantir-games'),
    hostOverride: env.AGENT_QUERY_HOST,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const backups = new BackupJob({
    runtime: options.runtime,
    dataDir: env.AGENT_DATA_DIR,
    backupDir: env.AGENT_BACKUP_DIR,
    maxDownloadBlockBytes:
      env.AGENT_DOWNLOAD_BLOCK_MAX_BYTES > 0
        ? env.AGENT_DOWNLOAD_BLOCK_MAX_BYTES
        : DEFAULT_DOWNLOAD_BLOCK_MAX_BYTES,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const storage = new StorageScanner({
    runtime: options.runtime,
    dataDir: env.AGENT_DATA_DIR,
    backupDir: env.AGENT_BACKUP_DIR,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const serverDisk = new ServerDiskUsage({
    dataDir: env.AGENT_DATA_DIR,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const files = new ServerFileJob({ runtime: options.runtime, dataDir: env.AGENT_DATA_DIR });

  const archiveUploads = new ArchiveUploadJob({
    runtime: options.runtime,
    dataDir: env.AGENT_DATA_DIR,
    maxArchiveBytes:
      env.AGENT_UPLOAD_ARCHIVE_MAX_BYTES !== undefined && env.AGENT_UPLOAD_ARCHIVE_MAX_BYTES > 0
        ? env.AGENT_UPLOAD_ARCHIVE_MAX_BYTES
        : DEFAULT_ARCHIVE_UPLOAD_MAX_BYTES,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const router = new HostnameRouterJob({
    routerDir: env.AGENT_ROUTER_DIR ?? null,
    listenPort: env.MINECRAFT_ROUTER_PORT ?? DEFAULT_ROUTER_LISTEN_PORT,
  });

  const rcon = new RconConsole({
    runtime: options.runtime,
    dataDir: env.AGENT_DATA_DIR,
    // Dasselbe Netz wie die Spielerabfrage: Dort hat der Container seine
    // Adresse, und nur dort ist der nie veröffentlichte RCON-Port zu erreichen.
    network: env.AGENT_CONTAINER_NETWORK ?? 'palantir-games',
    ...(options.rconClient === undefined ? {} : { client: options.rconClient }),
  });

  return {
    scheduler,
    query,
    backups,
    storage,
    serverDisk,
    files,
    archiveUploads,
    router,
    rcon,
    stop: () => {
      query.stopAll();
      scheduler.stopAll();
    },
  };
}
