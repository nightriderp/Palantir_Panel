/**
 * Adapter zwischen Agent-Protokoll (A1) und Container-Runtime (A2).
 *
 * Hier – und nur hier – treffen die beiden Welten aufeinander:
 *   - **Protokoll** (`packages/contracts`): Wire-Format zum Backend, Befehle mit
 *     Korrelations-ID, Response-Envelope, Fehlercodes mit HTTP-Zuordnung
 *   - **Runtime** (`apps/agent/src/runtime`): interne Sicht des Agents auf
 *     Container, eigener Fehlerkatalog ohne HTTP-Bezug
 *
 * Die Trennung ist Absicht (siehe Kopf von `agent-commands.ts`): A2 darf seine
 * Typen weiterentwickeln, ohne das Protokoll zu ändern, und das Backend hängt
 * nicht an Agent-Interna. Dass beide Seiten sich ähneln, macht die Übersetzung
 * kurz – sie bleibt trotzdem an einer einzigen, getesteten Stelle.
 *
 * Der Adapter fasst Docker nicht selbst an: Er ruft ausschließlich Methoden des
 * `ContainerRuntime`-Interfaces auf (CLAUDE.md §4, Pflichtenheft §2.3/§2.5).
 */

import {
  type AgentCommandName,
  type AgentContainerState,
  type CreateBackupCommandPayload,
  type DeleteBackupCommandPayload,
  type DownloadBackupCommandPayload,
  type ExecConsoleCommandPayload,
  type FileDeleteCommandPayload,
  type GetStorageBreakdownCommandPayload,
  type RemoveStorageEntryCommandPayload,
  type RestoreBackupCommandPayload,
  type SetServerQueryCommandPayload,
  type UploadArchiveBlockCommandPayload,
  type AgentContainerStatus,
  type ApiResponse,
  type ErrorCode,
  fail,
  type ImplementedAgentCommandName,
  isImplementedAgentCommand,
  ok,
} from '@palantir/contracts';
import { AGENT_COMMAND_PAYLOAD_SCHEMAS } from '@palantir/validation';
import type { AgentJobs } from '../jobs/index.js';
import { type ConnectionLogger, consoleLogger } from './agent-connection.js';
import {
  type ContainerRuntime,
  type ContainerRuntimeErrorCode,
  type ContainerRuntimeEvent,
  type ContainerSpec,
  type ContainerState,
  isContainerRuntimeError,
  type Unsubscribe,
} from '../runtime/index.js';
import type { AgentRuntimePort, CommandExecution, OutboundEvent } from './ports.js';

/**
 * Zuordnung der agent-internen Runtime-Fehler auf den API-Fehlercode-Katalog
 * (Pflichtenheft §5.1; von A2 unter „Gefundene Punkte" angemeldet).
 *
 * Vollständig über `ContainerRuntimeErrorCode` – ein neuer Runtime-Code ohne
 * Eintrag hier lässt schon den Build scheitern, statt still als
 * `AGENT_COMMAND_FAILED` zu enden.
 */
export const RUNTIME_ERROR_TO_API_CODE: Record<ContainerRuntimeErrorCode, ErrorCode> = {
  CONTAINER_NOT_FOUND: 'AGENT_CONTAINER_NOT_FOUND',
  IMAGE_NOT_FOUND: 'AGENT_IMAGE_NOT_FOUND',
  CONTAINER_NAME_CONFLICT: 'AGENT_CONTAINER_NAME_CONFLICT',
  CONTAINER_NOT_RUNNING: 'AGENT_CONTAINER_NOT_RUNNING',
  CONTAINER_STATE_CONFLICT: 'AGENT_CONTAINER_STATE_CONFLICT',
  INVALID_CONTAINER_SPEC: 'AGENT_COMMAND_INVALID',
  INVALID_PATH: 'AGENT_INVALID_PATH',
  FILE_NOT_FOUND: 'AGENT_FILE_NOT_FOUND',
  FILE_TOO_LARGE: 'AGENT_FILE_TOO_LARGE',
  // Eigener Code (413) seit dem Contracts-Nachzug W2-C2: Datei- und
  // Archiv-Grenze sind zwei verschiedene Grenzen, und der Nutzer raeumt anders
  // auf (kleinere Datei waehlen vs. Archiv aufteilen). Vorher stand im Panel
  // "die Datei ist zu gross" ueber einem Archiv, dessen einzelne Dateien alle
  // unter der Grenze lagen. Agent-intern bleiben beide ohnehin getrennt.
  ARCHIVE_TOO_LARGE: 'AGENT_ARCHIVE_TOO_LARGE',
  FILE_EXISTS: 'AGENT_FILE_EXISTS',
  RUNTIME_UNAVAILABLE: 'AGENT_RUNTIME_UNAVAILABLE',
  RUNTIME_ERROR: 'AGENT_COMMAND_FAILED',
  CHECKSUM_MISMATCH: 'BACKUP_CHECKSUM_MISMATCH',
  ARCHIVE_INVALID: 'AGENT_ARCHIVE_INVALID',
};

