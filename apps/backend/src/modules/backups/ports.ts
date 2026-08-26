/**
 * Schnittstellen der Backup-Verwaltung nach außen.
 *
 * B5 orchestriert nur (STRUKTUR.md, Pflichtenheft §2.3): Es kennt weder den
 * Homeserver noch die Server-Orchestrierung noch die Notification-Engine
 * direkt, sondern spricht ausschließlich über die Schnittstellen in dieser
 * Datei. Das hält die fachlichen Regeln ohne Infrastruktur testbar (CLAUDE.md
 * §4, analog zum `ContainerRuntime`-Interface des Agents) und vermeidet, dass
 * B5 Tabellen anlegt, die anderen Paketen gehören.
 *
 * Wer setzt was ein:
 * - {@link ServerDirectory} – B3 (Server-Orchestrierung), sobald `game_servers` existiert
 * - {@link BackupAgentGateway} – B3 über den WebSocket-Kanal zum Agent (Pflichtenheft §5.3)
 * - {@link UserDirectory} – hier bereits über Drizzle umgesetzt (`repository.ts`)
 * - {@link BackupEventPublisher} – B6 (Notification-Engine, Pflichtenheft §14)
 */

import type {
  ApiResponse,
  CreateBackupCommandPayload,
  DeleteBackupCommandPayload,
  DownloadBackupCommandPayload,
  RestoreBackupCommandPayload,
  ServerStatus,
  WebSocketEventName,
} from '@palantir/contracts';

/**
 * Der Ausschnitt eines `GameServer`, den die Backup-Verwaltung braucht
 * (Pflichtenheft §6).
 *
 * Bewusst kein vollständiges `GameServerDto`: B5 interessiert nur, wem der
 * Server gehört, wo seine Daten liegen und ob gerade ein Container läuft.
 */
export interface BackupServerRecord {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly status: ServerStatus;
  /** `null`, solange kein Container angelegt ist. */
  readonly dockerContainerId: string | null;
  /** Datenordner des Servers auf dem Homeserver (`CreateCommandPayload.dataVolume.hostPath`). */
  readonly dataHostPath: string;
  /** Mitverwalter (`ServerMember`, Pflichtenheft §6) – zählen bei `.own` mit. */
  readonly memberUserIds: readonly string[];
}

/** Nachschlagen von Servern. Umsetzung: B3. */
export interface ServerDirectory {
  findById(serverId: string): Promise<BackupServerRecord | null>;
  /** Für die globale Übersicht: Namen zu bereits bekannten Server-Ids. */
  findManyByIds(serverIds: readonly string[]): Promise<BackupServerRecord[]>;
}

/** Nachschlagen von Anzeigenamen (Entität `User`, Pflichtenheft §6). */
export interface UserDirectory {
  findDisplayNames(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * Zugang zum Agent für die vier Backup-Befehle (Pflichtenheft §5.3).
 *
 * Die Antworten kommen als Response-Envelope mit `unknown`-Nutzdaten zurück;
 * geprüft werden sie im Service gegen die Zod-Schemas aus
 * `@palantir/validation`. So bleibt diese Schnittstelle frei von Annahmen über
 * die konkreten Ergebnisformen.
 */
export interface BackupAgentGateway {
  createBackup(payload: CreateBackupCommandPayload): Promise<ApiResponse<unknown>>;
  restoreBackup(payload: RestoreBackupCommandPayload): Promise<ApiResponse<unknown>>;
  downloadBackupChunk(payload: DownloadBackupCommandPayload): Promise<ApiResponse<unknown>>;
  deleteBackup(payload: DeleteBackupCommandPayload): Promise<ApiResponse<unknown>>;
}

/**
 * Ereignisse ins interne Event-System (Pflichtenheft §14).
 *
 * B5 löst ausschließlich `backup.failed` aus; Konsument ist B6.
 */
export interface BackupEventPublisher {
  publish(event: WebSocketEventName, payload: Record<string, unknown>): void | Promise<void>;
}

/**
 * Ereignis-Senke, solange die Notification-Engine (B6) fehlt.
 *
 * Bewusst wirkungslos statt einer Fehlermeldung: Ein fehlgeschlagenes Backup
 * darf nicht daran scheitern, dass niemand zuhört.
 */
export const noopEventPublisher: BackupEventPublisher = {
  publish() {
    // absichtlich leer
  },
};

/** Zeitquelle – austauschbar, damit Aufbewahrungsregel und Zeitpläne testbar bleiben. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/**
 * Startet einen Hintergrundlauf (Backup, Restore).
 *
 * Diese Vorgänge dauern Minuten; die REST-Antwort darf nicht darauf warten. Der
 * Standard stößt den Lauf an und vergisst ihn; Tests reichen einen Runner
 * herein, der sofort und beobachtbar ausführt.
 */
export type JobRunner = (job: () => Promise<void>) => void;

export const fireAndForgetJobRunner: JobRunner = (job) => {
  void job();
};
