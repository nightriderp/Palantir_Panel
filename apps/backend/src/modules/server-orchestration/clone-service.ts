/**
 * Klonen eines Servers als Hintergrund-Auftrag (Pflichtenheft §9, Lastenheft
 * §3.3, Arbeitspaket P7).
 *
 * Aus `service.ts` herausgelöst (Review 2026-09-16, Befund 2.1). Der Dienst
 * hält den Auftragsspeicher und den Ablauf; alles, was in den übrigen Dienst
 * hineingreift (Server anlegen, als fehlgeschlagen markieren, Ereignis melden),
 * bekommt er als schmale Funktionen gereicht. `ServerOrchestrationService`
 * reicht `cloneServer` und `findCloneJob` unverändert durch.
 */

import { randomUUID } from 'node:crypto';
import { type ServerCloneJobDto } from '@palantir/contracts';
import { type CloneServerInput, type CreateServerInput } from '@palantir/validation';
import { type AgentGatewayLogger, type AgentRegistry } from './agent-gateway.js';
import { type CloneJobProgress, type CloneJobStore, createCloneJobStore } from './clone-jobs.js';
import { ServerOrchestrationError } from './errors.js';
import { fireAndForget } from '../../lib/fire-and-forget.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { normalizeSubdomain } from './subdomain.js';

export interface CloneEventSink {
  emit(event: string, payload: Record<string, unknown>): void;
}

export interface ServerCloneServiceDependencies {
  readonly repository: Pick<ServerRepository, 'isSubdomainTaken' | 'findById'>;
  readonly agents: Pick<AgentRegistry, 'require'>;
  readonly events: CloneEventSink;
  readonly log: AgentGatewayLogger;
  readonly now: () => Date;
  /** Wie `ServerOrchestrationService.requireServer`. */
  readonly requireServer: (serverId: string) => Promise<ServerRecord>;
  /**
   * Wie `createServerInternal()` – dieselbe Prüfkette wie beim Anlegen, mit
   * dem Ursprungsserver als `clonedFromServerId`.
   */
  readonly createServer: (
    input: CreateServerInput,
    ownerId: string,
    clonedFromServerId: string,
  ) => Promise<ServerRecord>;
  /** Datenordner eines Servers auf dem Homeserver (`dataHostPathFor`). */
  readonly dataHostPathFor: (serverId: string) => string;
  /** Server in `error` versetzen – der Übergang `failed` der State Machine. */
  readonly markFailed: (server: ServerRecord, reason: string) => Promise<void>;
  /** Wie `emitServerEvent()` – mit vollständiger Nutzlast nach §14. */
  readonly emitServerEvent: (
    event: string,
    server: ServerRecord | string,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
}

export class ServerCloneService {
  private readonly deps: ServerCloneServiceDependencies;
  private readonly cloneJobs: CloneJobStore;

  constructor(deps: ServerCloneServiceDependencies) {
    this.deps = deps;
    this.cloneJobs = createCloneJobStore({ now: deps.now });
  }