/**
 * Container-Zustand der Runtime → Protokoll.
 *
 * Beide Listen sind bewusst deckungsgleich; die Abbildung steht trotzdem
 * ausgeschrieben da, damit ein zusätzlicher Zustand auf einer Seite hier
 * auffällt und nicht stillschweigend zu `unknown` wird.
 */
const CONTAINER_STATUS_MAP: Record<ContainerState['status'], AgentContainerStatus> = {
  created: 'created',
  running: 'running',
  paused: 'paused',
  restarting: 'restarting',
  removing: 'removing',
  exited: 'exited',
  dead: 'dead',
  unknown: 'unknown',
};

export interface RuntimeAdapterOptions {
  readonly runtime: ContainerRuntime;
  /**
   * Protokoll des Agents. Ohne Angabe die Konsole - dieselbe Voreinstellung
   * wie in der Verbindung.
   *
   * Gebraucht wird er fuer **gescheiterte Befehle** (WORK_STATUS.md,
   * Gefundener Punkt 118): Bisher gingen sie ausschliesslich als Antwort ans
   * Backend zurueck, und auf der Node stand nichts davon. Wer dort nachsah,
   * warum ein Server nicht entsteht, fand ein leeres Log - der Fehler war nur
   * im Panel sichtbar, und dort nur als uebersetzter Code ohne Einzelheiten.
   */
  readonly logger?: ConnectionLogger;
  /**
   * Job-Modul (A3). Ohne Angabe beantwortet der Adapter die Job-Befehle
   * (Backups, Speicherübersicht, Server-Abfrage) mit
   * `AGENT_COMMAND_NOT_IMPLEMENTED` – so bleibt der Adapter ohne Dateisystem
   * testbar, und ein Agent-Aufbau ohne Jobs sagt ehrlich, was er nicht kann.
   */
  readonly jobs?: AgentJobs;
}

/**
 * Senke für Ereignisse der Runtime – in der Regel `connection.sendEvent`.
 *
 * Sie kommt erst bei {@link ContainerRuntimeAdapter.start} herein und nicht
 * schon in den Konstruktor: Adapter und Verbindung brauchen einander
 * gegenseitig, und so lässt sich beides ohne Zwischenvariable verdrahten. Der
 * Adapter kennt die Verbindung dabei nie direkt und bleibt ohne WebSocket
 * testbar.
 */
export type OutboundEventSink = (event: OutboundEvent) => void;

/**
 * Verbindet eine `ContainerRuntime` mit der Core-Verbindung.
 *
 * Übernimmt beide Richtungen:
 *   - Befehle vom Backend → Runtime-Aufrufe (`execute`)
 *   - Ereignisse der Runtime → Protokoll-Ereignisse (`emit`)
 */
export class ContainerRuntimeAdapter implements AgentRuntimePort {
  private readonly runtime: ContainerRuntime;
  private readonly jobs: AgentJobs | undefined;
  private readonly log: ConnectionLogger;
  private unsubscribe: Unsubscribe | null = null;
  /**
   * Container mit offenen Live-Kanälen (`LOG_LINE`, `STATS_UPDATE`), je Eintrag
   * die Abmeldung – `null`, solange `watch()` noch läuft.
   *
   * Ohne diese Liste bliebe die Live-Konsole leer und CPU/RAM dauerhaft „—":
   * `runtime.on()` allein liefert nur `STATUS_CHANGED`/`CRASHED`, die beiden
   * Live-Kanäle öffnet erst `runtime.watch()` (Audit event-flow-01).
   *
   * Die Liste ist nötig, weil `watch()` **nicht** idempotent ist: Jeder Aufruf
   * der Docker-Runtime öffnet ein weiteres Stream-Paar, und jede Logzeile käme
   * dann mehrfach beim Backend an.
   */
  private readonly liveChannels = new Map<string, Unsubscribe | null>();

