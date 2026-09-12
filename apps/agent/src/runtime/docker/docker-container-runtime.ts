/**
 * `ContainerRuntime`-Implementierung gegen die Docker-Engine, angesprochen
 * ausschliesslich ueber den Docker-Socket-Proxy (Pflichtenheft §2.3).
 *
 * Verantwortlich fuer die Uebersetzung der Agent-Befehle aus Pflichtenheft §5.3
 * in Engine-Aufrufe und fuer die vier ausgehenden Events. Die Haertung steckt
 * vollstaendig in `hardening.ts` - hier wird nichts davon nachgebaut oder
 * umgangen.
 */

import path from 'node:path';
import { type ContainerRuntime } from '../container-runtime.js';
import { ContainerRuntimeError, isContainerRuntimeError } from '../errors.js';
import { type RegistryCredentials, pullImage } from './image-pull.js';
import {
  RuntimeEventEmitter,
  type ContainerRuntimeEventListener,
  type Unsubscribe,
} from '../events.js';
import {
  PALANTIR_DATA_VOLUME_PATH_LABEL,
  PALANTIR_MANAGED_LABEL,
  buildCreateContainerBody,
  type HardeningOptions,
} from '../hardening.js';
import { AGENT_FILE_CHANNEL_MAX_BYTES } from '@palantir/contracts';
import { MAX_EXTRACTED_BYTES, type ArchiveKind, readArchive } from '../archive.js';
import { resolveWithinRoot } from '../paths.js';
import {
  DEFAULT_LOG_TAIL,
  type ContainerHandle,
  type ContainerSpec,
  type ContainerImage,
  type ContainerState,
  type ContainerStats,
  type ContainerStatus,
  type DataVolumePaths,
  type ExecResult,
  type ExtractArchiveResult,
  type FileEntry,
  type GetLogsOptions,
  type LogLine,
  type RemoveImageOptions,
  type RemoveOptions,
  type StopOptions,
  type UploadFileOptions,
  type WatchOptions,
} from '../types.js';
import { DockerHttpClient, type DockerStream, type FetchLike } from './http-client.js';
import {
  toContainerState,
  toContainerStats,
  toNetworkAddress,
  type DockerInspectResponse,
  type DockerStatsResponse,
} from './mapping.js';
import { LogLineAssembler, demuxDockerStream, readNdjson } from './stream.js';
import { type TarFileInput, createTar, parseTar, parseTarHeaders } from './tar.js';

/**
 * Obergrenze fuer Dateien, die der Datei-Manager im Speicher bewegt.
 *
 * Bewusst deutlich unter dem Upload-Limit aus `MAX_UPLOAD_SIZE_BYTES` (2 GB):
 * `readFile`/`writeFile` halten den Inhalt komplett im Speicher. Der
 * vollstaendige Export der Serverdaten (Lastenheft §3.3) laeuft nicht hierueber,
 * sondern als Backup-Job in A3.
 *
 * Der Wert kommt aus dem Vertrag (Audit contracts-validation-12): Es ist
 * dieselbe Grenze, gegen die das Backend puffert - vorher stand die 64 MiB
 * zweimal als Literal im Code, und nur ein Kommentar hielt beide Seiten
 * zusammen.
 */
export const DEFAULT_MAX_FILE_BYTES = AGENT_FILE_CHANNEL_MAX_BYTES;

/**
 * Obergrenze fuer ein **Archiv**, das entpackt werden soll (Audit
 * agent-runtime-02).
 *
 * Bewusst nicht {@link DEFAULT_MAX_FILE_BYTES}: `UPLOAD_ARCHIVE_BLOCK` existiert
 * genau deshalb, weil ein gewachsener Weltordner die 64 MiB des Agent-Kanals
 * sprengt (`jobs/files/archive-upload.ts`). Praeft `extractArchive` das
 * zusammengesetzte Archiv gegen die Datei-Grenze, scheitert die blockweise
 * Uebertragung am letzten Block - fuer genau den Fall, fuer den sie gebaut
 * wurde. Die gewollte Grenze ist die des Entpackens.
 */
export const DEFAULT_MAX_ARCHIVE_BYTES = MAX_EXTRACTED_BYTES;

/**
 * Wie viele Eintraege eine Auflistung hoechstens zurueckgibt (Fundpunkt 274).
 *
 * Die Engine kennt keinen Aufruf „nur die Namen": `GET /archive` liefert den
 * Ordner **rekursiv und mit Inhalten**. Fuer die Anzeige der ersten Ebene wurde
 * damit der ganze Baum geholt - bei einer gewachsenen Minecraft-Welt sind das
 * Gigabyte, und sie liefen durch den gemeinsamen Agent-Prozess, also zu Lasten
 * aller Server der Node.
 *
 * Fundpunkt 228 hat dagegen eine Byte-Grenze gezogen (128 MiB) und damit den
 * Speicher gerettet, aber die Auflistung selbst geopfert: Ein Datenordner mit
 * Wine-Prefix und SteamCMD-Kopie ist groesser als das, und der Datei-Manager
 * zeigte dort gar nichts mehr. Seit {@link parseTarHeaders} wird der Strom
 * gelesen, statt ihn zu sammeln - die Inhalte laufen durch, ohne im Speicher
 * zu landen, und eine Byte-Grenze braucht es nicht mehr.
 *
 * Was bleibt, ist die Zahl der gesammelten Eintraege. Zwanzigtausend Namen in
 * einem Ordner sind fuer eine Anzeige ohnehin nicht mehr zu gebrauchen; bis
 * dahin wird gelesen, danach abgeschnitten.
 */
export const MAX_LISTING_ENTRIES = 20_000;

/**
 * Obergrenze fuer die gesammelte Ausgabe eines Konsolenbefehls (`execConsole`).
 *
 * Ein RCON-/Konsolenkommando liefert normalerweise wenige Zeilen; ein Befehl mit
 * riesiger Ausgabe darf den Agent-Speicher nicht bis zum OOM fuellen. Wird die
 * Grenze ueberschritten, bricht der Agent den Ausgabestrom ab und markiert die
 * Ausgabe als gekuerzt.
 */
export const MAX_EXEC_OUTPUT_BYTES = 1024 * 1024;

/**
 * Frist fuer das Holen eines Images.
 *
 * Grosszuegig, weil ein Spiel-Image Hunderte MB mitbringt und der erste Zug auf
 * eine frische Node ueber eine Hausleitung laeuft. Ein zu knapper Wert bricht
 * genau den Zug ab, den er ermoeglichen soll.
 */