  /**
   * Klont einen Server.
   *
   * „Erzeugt einen neuen `GameServer`-Datensatz mit kopierter Konfiguration und
   * zwingend neuer, eigener Subdomain (gleiche Prüf-/Formatregeln wie bei
   * Neuerstellung); Weltdaten werden optional mitkopiert, Fortschritt wird im
   * Frontend angezeigt."
   *
   * **Auftrag statt langer Antwort (P7).** Der Aufruf liefert sofort den
   * `ServerCloneJobDto`; die eigentliche Arbeit läuft im Hintergrund weiter und
   * meldet sich über `serverClone.progressed`. Vorher gab dieselbe Methode erst
   * nach dem vollständigen Anlegen einen Serverdatensatz zurück – bei einer
   * mitkopierten Welt wären das Minuten mit offener Verbindung, und das
   * Frontend erwartete ohnehin schon den Auftrag.
   *
   * Die neue Subdomain ist Pflicht und durchläuft dieselbe Prüfkette –
   * `createServer` wird dafür bewusst wiederverwendet. Eine bereits vergebene
   * Subdomain fällt deshalb **vor** dem Auftrag auf und wird als Fehler
   * beantwortet, nicht als fehlgeschlagener Auftrag: Ein Auftrag, der nie eine
   * Chance hatte, wäre nur ein Umweg zur selben Meldung.
   */
  async cloneServer(
    sourceServerId: string,
    input: CloneServerInput,
    ownerId: string,
  ): Promise<ServerCloneJobDto> {
    const source = await this.deps.requireServer(sourceServerId);

    // Vorab dieselbe Prüfung, die das Anlegen gleich noch einmal macht: Sie ist
    // die einzige, die schon feststeht, bevor irgendetwas läuft.
    if (await this.deps.repository.isSubdomainTaken(normalizeSubdomain(input.subdomain))) {
      throw new ServerOrchestrationError('SUBDOMAIN_TAKEN', undefined, {
        subdomain: input.subdomain,
      });
    }

    const job = this.cloneJobs.create({
      sourceServerId,
      targetName: input.name,
      targetSubdomain: input.subdomain,
      includeWorldData: input.includeWorldData,
    });

    this.publishCloneJob(job);

    // Bewusst nicht abgewartet: Der Aufrufer bekommt den Auftrag sofort. Der
    // Hintergrundlauf fängt jeden Fehler selbst ab und schreibt ihn in den
    // Auftrag; das Netz darunter fängt, was daran vorbeigeht (Fundpunkt 126).
    fireAndForget(this.runCloneJob(job.id, source, input, ownerId), this.deps.log, {
      vorgang: 'Klon-Auftrag',
      serverId: sourceServerId,
      jobId: job.id,
    });

    return job;
  }

  /** Stand eines Klon-Auftrags (Route `GET /api/servers/:id/clone/:jobId`). */
  findCloneJob(sourceServerId: string, jobId: string): ServerCloneJobDto | null {
    const job = this.cloneJobs.find(jobId);

    // Ein Auftrag an einem anderen Server wird wie ein fehlender gemeldet – die
    // Antwort soll nicht verraten, was an fremden Servern läuft.
    return job !== null && job.serverId === sourceServerId ? job : null;
  }

  /** Meldet den Auftragsstand an den Live-Kanal (Contract `serverClone.progressed`). */
  private publishCloneJob(job: ServerCloneJobDto): void {
    this.deps.events.emit('serverClone.progressed', { serverId: job.serverId, job });
  }

  private advanceCloneJob(jobId: string, progress: CloneJobProgress): void {
    const job = this.cloneJobs.update(jobId, progress);

    if (job !== null) {
      this.publishCloneJob(job);
    }
  }