  constructor(options: RuntimeAdapterOptions) {
    this.runtime = options.runtime;
    this.jobs = options.jobs;
    this.log = options.logger ?? consoleLogger;
  }

  /**
   * Meldet sich am Ereignisstrom der Runtime an und leitet alles an `emit`
   * weiter. Mehrfachaufrufe sind wirkungslos.
   */
  start(emit: OutboundEventSink): void {
    if (this.unsubscribe !== null) {
      return;
    }
    this.unsubscribe = this.runtime.on((event) => {
      emit(toOutboundEvent(event));
    });
  }

  /** Meldet sich wieder ab. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;

    // Die Live-Kanäle mit schließen: Ohne Senke hätte ihr Inhalt kein Ziel mehr,
    // die Streams liefen aber weiter.
    for (const abmelden of this.liveChannels.values()) {
      abmelden?.();
    }
    this.liveChannels.clear();
  }

  async execute(execution: CommandExecution): Promise<ApiResponse<unknown>> {
    const { command } = execution;

    if (!isImplementedAgentCommand(command)) {
      // Der Befehl steht im Protokoll, ist hier aber nicht gebaut.
      return fail(
        'AGENT_COMMAND_NOT_IMPLEMENTED',
        `${command} wird vom Agent noch nicht unterstützt.`,
      );
    }

    if (JOB_COMMANDS.has(command) && this.jobs === undefined) {
      // Ein Agent ohne Job-Modul sagt das ehrlich, statt den Befehl mit einem
      // Laufzeitfehler scheitern zu lassen.
      return fail(
        'AGENT_COMMAND_NOT_IMPLEMENTED',
        `${command} braucht das Job-Modul (A3), das in diesem Agent nicht eingehängt ist.`,
      );
    }

    const schema = AGENT_COMMAND_PAYLOAD_SCHEMAS[command];
    const payload = schema.safeParse(execution.payload);
    if (!payload.success) {
      const grund = payload.error.issues
        .map((issue) => `${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`)
        .join('; ');
      return fail('AGENT_COMMAND_INVALID', `${command}: ${grund}`);
    }

    try {
      return ok(await this.dispatch(command, payload.data, execution.serverId));
    } catch (error) {
      const antwort = toErrorResponse(command, error);

      /*
       * Auch auf der Node festhalten (Gefundener Punkt 118). Die Antwort geht
       * ans Backend, aber wer auf dem Homeserver nachsieht, warum etwas nicht
       * klappt, soll den Grund dort finden - mit Befehl, Server und dem
       * urspruenglichen Text, nicht nur dem uebersetzten Code.
       */
      this.log.error('Befehl fehlgeschlagen', {
        command,
        serverId: execution.serverId,
        code: antwort.error?.code,
        message: antwort.error?.message,
      });

