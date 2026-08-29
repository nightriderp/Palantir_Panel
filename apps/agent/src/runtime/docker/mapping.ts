/**
 * Uebersetzung der Docker-Engine-Antworten in die Runtime-Typen aus `types.ts`.
 *
 * Bewusst reine Funktionen ohne HTTP: so lassen sich die kniffligen Teile
 * (CPU-Prozent aus zwei Messpunkten, Speicher ohne Page-Cache) direkt testen.
 */

import {
  CONTAINER_STATUSES,
  type ContainerState,
  type ContainerStats,
  type ContainerStatus,
} from '../types.js';

/** Docker markiert "nie passiert" mit diesem Zeitstempel. */
const NULL_ZEITSTEMPEL_PRAEFIX = '0001-01-01';

export interface DockerInspectResponse {
  readonly Id: string;
  readonly Name?: string;
  readonly RestartCount?: number;
  readonly Config?: { readonly Image?: string; readonly Labels?: Record<string, string> };
  readonly Image?: string;
  readonly State?: {
    readonly Status?: string;
    readonly ExitCode?: number;
    readonly StartedAt?: string;
    readonly FinishedAt?: string;
    readonly OOMKilled?: boolean;
  };
}

export interface DockerStatsResponse {
  readonly read?: string;
  readonly pids_stats?: { readonly current?: number };
  readonly cpu_stats?: DockerCpuStats;
  readonly precpu_stats?: DockerCpuStats;
  readonly memory_stats?: {
    readonly usage?: number;
    readonly limit?: number;
    readonly stats?: Readonly<Record<string, number>>;
  };
  readonly networks?: Readonly<
    Record<string, { readonly rx_bytes?: number; readonly tx_bytes?: number }>
  >;
  readonly blkio_stats?: {
    readonly io_service_bytes_recursive?: readonly {
      readonly op?: string;
      readonly value?: number;
    }[];
  };
}

interface DockerCpuStats {
  readonly cpu_usage?: {
    readonly total_usage?: number;
    readonly percpu_usage?: readonly number[];
  };
  readonly system_cpu_usage?: number;
  readonly online_cpus?: number;
}

export function toContainerStatus(wert: string | undefined): ContainerStatus {
  return (CONTAINER_STATUSES as readonly string[]).includes(wert ?? '')
    ? (wert as ContainerStatus)
    : 'unknown';
}

function zeitstempelOderNull(wert: string | undefined): string | null {
  if (wert === undefined || wert.startsWith(NULL_ZEITSTEMPEL_PRAEFIX)) return null;
  const datum = new Date(wert);
  return Number.isNaN(datum.getTime()) ? null : datum.toISOString();
}

export function toContainerState(antwort: DockerInspectResponse): ContainerState {
  const finishedAt = zeitstempelOderNull(antwort.State?.FinishedAt);
  return {
    containerId: antwort.Id,
    // Docker liefert Namen mit fuehrendem Schraegstrich.
    name: (antwort.Name ?? '').replace(/^\//, ''),
    image: antwort.Config?.Image ?? antwort.Image ?? '',
    status: toContainerStatus(antwort.State?.Status),
    // Ohne beendeten Lauf ist der Exit-Code der Engine (immer 0) bedeutungslos.
    exitCode: finishedAt === null ? null : (antwort.State?.ExitCode ?? 0),
    startedAt: zeitstempelOderNull(antwort.State?.StartedAt),
    finishedAt,
    oomKilled: antwort.State?.OOMKilled ?? false,
    restartCount: antwort.RestartCount ?? 0,
  };
}

/**
 * CPU-Auslastung in Prozent eines Kerns.
 *
 * Die Engine liefert nur Zaehlerstaende; der Prozentwert ergibt sich aus der
 * Differenz zweier Messpunkte, normiert auf die Zahl der Kerne. Ohne zweiten
 * Messpunkt (z. B. bei `one-shot`) ist keine Aussage moeglich - dann 0.
 */
export function berechneCpuProzent(stats: DockerStatsResponse): number {
  const jetzt = stats.cpu_stats;
  const vorher = stats.precpu_stats;
  if (jetzt?.cpu_usage?.total_usage === undefined || jetzt.system_cpu_usage === undefined) return 0;
  if (vorher?.cpu_usage?.total_usage === undefined || vorher.system_cpu_usage === undefined) {
    return 0;
  }

  const cpuDelta = jetzt.cpu_usage.total_usage - vorher.cpu_usage.total_usage;
  const systemDelta = jetzt.system_cpu_usage - vorher.system_cpu_usage;
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;

  const kerne = jetzt.online_cpus ?? jetzt.cpu_usage.percpu_usage?.length ?? 1;
  return Math.round((cpuDelta / systemDelta) * kerne * 100 * 100) / 100;
}

/**
 * Tatsaechlich belegter Speicher.
 *
 * `memory_stats.usage` enthaelt den Page-Cache mit. Der zaehlt fuer die Anzeige
 * nicht als Verbrauch, weil der Kernel ihn jederzeit freigeben kann - deshalb
 * wird er abgezogen (cgroup v2: `inactive_file`, cgroup v1: `cache`).
 */
export function berechneSpeicherVerbrauch(stats: DockerStatsResponse): number {
  const belegt = stats.memory_stats?.usage ?? 0;
  const detail = stats.memory_stats?.stats ?? {};
  const cache = detail['inactive_file'] ?? detail['cache'] ?? 0;
  return Math.max(0, belegt - cache);
}

export function toContainerStats(containerId: string, stats: DockerStatsResponse): ContainerStats {
  let rx = 0;
  let tx = 0;
  for (const netz of Object.values(stats.networks ?? {})) {
    rx += netz.rx_bytes ?? 0;
    tx += netz.tx_bytes ?? 0;
  }

  let gelesen = 0;
  let geschrieben = 0;
  for (const eintrag of stats.blkio_stats?.io_service_bytes_recursive ?? []) {
    const operation = (eintrag.op ?? '').toLowerCase();
    if (operation === 'read') gelesen += eintrag.value ?? 0;
    if (operation === 'write') geschrieben += eintrag.value ?? 0;
  }

  const gemessenAm = stats.read === undefined ? new Date() : new Date(stats.read);

  return {
    containerId,
    cpuPercent: berechneCpuProzent(stats),
    memoryUsedBytes: berechneSpeicherVerbrauch(stats),
    memoryLimitBytes: stats.memory_stats?.limit ?? 0,
    networkRxBytes: rx,
    networkTxBytes: tx,
    blockReadBytes: gelesen,
    blockWriteBytes: geschrieben,
    pids: stats.pids_stats?.current ?? 0,
    sampledAt: Number.isNaN(gemessenAm.getTime())
      ? new Date().toISOString()
      : gemessenAm.toISOString(),
  };
}
