/**
 * Container-Haertung (Pflichtenheft §2.3, §18, Lastenheft §4 "Sicherheit").
 *
 * Diese Datei ist die **einzige** Stelle, an der das Erzeugungs-Payload eines
 * Containers gebaut wird. Damit gilt die Haertung fuer jede Container-Ansteuerung
 * und nicht nur fuer die erste Implementierung (CLAUDE.md §2). Wer einen
 * Container anlegt, kommt an `buildCreateContainerBody()` nicht vorbei.
 *
 * Gesetzt wird immer:
 *   - `no-new-privileges` (kein Rechtezuwachs ueber setuid-Binaries)
 *   - alle Linux-Capabilities entzogen (`CapDrop: ALL`), `Privileged: false`
 *   - Seccomp-Profil (siehe Hinweis unten)
 *   - feste CPU-/RAM-Grenzen, Swap deaktiviert, PID-Limit gegen Fork-Bomben
 *   - Read-only-Root-Filesystem, sofern das Spiel es unterstuetzt; beschreibbar
 *     ist dann nur das gemountete Datenvolume und ein `noexec`-tmpfs
 *   - `RestartPolicy: no` - Neustarts nach Absturz steuert Palantir selbst mit
 *     Crash-Loop-Schutz (Pflichtenheft §9), nicht die Container-Engine
 *   - rotierendes Logging, damit ein schreibfreudiger Server die Platte nicht fuellt
 *
 * **Hinweis zum Seccomp-Profil (dokumentierte Entscheidung, CLAUDE.md §8):**
 * Ohne `seccomp=`-Eintrag wendet die Container-Engine ihr Standardprofil an,
 * das bereits rund vier Dutzend gefaehrliche Syscalls sperrt. Ein eigenes,
 * vollstaendiges Whitelist-Profil von Hand zu pflegen ist fehleranfaellig und
 * bricht erfahrungsgemaess einzelne Spiele-Images. Deshalb: das Profil ist ueber
 * `AGENT_SECCOMP_PROFILE_PATH` konfigurierbar; ist die Variable gesetzt, wird
 * genau dieses Profil inline uebergeben, sonst greift das Standardprofil der
 * Engine. `seccomp=unconfined` ist an keiner Stelle vorgesehen.
 */

import {
  DEFAULT_PIDS_LIMIT,
  type ContainerSpec,
  type PortMapping,
  type VolumeMount,
} from './types.js';
import { ContainerRuntimeError } from './errors.js';
import { assertAbsoluteContainerPath, assertHostPathAllowed } from './paths.js';

/** Label, an dem die Runtime von Palantir verwaltete Container erkennt. */
export const PALANTIR_MANAGED_LABEL = 'palantir.managed';
/** Label mit der ID des zugehoerigen `GameServer`-Datensatzes. */
export const PALANTIR_SERVER_ID_LABEL = 'palantir.serverId';

/** Groesse des beschreibbaren tmpfs bei read-only Root-Filesystem. */
export const DEFAULT_TMPFS_SIZE = '64m';
/** Mount-Optionen des tmpfs: beschreibbar, aber nicht ausfuehrbar. */
export const TMPFS_OPTIONS = `rw,noexec,nosuid,nodev,size=${DEFAULT_TMPFS_SIZE}`;
/** Vorgabe fuer das Host-Interface der Portbindungen (kein LAN-Listener, Pflichtenheft §18). */
export const DEFAULT_HOST_IP = '127.0.0.1';
/** Kulanzzeit fuer SIGTERM, wenn der Spec nichts anderes sagt. */
export const DEFAULT_STOP_TIMEOUT_SECONDS = 30;

/** Teilmenge der Docker-Engine-`HostConfig`, die Palantir setzt. */
export interface DockerHostConfig {
  readonly Binds: string[];
  readonly PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
  readonly Memory: number;
  readonly MemorySwap: number;
  readonly NanoCpus: number;
  readonly PidsLimit: number;
  readonly ReadonlyRootfs: boolean;
  readonly Tmpfs: Record<string, string>;
  readonly SecurityOpt: string[];
  readonly CapDrop: string[];
  readonly Privileged: false;
  readonly RestartPolicy: { Name: 'no' };
  readonly LogConfig: { Type: 'json-file'; Config: Record<string, string> };
  readonly NetworkMode: string;
}

