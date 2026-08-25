/**
 * Arbeitspaket A2 - Container-Runtime.
 *
 * Oeffentliche Oberflaeche des Runtime-Moduls. Anderer Agent-Code importiert
 * ausschliesslich von hier und arbeitet gegen das `ContainerRuntime`-Interface -
 * nie direkt gegen die Docker-API oder den Docker-Socket-Proxy (CLAUDE.md §4).
 */

export { type ContainerRuntime } from './container-runtime.js';

export {
  ContainerRuntimeError,
  RUNTIME_ERROR_CATALOG,
  RUNTIME_ERROR_CODES,
  type ContainerRuntimeErrorCode,
  type ContainerRuntimeErrorOptions,
  isContainerRuntimeError,
  isContainerRuntimeErrorCode,
} from './errors.js';

export {
  CONTAINER_RUNTIME_EVENTS,
  RuntimeEventEmitter,
  type ContainerRuntimeEvent,
  type ContainerRuntimeEventListener,
  type ContainerRuntimeEventType,
  type CrashedEvent,
  type LogLineEvent,
  type StatsUpdateEvent,
  type StatusChangedEvent,
  type Unsubscribe,
} from './events.js';

export {
  CONTAINER_STATUSES,
  DEFAULT_LOG_TAIL,
  DEFAULT_PIDS_LIMIT,
  type ContainerHandle,
  type ContainerSpec,
  type ContainerState,
  type ContainerStats,
  type ContainerStatus,
  type ExecResult,
  type FileEntry,
  type FileEntryType,
  type GetLogsOptions,
  type LogLine,
  type LogStreamName,
  type PortMapping,
  type PortProtocol,
  type RemoveOptions,
  type ResourceLimits,
  type StopOptions,
  type VolumeMount,
  type WatchOptions,
} from './types.js';

export {
  DEFAULT_HOST_IP,
  DEFAULT_STOP_TIMEOUT_SECONDS,
  DEFAULT_TMPFS_SIZE,
  PALANTIR_MANAGED_LABEL,
  PALANTIR_SERVER_ID_LABEL,
  TMPFS_OPTIONS,
  assertValidContainerSpec,
  buildCreateContainerBody,
  type DockerCreateContainerBody,
  type DockerHostConfig,
  type HardeningOptions,
} from './hardening.js';

export { assertAbsoluteContainerPath, assertHostPathAllowed, resolveWithinRoot } from './paths.js';

export {
  DockerHttpClient,
  type DockerHttpClientOptions,
  type FetchLike,
} from './docker/http-client.js';

export {
  DEFAULT_MAX_FILE_BYTES,
  DockerContainerRuntime,
  createDockerContainerRuntime,
  type CreateDockerContainerRuntimeOptions,
  type DockerContainerRuntimeOptions,
} from './docker/docker-container-runtime.js';

export {
  FAKE_DATA_ROOT,
  FakeContainerRuntime,
  type FakeContainerRuntimeOptions,
  type FakeExecHandler,
  type FakeFailableMethod,
} from './fake/fake-container-runtime.js';

export { createContainerRuntimeFromEnv } from './factory.js';
