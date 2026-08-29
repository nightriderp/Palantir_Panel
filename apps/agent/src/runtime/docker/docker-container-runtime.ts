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
import { ContainerRuntimeError } from '../errors.js';
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
import { resolveWithinRoot } from '../paths.js';
import {
  DEFAULT_LOG_TAIL,
  type ContainerHandle,
  type ContainerSpec,
  type ContainerImage,
  type ContainerState,
  type ContainerStats,
  type ContainerStatus,
  type ExecResult,
  type FileEntry,
  type GetLogsOptions,
  type LogLine,
  type RemoveImageOptions,
  type RemoveOptions,
  type StopOptions,
  type WatchOptions,
} from '../types.js';
import { DockerHttpClient, type DockerStream, type FetchLike } from './http-client.js';
import {
  toContainerState,
  toContainerStats,
  type DockerInspectResponse,
  type DockerStatsResponse,
} from './mapping.js';
import { LogLineAssembler, demuxDockerStream, readNdjson } from './stream.js';
import { createTar, parseTar } from './tar.js';

/**
 * Obergrenze fuer Dateien, die der Datei-Manager im Speicher bewegt.
 *
 * Bewusst deutlich unter dem Upload-Limit aus `MAX_UPLOAD_SIZE_BYTES` (2 GB):
 * `readFile`/`writeFile` halten den Inhalt komplett im Speicher. Der
 * vollstaendige Export der Serverdaten (Lastenheft §3.3) laeuft nicht hierueber,
 * sondern als Backup-Job in A3.
 */
export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Obergrenze fuer die gesammelte Ausgabe eines Konsolenbefehls (`execConsole`).
 *
 * Ein RCON-/Konsolenkommando liefert normalerweise wenige Zeilen; ein Befehl mit
 * riesiger Ausgabe darf den Agent-Speicher nicht bis zum OOM fuellen. Wird die
 * Grenze ueberschritten, bricht der Agent den Ausgabestrom ab und markiert die
 * Ausgabe als gekuerzt.
 */
export const MAX_EXEC_OUTPUT_BYTES = 1024 * 1024;

export interface DockerContainerRuntimeOptions {
  readonly client: DockerHttpClient;
  readonly hardening: HardeningOptions;
  /** Groessenlimit fuer `readFile`/`writeFile`. Vorgabe: {@link DEFAULT_MAX_FILE_BYTES}. */
  readonly maxFileBytes?: number;
  /** Wird gerufen, wenn ein Hintergrund-Stream unerwartet abbricht. */
  readonly onStreamError?: (fehler: unknown, kontext: Readonly<Record<string, unknown>>) => void;
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

  constructor(options: DockerContainerRuntimeOptions) {
    this.#client = options.client;
    this.#hardening = options.hardening;
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.#onStreamError =
      options.onStreamError ??
      ((fehler, kontext) => {
        console.warn('[runtime] Stream abgebrochen', { fehler, ...kontext });
      });
  }

  // ---------------------------------------------------------------- Lebenszyklus

  async connect(): Promise<void> {
    if (this.#verbunden) return;

    const stream = await this.#client.openStream('GET', '/events', {
      query: { filters: ENGINE_EVENT_FILTER },
    });
    this.#eventStream = stream;
    this.#verbunden = true;