export const DEFAULT_PULL_TIMEOUT_MS = 15 * 60 * 1_000;

export interface DockerContainerRuntimeOptions {
  readonly client: DockerHttpClient;
  readonly hardening: HardeningOptions;
  /** Groessenlimit fuer `readFile`/`writeFile`. Vorgabe: {@link DEFAULT_MAX_FILE_BYTES}. */
  readonly maxFileBytes?: number;
  /** Groessenlimit fuer `extractArchive`. Vorgabe: {@link DEFAULT_MAX_ARCHIVE_BYTES}. */
  readonly maxArchiveBytes?: number;
  /** Wird gerufen, wenn ein Hintergrund-Stream unerwartet abbricht. */
  readonly onStreamError?: (fehler: unknown, kontext: Readonly<Record<string, unknown>>) => void;
  /**
   * Zugang zur eigenen Registry (Gefundener Punkt 111).
   *
   * Ohne Angabe holt der Agent nur oeffentliche Images. Die eigenen
   * Spiel-Images liegen privat; der Login des Docker-CLI auf der Node hilft
   * dafuer nicht, weil die Engine-API keine Client-Konfiguration liest.
   */
  readonly registry?: RegistryCredentials | undefined;
  /** Frist fuer das Holen eines Images. Vorgabe: {@link DEFAULT_PULL_TIMEOUT_MS}. */
  readonly pullTimeoutMs?: number;
}

interface DockerEngineEvent {
  readonly status?: string;
  readonly id?: string;
  readonly time?: number;
  readonly Actor?: { readonly ID?: string; readonly Attributes?: Record<string, string> };
}

interface Abonnement {
  readonly cancel: () => void;
}

/** Antwortform von `GET /images/json` - nur die tatsaechlich gelesenen Felder. */
interface DockerImageListEntry {
  readonly Id: string;
  readonly RepoTags?: string[];
  readonly Size?: number;
  /** Unix-Zeit in Sekunden. */
  readonly Created?: number;
}

/** Antwortform von `GET /containers/json` - nur die Felder fuer den Nutzungsstatus. */
interface DockerContainerListEntry {
  readonly Image?: string;
  readonly ImageID?: string;
}

const PALANTIR_LABEL_FILTER = JSON.stringify({
  label: [`${PALANTIR_MANAGED_LABEL}=true`],
});

const ENGINE_EVENT_FILTER = JSON.stringify({
  type: ['container'],
  label: [`${PALANTIR_MANAGED_LABEL}=true`],
});

/**
 * Wartezeiten fuer den Wiederaufbau des Engine-Ereignisstroms: 1 s, 2 s, 4 s …
 * bis hoechstens 30 s (Audit agent-runtime-04).
 *
 * Ohne Jitter - anders als beim Verbindungsaufbau zum Backend gibt es hier
 * keine Herde: Der Agent spricht mit genau einem Socket-Proxy auf derselben
 * Node, und der vertraegt einen Versuch pro Sekunde.
 */
export const ENGINE_RECONNECT_INITIAL_MS = 1_000;
export const ENGINE_RECONNECT_MAX_MS = 30_000;

async function* alsStrom(inhalt: Buffer): AsyncGenerator<Uint8Array> {
  yield inhalt;
}

function istAbbruch(fehler: unknown): boolean {
  return (
    typeof fehler === 'object' &&
    fehler !== null &&
    (fehler as { name?: unknown }).name === 'AbortError'
  );
}

export class DockerContainerRuntime implements ContainerRuntime {
  readonly #client: DockerHttpClient;
  readonly #hardening: HardeningOptions;
  readonly #maxFileBytes: number;
  readonly #maxArchiveBytes: number;
  readonly #registry: RegistryCredentials | undefined;
  readonly #pullTimeoutMs: number;
  readonly #onStreamError: (fehler: unknown, kontext: Readonly<Record<string, unknown>>) => void;

  readonly #emitter = new RuntimeEventEmitter();
  readonly #letzterStatus = new Map<string, ContainerStatus>();
  readonly #abos = new Map<string, Set<Abonnement>>();
  /**
   * Container, deren Beenden von Palantir ausgeloest wurde. Ohne diese Merkliste
   * wuerde jedes regulaere `stop` als `CRASHED` gemeldet, weil die Engine beim
   * Beenden per SIGTERM einen Exit-Code ungleich 0 meldet.
   */
  readonly #erwarteterStopp = new Set<string>();
  /** Container, fuer die die Engine gerade ein OOM-Ereignis gemeldet hat. */
  readonly #oomGemerkt = new Set<string>();
  /**
   * Container-Pfad des Datenvolumes je Container - die Grenze des Datei-Managers
   * (Fundpunkt 100). Container-IDs sind einmalig, deshalb ist der Wert stabil und
   * darf gecacht werden; ohne Cache inspiziert jeder Dateibefehl erneut.
   */
  readonly #datenVolumeWurzeln = new Map<string, string>();

  #eventStream: DockerStream | undefined;
  #verbunden = false;
  /** Laufender Wiederaufbau des Ereignisstroms; `undefined` = keiner geplant. */
  #eventReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** Fehlversuche seit dem letzten erfolgreichen Ereignisstrom - Basis der Wartezeit. */
  #eventVersuche = 0;

  constructor(options: DockerContainerRuntimeOptions) {
    this.#client = options.client;
    this.#registry = options.registry;
    this.#pullTimeoutMs = options.pullTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS;
    this.#hardening = options.hardening;
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.#maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
    this.#onStreamError =
      options.onStreamError ??
      ((fehler, kontext) => {
        console.warn('[runtime] Stream abgebrochen', { fehler, ...kontext });
      });
  }

  // ---------------------------------------------------------------- Lebenszyklus

