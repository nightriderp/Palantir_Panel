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

/**
 * `CREATE_BACKUP` – Datenordner eines Servers auf dem Homeserver sichern
 * (Lastenheft §3.3, Arbeitspaket A3).
 *
 * Das Backend legt den Datensatz vorher an und gibt seine `backupId` mit, damit
 * Ergebnis und Datensatz auch dann zusammenfinden, wenn die Verbindung während
 * des Laufs abreißt und der Befehl wiederholt wird.
 *
 * `containerId` ist gesetzt, wenn zum Server ein Container existiert. Nur dann
 * kann der Agent ihn für einen sauberen Stand kurz anhalten – ob er das darf,
 * entscheidet das Backend über `stopContainer`.
 */
export interface CreateBackupCommandPayload {
  /** Id des `Backup`-Datensatzes im Backend (Pflichtenheft §6). */
  readonly backupId: string;
  readonly serverId: string;
  /** Zu sichernder Datenordner auf dem Homeserver (`CreateCommandPayload.dataVolume.hostPath`). */
  readonly sourcePath: string;
  readonly containerId?: string;
  /**
   * Container vor dem Sichern anhalten und danach wieder in den vorherigen
   * Zustand bringen. Ohne Anhalten entsteht die Sicherung im laufenden Betrieb
   * und kann einen halb geschriebenen Spielstand enthalten.
   */
  readonly stopContainer?: boolean;
  /** Kulanzzeit für das Anhalten; ohne Angabe gilt der Wert aus `CREATE`. */
  readonly stopTimeoutSeconds?: number;
}

/**
 * `RESTORE_BACKUP` – Datenordner eines Servers aus einem Archiv zurückspielen.
 *
 * Der Agent hält den Container dafür an; das Backend stellt vorher sicher, dass
 * der Server nicht mitten im Lifecycle-Übergang steckt (Pflichtenheft §9).
 */
export interface RestoreBackupCommandPayload {
  readonly backupId: string;
  readonly serverId: string;
  /** Archiv auf dem Homeserver (`CreateBackupCommandResult.storagePath`). */
  readonly storagePath: string;
  /** Zielordner – derselbe Datenordner wie beim Sichern. */
  readonly targetPath: string;
  readonly containerId?: string;
  readonly stopTimeoutSeconds?: number;
}

/**
 * `DOWNLOAD_BACKUP` – einen Block aus dem Archiv lesen.
 *
 * Bewusst blockweise und vom Backend getrieben: Ein Backup kann mehrere
 * Gigabyte groß sein, und der Agent darf keinen eigenen Listener öffnen
 * (Pflichtenheft §18). Das Backend fragt so lange nach, bis `eof` gesetzt ist,
 * und schreibt jeden Block direkt in die HTTP-Antwort.
 */
export interface DownloadBackupCommandPayload {
  readonly backupId: string;
  readonly storagePath: string;
  /** Leseposition in Byte, beginnend bei 0. */
  readonly offset: number;
  /** Größte gewünschte Blockgröße in Byte. Der Agent darf weniger liefern. */
  readonly maxBytes: number;
}

/**
 * `DELETE_BACKUP` – Archiv eines Backups vom Homeserver entfernen.
 *
 * Bewusst idempotent: Ein bereits fehlendes Archiv ist kein Fehler. Sonst
 * bliebe nach einem Abbruch mitten in der Aufbewahrungsprüfung ein Datensatz
 * zurück, der sich nie wieder löschen ließe.
 */
export interface DeleteBackupCommandPayload {
  readonly backupId: string;
  readonly storagePath: string;
}

/**
 * `GET_STORAGE_BREAKDOWN` – Speicherbelegung des Homeservers erheben
 * (Pflichtenheft §16).
 *
 * Node-weiter Befehl ohne `containerId`. Der Scan läuft **on demand**, nicht
 * dauerhaft im Hintergrund; das Backend speichert das Ergebnis mit Zeitstempel
 * zwischen (Arbeitspaket B8).
 *
 * Der Agent ist bewusst der unwissende Teil: Er meldet, was auf der Platte
 * liegt und ob es gerade benutzt wird. Ob ein Datenordner zu einem noch
 * existierenden Server gehört und ob ein Eintrag gelöscht werden darf,
 * entscheidet ausschließlich das Backend (`StorageEntryDto` in `storage.ts`).
 */
