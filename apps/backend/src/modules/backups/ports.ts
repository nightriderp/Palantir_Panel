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
  LiveServerEventPayloads,
  NotificationEventPayloads,
  RestoreBackupCommandPayload,
  ServerExportManifest,
  ServerStatus,
} from '@palantir/contracts';
import {
  type FireAndForgetLogger,
  consoleFireAndForgetLogger,
  fireAndForget,
} from '../../lib/fire-and-forget.js';

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
  /**
   * Node, auf der der Server läuft – und damit die Node, auf der seine
   * Sicherungen entstehen (Fundpunkt 174).
   *
   * B5 fragt sie nie ab; sie wird beim Anlegen am Backup festgehalten, damit
   * `DOWNLOAD_BACKUP` und `DELETE_BACKUP` ihre Node auch dann noch kennen, wenn
   * der Server längst gelöscht ist.
   */
  readonly hostId: string;
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

/**
 * Liefert die Konfiguration eines Servers als Export-Manifest (P8,
 * Lastenheft §3.3). Umsetzung: B3 – nur dort steht die Entität `GameServer`.
 *
 * Bewusst ein eigener Port und kein weiteres Feld an `BackupServerRecord`: Das
 * Manifest wird ausschließlich beim Export gebraucht; jedes gewöhnliche Backup
 * würde die zusätzlichen Spalten sonst mitladen.
 */
export interface ServerExportManifestSource {
  /** `null`, wenn es den Server nicht (mehr) gibt. */
  buildManifest(serverId: string): Promise<ServerExportManifest | null>;
}