      return antwort;
    }
  }

  async listContainerStates(): Promise<readonly AgentContainerState[]> {
    // Fehler werden bewusst nach oben durchgereicht: Die Verbindung meldet dann
    // gar keinen Ist-Zustand, statt eine leere Liste zu schicken – die läse das
    // Backend als „hier läuft nichts" (siehe ports.ts).
    const states = await this.runtime.list();
    const observedAt = new Date().toISOString();

    // Derselbe Ist-Zustand richtet auch die Live-Kanäle aus (Audit
    // event-flow-01). Das ist die Stelle, an der ein bereits laufender Container
    // nach dem Agent-Start und nach jedem Soll/Ist-Abgleich seine Konsole und
    // seine Messwerte zurückbekommt – ohne sie käme Live-Ausgabe erst nach dem
    // nächsten START.
    await this.syncLiveChannels(states);

    return states.map((state) => toAgentContainerState(state, observedAt));
  }

  /**
   * Übersetzung Befehl → Runtime-Aufruf.
   *
   * Die Nutzdaten sind an dieser Stelle bereits gegen das Schema geprüft; das
   * `as`-Cast je Zweig gleicht nur aus, dass TypeScript den Zusammenhang
   * zwischen Befehlsname und Schema-Tabelle nicht selbst verengt.
   */
  private async dispatch(
    command: ImplementedAgentCommandName,
    payload: unknown,
    serverId: string | null,
  ): Promise<unknown> {
    switch (command) {
      case 'CREATE': {
        const p = payload as CreatePayload;
        const spec = toContainerSpec(p, serverId);

        /*
         * Datenordner anlegen, bevor Docker es tut (Gefundener Punkt 117): Eine
         * fehlende Bind-Quelle erzeugt der Daemon als `root:root`, und ein
         * Spielprozess, der nicht als root laeuft, koennte darin nicht
         * schreiben. Legt ihn der Agent an, gehoert er dessen UID.
         *
         * Ohne Job-Modul bleibt es beim alten Verhalten - der Adapter laeuft
         * dann ohne Dateisystem-Zugriff (Tests), und das Anlegen selbst soll
         * daran nicht scheitern.
         */
        await this.jobs?.files.ensureDataDirectory(spec.dataVolume.hostPath);

        const handle = await this.runtime.create(spec);

        /*
         * Route des Hostname-Routers, falls der Bauplan die Labels dafuer
         * traegt (Pflichtenheft §2.4, §13). Ein Container ohne diese Labels -
         * derzeit jeder - erzeugt keine Datei.
         *
         * ERST NACH dem Anlegen: Eine Route ohne Container zeigte ins Leere,
         * und ein gescheitertes CREATE liesse sie liegen. Umgekehrt ist eine
         * Sekunde ohne Route folgenlos, denn gestartet wird der Container
         * ohnehin erst danach.
         */
        await this.jobs?.router.writeFromSpec(spec);

        return { containerId: handle.containerId, name: handle.name, warnings: handle.warnings };
      }
      case 'START': {
        const p = payload as { containerId: string };
        await this.runtime.start(p.containerId);
        // Erst jetzt, nach dem erfolgreichen Start: Die Live-Streams der Engine
        // enden mit dem Container, ein Abonnement von vorher wäre also tot.
        await this.renewLiveChannels(p.containerId);
        return null;
      }
      case 'STOP': {
        const p = payload as { containerId: string; timeoutSeconds?: number };
        await this.runtime.stop(p.containerId, optionalTimeout(p.timeoutSeconds));
        await this.closeLiveChannels(p.containerId);
        return null;
      }
      case 'RESTART': {
        const p = payload as { containerId: string; timeoutSeconds?: number };
        await this.runtime.restart(p.containerId, optionalTimeout(p.timeoutSeconds));
        // Wie bei START: Der Neustart hat die alten Streams beendet.
        await this.renewLiveChannels(p.containerId);
        return null;
      }
      case 'DELETE': {
        const p = payload as { containerId: string; removeVolumes?: boolean; force?: boolean };
        await this.runtime.remove(p.containerId, {
          ...(p.removeVolumes === undefined ? {} : { removeVolumes: p.removeVolumes }),
          ...(p.force === undefined ? {} : { force: p.force }),
        });
        // Nur nach erfolgreichem Entfernen – scheitert DELETE (etwa 409, weil
        // der Container noch läuft), behält er seine Live-Kanäle.
        await this.closeLiveChannels(p.containerId);

        /*
         * Und die Route mit (Pflichtenheft §2.4, §13). Sie hängt an der
         * Server-Id, nicht an der Container-Id: Der Befehl nennt nur letztere,
         * die Id des Servers steht aber im Rahmen jedes Befehls. Eine fehlende
         * Datei ist kein Fehler - der Regelfall ist ein Server, der nie eine
         * hatte.
         */
        await this.jobs?.router.remove(serverId);

        return null;
      }
      case 'GET_STATS': {
        const p = payload as { containerId: string };
        const stats = await this.runtime.getStats(p.containerId);

        /*
         * Plattenplatz kommt nicht aus der Container-Engine (Fundpunkt 168):
         * Der Datenordner ist ein Bind-Mount, und `blockReadBytes` zählt
         * Ein-/Ausgabe, nicht Belegung. Er wird deshalb hier ergänzt, aus der
         * eigenen Messung am Ordner.
         *
         * `usedMb()` wartet nie auf das Dateisystem, sondern gibt den letzten
         * bekannten Wert heraus und stößt die Messung nur an – ein langsamer
         * Weltordner verzögert damit keine Antwort. Solange nichts gemessen
         * ist, bleibt das Feld weg: „nicht gemessen" ist etwas anderes als
         * „null Bytes belegt", und aus einer fehlenden Messung darf nie eine
         * Warnung entstehen.
         *
         * Ohne Job-Modul (`jobs` nicht eingehängt) oder ohne `serverId` bleibt
         * es ebenfalls weg – dann gibt es keinen Ordner, den man messen könnte.
         */
        const belegtMb =
          serverId === null ? null : (this.jobs?.serverDisk.usedMb(serverId) ?? null);

        return {
          ...stats,
          ...(belegtMb === null ? {} : { diskUsedBytes: belegtMb * 1024 * 1024 }),
        };
      }
      case 'GET_LOGS': {
        const p = payload as {
          containerId: string;
          tail?: number;
          since?: string;
          includeStdout?: boolean;
          includeStderr?: boolean;
        };
        const lines = await this.runtime.getLogs(p.containerId, {
          ...(p.tail === undefined ? {} : { tail: p.tail }),
          ...(p.since === undefined ? {} : { since: p.since }),
          ...(p.includeStdout === undefined ? {} : { includeStdout: p.includeStdout }),
          ...(p.includeStderr === undefined ? {} : { includeStderr: p.includeStderr }),
        });
        return {
          containerId: p.containerId,
          lines: lines.map((line) => ({
            stream: line.stream,
            message: line.message,
            timestamp: line.timestamp,
          })),
        };
      }
      case 'EXEC_CONSOLE': {
        const p = payload as ExecConsoleCommandPayload;

        if (p.rcon !== undefined) {
          // Spiele mit RCON-Anschluss (P2-9): Der Befehl geht an den Container
          // im Spielenetz und die Antwort kommt zurück. Das braucht die Jobs
          // (Datenordner für das Passwort) und die Server-Id für den Ordner.
          if (this.jobs === undefined) {
            throw new MissingAgentJobsError();
          }

          if (serverId === null) {
            return {
              exitCode: 1,
              stdout: '',
              stderr: 'RCON braucht die Server-Id im Befehl – sie fehlt.',
            };
          }

          const result = await this.jobs.rcon.exec(serverId, p.containerId, p.rcon, p.command);
          return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
        }

        const result = await this.runtime.execConsole(p.containerId, p.command);
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      }
      case 'FILE_LIST': {
        const p = payload as { containerId: string; path: string };
        const entries = await this.runtime.listFiles(p.containerId, p.path);
        return {
          containerId: p.containerId,
          path: p.path,
          entries: entries.map((e) => ({ ...e })),
        };
      }
      case 'FILE_READ': {
        const p = payload as { containerId: string; path: string };
        const content = await this.runtime.readFile(p.containerId, p.path);
        return {
          containerId: p.containerId,
          path: p.path,
          contentBase64: content.toString('base64'),
          sizeBytes: content.byteLength,
        };
      }
      case 'FILE_WRITE': {
        const p = payload as { containerId: string; path: string; contentBase64: string };
        await this.runtime.writeFile(p.containerId, p.path, Buffer.from(p.contentBase64, 'base64'));
        return null;
      }
      case 'FILE_DELETE':
        // Loeschen laeuft host-seitig im Job-Modul (A3), nicht ueber die
        // Container-Runtime: Die Engine-API kennt kein Loeschen, und `exec`
        // braeuchte einen laufenden Container (WORK_STATUS.md, Punkt 105).
        return this.requireJobs().files.delete(payload as FileDeleteCommandPayload);
      case 'FILE_UPLOAD': {
        const p = payload as {
          containerId: string;
          path: string;
          contentBase64: string;
          overwrite?: boolean;
        };
        await this.runtime.uploadFile(
          p.containerId,
          p.path,
          Buffer.from(p.contentBase64, 'base64'),
          { ...(p.overwrite === undefined ? {} : { overwrite: p.overwrite }) },
        );
        return null;
      }
      case 'UPLOAD_ARCHIVE_BLOCK':
        // Blockweise Uebertragung: Das Zusammensetzen ist Dateisystemarbeit und
        // liegt deshalb im Job-Modul (Gefundener Punkt 106).
        return this.requireJobs().archiveUploads.receive(
          payload as UploadArchiveBlockCommandPayload,
        );
      case 'FILE_EXTRACT': {
        const p = payload as {
          containerId: string;
          path: string;
          contentBase64: string;
          format: 'tar.gz' | 'zip';
        };

        return this.runtime.extractArchive(
          p.containerId,
          p.path,
          Buffer.from(p.contentBase64, 'base64'),
          p.format,
        );
      }

      // ------------------------------------------------------------- Jobs (A3)
      // Die Zweige unten laufen nur mit eingehängtem Job-Modul; execute() hat
      // das vorher geprüft.

      case 'CREATE_BACKUP':
        return this.requireJobs().backups.createBackup(payload as CreateBackupCommandPayload);
      case 'RESTORE_BACKUP':
        return this.requireJobs().backups.restoreBackup(payload as RestoreBackupCommandPayload);
      case 'DOWNLOAD_BACKUP':
        return this.requireJobs().backups.downloadBackup(payload as DownloadBackupCommandPayload);
      case 'DELETE_BACKUP':
        return this.requireJobs().backups.deleteBackup(payload as DeleteBackupCommandPayload);
      case 'GET_STORAGE_BREAKDOWN':
        return this.requireJobs().storage.scan(payload as GetStorageBreakdownCommandPayload);
      case 'REMOVE_STORAGE_ENTRY':
        return this.requireJobs().storage.remove(payload as RemoveStorageEntryCommandPayload);
      case 'SET_SERVER_QUERY': {
        const p = payload as SetServerQueryCommandPayload;
        return this.requireJobs().query.setTarget(p.serverId, p.target);
      }
    }
  }

  /**
   * Live-Kanäle eines Containers öffnen, sofern noch keine offen sind.
   *
   * Ein Fehlschlag lässt den auslösenden Befehl bewusst **nicht** scheitern: Der
   * Container läuft, es fehlen nur Konsole und Live-Messwerte. Der Grund steht
   * dafür im Log der Node.
   */
  private async openLiveChannels(containerId: string): Promise<void> {
    if (this.liveChannels.has(containerId)) {
      return;
    }

    // Platzhalter vor dem `await`: Zwei gleichzeitige Aufrufe (START und
    // Ist-Zustands-Bericht) dürfen nicht zwei Stream-Paare öffnen.
    this.liveChannels.set(containerId, null);
    try {
      const abmelden = await this.runtime.watch(containerId);
      if (!this.liveChannels.has(containerId)) {
        // Zwischenzeitlich abgemeldet (STOP/DELETE): sofort wieder schließen.
        abmelden();
        return;
      }
      this.liveChannels.set(containerId, abmelden);
    } catch (fehler) {
      this.liveChannels.delete(containerId);
      this.log.warn('Live-Kanäle konnten nicht geöffnet werden', {
        containerId,
        fehler: fehler instanceof Error ? fehler.message : String(fehler),
      });
    }
  }

  /** Live-Kanäle schließen und wieder öffnen – nach START und RESTART. */
  private async renewLiveChannels(containerId: string): Promise<void> {
    await this.closeLiveChannels(containerId);
    await this.openLiveChannels(containerId);
  }

  /**
   * Live-Kanäle eines Containers schließen.
   *
   * Bewusst über `unwatch()` statt nur über die gemerkte Abmeldung: Nach einem
   * Neustart des Adapters können in der Runtime noch Abonnements hängen, die
   * hier nicht mehr bekannt sind.
   */
  private async closeLiveChannels(containerId: string): Promise<void> {
    this.liveChannels.delete(containerId);
    try {
      await this.runtime.unwatch(containerId);
    } catch (fehler) {
      this.log.warn('Live-Kanäle konnten nicht geschlossen werden', {
        containerId,
        fehler: fehler instanceof Error ? fehler.message : String(fehler),
      });
    }
  }

  /** Live-Kanäle am gemeldeten Ist-Zustand ausrichten. */
  private async syncLiveChannels(states: readonly ContainerState[]): Promise<void> {
    for (const state of states) {
      if (state.status === 'running') {
        await this.openLiveChannels(state.containerId);
      } else if (this.liveChannels.has(state.containerId)) {
        await this.closeLiveChannels(state.containerId);
      }
    }
  }

  private requireJobs(): AgentJobs {
    if (this.jobs === undefined) {
      // Kann nur passieren, wenn JOB_COMMANDS und dieser Zweig auseinanderlaufen
      // – ein Test hält beide zusammen. Der eigene Fehlertyp sorgt dafür, dass
      // die Antwort auch dann ehrlich bleibt (Audit agent-conn-03): ein
      // generischer `Error` käme über `toErrorResponse` als
      // AGENT_COMMAND_FAILED heraus und behauptete damit einen Fehlschlag,
      // wo schlicht nichts gebaut ist.
      throw new MissingAgentJobsError();
    }
    return this.jobs;
  }
}