export interface GetStorageBreakdownCommandPayload {
  /**
   * Container-Images mit erheben. Ohne Angabe `true`. Ein Image-Scan ist
   * deutlich teurer als die Ordnergrößen – deshalb abschaltbar.
   */
  readonly includeImages?: boolean;
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

/** Ergebnis von `CREATE_BACKUP`. */
export interface CreateBackupCommandResult {
  readonly backupId: string;
  /** Ablageort des fertigen Archivs auf dem Homeserver. */
  readonly storagePath: string;
  readonly sizeBytes: number;
  /** SHA-256 des Archivs in Kleinbuchstaben – Grundlage der Integritätsprüfung. */
  readonly checksumSha256: string;
  /** War der Container während des Sicherns angehalten? Bestimmt die Verlässlichkeit des Spielstands. */
  readonly containerStopped: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
}

/** Ergebnis von `RESTORE_BACKUP`. */
export interface RestoreBackupCommandResult {
  readonly backupId: string;
  readonly restoredBytes: number;
  /** War der Container zum Zeitpunkt des Zurückspielens angehalten? */
  readonly containerStopped: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
}

/** Ergebnis von `DOWNLOAD_BACKUP` – ein Block, Base64-kodiert wie bei `FILE_READ`. */
export interface DownloadBackupCommandResult {
  readonly backupId: string;
  readonly offset: number;
  readonly contentBase64: string;
  /** Tatsächlich gelesene Byte-Anzahl (vor der Base64-Kodierung). */
  readonly bytesRead: number;
  /** Gesamtgröße des Archivs – erlaubt dem Backend ein `Content-Length`. */
  readonly totalBytes: number;
  /** `true`, wenn mit diesem Block das Dateiende erreicht ist. */
  readonly eof: boolean;
}

/** Ergebnis von `DELETE_BACKUP`. */
export interface DeleteBackupCommandResult {
  readonly backupId: string;
  /** `false`, wenn das Archiv schon vorher nicht mehr da war. */
  readonly removed: boolean;
  /** Freigegebener Speicher in Byte; `0`, wenn nichts zu entfernen war. */
  readonly freedBytes: number;
}

/**
 * Art eines Postens in der Speicherübersicht, so wie der Agent sie erkennen
 * kann (Pflichtenheft §16).
 *
 * `orphaned` vergibt der Agent nur, wenn ein Verzeichnis in seinen
 * Datenbereichen liegt, aber keinem bekannten Container zugeordnet ist. Ob es
 * wirklich verwaist ist, entscheidet erst das Backend anhand der Datenbank –
 * deshalb gibt es dort zusätzlich die Kategorie `other`.
 */
export type AgentStorageEntryKind = 'serverData' | 'backup' | 'dockerImage' | 'orphaned';

/** Ein Posten der Speicherübersicht, wie der Agent ihn meldet. */
export interface AgentStorageEntry {
  readonly kind: AgentStorageEntryKind;
  /** Absoluter Pfad auf dem Homeserver; `null` bei Container-Images. */
  readonly path: string | null;
  readonly sizeBytes: number;
  /**
   * `serverId` aus dem Container-Label `palantir.serverId` bzw. dem
   * Ordnernamen; `null`, wenn nicht zuordenbar.
   */
  readonly serverId: string | null;
  /** Dateiname des Backup-Archivs bei `backup`, sonst `null`. */
  readonly backupFileName: string | null;
  /** Image-Id bei `dockerImage`, sonst `null`. */
  readonly imageId: string | null;
  /** Image-Tag bei `dockerImage`, sonst `null`. */
  readonly imageTag: string | null;
  /** Ob der Posten benutzt wird: laufender Container bzw. von einem Container referenziertes Image. */
  readonly inUse: boolean;
  /** Letzte Änderung als ISO-8601; `null`, wenn nicht ermittelbar. */
  readonly lastModifiedAt: string | null;
}

/** Ergebnis von `GET_STORAGE_BREAKDOWN` (Pflichtenheft §16). */
export interface GetStorageBreakdownCommandResult {
  /** Zeitpunkt des Scans als ISO-8601 – nicht der Abrufzeitpunkt. */
  readonly scannedAt: string;
  /** Gesamtgröße des Datenträgers, auf dem die Gameserver-Daten liegen. */
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly freeBytes: number;
  readonly entries: readonly AgentStorageEntry[];
}

// ---------------------------------------------------------------------------
// Zuordnung Befehl → Nutzdaten/Ergebnis
// ---------------------------------------------------------------------------

/**
 * Nutzdaten je Befehlsname.
 *
 * `CREATE_BACKUP`, `RESTORE_BACKUP`, `DOWNLOAD_BACKUP` und `DELETE_BACKUP` sind mit B5
 * ausdefiniert, damit das Backend die Backup-Verwaltung dagegen bauen kann. Die
 * **Ausführung** bleibt Dateisystem- und Job-Arbeit des Agents (A3): bis dahin
 * beantwortet er sie mit `AGENT_COMMAND_NOT_IMPLEMENTED`, weil sie nicht in
 * `IMPLEMENTED_AGENT_COMMANDS` stehen.
 *
 * `GET_STORAGE_BREAKDOWN` hat seit B8 ebenfalls eine Nutzlast und ein Ergebnis: Das
 * Backend muss die Antwort entgegennehmen, zwischenspeichern und ausliefern
 * (Pflichtenheft §16), und dafür braucht es das Wire-Format. Ausgeführt wird
 * der Befehl weiterhin von niemandem – er steht nach wie vor **nicht** in
 * `IMPLEMENTED_AGENT_COMMANDS`, der Agent antwortet also unverändert mit
 * `AGENT_COMMAND_NOT_IMPLEMENTED`, bis A3 den Scanner baut.
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
  readonly CREATE_BACKUP: CreateBackupCommandPayload;
  readonly RESTORE_BACKUP: RestoreBackupCommandPayload;
  readonly DOWNLOAD_BACKUP: DownloadBackupCommandPayload;
  readonly DELETE_BACKUP: DeleteBackupCommandPayload;
  readonly GET_STORAGE_BREAKDOWN: GetStorageBreakdownCommandPayload;
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
  readonly CREATE_BACKUP: CreateBackupCommandResult;
  readonly RESTORE_BACKUP: RestoreBackupCommandResult;
  readonly DOWNLOAD_BACKUP: DownloadBackupCommandResult;
  readonly DELETE_BACKUP: DeleteBackupCommandResult;
  readonly GET_STORAGE_BREAKDOWN: GetStorageBreakdownCommandResult;
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
