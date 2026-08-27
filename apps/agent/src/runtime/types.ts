/**
 * Datentypen der Container-Runtime (Arbeitspaket A2).
 *
 * Diese Typen beschreiben ausschliesslich die **Runtime-Sicht** des Agents auf
 * Container - nicht das Backend-Agent-Protokoll. Das Protokoll (Befehle mit
 * Korrelations-ID, Envelope) liegt in `packages/contracts` und gehoert zu A1
 * (Pflichtenheft §5.3); A1 uebersetzt Protokoll-Befehle auf die hier
 * definierten Aufrufe. Dadurch bleibt A2 unabhaengig vom Wire-Format und ohne
 * Backend testbar.
 *
 * Der Server-Lifecycle aus Pflichtenheft §9 (`creating`, `starting`, `running`,
 * ...) wird bewusst **nicht** hier abgebildet: er umfasst den Health-Check und
 * lebt im Backend (B3). Die Runtime meldet nur den rohen Container-Zustand.
 */

/** Roher Container-Zustand, wie die Container-Engine ihn kennt. */
export type ContainerStatus =
  'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead' | 'unknown';

export const CONTAINER_STATUSES = [
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
  'unknown',
] as const satisfies readonly ContainerStatus[];

/** Feste CPU-/RAM-Grenzen je Container (Pflichtenheft §2.3 - nicht optional). */
export interface ResourceLimits {
  /** Harte RAM-Grenze in MiB. */
  readonly memoryMb: number;
  /** CPU-Anteil in Kernen, Nachkommastellen erlaubt (z. B. 1.5). */
  readonly cpuCores: number;
  /**
   * Obergrenze fuer Prozesse/Threads im Container (Fork-Bomb-Schutz).
   * Ohne Angabe greift {@link DEFAULT_PIDS_LIMIT}.
   */
  readonly pidsLimit?: number;
}

export const DEFAULT_PIDS_LIMIT = 512;

export type PortProtocol = 'tcp' | 'udp';

/** Portweiterleitung Host zu Container (Zuordnung kommt aus der Datenbank, Pflichtenheft §2.4). */
export interface PortMapping {
  readonly containerPort: number;
  readonly hostPort: number;
  readonly protocol: PortProtocol;
  /**
   * Host-Interface, an das gebunden wird. Vorgabe ist die WireGuard-Adresse des
   * Homeservers bzw. `127.0.0.1` - bewusst nicht `0.0.0.0`, damit am Homeserver
   * kein Listener im LAN entsteht (Pflichtenheft §18).
   */
  readonly hostIp?: string;
}

/** Bind-Mount vom Host in den Container. */
export interface VolumeMount {
  /** Absoluter Pfad auf dem Homeserver, muss unterhalb von `AGENT_DATA_DIR` liegen. */
  readonly hostPath: string;
  /** Absoluter Pfad im Container. */
  readonly containerPath: string;
  readonly readOnly?: boolean;
}

/**
 * Vollstaendige Beschreibung eines zu erzeugenden Containers.
 *
 * Alles Spielspezifische (Image, Standard-Env, Ports, Ressourcen-Empfehlung)
 * stammt aus der `GameTypeDefinition` im Backend (Pflichtenheft §11); die
 * Runtime kennt keine Spiele, nur Container.
 */
export interface ContainerSpec {
  /** Eindeutiger Container-Name, vom Backend vergeben (z. B. `palantir-<serverId>`). */
  readonly name: string;
  readonly image: string;
  readonly env: Readonly<Record<string, string>>;
  readonly command?: readonly string[];
  readonly ports: readonly PortMapping[];
  readonly resources: ResourceLimits;
  /** Beschreibbarer Datenordner des Servers - der einzige persistente Ort. */
  readonly dataVolume: VolumeMount;
  readonly extraMounts?: readonly VolumeMount[];
  /**
   * Read-only-Root-Filesystem. Pflichtenheft §2.3 verlangt das "wo vom Spiel
   * unterstuetzt" - die Entscheidung trifft die `GameTypeDefinition`, nicht die
   * Runtime. Ohne Angabe gilt `true` (sichere Vorgabe).
   */
  readonly readOnlyRootFilesystem?: boolean;
  /**
   * Zusaetzliche beschreibbare tmpfs-Pfade, wenn das Root-Filesystem read-only
   * ist (z. B. `/tmp`). Werden ohne Ausfuehrungsrecht gemountet.
   */
  readonly tmpfsPaths?: readonly string[];
  /** Zusaetzliche Labels; die Palantir-Labels werden immer ergaenzt. */
  readonly labels?: Readonly<Record<string, string>>;
  /** ID des zugehoerigen `GameServer`-Datensatzes, landet als Label am Container. */
  readonly serverId?: string;
  readonly workingDir?: string;
  /** Nutzer im Container (`uid:gid`). Ohne Angabe entscheidet das Image. */
  readonly user?: string;
  /** Kulanzzeit fuer SIGTERM vor SIGKILL. */
  readonly stopTimeoutSeconds?: number;
}