    void this.#leseEngineEvents(stream);
  }

  async dispose(): Promise<void> {
    this.#verbunden = false;

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

    const antwort = await this.#client.requestJson<{ Id: string; Warnings?: string[] }>(
      'POST',
      '/containers/create',
      { query: { name: spec.name }, body, notFoundCode: 'IMAGE_NOT_FOUND' },
    );

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
    this.#erwarteterStopp.add(containerId);
    try {
      await this.#client.requestVoid('POST', `${this.#pfad(containerId)}/stop`, {
        query: { t: options.timeoutSeconds },
        tolerateStatus: [304],
      });
    } catch (fehler) {
      this.#erwarteterStopp.delete(containerId);
      throw fehler;
    }
  }

  async restart(containerId: string, options: StopOptions = {}): Promise<void> {
    this.#erwarteterStopp.add(containerId);
    try {
      await this.#client.requestVoid('POST', `${this.#pfad(containerId)}/restart`, {
        query: { t: options.timeoutSeconds },
      });
    } catch (fehler) {
      this.#erwarteterStopp.delete(containerId);
      throw fehler;
    }
  }

  async remove(containerId: string, options: RemoveOptions = {}): Promise<void> {
    this.#erwarteterStopp.add(containerId);
    try {
      await this.#client.requestVoid('DELETE', this.#pfad(containerId), {
        query: { v: options.removeVolumes ?? false, force: options.force ?? false },
      });
    } finally {
      await this.unwatch(containerId);
      this.#erwarteterStopp.delete(containerId);
      this.#letzterStatus.delete(containerId);
      this.#oomGemerkt.delete(containerId);
      this.#datenVolumeWurzeln.delete(containerId);
    }
  }

  async inspect(containerId: string): Promise<ContainerState> {
    return toContainerState(await this.#inspectRoh(containerId));
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

  async listFiles(containerId: string, verzeichnis: string): Promise<readonly FileEntry[]> {
    const wurzel = await this.#datenVolumeWurzel(containerId);
    const pfad = resolveWithinRoot(wurzel, verzeichnis);
    const archiv = await this.#client.requestBuffer('GET', `${this.#pfad(containerId)}/archive`, {
      query: { path: pfad },
      notFoundCode: 'FILE_NOT_FOUND',
    });

    // Die Engine packt das Verzeichnis samt Namen ein: `<basename>/<eintrag>`.
    const basisName = path.posix.basename(pfad);
    const praefix = basisName.length === 0 ? '' : `${basisName}/`;

    const eintraege: FileEntry[] = [];
    for (const eintrag of parseTar(archiv)) {
      if (!eintrag.name.startsWith(praefix)) continue;

      const relativ = eintrag.name.slice(praefix.length).replace(/\/$/, '');
      // Nur die direkte Ebene - `listFiles` ist bewusst nicht rekursiv.
      if (relativ.length === 0 || relativ.includes('/')) continue;

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
    const groesse = await this.#dateiGroesse(containerId, pfad);

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

    if (inhalt.length > this.#maxFileBytes) {
      throw new ContainerRuntimeError('FILE_TOO_LARGE', {
        details: { path: pfad, sizeBytes: inhalt.length, maxBytes: this.#maxFileBytes },
      });
    }

    const zielVerzeichnis = path.posix.dirname(pfad);
    const archiv = createTar([{ name: path.posix.basename(pfad), content: inhalt }]);

    await this.#client.requestVoid('PUT', `${this.#pfad(containerId)}/archive`, {
      query: { path: zielVerzeichnis },
      rawBody: archiv,
      notFoundCode: 'FILE_NOT_FOUND',
    });
  }

  // ---------------------------------------------------------------- Intern

  #pfad(containerId: string): string {
    return `/containers/${encodeURIComponent(containerId)}`;
  }

  /** Groesse einer Datei im Container, ohne sie zu laden (HEAD auf `/archive`). */
  async #dateiGroesse(containerId: string, pfad: string): Promise<number> {
    const antwort = await this.#client.requestRaw('HEAD', `${this.#pfad(containerId)}/archive`, {
      query: { path: pfad },
      notFoundCode: 'FILE_NOT_FOUND',
    });

    const kopfzeile = antwort.headers.get('x-docker-container-path-stat');
    if (kopfzeile === null) return 0;

    try {
      const stat = JSON.parse(Buffer.from(kopfzeile, 'base64').toString('utf8')) as {
        size?: number;
      };
      return stat.size ?? 0;
    } catch {
      // Ohne verwertbaren Stat-Kopf greift allein das Limit beim Lesen.
      return 0;
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

  async #leseEngineEvents(stream: DockerStream): Promise<void> {
    try {
      for await (const roh of readNdjson(stream.body)) {
        this.#verarbeiteEngineEvent(roh as DockerEngineEvent);
      }
    } catch (fehler) {
      if (!istAbbruch(fehler)) this.#onStreamError(fehler, { stream: 'events' });
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