  /**
   * Der eigentliche Klon-Lauf.
   *
   * Fehler beenden den Auftrag mit `failed` und einem Text, statt zu werfen:
   * Auf diesen Aufruf wartet niemand mehr.
   */
  private async runCloneJob(
    jobId: string,
    source: ServerRecord,
    input: CloneServerInput,
    ownerId: string,
  ): Promise<void> {
    /*
     * Der bereits angelegte Zielserver – gebraucht im Fehlerfall (Audit
     * orchestration-features-04). Bleibt `null`, solange das Anlegen nicht
     * durch ist; scheitert es selbst, hat sein Rollback den Datensatz schon
     * entfernt.
     */
    let ziel: ServerRecord | null = null;

    try {
      this.advanceCloneJob(jobId, {
        status: 'running',
        progressPercent: 5,
        step: 'Server wird angelegt',
      });

      const clone = await this.deps.createServer(
        {
          name: input.name,
          gameType: source.gameType,
          subdomain: input.subdomain,
          hostId: source.hostId,
          resourceLimits: source.resourceLimits,
          config: { ...source.configJson },
          startupParameters: source.startupParameters,
          autoShutdownEnabled: source.autoShutdown.enabled,
          worldImport: null,
        },
        ownerId,
        source.id,
      );

      ziel = clone;

      this.advanceCloneJob(jobId, {
        targetServerId: clone.id,
        progressPercent: input.includeWorldData ? 30 : 90,
        step: input.includeWorldData ? 'Weltdaten werden gesichert' : 'Klon wird abgeschlossen',
      });

      if (input.includeWorldData) {
        await this.copyWorldData(
          jobId,
          source,
          await this.deps.requireServer(clone.id),
          input.stopSourceServer === true,
        );
      }

      await this.deps.emitServerEvent('server.cloned', clone, {
        sourceServerId: source.id,
        copiedWorldData: input.includeWorldData,
      });

      const fertig = this.cloneJobs.finish(jobId, 'completed');

      if (fertig !== null) {
        this.publishCloneJob(fertig);
      }
    } catch (error: unknown) {
      const grund = error instanceof Error ? error.message : 'Unbekannter Fehler.';

      /*
       * Der Zielserver darf nicht unauffällig stehen bleiben (Audit
       * orchestration-features-04): Der Klon-Auftrag ist nach 15 Minuten
       * vergessen, danach deutete nichts mehr darauf hin, dass diesem Server
       * die Welt fehlt – der Nutzer startet ihn und spielt auf leerer Welt
       * weiter.
       */
      if (ziel !== null) {
        await this.markCloneTargetFailed(ziel, grund);
      }

      const gescheitert = this.cloneJobs.finish(jobId, 'failed', grund);

      this.deps.log.error(
        { jobId, sourceServerId: source.id, targetServerId: ziel?.id ?? null, error: grund },
        'Klon fehlgeschlagen',
      );

      if (gescheitert !== null) {
        this.publishCloneJob(gescheitert);
      }
    }
  }