/**
 * „Dieser Befehl braucht das Job-Modul (A3), und es ist nicht eingehängt."
 *
 * Eigener Typ statt eines generischen `Error`, damit {@link toErrorResponse}
 * ihn erkennt. Exportiert, weil ein Test prüft, dass er nie auftritt – solange
 * {@link JOB_COMMANDS} vollständig ist, greift schon das Gate in `execute()`.
 */
export class MissingAgentJobsError extends Error {
  constructor() {
    super('Das Job-Modul (A3) ist nicht eingehängt.');
    this.name = 'MissingAgentJobsError';
  }
}

/**
 * Befehle, die das Job-Modul (A3) brauchen.
 *
 * Steht als eigene Liste da und nicht als Negation der Runtime-Befehle: So
 * fällt beim Ergänzen eines Befehls auf, auf welcher Seite er landet.
 */
export const JOB_COMMANDS: ReadonlySet<AgentCommandName> = new Set([
  'CREATE_BACKUP',
  'RESTORE_BACKUP',
  'DOWNLOAD_BACKUP',
  'DELETE_BACKUP',
  'GET_STORAGE_BREAKDOWN',
  'SET_SERVER_QUERY',
  'REMOVE_STORAGE_ENTRY',
  // Beide fehlten hier, obwohl ihre Zweige in dispatch() `requireJobs()` rufen
  // (Audit agent-conn-03): Ein Adapter ohne Job-Modul beantwortete sie mit
  // AGENT_COMMAND_FAILED statt AGENT_COMMAND_NOT_IMPLEMENTED - das Backend
  // konnte „nicht gebaut" nicht mehr von „hat nicht funktioniert" trennen.
  'FILE_DELETE',
  'UPLOAD_ARCHIVE_BLOCK',
]);

