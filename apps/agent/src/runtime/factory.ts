/**
 * Aufbau der produktiven Container-Runtime aus der zentralen Konfiguration.
 *
 * Nur diese Datei liest im Runtime-Modul die Umgebung. Die Runtime selbst
 * bekommt alles injiziert und bleibt dadurch ohne `.env` testbar.
 */

import { readFileSync } from 'node:fs';
import { ContainerRuntimeError } from './errors.js';
import { type HardeningOptions } from './hardening.js';
import {
  type DockerContainerRuntime,
  createDockerContainerRuntime,
  type CreateDockerContainerRuntimeOptions,
} from './docker/docker-container-runtime.js';

/** Die Teilmenge der Agent-Konfiguration, die die Runtime braucht. */
export interface RuntimeEnv {
  readonly DOCKER_SOCKET_PROXY_URL: string;
  readonly AGENT_DATA_DIR: string;
  readonly AGENT_BACKUP_DIR: string;
  readonly AGENT_SECCOMP_PROFILE_PATH?: string | undefined;
}

export interface CreateContainerRuntimeOptions extends Omit<
  CreateDockerContainerRuntimeOptions,
  'dockerSocketProxyUrl' | 'hardening'
> {
  /** Docker-Netzwerk der Gameserver-Container. */
  readonly networkMode?: string;
  /** Host-Interface fuer Portbindungen. */
  readonly defaultHostIp?: string;
}

/**
 * Baut die Docker-Runtime auf Basis der Umgebung.
 *
 * Ist `AGENT_SECCOMP_PROFILE_PATH` gesetzt, wird die Profildatei hier einmalig
 * gelesen und anschliessend bei **jedem** Container mitgegeben. Fehlt die Datei
 * oder ist sie kein gueltiges JSON, bricht der Aufbau ab - lieber gar keine
 * Runtime als eine ohne das erwartete Seccomp-Profil.
 */
export function createContainerRuntimeFromEnv(
  env: RuntimeEnv,
  options: CreateContainerRuntimeOptions = {},
): DockerContainerRuntime {
  const { networkMode, defaultHostIp, ...rest } = options;

  const hardening: HardeningOptions = {
    // Bind-Mounts sind auf die Palantir-Verzeichnisse begrenzt; Backups werden
    // fuer den Restore ebenfalls gemountet (A3).
    allowedHostRoots: [env.AGENT_DATA_DIR, env.AGENT_BACKUP_DIR],
    ...(defaultHostIp === undefined ? {} : { defaultHostIp }),
    ...(networkMode === undefined ? {} : { networkMode }),
    ...ladeSeccompProfil(env.AGENT_SECCOMP_PROFILE_PATH),
  };

  return createDockerContainerRuntime({
    dockerSocketProxyUrl: env.DOCKER_SOCKET_PROXY_URL,
    hardening,
    ...rest,
  });
}

function ladeSeccompProfil(pfad: string | undefined): { seccompProfile?: string } {
  if (pfad === undefined || pfad.trim().length === 0) {
    // Ohne eigenes Profil greift das Standardprofil der Container-Engine
    // (siehe Begruendung in hardening.ts).
    return {};
  }

  let inhalt: string;
  try {
    inhalt = readFileSync(pfad, 'utf8');
  } catch (ursache) {
    throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
      message: `Das Seccomp-Profil unter ${pfad} konnte nicht gelesen werden.`,
      cause: ursache,
      details: { path: pfad },
    });
  }

  try {
    JSON.parse(inhalt);
  } catch (ursache) {
    throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
      message: `Das Seccomp-Profil unter ${pfad} ist kein gueltiges JSON.`,
      cause: ursache,
      details: { path: pfad },
    });
  }

  return { seccompProfile: inhalt };
}