/** Erzeugungs-Payload der Docker-Engine (`POST /containers/create`). */
export interface DockerCreateContainerBody {
  readonly Image: string;
  readonly Env: string[];
  readonly Cmd?: string[];
  readonly WorkingDir?: string;
  readonly User?: string;
  readonly Labels: Record<string, string>;
  readonly ExposedPorts: Record<string, Record<string, never>>;
  readonly StopTimeout: number;
  readonly Tty: false;
  readonly OpenStdin: false;
  readonly AttachStdin: false;
  readonly HostConfig: DockerHostConfig;
}

export interface HardeningOptions {
  /**
   * Erlaubte Host-Wurzelverzeichnisse fuer Bind-Mounts (in der Regel
   * `AGENT_DATA_DIR`, fuer Restores zusaetzlich `AGENT_BACKUP_DIR`).
   */
  readonly allowedHostRoots: readonly string[];
  /** Inhalt eines Seccomp-Profils als JSON-String. Ohne Angabe: Standardprofil der Engine. */
  readonly seccompProfile?: string;
  /** Host-Interface fuer Portbindungen, wenn der Spec keines nennt. */
  readonly defaultHostIp?: string;
  /** Docker-Netzwerk, in dem die Gameserver laufen. */
  readonly networkMode?: string;
}

const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_CPU_CORES = 256;
const MIN_MEMORY_MB = 16;

function invalidSpec(message: string, details?: Record<string, unknown>): ContainerRuntimeError {
  return new ContainerRuntimeError('INVALID_CONTAINER_SPEC', { message, details });
}

function assertValidPort(port: number, feld: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidSpec(`${feld} muss eine Portnummer zwischen 1 und 65535 sein.`, { port });
  }
}

/**
 * Prueft einen Container-Spec vollstaendig, bevor daraus ein Payload wird.
 * Bewusst streng: ein ungueltiger Spec darf die Engine nie erreichen.
 */
export function assertValidContainerSpec(spec: ContainerSpec, options: HardeningOptions): void {
  if (!CONTAINER_NAME_PATTERN.test(spec.name)) {
    throw invalidSpec('Der Container-Name enthaelt unzulaessige Zeichen.', { name: spec.name });
  }
  if (spec.image.trim().length === 0) {
    throw invalidSpec('Es ist kein Image angegeben.');
  }

  const { memoryMb, cpuCores, pidsLimit } = spec.resources;
  if (!Number.isInteger(memoryMb) || memoryMb < MIN_MEMORY_MB) {
    throw invalidSpec(`Die RAM-Grenze muss eine ganze Zahl ab ${MIN_MEMORY_MB} MiB sein.`, {
      memoryMb,
    });
  }
  if (!Number.isFinite(cpuCores) || cpuCores <= 0 || cpuCores > MAX_CPU_CORES) {
    throw invalidSpec(`Die CPU-Grenze muss groesser als 0 und hoechstens ${MAX_CPU_CORES} sein.`, {
      cpuCores,
    });
  }
  if (pidsLimit !== undefined && (!Number.isInteger(pidsLimit) || pidsLimit < 1)) {
    throw invalidSpec('Das PID-Limit muss eine ganze Zahl groesser als 0 sein.', { pidsLimit });
  }

  const belegteHostPorts = new Set<string>();
  for (const port of spec.ports) {
    assertValidPort(port.containerPort, 'containerPort');
    assertValidPort(port.hostPort, 'hostPort');
    if (port.protocol !== 'tcp' && port.protocol !== 'udp') {
      throw invalidSpec('Nur die Protokolle tcp und udp sind zulaessig.', {
        protocol: port.protocol,
      });
    }
    const schluessel = `${port.hostPort}/${port.protocol}`;
    if (belegteHostPorts.has(schluessel)) {
      throw invalidSpec('Ein Host-Port ist doppelt belegt.', { port: schluessel });
    }
    belegteHostPorts.add(schluessel);
  }

  for (const [key, value] of Object.entries(spec.env)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw invalidSpec('Ungueltiger Name einer Umgebungsvariable.', { key });
    }
    if (value.includes('\0')) {
      throw invalidSpec('Umgebungsvariablen duerfen kein NUL-Byte enthalten.', { key });
    }
  }

  if (spec.dataVolume.readOnly === true) {
    throw invalidSpec('Das Datenvolume muss beschreibbar sein.', {
      containerPath: spec.dataVolume.containerPath,
    });
  }

  for (const mount of [spec.dataVolume, ...(spec.extraMounts ?? [])]) {
    assertAbsoluteContainerPath(mount.containerPath);
    assertHostPathAllowed(options.allowedHostRoots, mount.hostPath);
  }

  for (const tmpfsPath of spec.tmpfsPaths ?? []) {
    assertAbsoluteContainerPath(tmpfsPath);
  }
}

