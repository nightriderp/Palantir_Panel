/**
 * Nutzdaten und Ergebnisse der einzelnen Agent-Befehle (Pflichtenheft §5.3).
 *
 * Der Rahmen (Frames, Korrelations-ID, Envelope) steht in `agent-protocol.ts`;
 * hier steht, was **in** einem `command`-Frame drinsteckt und was als `data` im
 * zugehörigen `commandResult` zurückkommt.
 *
 * **Abgrenzung zu `apps/agent/src/runtime/types.ts` (A2):** Die Typen dort
 * beschreiben die interne Sicht der Container-Runtime, die hier das
 * Wire-Format zwischen Backend und Agent. Beide ähneln sich, sind aber
 * getrennt: Der Agent darf seine Runtime-Typen weiterentwickeln, ohne dass sich
 * das Protokoll ändert, und das Backend hängt nicht an Agent-Interna. Die
 * Übersetzung zwischen beiden macht der Adapter in
 * `apps/agent/src/connection/runtime-adapter.ts` – an genau einer Stelle,
 * mit Test.
 *
 * **Zuordnung Container:** Alle container-bezogenen Befehle tragen die
 * `containerId` in den Nutzdaten. Das Backend kennt sie als
 * `GameServer.dockerContainerId` (Pflichtenheft §6). Einzige Ausnahme ist
 * `CREATE` – dort entsteht sie erst und kommt im Ergebnis zurück.
 *
 * Änderungen sind bevorzugt additiv (neue optionale Felder).
 */

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

export type AgentPortProtocol = 'tcp' | 'udp';

/** Portweiterleitung Host → Container (Zuordnung aus der Datenbank, Pflichtenheft §2.4). */
export interface AgentPortMapping {
  readonly containerPort: number;
  readonly hostPort: number;
  readonly protocol: AgentPortProtocol;
}

/** Feste CPU-/RAM-Grenzen je Container – nicht optional (Pflichtenheft §2.3). */
export interface AgentResourceLimits {
  /** Harte RAM-Grenze in MiB. */
  readonly memoryMb: number;
  /** CPU-Anteil in Kernen, Nachkommastellen erlaubt (z. B. 1.5). */
  readonly cpuCores: number;
  /** Obergrenze für Prozesse/Threads im Container (Fork-Bomb-Schutz). */
  readonly pidsLimit?: number;
}

