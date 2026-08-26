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
 *    (Lastenheft §3.8, Pflichtenheft §16)
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
import { BackupJob, DEFAULT_DOWNLOAD_BLOCK_MAX_BYTES } from './backup/backup-job.js';
import { createServerProbe, type ServerProbe } from './query/probe.js';
import { ServerQueryJob } from './query/server-query-job.js';
import { JobScheduler, type SchedulerTimers } from './scheduler.js';
import { StorageScanner } from './storage/storage-scanner.js';

export {
  JobScheduler,
  systemTimers,
  type JobSchedulerOptions,
  type ScheduledJob,
  type SchedulerTimers,
  type TimerHandle,
} from './scheduler.js';

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
  DEFAULT_QUERY_HOST,
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
  StorageScanner,
  type DiskUsage,
  type StorageScannerOptions,
} from './storage/storage-scanner.js';

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
  /** Beendet alle laufenden Jobs – beim Herunterfahren des Agents. */
  stop(): void;
}

/** Die Teilmenge der Agent-Konfiguration, die die Jobs brauchen. */
export interface JobsEnv {
  readonly AGENT_DATA_DIR: string;
  readonly AGENT_BACKUP_DIR: string;
  readonly AGENT_QUERY_INTERVAL_SECONDS: number;
  readonly AGENT_QUERY_TIMEOUT_MS: number;
  readonly AGENT_DOWNLOAD_BLOCK_MAX_BYTES: number;
}

export interface CreateAgentJobsOptions {
  readonly runtime: ContainerRuntime;
  /** Senke für die Ereignisse der Jobs – in der Regel `connection.sendEvent`. */
  readonly emit: (event: OutboundEvent) => void;
  /** Zeitgeber; ohne Angabe die globalen. */
  readonly timers?: SchedulerTimers;
  /** Sonde; ohne Angabe Port-Connect (`gamedig` ist noch offen, siehe `probe.ts`). */
  readonly probe?: ServerProbe;
  readonly onJobError?: (jobName: string, error: unknown) => void;
  readonly now?: () => Date;
}

/**
 * Baut die Jobs aus der Konfiguration zusammen.
 *
 * Nur diese Funktion liest die Umgebung; die Jobs selbst bekommen alles
 * injiziert und bleiben ohne `.env` testbar – dieselbe Aufteilung wie in
 * `runtime/factory.ts`.
 */
export function createAgentJobs(
  env: JobsEnv,
  options: CreateAgentJobsOptions,
): AgentJobs {
  const scheduler = new JobScheduler({
    ...(options.timers === undefined ? {} : { timers: options.timers }),
    ...(options.onJobError === undefined ? {} : { onError: options.onJobError }),
  });

  const query = new ServerQueryJob({
    scheduler,
    probe: options.probe ?? createServerProbe(),
    emit: options.emit,
    defaultIntervalSeconds: env.AGENT_QUERY_INTERVAL_SECONDS,
    timeoutMs: env.AGENT_QUERY_TIMEOUT_MS,
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

  return {
    scheduler,
    query,
    backups,
    storage,
    stop: () => {
      query.stopAll();
      scheduler.stopAll();
    },
  };
}