function bindString(mount: VolumeMount, allowedHostRoots: readonly string[]): string {
  const hostPath = assertHostPathAllowed(allowedHostRoots, mount.hostPath);
  const containerPath = assertAbsoluteContainerPath(mount.containerPath);
  return `${hostPath}:${containerPath}:${mount.readOnly === true ? 'ro' : 'rw'}`;
}

function portKey(port: PortMapping): string {
  return `${port.containerPort}/${port.protocol}`;
}

/**
 * Baut das gehaertete Erzeugungs-Payload zu einem Container-Spec.
 *
 * @throws {ContainerRuntimeError} `INVALID_CONTAINER_SPEC` oder `INVALID_PATH`,
 * wenn der Spec die Vorgaben verletzt.
 */
export function buildCreateContainerBody(
  spec: ContainerSpec,
  options: HardeningOptions,
): DockerCreateContainerBody {
  assertValidContainerSpec(spec, options);

  const readOnlyRootfs = spec.readOnlyRootFilesystem ?? true;
  const tmpfsPaths = spec.tmpfsPaths ?? (readOnlyRootfs ? ['/tmp'] : []);

  const tmpfs: Record<string, string> = {};
  for (const tmpfsPath of tmpfsPaths) {
    tmpfs[assertAbsoluteContainerPath(tmpfsPath)] = TMPFS_OPTIONS;
  }

  const exposedPorts: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {};
  for (const port of spec.ports) {
    const key = portKey(port);
    exposedPorts[key] = {};
    portBindings[key] = [
      {
        HostIp: port.hostIp ?? options.defaultHostIp ?? DEFAULT_HOST_IP,
        HostPort: String(port.hostPort),
      },
    ];
  }

  // no-new-privileges ist nicht verhandelbar und steht deshalb fest verdrahtet
  // an erster Stelle; das Seccomp-Profil kommt nur als zusaetzlicher Eintrag hinzu.
  const securityOpt = ['no-new-privileges:true'];
  if (options.seccompProfile !== undefined) {
    securityOpt.push(`seccomp=${options.seccompProfile}`);
  }

  const memoryBytes = spec.resources.memoryMb * 1024 * 1024;

  const labels: Record<string, string> = {
    ...(spec.labels ?? {}),
    [PALANTIR_MANAGED_LABEL]: 'true',
  };
  if (spec.serverId !== undefined) {
    labels[PALANTIR_SERVER_ID_LABEL] = spec.serverId;
  }

  const body: DockerCreateContainerBody = {
    Image: spec.image,
    Env: Object.entries(spec.env).map(([key, value]) => `${key}=${value}`),
    ...(spec.command === undefined ? {} : { Cmd: [...spec.command] }),
    ...(spec.workingDir === undefined ? {} : { WorkingDir: spec.workingDir }),
    ...(spec.user === undefined ? {} : { User: spec.user }),
    Labels: labels,
    ExposedPorts: exposedPorts,
    StopTimeout: spec.stopTimeoutSeconds ?? DEFAULT_STOP_TIMEOUT_SECONDS,
    Tty: false,
    OpenStdin: false,
    AttachStdin: false,
    HostConfig: {
      Binds: [spec.dataVolume, ...(spec.extraMounts ?? [])].map((mount) =>
        bindString(mount, options.allowedHostRoots),
      ),
      PortBindings: portBindings,
      Memory: memoryBytes,
      // Gleicher Wert wie Memory => kein Swap. Sonst koennte ein Container sein
      // RAM-Limit ueber die Auslagerungsdatei des Hosts umgehen.
      MemorySwap: memoryBytes,
      NanoCpus: Math.round(spec.resources.cpuCores * 1_000_000_000),
      PidsLimit: spec.resources.pidsLimit ?? DEFAULT_PIDS_LIMIT,
      ReadonlyRootfs: readOnlyRootfs,
      Tmpfs: tmpfs,
      SecurityOpt: securityOpt,
      CapDrop: ['ALL'],
      Privileged: false,
      RestartPolicy: { Name: 'no' },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      NetworkMode: options.networkMode ?? 'bridge',
    },
  };

  return body;
}