/** Nutzdaten von `CREATE`, wie sie das Schema liefert. */
type CreatePayload = {
  name: string;
  image: string;
  env: Record<string, string>;
  command?: string[];
  ports: { containerPort: number; hostPort: number; protocol: 'tcp' | 'udp' }[];
  resources: { memoryMb: number; cpuCores: number; pidsLimit?: number };
  dataVolume: { hostPath: string; containerPath: string; readOnly?: boolean };
  extraMounts?: { hostPath: string; containerPath: string; readOnly?: boolean }[];
  readOnlyRootFilesystem?: boolean;
  tmpfsPaths?: string[];
  labels?: Record<string, string>;
  workingDir?: string;
  user?: string;
  stopTimeoutSeconds?: number;
};

function optionalTimeout(timeoutSeconds: number | undefined): { timeoutSeconds?: number } {
  return timeoutSeconds === undefined ? {} : { timeoutSeconds };
}

/**
 * Wire-Format → `ContainerSpec` der Runtime.
 *
 * Optionale Felder werden nur gesetzt, wenn sie tatsächlich ankommen: Ein
 * explizites `undefined` würde in der Runtime die dortige sichere Vorgabe
 * überschreiben (z. B. bei `readOnlyRootFilesystem`).
 */
export function toContainerSpec(payload: CreatePayload, serverId?: string | null): ContainerSpec {
  return {
    name: payload.name,
    image: payload.image,
    env: payload.env,
    ports: payload.ports.map((port) => ({
      containerPort: port.containerPort,
      hostPort: port.hostPort,
      protocol: port.protocol,
    })),
    resources: {
      memoryMb: payload.resources.memoryMb,
      cpuCores: payload.resources.cpuCores,
      ...(payload.resources.pidsLimit === undefined
        ? {}
        : { pidsLimit: payload.resources.pidsLimit }),
    },
    dataVolume: toVolumeMount(payload.dataVolume),
    ...(payload.command === undefined ? {} : { command: payload.command }),
    ...(payload.extraMounts === undefined
      ? {}
      : { extraMounts: payload.extraMounts.map(toVolumeMount) }),
    ...(payload.readOnlyRootFilesystem === undefined
      ? {}
      : { readOnlyRootFilesystem: payload.readOnlyRootFilesystem }),
    ...(payload.tmpfsPaths === undefined ? {} : { tmpfsPaths: payload.tmpfsPaths }),
    ...(payload.labels === undefined ? {} : { labels: payload.labels }),
    ...(payload.workingDir === undefined ? {} : { workingDir: payload.workingDir }),
    ...(payload.user === undefined ? {} : { user: payload.user }),
    ...(payload.stopTimeoutSeconds === undefined
      ? {}
      : { stopTimeoutSeconds: payload.stopTimeoutSeconds }),
    ...(serverId === undefined || serverId === null ? {} : { serverId }),
  };
}