/** Bind-Mount vom Homeserver in den Container. */
export interface AgentVolumeMount {
  /** Absoluter Pfad auf dem Homeserver; der Agent lässt nur Pfade unterhalb seiner Datenverzeichnisse zu. */
  readonly hostPath: string;
  /** Absoluter Pfad im Container. */
  readonly containerPath: string;
  readonly readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Nutzdaten je Befehl
// ---------------------------------------------------------------------------

/**
 * `CREATE` – Container anlegen (noch nicht starten).
 *
 * Alles Spielspezifische stammt aus der `GameTypeDefinition` im Backend
 * (Pflichtenheft §11); der Agent kennt keine Spiele, nur Container.
 */
export interface CreateCommandPayload {
  /** Eindeutiger Container-Name, vom Backend vergeben (z. B. `palantir-<serverId>`). */
  readonly name: string;
  readonly image: string;
  readonly env: Readonly<Record<string, string>>;
  readonly command?: readonly string[];
  readonly ports: readonly AgentPortMapping[];
  readonly resources: AgentResourceLimits;
  /** Beschreibbarer Datenordner des Servers – der einzige dauerhaft beschreibbare Ort. */
  readonly dataVolume: AgentVolumeMount;
  readonly extraMounts?: readonly AgentVolumeMount[];
  /**
   * Read-only-Root-Filesystem. Pflichtenheft §2.3 verlangt das „wo vom Spiel
   * unterstützt" – die Entscheidung trifft die `GameTypeDefinition`, nicht der
   * Agent. Ohne Angabe gilt die sichere Vorgabe der Runtime.
   */
  readonly readOnlyRootFilesystem?: boolean;
  /** Zusätzliche beschreibbare tmpfs-Pfade bei read-only Root (z. B. `/tmp`). */
  readonly tmpfsPaths?: readonly string[];
  readonly labels?: Readonly<Record<string, string>>;
  readonly workingDir?: string;
  /** Nutzer im Container (`uid:gid`). Ohne Angabe entscheidet das Image. */
  readonly user?: string;
  /** Kulanzzeit für SIGTERM vor SIGKILL. */
  readonly stopTimeoutSeconds?: number;
}

/** `START` – Container starten. */
export interface StartCommandPayload {
  readonly containerId: string;
}

/** `STOP` – SIGTERM, nach Ablauf der Kulanzzeit SIGKILL. */
export interface StopCommandPayload {
  readonly containerId: string;
  /** Kulanzzeit; ohne Angabe gilt der Wert aus dem `CREATE`-Aufruf. */
  readonly timeoutSeconds?: number;
}

/** `RESTART` – stoppen und wieder starten. */
export interface RestartCommandPayload {
  readonly containerId: string;
  readonly timeoutSeconds?: number;
}

/** `DELETE` – Container entfernen. Bind-Mounts auf dem Host bleiben unberührt. */
export interface DeleteCommandPayload {
  readonly containerId: string;
  /** Anonyme Volumes mitentfernen. */
  readonly removeVolumes?: boolean;
  /** Laufenden Container hart entfernen. */
  readonly force?: boolean;
}

/** `GET_STATS` – einmalige Momentaufnahme der Auslastung. */
export interface GetStatsCommandPayload {
  readonly containerId: string;
}

/** `GET_LOGS` – die letzten Logzeilen als Block (kein Stream). */
export interface GetLogsCommandPayload {
  readonly containerId: string;
  /** Anzahl der letzten Zeilen. */
  readonly tail?: number;
  /** Nur Zeilen ab diesem Zeitpunkt (ISO-8601). */
  readonly since?: string;
  readonly includeStdout?: boolean;
  readonly includeStderr?: boolean;
}

/**
 * `EXEC_CONSOLE` – Befehl im laufenden Container ausführen.
 *
 * Bewusst eine **Argumentliste** und kein Kommandostring: Es gibt keine
 * Shell-Interpolation, damit aus einer Konsoleneingabe keine Shell-Injection
 * werden kann.
 */
export interface ExecConsoleCommandPayload {
  readonly containerId: string;
  readonly command: readonly string[];
}

/** `FILE_LIST` – Verzeichnisinhalt im Container (nicht rekursiv). */
export interface FileListCommandPayload {
  readonly containerId: string;
  /** Absoluter Pfad im Container. */
  readonly path: string;
}

/** `FILE_READ` – Dateiinhalt aus dem Container lesen. */
export interface FileReadCommandPayload {
  readonly containerId: string;
  readonly path: string;
}

/**
 * `FILE_WRITE` – Datei im Container schreiben bzw. überschreiben.
 *
 * Der Inhalt geht Base64-kodiert über die Leitung, weil das Protokoll JSON ist
 * und Dateien beliebige Bytes enthalten dürfen.
 */
export interface FileWriteCommandPayload {
  readonly containerId: string;
  readonly path: string;
  readonly contentBase64: string;
}

// ---------------------------------------------------------------------------
// Ergebnisse je Befehl (das `data`-Feld im Envelope)
// ---------------------------------------------------------------------------

/** Ergebnis von `CREATE`. */
export interface CreateCommandResult {
  readonly containerId: string;
  readonly name: string;
  /** Warnungen der Container-Engine beim Anlegen (z. B. unbekannte Optionen). */
  readonly warnings: readonly string[];
}

/** Ergebnis von `GET_STATS` (Lastenheft §3.3 „Live-Monitoring"). */
export interface AgentContainerStats {
  readonly containerId: string;
  /** CPU-Auslastung in Prozent eines Kerns (250 = 2,5 Kerne ausgelastet). */
  readonly cpuPercent: number;
  readonly memoryUsedBytes: number;
  readonly memoryLimitBytes: number;
  readonly networkRxBytes: number;
  readonly networkTxBytes: number;
  readonly blockReadBytes: number;
  readonly blockWriteBytes: number;
  readonly pids: number;
  /** Zeitpunkt der Messung als ISO-8601. */
  readonly sampledAt: string;
}

export type AgentLogStreamName = 'stdout' | 'stderr';

export interface AgentLogLine {
  readonly stream: AgentLogStreamName;
  readonly message: string;
  /** Zeitstempel als ISO-8601, `null` wenn die Engine keinen liefert. */
  readonly timestamp: string | null;
}

/** Ergebnis von `GET_LOGS`. */
export interface GetLogsCommandResult {
  readonly containerId: string;
  readonly lines: readonly AgentLogLine[];
}

/** Ergebnis von `EXEC_CONSOLE`. */
export interface ExecConsoleCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type AgentFileEntryType = 'file' | 'directory' | 'symlink';

export interface AgentFileEntry {
  readonly name: string;
  /** Absoluter Pfad im Container. */
  readonly path: string;
  readonly type: AgentFileEntryType;
  readonly sizeBytes: number;
  /** Änderungszeitpunkt als ISO-8601. */
  readonly modifiedAt: string;
  /** Unix-Rechte als Oktalstring, z. B. `644`. */
  readonly mode: string;
}

/** Ergebnis von `FILE_LIST`. */
export interface FileListCommandResult {
  readonly containerId: string;
  readonly path: string;
  readonly entries: readonly AgentFileEntry[];
}

/** Ergebnis von `FILE_READ` – Inhalt Base64-kodiert, siehe `FileWriteCommandPayload`. */
export interface FileReadCommandResult {
  readonly containerId: string;
  readonly path: string;
  readonly contentBase64: string;
  readonly sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Zuordnung Befehl → Nutzdaten/Ergebnis
// ---------------------------------------------------------------------------

/**
 * Nutzdaten je Befehlsname.
 *
 * `CREATE_BACKUP`, `RESTORE_BACKUP` und `GET_STORAGE_BREAKDOWN` stehen bewusst
 * noch auf `never`: Sie sind Dateisystem- und Job-Aufgaben und gehören zu A3
 * (Jobs & Scheduler), nicht zur Container-Ansteuerung. Der Agent beantwortet
 * sie bis dahin mit `AGENT_COMMAND_NOT_IMPLEMENTED`. Sobald A3 sie umsetzt,
 * werden die Einträge hier additiv ersetzt.
 */
export interface AgentCommandPayloads {
  readonly CREATE: CreateCommandPayload;
  readonly START: StartCommandPayload;
  readonly STOP: StopCommandPayload;
  readonly RESTART: RestartCommandPayload;
  readonly DELETE: DeleteCommandPayload;
  readonly GET_STATS: GetStatsCommandPayload;
  readonly GET_LOGS: GetLogsCommandPayload;
  readonly EXEC_CONSOLE: ExecConsoleCommandPayload;
  readonly FILE_LIST: FileListCommandPayload;
  readonly FILE_READ: FileReadCommandPayload;
  readonly FILE_WRITE: FileWriteCommandPayload;
  readonly CREATE_BACKUP: never;
  readonly RESTORE_BACKUP: never;
  readonly GET_STORAGE_BREAKDOWN: never;
}

/** Ergebnis je Befehlsname; `null` bei Befehlen ohne Rückgabe. */
export interface AgentCommandResults {
  readonly CREATE: CreateCommandResult;
  readonly START: null;
  readonly STOP: null;
  readonly RESTART: null;
  readonly DELETE: null;
  readonly GET_STATS: AgentContainerStats;
  readonly GET_LOGS: GetLogsCommandResult;
  readonly EXEC_CONSOLE: ExecConsoleCommandResult;
  readonly FILE_LIST: FileListCommandResult;
  readonly FILE_READ: FileReadCommandResult;
  readonly FILE_WRITE: null;
  readonly CREATE_BACKUP: never;
  readonly RESTORE_BACKUP: never;
  readonly GET_STORAGE_BREAKDOWN: never;
}

/**
 * Befehle, die der Agent aktuell ausführen kann.
 *
 * Alles außerhalb dieser Liste steht zwar im Protokoll (Pflichtenheft §5.3),
 * wird aber mit `AGENT_COMMAND_NOT_IMPLEMENTED` beantwortet – das Backend
 * erfährt den Unterschied zwischen „unbekannt" und „noch nicht gebaut".
 */
export const IMPLEMENTED_AGENT_COMMANDS = [
  'CREATE',
  'START',
  'STOP',
  'RESTART',
  'DELETE',
  'GET_STATS',
  'GET_LOGS',
  'EXEC_CONSOLE',
  'FILE_LIST',
  'FILE_READ',
  'FILE_WRITE',
] as const;

export type ImplementedAgentCommandName = (typeof IMPLEMENTED_AGENT_COMMANDS)[number];

export function isImplementedAgentCommand(value: string): value is ImplementedAgentCommandName {
  return (IMPLEMENTED_AGENT_COMMANDS as readonly string[]).includes(value);
}