/** Rueckgabe von `create()`. */
export interface ContainerHandle {
  readonly containerId: string;
  readonly name: string;
  /** Warnungen der Container-Engine beim Anlegen (z. B. unbekannte Optionen). */
  readonly warnings: readonly string[];
}

/** Ergebnis von `inspect()`. */
export interface ContainerState {
  readonly containerId: string;
  readonly name: string;
  readonly image: string;
  readonly status: ContainerStatus;
  /** Exit-Code des letzten Laufs, `null` solange der Container nie beendet wurde. */
  readonly exitCode: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly oomKilled: boolean;
  readonly restartCount: number;
}

/** Momentaufnahme der Auslastung (Lastenheft §3.3 "Live-Monitoring"). */
export interface ContainerStats {
  readonly containerId: string;
  /** CPU-Auslastung in Prozent eines Kerns (z. B. 250 = 2,5 Kerne ausgelastet). */
  readonly cpuPercent: number;
  readonly memoryUsedBytes: number;
  readonly memoryLimitBytes: number;
  readonly networkRxBytes: number;
  readonly networkTxBytes: number;
  readonly blockReadBytes: number;
  readonly blockWriteBytes: number;
  readonly pids: number;
  /** Zeitpunkt der Messung als ISO-8601-String. */
  readonly sampledAt: string;
}

export type LogStreamName = 'stdout' | 'stderr';

export interface LogLine {
  readonly containerId: string;
  readonly stream: LogStreamName;
  readonly message: string;
  /** Zeitstempel der Zeile als ISO-8601-String, `null` wenn die Engine keinen liefert. */
  readonly timestamp: string | null;
}

export interface GetLogsOptions {
  /** Anzahl der letzten Zeilen. Ohne Angabe gilt {@link DEFAULT_LOG_TAIL}. */
  readonly tail?: number;
  /** Nur Zeilen ab diesem Zeitpunkt (ISO-8601). */
  readonly since?: string;
  readonly includeStdout?: boolean;
  readonly includeStderr?: boolean;
}

export const DEFAULT_LOG_TAIL = 200;

/** Ergebnis eines Konsolenbefehls (`EXEC_CONSOLE`). */
export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type FileEntryType = 'file' | 'directory' | 'symlink';

/** Eintrag im Datei-Manager (Lastenheft §3.3). */
export interface FileEntry {
  readonly name: string;
  /** Absoluter Pfad im Container. */
  readonly path: string;
  readonly type: FileEntryType;
  readonly sizeBytes: number;
  /** Aenderungszeitpunkt als ISO-8601-String. */
  readonly modifiedAt: string;
  /** Unix-Rechte als Oktalstring, z. B. `644`. */
  readonly mode: string;
}

export interface StopOptions {
  /** Kulanzzeit fuer SIGTERM vor SIGKILL; ohne Angabe gilt der Wert aus dem Spec. */
  readonly timeoutSeconds?: number;
}

export interface RemoveOptions {
  /** Anonyme Volumes des Containers mitentfernen. Bind-Mounts bleiben unberuehrt. */
  readonly removeVolumes?: boolean;
  /** Laufenden Container hart entfernen. */
  readonly force?: boolean;
}

/** Was bei `watch()` zusaetzlich zum Statuskanal live mitgelesen wird. */
export interface WatchOptions {
  /** `LOG_LINE`-Events aus dem Container-Log. Vorgabe: `true`. */
  readonly logs?: boolean;
  /** `STATS_UPDATE`-Events aus dem Statistik-Stream. Vorgabe: `true`. */
  readonly stats?: boolean;
  /** Nur Logzeilen ab diesem Zeitpunkt (ISO-8601). */
  readonly logsSince?: string;
}

/**
 * Ein Container-Image auf dem Homeserver (Pflichtenheft §16).
 *
 * Ergaenzung aus A3: Der Storage-Explorer verlangt die Groessen der Images
 * "inkl. Nutzungsstatus". Der Weg dorthin fuehrt ueber die Container-Engine,
 * und Agent-Code spricht mit ihr ausschliesslich ueber `ContainerRuntime`
 * (CLAUDE.md §4) - deshalb steht der Typ hier und nicht im Storage-Job.
 */
export interface ContainerImage {
  /** Image-ID der Engine, z. B. `sha256:abc...`. */
  readonly imageId: string;
  /** Erster Tag, z. B. `palantir/testserver:1`; `null` bei taglosen Images. */
  readonly tag: string | null;
  readonly sizeBytes: number;
  /** Erstellzeitpunkt als ISO-8601-String; `null`, wenn die Engine keinen liefert. */
  readonly createdAt: string | null;
  /**
   * Wird das Image von mindestens einem Container benutzt?
   *
   * Bewusst ueber **alle** Container der Engine ermittelt, nicht nur ueber die
   * von Palantir verwalteten: Ein Image, das ein fremder Container benutzt,
   * darf der Storage-Explorer nicht als ungenutzt anbieten.
   */
  readonly inUse: boolean;
}

export interface RemoveImageOptions {
  /** Image auch entfernen, wenn es noch von einem Tag referenziert wird. */
  readonly force?: boolean;
}