function toVolumeMount(mount: { hostPath: string; containerPath: string; readOnly?: boolean }) {
  return {
    hostPath: mount.hostPath,
    containerPath: mount.containerPath,
    ...(mount.readOnly === undefined ? {} : { readOnly: mount.readOnly }),
  };
}

/**
 * Runtime-Zustand → Protokoll-Zustand.
 *
 * Die `serverId` steht als Label am Container (A2 setzt sie beim Anlegen) und
 * kommt seit Gefundenem Punkt 19 von dort – nicht mehr aus dem Container-Namen.
 * Fehlt das Label, meldet der Adapter `null` statt zu raten, und das Backend
 * behandelt den Container als nicht zuordenbar.
 */
export function toAgentContainerState(
  state: ContainerState,
  observedAt: string,
): AgentContainerState {
  return {
    serverId: state.serverId,
    containerId: state.containerId,
    status: CONTAINER_STATUS_MAP[state.status],
    exitCode: state.exitCode,
    startedAt: state.startedAt,
    observedAt,
  };
}

/** Runtime-Ereignis → Protokoll-Ereignis. */
export function toOutboundEvent(event: ContainerRuntimeEvent): OutboundEvent {
  switch (event.type) {
    case 'STATUS_CHANGED':
      return {
        event: 'STATUS_CHANGED',
        serverId: null,
        payload: {
          containerId: event.containerId,
          status: CONTAINER_STATUS_MAP[event.status],
          previousStatus:
            event.previousStatus === null ? null : CONTAINER_STATUS_MAP[event.previousStatus],
          exitCode: event.exitCode,
          at: event.at,
        },
      };
    case 'STATS_UPDATE':
      return {
        event: 'STATS_UPDATE',
        serverId: null,
        payload: { ...event.stats, at: event.at },
      };
    case 'LOG_LINE':
      return {
        event: 'LOG_LINE',
        serverId: null,
        payload: {
          containerId: event.containerId,
          stream: event.line.stream,
          message: event.line.message,
          timestamp: event.line.timestamp,
          at: event.at,
        },
      };
    case 'CRASHED':
      return {
        event: 'CRASHED',
        serverId: null,
        payload: {
          containerId: event.containerId,
          exitCode: event.exitCode,
          oomKilled: event.oomKilled,
          at: event.at,
        },
      };
  }
}

/** Fehler der Runtime → Fehlerantwort im Envelope-Format (Pflichtenheft §5.1). */
export function toErrorResponse(command: AgentCommandName, error: unknown): ApiResponse<never> {
  if (isContainerRuntimeError(error)) {
    return fail(RUNTIME_ERROR_TO_API_CODE[error.code], `${command}: ${error.message}`);
  }

  if (error instanceof MissingAgentJobsError) {
    return fail(
      'AGENT_COMMAND_NOT_IMPLEMENTED',
      `${command} braucht das Job-Modul (A3), das in diesem Agent nicht eingehängt ist.`,
    );
  }

  const meldung = error instanceof Error ? error.message : String(error);
  return fail('AGENT_COMMAND_FAILED', `${command}: ${meldung}`);
}