/** Nachschlagen von Anzeigenamen (Entität `User`, Pflichtenheft §6). */
export interface UserDirectory {
  findDisplayNames(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * Wo ein Archiv liegt (Fundpunkt 174).
 *
 * `CREATE_BACKUP` und `RESTORE_BACKUP` tragen eine `serverId`; ihre Node
 * erschließt sich daraus. `DOWNLOAD_BACKUP` und `DELETE_BACKUP` arbeiten nur
 * auf einem Archivpfad – ihnen muss der Aufrufer sagen, auf welcher Maschine
 * dieser Pfad gilt. Bewusst ein eigener Parameter und kein Feld an der
 * Befehlsnutzlast: Die Nutzlasten stehen im Vertrag und beschreiben, was der
 * Agent bekommt; die Node bestimmt dagegen, **welcher** Agent gemeint ist.
 *
 * `null` heißt „unbekannt" (Zeile von vor der Spalte `backups.host_id`, oder
 * ausgemusterte Node) – das Gateway fällt dann auf die Node der Installation
 * zurück und schreibt das ins Log.
 */
export interface BackupArchiveLocation {
  readonly hostId: string | null;
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
  downloadBackupChunk(
    payload: DownloadBackupCommandPayload,
    archive: BackupArchiveLocation,
  ): Promise<ApiResponse<unknown>>;
  deleteBackup(
    payload: DeleteBackupCommandPayload,
    archive: BackupArchiveLocation,
  ): Promise<ApiResponse<unknown>>;
}

/**
 * Ereignisse, die B5 auslöst, mit ihrer vertraglichen Nutzlast.
 *
 * `backup.failed` ist ein Benachrichtigungsanlass (Pflichtenheft §14),
 * `backup.progressed` ein reines Live-Ereignis für offene Ansichten
 * (Gefundener Punkt 51). Beide Formen stehen im Vertrag; hier steht nur die
 * Zuordnung Ereignis → Nutzlast, keine zweite Beschreibung (CLAUDE.md §3).
 */
export interface BackupEventPayloads {
  'backup.failed': NotificationEventPayloads['backup.failed'];
  'backup.progressed': LiveServerEventPayloads['backup.progressed'];
  /** Fortschritt einer Wiederherstellung (Fundpunkt 225) – wie `backup.progressed` rein für offene Ansichten. */
  'backupRestore.progressed': LiveServerEventPayloads['backupRestore.progressed'];
}

export type BackupEventName = keyof BackupEventPayloads;

/**
 * Ereignisse ins interne Event-System (Pflichtenheft §14).
 *
 * Je Ereignis eine eigene Signatur statt `Record<string, unknown>`: Eine
 * unvollständige Nutzlast fiel früher erst zur Laufzeit auf – und dort still,
 * weil die Notification-Engine jeden Fehler abfängt. Der Besitzer eines Servers
 * erfuhr deshalb nichts von einem gescheiterten Backup (Audit W1-7,
 * event-flow-02). Jetzt meldet der Compiler das fehlende Feld an der Stelle,
 * an der das Ereignis entsteht.
 */
export interface BackupEventPublisher {
  publish(
    event: 'backup.failed',
    payload: BackupEventPayloads['backup.failed'],
  ): void | Promise<void>;
  publish(
    event: 'backup.progressed',
    payload: BackupEventPayloads['backup.progressed'],
  ): void | Promise<void>;
  publish(
    event: 'backupRestore.progressed',
    payload: BackupEventPayloads['backupRestore.progressed'],
  ): void | Promise<void>;
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

/**
 * Vorgänge der Sicherungen, die ins Audit-Log gehören (Fundpunkt 237).
 *
 * Die drei Aktionen standen seit jeher im Katalog
 * (`packages/contracts/src/audit.ts`), und die Admin-Oberfläche beschriftet sie
 * bereits – geschrieben hat sie niemand. Wer eine fremde Sicherung löschte oder
 * zurückspielte, hinterließ keine Zeile; im Protokoll fehlte damit ausgerechnet
 * der Vorgang, der Serverdaten überschreibt.
 */
export type BackupAuditAction = 'backup.created' | 'backup.restored' | 'backup.deleted';

/**
 * Wer den Vorgang ausgelöst hat, in der Form, die der Eintrag braucht.
 *
 * Der Anzeigename ist eine **Kopie** zum Zeitpunkt der Aktion (Pflichtenheft
 * §6): Der Eintrag bleibt lesbar, auch wenn das Konto später umbenannt wird
 * oder verschwindet.
 */
export interface BackupAuditContext {
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly ipHint: string | null;
}

/**
 * Schmale Sicht auf `AuditService.record()` aus B8.
 *
 * Bewusst nicht der ganze Dienst: B5 schreibt drei Aktionen und soll ohne das
 * Admin-Modul testbar bleiben – dieselbe Trennung wie bei {@link
 * BackupEventPublisher} gegenüber B6.
 *
 * `record()` darf werfen, und der Aufrufer fängt das **nicht** ab: Lässt sich
 * eine sicherheitsrelevante Aktion nicht protokollieren, soll die Aktion selbst
 * scheitern, statt unbemerkt zu passieren (so beschreibt es
 * `AuditService.record`).
 */
export interface BackupAuditSink {
  record(entry: {
    action: BackupAuditAction;
    actorId: string | null;
    actorDisplayName: string | null;
    targetType: 'backup';
    targetId: string;
    ipHint: string | null;
    metadata: Record<string, unknown>;
  }): void | Promise<void>;
}

/** Senke, solange B8 nicht eingehängt ist (Tests, Betrieb ohne Datenbank). */
export const noopBackupAuditSink: BackupAuditSink = {
  record() {
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

/**
 * Der Standard-Runner mit dem Logger des Betriebs (Audit W0-5, bb-05): Bricht
 * während eines Backups die Datenbank weg, wirft erst der Lauf und dann das
 * `failBackup` im catch – ohne Fänger wäre das eine unbehandelte Ablehnung,
 * die den Prozess beendet. Hier landet sie im Log.
 */
export function createFireAndForgetJobRunner(log: FireAndForgetLogger): JobRunner {
  return (job) => {
    fireAndForget(job(), log, 'Hintergrundlauf der Backup-Verwaltung');
  };
}

/** Runner ohne eigenen Logger – für Tests und Skripte; meldet über `console`. */
export const fireAndForgetJobRunner: JobRunner = createFireAndForgetJobRunner(
  consoleFireAndForgetLogger,
);