  /**
   * Markiert einen Klon, dessen Weltdaten-Übernahme gescheitert ist, als
   * `error` – mit einem Hinweis, der den Grund benennt.
   *
   * Bewusst **kein** Löschen: Auf der Node liegen bereits Container und
   * Datenordner, und je nachdem, wie weit `RESTORE_BACKUP` gekommen ist, auch
   * schon Teile der Welt. Sie ungefragt wegzuräumen wäre der schlechtere
   * Eingriff – dieselbe Begründung wie an `rollbackFailedCreate()`. Der Nutzer
   * sieht den Fehlerzustand samt Meldung und entscheidet selbst.
   *
   * Scheitert das Markieren, bleibt es beim Log: Der Klon-Auftrag ist die
   * eigentliche Antwort auf den Vorgang, und der wird ohnehin als `failed`
   * gemeldet.
   */
  private async markCloneTargetFailed(clone: ServerRecord, grund: string): Promise<void> {
    const hinweis = `Die Weltdaten des Ursprungsservers konnten nicht übernommen werden: ${grund} Der Server ist angelegt, seine Welt aber leer.`;

    try {
      const aktuell = await this.deps.repository.findById(clone.id);

      if (aktuell === null) {
        return;
      }

      await this.deps.markFailed(aktuell, hinweis);
      await this.deps.emitServerEvent('server.failed', aktuell.id, { detail: hinweis });
    } catch (error: unknown) {
      this.deps.log.warn(
        {
          serverId: clone.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Gescheiterter Klon konnte nicht als fehlerhaft markiert werden',
      );
    }
  }

  /**
   * Kopiert die Weltdaten in den Klon (Lastenheft §3.3, Arbeitspaket P7).
   *
   * **Über die vorhandene Backup-Mechanik, nicht über einen neuen Befehl.** Der
   * Datenordner wird auf dem Homeserver gepackt (`CREATE_BACKUP`), in den
   * Datenordner des Klons entpackt (`RESTORE_BACKUP`) und das Zwischenarchiv
   * wieder entfernt (`DELETE_BACKUP`). Alle drei Befehle sind seit A3 umgesetzt;
   * ein eigener Kopier-Befehl wäre eine vierte Art, dieselbe Dateisystemarbeit
   * zu beschreiben (Entwicklungsregeln §3). Der Umweg über das Archiv bringt
   * außerdem die Prüfsumme mit: `RESTORE_BACKUP` vergleicht sie, bevor es etwas
   * schreibt (Fundpunkt 99).
   *
   * **Der Quellserver wird nicht angehalten.** Er gehört dem Nutzer und läuft
   * womöglich mit Spielern darauf; ihn für einen Klon abzuschalten wäre ein
   * Eingriff, um den niemand gebeten hat. Die Kopie entspricht damit einer
   * Sicherung im laufenden Betrieb – dieselbe Einschränkung, die
   * `BackupDto.containerStopped` beschreibt.
   *
   * Das Zwischenarchiv wird auch dann entfernt, wenn das Zurückspielen
   * scheitert: Sonst bliebe eine vollständige Kopie der Welt ohne Besitzer auf
   * der Platte liegen.
   */
  private async copyWorldData(
    jobId: string,
    source: ServerRecord,
    clone: ServerRecord,
    stopSource: boolean,
  ): Promise<void> {
    const session = this.deps.agents.require(source.hostId);
    const archivId = randomUUID();

    /*
     * `stopContainer` kommt aus der Anfrage (`stopSourceServer`, Gefundener
     * Punkt 107): Ein laufender Spielserver schreibt weiter in die Dateien, die
     * gerade gepackt werden, und die Kopie enthielte dann einen halb
     * geschriebenen Spielstand. Angehalten wird nur auf ausdrücklichen Wunsch –
     * den Server eines Nutzers ungefragt abzuschalten wäre ein Eingriff, um den
     * niemand gebeten hat. Der Agent versetzt den Container danach in seinen
     * vorherigen Zustand zurück (`backup-job.ts`).
     */
    const gesichert = await session.sendCommand('CREATE_BACKUP', source.id, {
      backupId: archivId,
      serverId: source.id,
      sourcePath: this.deps.dataHostPathFor(source.id),
      ...(source.dockerContainerId === null ? {} : { containerId: source.dockerContainerId }),
      stopContainer: stopSource,
    });

    this.advanceCloneJob(jobId, {
      progressPercent: 60,
      step: gesichert.containerStopped
        ? 'Weltdaten werden übertragen (Quellserver angehalten)'
        : 'Weltdaten werden übertragen',
      totalBytes: gesichert.sizeBytes,
    });

    try {
      await session.sendCommand('RESTORE_BACKUP', clone.id, {
        backupId: archivId,
        serverId: clone.id,
        storagePath: gesichert.storagePath,
        targetPath: this.deps.dataHostPathFor(clone.id),
        expectedChecksum: gesichert.checksumSha256,
        ...(clone.dockerContainerId === null ? {} : { containerId: clone.dockerContainerId }),
      });
    } finally {
      try {
        await session.sendCommand('DELETE_BACKUP', source.id, {
          backupId: archivId,
          storagePath: gesichert.storagePath,
        });
      } catch (error: unknown) {
        // Ein liegengebliebenes Zwischenarchiv ist ärgerlich, aber kein Grund,
        // einen sonst gelungenen Klon als gescheitert zu melden. Der
        // Speicher-Explorer (B8) findet es als verwaisten Posten.
        this.deps.log.warn(
          {
            sourceServerId: source.id,
            storagePath: gesichert.storagePath,
            error: error instanceof Error ? error.message : String(error),
          },
          'Zwischenarchiv des Klons konnte nicht entfernt werden',
        );
      }
    }

    this.advanceCloneJob(jobId, {
      progressPercent: 90,
      step: 'Klon wird abgeschlossen',
      copiedBytes: gesichert.sizeBytes,
    });
  }
}