  async connect(): Promise<void> {
    if (this.#verbunden) return;

    const stream = await this.#oeffneEngineEvents();
    this.#eventStream = stream;
    this.#verbunden = true;
    this.#eventVersuche = 0;

    void this.#leseEngineEvents(stream);
  }

  async dispose(): Promise<void> {
    this.#verbunden = false;

    if (this.#eventReconnectTimer !== undefined) {
      clearTimeout(this.#eventReconnectTimer);
      this.#eventReconnectTimer = undefined;
    }

    for (const containerId of [...this.#abos.keys()]) {
      await this.unwatch(containerId);
    }

    this.#eventStream?.cancel();
    this.#eventStream = undefined;
    this.#emitter.removeAll();
    this.#letzterStatus.clear();
    this.#erwarteterStopp.clear();
    this.#oomGemerkt.clear();
    this.#datenVolumeWurzeln.clear();
  }

  on(listener: ContainerRuntimeEventListener): Unsubscribe {
    return this.#emitter.on(listener);
  }

  // ---------------------------------------------------------------- Lifecycle-Befehle

  async create(spec: ContainerSpec): Promise<ContainerHandle> {
    const body = buildCreateContainerBody(spec, this.#hardening);

    const anlegen = async (): Promise<{ Id: string; Warnings?: string[] }> =>
      this.#client.requestJson<{ Id: string; Warnings?: string[] }>('POST', '/containers/create', {
        query: { name: spec.name },
        body,
        notFoundCode: 'IMAGE_NOT_FOUND',
      });

    let antwort: { Id: string; Warnings?: string[] };

    try {
      antwort = await anlegen();
    } catch (fehler) {
      /*
       * Fehlt das Image, wird es geholt und einmal erneut versucht
       * (Gefundener Punkt 111). Bewusst erst nach dem Fehlschlag statt vorher
       * zu pruefen: Der Normalfall ist das vorhandene Image, und eine Abfrage
       * davor kostete jedes Anlegen eine zusaetzliche Runde zur Engine.
       */
      if (!(fehler instanceof ContainerRuntimeError) || fehler.code !== 'IMAGE_NOT_FOUND') {
        throw fehler;
      }

      await pullImage(this.#client, spec.image, {
        credentials: this.#registry,
        timeoutMs: this.#pullTimeoutMs,
      });

      antwort = await anlegen();
    }

    return { containerId: antwort.Id, name: spec.name, warnings: antwort.Warnings ?? [] };
  }

  async start(containerId: string): Promise<void> {
    // 304 = laeuft bereits. Ein START auf einen laufenden Container ist kein
    // Fehler, sondern der erwartete Ausgang bei einem wiederholten Befehl
    // (Pflichtenheft §2.2, Schutz vor Doppelausfuehrung).
    await this.#client.requestVoid('POST', `${this.#pfad(containerId)}/start`, {
      tolerateStatus: [304],
    });
  }

  async stop(containerId: string, options: StopOptions = {}): Promise<void> {
    /*
     * Das Merken passiert **vor** der Anfrage: Das `die`-Event kann eintreffen,
     * bevor die Engine auf `/stop` antwortet. Verbraucht wird es nur von genau
     * diesem Event - bleibt es liegen, verschluckt es den naechsten echten
     * Absturz (Audit agent-runtime-03). Deshalb wird es im `finally` wieder
     * entfernt, wenn kein `die` folgen kann: bei einem Fehler und bei 304
     * ("war schon gestoppt", laut Interface kein Fehlerfall).
     */
    this.#erwarteterStopp.add(containerId);
    let ausgeloest = false;
    try {
      const status = await this.#client.requestVoid('POST', `${this.#pfad(containerId)}/stop`, {
        query: { t: options.timeoutSeconds },
        tolerateStatus: [304],
      });
      ausgeloest = status !== 304;
    } finally {
      if (!ausgeloest) this.#erwarteterStopp.delete(containerId);
    }
  }

  async restart(containerId: string, options: StopOptions = {}): Promise<void> {
    // Wie bei stop(): Das Flag ueberlebt nur einen tatsaechlich ausgeloesten
    // Neustart. Lief der Container gar nicht, folgt kein `die`; der
    // `start`-Zweig in #verarbeiteEngineEvent raeumt das Flag dann ab.
    this.#erwarteterStopp.add(containerId);
    let ausgeloest = false;
    try {
      await this.#client.requestVoid('POST', `${this.#pfad(containerId)}/restart`, {
        query: { t: options.timeoutSeconds },
      });
      ausgeloest = true;
    } finally {
      if (!ausgeloest) this.#erwarteterStopp.delete(containerId);
    }
  }

  async remove(containerId: string, options: RemoveOptions = {}): Promise<void> {
    this.#erwarteterStopp.add(containerId);
    try {
      await this.#client.requestVoid('DELETE', this.#pfad(containerId), {
        query: { v: options.removeVolumes ?? false, force: options.force ?? false },
      });
    } catch (fehler) {
      /*
       * Nur aufraeumen, wenn der Container wirklich weg ist (Audit
       * agent-runtime-05): Ein DELETE ohne `force` auf einen laufenden
       * Container endet mit 409. Wuerden hier die Abos beendet und der
       * gemerkte Zustand geloescht, waeren Konsole und Messwerte des weiter
       * laufenden Containers still abgeschaltet, und sein naechster
       * Statuswechsel kaeme mit `previousStatus: null` an, als sei er neu.
       * Ein 404 heisst dagegen "existiert nicht mehr" - da ist Aufraeumen
       * richtig, der Fehler geht trotzdem an den Aufrufer.
       */
      this.#erwarteterStopp.delete(containerId);
      if (isContainerRuntimeError(fehler) && fehler.code === 'CONTAINER_NOT_FOUND') {
        await this.#vergesseContainer(containerId);
      }
      throw fehler;
    }

    this.#erwarteterStopp.delete(containerId);
    await this.#vergesseContainer(containerId);
  }

  /** Abos und gemerkten Zustand eines entfernten Containers freigeben. */
  async #vergesseContainer(containerId: string): Promise<void> {
    await this.unwatch(containerId);
    this.#letzterStatus.delete(containerId);
    this.#oomGemerkt.delete(containerId);
    this.#datenVolumeWurzeln.delete(containerId);
  }

  async inspect(containerId: string): Promise<ContainerState> {
    return toContainerState(await this.#inspectRoh(containerId));
  }

  async networkAddress(containerId: string, network: string): Promise<string | null> {
    try {
      return toNetworkAddress(await this.#inspectRoh(containerId), network);
    } catch (fehler: unknown) {
      // Ein Container, den es nicht mehr gibt, hat keine Adresse - das ist
      // fuer die Abfrage eine Antwort, kein Fehler.
      if (isContainerRuntimeError(fehler) && fehler.code === 'CONTAINER_NOT_FOUND') {
        return null;
      }

      throw fehler;
    }
  }

  async #inspectRoh(containerId: string): Promise<DockerInspectResponse> {
    return this.#client.requestJson<DockerInspectResponse>(
      'GET',
      `${this.#pfad(containerId)}/json`,
    );
  }

  async list(): Promise<readonly ContainerState[]> {
    const eintraege = await this.#client.requestJson<{ Id: string }[]>('GET', '/containers/json', {
      query: { all: true, filters: PALANTIR_LABEL_FILTER },
    });
    // Die Listenantwort enthaelt weder Exit-Code noch Startzeit; fuer den
    // Ist-/Soll-Abgleich nach Reconnect (Pflichtenheft §2.2) braucht das Backend
    // aber genau die. Deshalb je Container ein Inspect.
    return Promise.all(eintraege.map((eintrag) => this.inspect(eintrag.Id)));
  }

  // ---------------------------------------------------------------- Images (A3)

  async listImages(): Promise<readonly ContainerImage[]> {
    const images = await this.#client.requestJson<DockerImageListEntry[]>('GET', '/images/json', {
      query: { all: false },
    });

    // Der Nutzungsstatus kommt aus der Containerliste, nicht aus `Containers`
    // der Image-Antwort: Dieses Feld liefert die Engine nur bei `all=true` und
    // meldet sonst -1. Ausserdem sollen ausdruecklich **alle** Container zaehlen
    // und nicht nur die von Palantir - ein Image, das ein fremder Container
    // benutzt, darf der Storage-Explorer nicht als ungenutzt anbieten.
    const benutzt = await this.#benutzteImages();

    return images.map((eintrag) => {
      const tags = eintrag.RepoTags?.filter((tag) => tag !== '<none>:<none>') ?? [];
      return {
        imageId: eintrag.Id,
        tag: tags[0] ?? null,
        sizeBytes: eintrag.Size ?? 0,
        createdAt:
          typeof eintrag.Created === 'number'
            ? new Date(eintrag.Created * 1000).toISOString()
            : null,
        inUse: benutzt.has(eintrag.Id) || tags.some((tag) => benutzt.has(tag)),
      };
    });
  }

  async removeImage(imageId: string, options: RemoveImageOptions = {}): Promise<boolean> {
    try {
      await this.#client.requestVoid('DELETE', `/images/${encodeURIComponent(imageId)}`, {
        query: { force: options.force ?? false, noprune: false },
        notFoundCode: 'IMAGE_NOT_FOUND',
      });
    } catch (fehler) {
      // Idempotenz (Lastenheft §3.8, wie bei DELETE_BACKUP): Ein bereits
      // entferntes Image ist kein Fehler, sonst bliebe nach einem Abbruch ein
      // Eintrag zurueck, der sich nie wieder loeschen liesse.
      if (fehler instanceof ContainerRuntimeError && fehler.code === 'IMAGE_NOT_FOUND') {
        return false;
      }
      throw fehler;
    }

    return true;
  }

  /** Image-IDs und -Tags, die aktuell von irgendeinem Container benutzt werden. */
  async #benutzteImages(): Promise<Set<string>> {
    const container = await this.#client.requestJson<DockerContainerListEntry[]>(
      'GET',
      '/containers/json',
      { query: { all: true } },
    );

    const benutzt = new Set<string>();
    for (const eintrag of container) {
      if (eintrag.ImageID !== undefined) benutzt.add(eintrag.ImageID);
      if (eintrag.Image !== undefined) benutzt.add(eintrag.Image);
    }
    return benutzt;
  }

  // ---------------------------------------------------------------- Beobachtung

  async getStats(containerId: string): Promise<ContainerStats> {
    // stream=false liefert eine Messung mit gefuelltem Vorgaengerwert - nur damit
    // laesst sich die CPU-Auslastung ueberhaupt berechnen.
    const antwort = await this.#client.requestJson<DockerStatsResponse>(
      'GET',
      `${this.#pfad(containerId)}/stats`,
      { query: { stream: false } },
    );
    return toContainerStats(containerId, antwort);
  }

  async getLogs(containerId: string, options: GetLogsOptions = {}): Promise<readonly LogLine[]> {
    const inhalt = await this.#client.requestBuffer('GET', `${this.#pfad(containerId)}/logs`, {
      query: {
        stdout: options.includeStdout ?? true,
        stderr: options.includeStderr ?? true,
        timestamps: true,
        tail: options.tail ?? DEFAULT_LOG_TAIL,
        since: options.since,
      },
    });

    const assembler = new LogLineAssembler(containerId);
    const zeilen: LogLine[] = [];
    for await (const rahmen of demuxDockerStream(alsStrom(inhalt))) {
      zeilen.push(...assembler.push(rahmen));
    }
    zeilen.push(...assembler.flush());
    return zeilen;
  }

  async watch(containerId: string, options: WatchOptions = {}): Promise<Unsubscribe> {
    const abbrecher: Array<() => void> = [];

    if (options.logs ?? true) {
      const stream = await this.#client.openStream('GET', `${this.#pfad(containerId)}/logs`, {
        query: {
          follow: true,
          stdout: true,
          stderr: true,
          timestamps: true,
          // tail=0: der Live-Kanal liefert nur Neues; Bestandszeilen holt
          // getLogs(). Sonst kaeme die Historie bei jedem watch() doppelt.
          tail: options.logsSince === undefined ? 0 : undefined,
          since: options.logsSince,
        },
      });
      abbrecher.push(stream.cancel);
      void this.#leseLogStream(containerId, stream);
    }

    if (options.stats ?? true) {
      const stream = await this.#client.openStream('GET', `${this.#pfad(containerId)}/stats`, {
        query: { stream: true },
      });
      abbrecher.push(stream.cancel);
      void this.#leseStatsStream(containerId, stream);
    }

    const abo: Abonnement = {
      cancel: () => {
        for (const abbrechen of abbrecher) abbrechen();
      },
    };

    const vorhandene = this.#abos.get(containerId) ?? new Set<Abonnement>();
    vorhandene.add(abo);
    this.#abos.set(containerId, vorhandene);

    return () => {
      abo.cancel();
      const menge = this.#abos.get(containerId);
      menge?.delete(abo);
      if (menge !== undefined && menge.size === 0) this.#abos.delete(containerId);
    };
  }

  async unwatch(containerId: string): Promise<void> {
    const menge = this.#abos.get(containerId);
    if (menge === undefined) return;
    for (const abo of menge) abo.cancel();
    this.#abos.delete(containerId);
  }

  // ---------------------------------------------------------------- Konsole

  async execConsole(containerId: string, command: readonly string[]): Promise<ExecResult> {
    if (command.length === 0) {
      throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
        message: 'Es wurde kein Konsolenbefehl uebergeben.',
      });
    }

    const exec = await this.#client.requestJson<{ Id: string }>(
      'POST',
      `${this.#pfad(containerId)}/exec`,
      {
        body: {
          AttachStdout: true,
          AttachStderr: true,
          AttachStdin: false,
          Tty: false,
          Cmd: [...command],
        },
      },
    );

    // Bewusst streamend statt in einen Puffer: Ein Befehl mit riesiger Ausgabe
    // (etwa `cat` einer grossen Datei) wuerde sonst den gesamten Inhalt in den
    // Agent-Speicher ziehen, bis das `mem_limit` reisst und per OOM alle Streams
    // der Node abreissen. Nach `MAX_EXEC_OUTPUT_BYTES` wird der Strom abgebrochen
    // und die Ausgabe als gekuerzt markiert.
    const strom = await this.#client.openStream('POST', `/exec/${exec.Id}/start`, {
      body: { Detach: false, Tty: false },
    });

    let stdout = '';
    let stderr = '';
    let gesamtBytes = 0;
    let abgeschnitten = false;
    try {
      for await (const rahmen of demuxDockerStream(strom.body)) {
        gesamtBytes += rahmen.payload.length;
        if (gesamtBytes > MAX_EXEC_OUTPUT_BYTES) {
          abgeschnitten = true;
          break;
        }
        if (rahmen.stream === 'stderr') stderr += rahmen.payload.toString('utf8');
        else stdout += rahmen.payload.toString('utf8');
      }
    } finally {
      strom.cancel();
    }

    if (abgeschnitten) {
      stdout += '\n[…Ausgabe abgeschnitten]';
    }

    const ergebnis = await this.#client.requestJson<{ ExitCode?: number | null }>(
      'GET',
      `/exec/${exec.Id}/json`,
    );

    return { exitCode: ergebnis.ExitCode ?? 0, stdout, stderr };
  }

  // ---------------------------------------------------------------- Datei-Manager

  /**
   * Container-Pfad des Datenvolumes - die Grenze, innerhalb derer der
   * Datei-Manager arbeiten darf (Fundpunkt 100). Quelle ist das beim Anlegen
   * gesetzte Label {@link PALANTIR_DATA_VOLUME_PATH_LABEL}.
   *
   * Faellt bewusst geschlossen: Laesst sich das Datenvolume nicht bestimmen
   * (fremder oder von Hand angelegter Container ohne Label), wird kein
   * Dateizugriff erlaubt statt auf das ganze Container-Dateisystem auszuweichen.
   *
   * Grenze der Pruefung: Sie sperrt den angefragten *Pfad* lexikalisch ein.
   * Symlinks, die innerhalb des Datenordners auf ein Ziel ausserhalb zeigen,
   * loest die Engine beim Archiv-Zugriff selbst auf; dagegen schuetzen die
   * Container-Haertung (CapDrop, no-new-privileges, read-only Rootfs), nicht
   * diese Zeichenketten-Pruefung.
   */
  async #datenVolumeWurzel(containerId: string): Promise<string> {
    const gemerkt = this.#datenVolumeWurzeln.get(containerId);
    if (gemerkt !== undefined) return gemerkt;

    const antwort = await this.#inspectRoh(containerId);
    const wurzel = antwort.Config?.Labels?.[PALANTIR_DATA_VOLUME_PATH_LABEL];
    if (wurzel === undefined || !path.posix.isAbsolute(wurzel)) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Das Server-Datenverzeichnis des Containers ist nicht bestimmbar.',
        details: { containerId },
      });
    }

    const normalisiert = path.posix.normalize(wurzel);
    this.#datenVolumeWurzeln.set(containerId, normalisiert);
    return normalisiert;
  }

  /**
   * Listet die direkte Ebene eines Ordners auf.
   *
   * Die Engine kennt keinen Aufruf „nur die Namen": `GET /archive` liefert den
   * Ordner rekursiv **und mit Inhalten**. Gelesen werden davon nur die
   * 512-Byte-Koepfe, die Inhalte werden im Vorbeigehen uebersprungen
   * (Fundpunkt 274) - der Speicherbedarf haengt damit an der Zahl der
   * Eintraege, nicht an der Groesse der Dateien.
   *
   * Vorher wurde das Archiv erst vollstaendig gepuffert und dann zerlegt. Das
   * kostete so viel Speicher, wie der Ordner gross war, und brauchte deshalb
   * die Grenze aus Fundpunkt 228 - an der ein Datenordner mit Wine-Prefix und
   * SteamCMD-Kopie zuverlaessig scheiterte: Der Datei-Manager zeigte statt
   * einer Liste nur noch „Die Ausfuehrung des Befehls ist fehlgeschlagen".
   */
  async listFiles(containerId: string, verzeichnis: string): Promise<readonly FileEntry[]> {
    const wurzel = await this.#datenVolumeWurzel(containerId);
    const pfad = resolveWithinRoot(wurzel, verzeichnis);
    const stuecke = this.#client.requestChunks('GET', `${this.#pfad(containerId)}/archive`, {
      query: { path: pfad },
      notFoundCode: 'FILE_NOT_FOUND',
    });

    // Die Engine packt das Verzeichnis samt Namen ein: `<basename>/<eintrag>`.
    const basisName = path.posix.basename(pfad);
    const praefix = basisName.length === 0 ? '' : `${basisName}/`;

    const eintraege: FileEntry[] = [];

    for await (const eintrag of parseTarHeaders(stuecke)) {
      if (!eintrag.name.startsWith(praefix)) continue;

      const relativ = eintrag.name.slice(praefix.length).replace(/\/$/u, '');
      // Nur die direkte Ebene - `listFiles` ist bewusst nicht rekursiv.
      if (relativ.length === 0 || relativ.includes('/')) continue;

      /*
       * Eine Grenze braucht es weiterhin, nur eine andere: Nicht die Groesse
       * des Archivs ist das Risiko, sondern die Zahl der Eintraege, die hier
       * gesammelt werden. Ein Ordner mit Hunderttausenden Dateien waere fuer
       * die Anzeige ohnehin unbrauchbar; abgeschnitten wird an einer Stelle,
       * an der noch niemand ernsthaft sucht.
       */
      if (eintraege.length >= MAX_LISTING_ENTRIES) break;

      eintraege.push({
        name: relativ,
        path: path.posix.join(pfad, relativ),
        type: eintrag.type,
        sizeBytes: eintrag.size,
        modifiedAt: eintrag.modifiedAt,
        mode: eintrag.mode,
      });
    }

    return eintraege.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  async readFile(containerId: string, datei: string): Promise<Buffer> {
    const wurzel = await this.#datenVolumeWurzel(containerId);
    const pfad = resolveWithinRoot(wurzel, datei);
    const eintragStat = await this.#pfadStat(containerId, pfad);

    /*
     * Der Pfad existiert, aber die Engine nennt keine Groesse: dann wird nicht
     * gelesen (Audit agent-runtime-06). Frueher galt die Groesse in dem Fall
     * als 0, die Pruefung unten ging durch und `requestBuffer` lud das ganze
     * `/archive` ohne jede Grenze in den Speicher - genau die Absicherung, die
     * der Kommentar in `#pfadStat` behauptete, gab es nicht. Faellt lieber
     * geschlossen: Der Datei-Manager zeigt eine Datei nicht an, statt dass der
     * Agent am Speicher stirbt.
     *
     * `null` als ganzer Eintrag heisst dagegen „nicht vorhanden"; das beantwortet
     * der Lesezugriff darunter wie bisher mit `FILE_NOT_FOUND`.
     */
    if (eintragStat !== null && eintragStat.sizeBytes === null) {
      throw new ContainerRuntimeError('FILE_TOO_LARGE', {
        message: 'Die Groesse der Datei ist nicht bestimmbar; sie wird nicht gelesen.',
        details: { path: pfad, maxBytes: this.#maxFileBytes },
      });
    }

    const groesse = eintragStat?.sizeBytes ?? 0;

    if (groesse > this.#maxFileBytes) {
      throw new ContainerRuntimeError('FILE_TOO_LARGE', {
        details: { path: pfad, sizeBytes: groesse, maxBytes: this.#maxFileBytes },
      });
    }

    const archiv = await this.#client.requestBuffer('GET', `${this.#pfad(containerId)}/archive`, {
      query: { path: pfad },
      notFoundCode: 'FILE_NOT_FOUND',
    });

    const eintrag = parseTar(archiv).find((kandidat) => kandidat.type === 'file');
    if (eintrag === undefined) {
      throw new ContainerRuntimeError('FILE_NOT_FOUND', {
        message: 'Der Pfad verweist auf keine lesbare Datei.',
        details: { path: pfad },
      });
    }
    return eintrag.content;
  }

  async writeFile(containerId: string, datei: string, inhalt: Buffer): Promise<void> {
    const wurzel = await this.#datenVolumeWurzel(containerId);
    const pfad = resolveWithinRoot(wurzel, datei);

    this.#pruefeGroesse(pfad, inhalt);
    await this.#schreibeDatei(containerId, pfad, inhalt);
  }

  /**
   * `FILE_UPLOAD` - wie {@link writeFile}, aber mit vorheriger Existenzpruefung.
   *
   * Die Pruefung ist kein Ersatz fuer eine atomare Anlage: Zwischen `HEAD` und
   * `PUT` kann ein zweiter Upload dieselbe Datei anlegen. Die Engine bietet
   * kein „nur anlegen, wenn nicht vorhanden" an; die Pruefung faengt den Fall
   * ab, um den es hier geht - der Nutzer laedt versehentlich auf einen belegten
   * Namen und wuerde die vorhandene Datei sonst unbemerkt verlieren.
   */
  async uploadFile(
    containerId: string,
    datei: string,
    inhalt: Buffer,
    options: UploadFileOptions = {},
  ): Promise<void> {
    const wurzel = await this.#datenVolumeWurzel(containerId);
    const pfad = resolveWithinRoot(wurzel, datei);

    this.#pruefeGroesse(pfad, inhalt);

    if (options.overwrite !== true && (await this.#pfadStat(containerId, pfad)) !== null) {
      throw new ContainerRuntimeError('FILE_EXISTS', { details: { path: pfad } });
    }

    await this.#schreibeDatei(containerId, pfad, inhalt);
  }

  /**
   * `FILE_EXTRACT` - ein hochgeladenes Archiv in den Datenordner entpacken
   * (Weltdaten-Uebernahme, Arbeitspaket P4).
   *
   * Der Weg ist derselbe wie beim Schreiben einer einzelnen Datei: Die Engine
   * kennt fuer Dateizugriffe nur `PUT /containers/{id}/archive` und entpackt
   * einen TAR-Strom in den angegebenen Ordner. Das hochgeladene Archiv wird
   * deshalb hier gelesen (`readArchive`), auf saubere Pfade geprueft und als
   * **ein** TAR neu gepackt - statt tausend Einzelbefehle zu schicken.
   *
   * Bewusst kein `exec` mit `tar`/`unzip` im Container: Das setzte eine Shell
   * und die passenden Werkzeuge im Image voraus (die es bei schlanken, read-only
   * Images oft nicht gibt) und wuerde ein fremdes Archiv im Container statt im
   * Agent auspacken - dort ohne die Grenzen aus `archive.ts`.
   */
  async extractArchive(
    containerId: string,
    ziel: string,
    archiv: Buffer,
    format: ArchiveKind,
  ): Promise<ExtractArchiveResult> {
    const wurzel = await this.#datenVolumeWurzel(containerId);
    const zielPfad = resolveWithinRoot(wurzel, ziel);

    /*
     * Eigene Grenze statt der des Datei-Managers (Audit agent-runtime-02): Ein
     * komprimiertes Weltarchiv darf groesser sein als eine einzelne Datei im
     * Editor - sonst waere die blockweise Uebertragung nutzlos.
     */
    if (archiv.length > this.#maxArchiveBytes) {
      throw new ContainerRuntimeError('ARCHIVE_TOO_LARGE', {
        details: { path: zielPfad, sizeBytes: archiv.length, maxBytes: this.#maxArchiveBytes },
      });
    }

    const inhalt = readArchive(archiv, format);
    const dateien: TarFileInput[] = inhalt.entries.map((eintrag) => ({
      name: eintrag.path,
      content: eintrag.content,
      type: eintrag.type,
    }));

    if (dateien.length > 0) {
      await this.#client.requestVoid('PUT', `${this.#pfad(containerId)}/archive`, {
        query: { path: zielPfad },
        rawBody: createTar(dateien),
        notFoundCode: 'FILE_NOT_FOUND',
      });
    }

    return {
      fileCount: inhalt.entries.filter((eintrag) => eintrag.type === 'file').length,
      extractedBytes: inhalt.totalBytes,
      skipped: [...inhalt.skipped],
    };
  }

  /**
   * Wo der Datenordner liegt - im Container und auf dem Host
   * (Gefundener Punkt 105).
   *
   * Der Container-Pfad steht als Label am Container, der Host-Pfad in seinen
   * Mounts. Beides wird nur gelesen; das Loeschen selbst passiert host-seitig
   * im Job-Modul, damit es auch bei gestopptem Container geht.
   */
  async dataVolumePaths(containerId: string): Promise<DataVolumePaths> {
    const containerPath = await this.#datenVolumeWurzel(containerId);
    const antwort = await this.#inspectRoh(containerId);
    const mount = (antwort.Mounts ?? []).find(
      (eintrag) => eintrag.Destination !== undefined && eintrag.Destination === containerPath,
    );

    if (mount?.Source === undefined || !path.posix.isAbsolute(mount.Source)) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Der Host-Pfad des Datenordners ist nicht bestimmbar.',
        details: { containerId, containerPath },
      });
    }

    // Docker meldet Mount-Quellen mal mit, mal ohne nachlaufenden Schraegstrich.
    const hostPath = path.posix.normalize(mount.Source).replace(/(?<=.)\/+$/, '');

    return { containerPath, hostPath };
  }

  // ---------------------------------------------------------------- Intern

  #pruefeGroesse(pfad: string, inhalt: Buffer): void {
    if (inhalt.length > this.#maxFileBytes) {
      throw new ContainerRuntimeError('FILE_TOO_LARGE', {
        details: { path: pfad, sizeBytes: inhalt.length, maxBytes: this.#maxFileBytes },
      });
    }
  }

  /** Einzelne Datei als Tar in ihr Zielverzeichnis entpacken lassen. */
  async #schreibeDatei(containerId: string, pfad: string, inhalt: Buffer): Promise<void> {
    const zielVerzeichnis = path.posix.dirname(pfad);
    const archiv = createTar([{ name: path.posix.basename(pfad), content: inhalt }]);

    await this.#client.requestVoid('PUT', `${this.#pfad(containerId)}/archive`, {
      query: { path: zielVerzeichnis },
      rawBody: archiv,
      notFoundCode: 'FILE_NOT_FOUND',
    });
  }

  #pfad(containerId: string): string {
    return `/containers/${encodeURIComponent(containerId)}`;
  }

  /**
   * Groesse und Art eines Pfades im Container, ohne ihn zu laden (HEAD auf
   * `/archive`). `null`, wenn der Pfad nicht existiert - darauf bauen die
   * Existenzpruefung des Uploads und das idempotente Loeschen auf.
   */
  async #pfadStat(
    containerId: string,
    pfad: string,
  ): Promise<{ sizeBytes: number | null; istVerzeichnis: boolean } | null> {
    let antwort: Response;
    try {
      antwort = await this.#client.requestRaw('HEAD', `${this.#pfad(containerId)}/archive`, {
        query: { path: pfad },
        notFoundCode: 'FILE_NOT_FOUND',
      });
    } catch (fehler: unknown) {
      if (isContainerRuntimeError(fehler) && fehler.code === 'FILE_NOT_FOUND') return null;
      throw fehler;
    }

    // `sizeBytes: null` heisst „Pfad existiert, Groesse unbekannt" - und ist
    // etwas anderes als eine leere Datei. Wer die Groesse braucht, muss den
    // Fall behandeln (`readFile` lehnt ab); wer nur die Existenz prueft
    // (`uploadFile`, Loeschen), kommt weiter wie bisher.
    const kopfzeile = antwort.headers.get('x-docker-container-path-stat');
    if (kopfzeile === null) return { sizeBytes: null, istVerzeichnis: false };

    try {
      const stat = JSON.parse(Buffer.from(kopfzeile, 'base64').toString('utf8')) as {
        size?: number;
        mode?: number;
      };
      return {
        sizeBytes: stat.size ?? null,
        // Go-`FileMode`: das oberste Bit (1 << 31) steht fuer „Verzeichnis".
        istVerzeichnis: ((stat.mode ?? 0) & 0x8000_0000) !== 0,
      };
    } catch {
      return { sizeBytes: null, istVerzeichnis: false };
    }
  }

  #setzeStatus(
    containerId: string,
    status: ContainerStatus,
    exitCode: number | null,
    at: string,
  ): void {
    const vorher = this.#letzterStatus.get(containerId) ?? null;
    if (vorher === status) return;
    this.#letzterStatus.set(containerId, status);
    this.#emitter.emit({
      type: 'STATUS_CHANGED',
      containerId,
      status,
      previousStatus: vorher,
      exitCode,
      at,
    });
  }

  #oeffneEngineEvents(): Promise<DockerStream> {
    return this.#client.openStream('GET', '/events', {
      query: { filters: ENGINE_EVENT_FILTER },
    });
  }

  async #leseEngineEvents(stream: DockerStream): Promise<void> {
    try {
      for await (const roh of readNdjson(stream.body)) {
        this.#verarbeiteEngineEvent(roh as DockerEngineEvent);
      }
    } catch (fehler) {
      if (!istAbbruch(fehler)) this.#onStreamError(fehler, { stream: 'events' });
    }

    /*
     * Hier endet der Strom - regulaer (Proxy-Neustart) oder mit Fehler
     * (Netz-Blip). Ohne Wiederaufbau versiegen STATUS_CHANGED und CRASHED
     * dauerhaft, und Abstuerze bleiben bis zum Agent-Neustart unsichtbar
     * (Audit agent-runtime-04).
     */
    if (this.#eventStream !== stream) return; // dispose() oder bereits ersetzt
    this.#eventStream = undefined;
    this.#planeEngineReconnect();
  }

  #planeEngineReconnect(): void {
    if (!this.#verbunden || this.#eventReconnectTimer !== undefined) return;

    const wartezeit = Math.min(
      ENGINE_RECONNECT_INITIAL_MS * 2 ** this.#eventVersuche,
      ENGINE_RECONNECT_MAX_MS,
    );
    this.#eventVersuche += 1;

    const timer = setTimeout(() => {
      this.#eventReconnectTimer = undefined;
      void this.#verbindeEngineEventsNeu();
    }, wartezeit);
    // Der Wiederaufbau haelt den Prozess nicht am Leben - das tut die
    // Backend-Verbindung.
    timer.unref?.();
    this.#eventReconnectTimer = timer;
  }

  async #verbindeEngineEventsNeu(): Promise<void> {
    if (!this.#verbunden) return;

    let stream: DockerStream;
    try {
      stream = await this.#oeffneEngineEvents();
    } catch (fehler) {
      this.#onStreamError(fehler, { stream: 'events', phase: 'reconnect' });
      this.#planeEngineReconnect();
      return;
    }

    if (!this.#verbunden) {
      // Zwischenzeitlich dispose(): den frisch geoeffneten Strom nicht stehen lassen.
      stream.cancel();
      return;
    }

    this.#eventStream = stream;
    this.#eventVersuche = 0;
    void this.#leseEngineEvents(stream);

    await this.#gleicheZustandAb();
  }

  /**
   * Einmaliger Ist-Abgleich nach dem Wiederaufbau: Ereignisse aus der Luecke
   * kommen nicht nach. `#setzeStatus` meldet nur echte Wechsel, ein Abgleich
   * ohne Aenderung bleibt also still.
   *
   * Bewusst kein nachtraegliches CRASHED: Ob ein zwischenzeitlich beendeter
   * Container abgestuerzt oder regulaer gestoppt wurde, laesst sich hier nicht
   * mehr entscheiden. Diese Bewertung trifft das Backend beim Soll/Ist-Abgleich
   * (Pflichtenheft §2.2).
   */
  async #gleicheZustandAb(): Promise<void> {
    try {
      const zustaende = await this.list();
      const at = new Date().toISOString();
      for (const zustand of zustaende) {
        this.#setzeStatus(zustand.containerId, zustand.status, zustand.exitCode, at);
      }
    } catch (fehler) {
      this.#onStreamError(fehler, { stream: 'events', phase: 'abgleich' });
    }
  }

  #verarbeiteEngineEvent(event: DockerEngineEvent): void {
    const containerId = event.id ?? event.Actor?.ID;
    if (containerId === undefined || event.status === undefined) return;

    const at = new Date((event.time ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

    switch (event.status) {
      case 'create':
        this.#setzeStatus(containerId, 'created', null, at);
        return;
      case 'start':
      case 'unpause':
        // Der Container laeuft wieder: Ein noch gesetzter erwarteter Stopp
        // gehoert zu einem Lauf, der vorbei ist (etwa `restart` auf einen
        // bereits gestoppten Container - dort folgt kein `die`). Bliebe er
        // liegen, verschluckte er den naechsten echten Absturz
        // (Audit agent-runtime-03).
        this.#erwarteterStopp.delete(containerId);
        this.#setzeStatus(containerId, 'running', null, at);
        return;
      case 'pause':
        this.#setzeStatus(containerId, 'paused', null, at);
        return;
      case 'restart':
        // Die Engine meldet vorher ein `die`; der erwartete Stopp ist dort
        // bereits verbraucht worden.
        this.#setzeStatus(containerId, 'running', null, at);
        return;
      case 'oom':
        // Kommt unmittelbar vor `die` und liefert die Begruendung dafuer.
        this.#oomGemerkt.add(containerId);
        return;
      case 'die': {
        const exitCode = Number.parseInt(event.Actor?.Attributes?.['exitCode'] ?? '0', 10);
        const oomKilled = this.#oomGemerkt.delete(containerId);
        const erwartet = this.#erwarteterStopp.delete(containerId);

        this.#setzeStatus(containerId, 'exited', Number.isNaN(exitCode) ? null : exitCode, at);

        if (!erwartet && (exitCode !== 0 || oomKilled)) {
          this.#emitter.emit({
            type: 'CRASHED',
            containerId,
            exitCode: Number.isNaN(exitCode) ? -1 : exitCode,
            oomKilled,
            at,
          });
        }
        return;
      }
      case 'destroy':
        this.#letzterStatus.delete(containerId);
        this.#oomGemerkt.delete(containerId);
        this.#erwarteterStopp.delete(containerId);
        return;
      default:
        return;
    }
  }

  async #leseLogStream(containerId: string, stream: DockerStream): Promise<void> {
    const assembler = new LogLineAssembler(containerId);
    try {
      for await (const rahmen of demuxDockerStream(stream.body)) {
        for (const line of assembler.push(rahmen)) {
          this.#emitter.emit({ type: 'LOG_LINE', containerId, line, at: new Date().toISOString() });
        }
      }
      for (const line of assembler.flush()) {
        this.#emitter.emit({ type: 'LOG_LINE', containerId, line, at: new Date().toISOString() });
      }
    } catch (fehler) {
      if (!istAbbruch(fehler)) this.#onStreamError(fehler, { stream: 'logs', containerId });
    }
  }

  async #leseStatsStream(containerId: string, stream: DockerStream): Promise<void> {
    try {
      for await (const roh of readNdjson(stream.body)) {
        this.#emitter.emit({
          type: 'STATS_UPDATE',
          containerId,
          stats: toContainerStats(containerId, roh as DockerStatsResponse),
          at: new Date().toISOString(),
        });
      }
    } catch (fehler) {
      if (!istAbbruch(fehler)) this.#onStreamError(fehler, { stream: 'stats', containerId });
    }
  }
}

export interface CreateDockerContainerRuntimeOptions extends Omit<
  DockerContainerRuntimeOptions,
  'client'
> {
  /** Basis-URL des Docker-Socket-Proxys (`DOCKER_SOCKET_PROXY_URL`). */
  readonly dockerSocketProxyUrl: string;
  readonly fetchImpl?: FetchLike;
  readonly requestTimeoutMs?: number;
}

/** Bequemer Aufbau der Docker-Runtime aus der Konfiguration. */
export function createDockerContainerRuntime(
  options: CreateDockerContainerRuntimeOptions,
): DockerContainerRuntime {
  const { dockerSocketProxyUrl, fetchImpl, requestTimeoutMs, ...rest } = options;
  return new DockerContainerRuntime({
    ...rest,
    client: new DockerHttpClient({
      baseUrl: dockerSocketProxyUrl,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    }),
  });
}
