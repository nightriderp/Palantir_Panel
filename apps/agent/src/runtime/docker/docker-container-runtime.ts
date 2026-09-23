/**
 * `ContainerRuntime`-Implementierung gegen die Docker-Engine, angesprochen
 * ausschliesslich ueber den Docker-Socket-Proxy (Pflichtenheft §2.3).
 *
 * Verantwortlich fuer die Uebersetzung der Agent-Befehle aus Pflichtenheft §5.3
 * in Engine-Aufrufe und fuer die vier ausgehenden Events. Die Haertung steckt
 * vollstaendig in `hardening.ts` - hier wird nichts davon nachgebaut oder
 * umgangen.
 */

import { promises as fs } from 'node:fs';
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
import { MAX_EXTRACTED_BYTES, type ArchiveKind, readArchive } from '../archive.js';
import { type SpeicherPlanung, javaHeapMib } from '../memory.js';
import { resolveWithinRoot } from '../paths.js';
import {
  DEFAULT_LOG_TAIL,
  DEFAULT_PIDS_LIMIT,
  type ContainerHandle,
  type ContainerSpec,
  type ContainerImage,
  type ContainerState,
  type ContainerStats,
  type ContainerStatus,
  type DataVolumePaths,
  type ExecResult,
  type ExtractArchiveResult,
  type GetLogsOptions,
  type LogLine,
  type RemoveImageOptions,
  type RemoveOptions,
  type ResourceLimits,
  type StopOptions,
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
import { type TarFileInput, createTar } from './tar.js';
import { bereich, fehlerFeld } from '../../log.js';

/**
 * Obergrenze fuer ein **Archiv**, das entpackt werden soll (Audit
 * agent-runtime-02).
 *
 * Bewusst nicht die Datei-Grenze des Kanals: `UPLOAD_ARCHIVE_BLOCK` existiert
 * genau deshalb, weil ein gewachsener Weltordner die 64 MiB des Agent-Kanals
 * sprengt (`jobs/files/archive-upload.ts`). Praeft `extractArchive` das
 * zusammengesetzte Archiv gegen die Datei-Grenze, scheitert die blockweise
 * Uebertragung am letzten Block - fuer genau den Fall, fuer den sie gebaut
 * wurde. Die gewollte Grenze ist die des Entpackens.
 */
export const DEFAULT_MAX_ARCHIVE_BYTES = MAX_EXTRACTED_BYTES;

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
  /**
   * Weiche RAM-Grenze und Heap-Planung (`memory.ts`, Betreiber-Entscheidung
   * 2026-09-18). Gesetzt, bekommt jeder neue Container `PALANTIR_JAVA_HEAP_MIB`
   * aus dem gerade freien Speicher der Node; Java-Images lesen die Variable,
   * alle anderen ignorieren sie. Ohne Angabe bleibt alles wie bisher.
   */
  readonly speicherPlanung?: SpeicherPlanung;
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
  readonly #speicherPlanung: SpeicherPlanung | undefined;
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
    this.#speicherPlanung = options.speicherPlanung;
    this.#maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
    this.#onStreamError =
      options.onStreamError ??
      ((fehler, kontext) => {
        bereich('runtime').warn({ ...kontext, ...fehlerFeld(fehler) }, 'Stream abgebrochen');
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

  /**
   * Java-Heap aus dem freien Speicher der Node (`memory.ts`).
   *
   * Berechnet beim Anlegen, nicht beim Start: Der Container traegt seine
   * Umgebung ab dem Anlegen, und ein Neustart soll denselben Heap behalten,
   * mit dem der Server zuletzt lief. Ein ausdruecklich gesetzter Wert aus dem
   * Backend hat Vorrang.
   */
  async #mitJavaHeap(spec: ContainerSpec): Promise<ContainerSpec> {
    if (spec.env['PALANTIR_JAVA_HEAP_MIB'] !== undefined) {
      return spec;
    }

    const heapMib = await this.#heapJetztMib(spec.resources.memoryMb);

    return heapMib === null
      ? spec
      : { ...spec, env: { ...spec.env, PALANTIR_JAVA_HEAP_MIB: String(heapMib) } };
  }

  /**
   * Heap fuer einen Server, der **jetzt** startet – oder `null`, wenn dieser
   * Agent ohne Speicherplanung laeuft (Tests, fremde Runtime).
   */
  async #heapJetztMib(zuweisungMb?: number): Promise<number | null> {
    const planung = this.#speicherPlanung;

    if (planung === undefined) {
      return null;
    }

    // Die Planung darf einen Start nie verhindern: Scheitert die Zaehlung der
    // laufenden Container, gilt der Server als einziger – ein grosszuegiger
    // Heap, den die weiche Grenze notfalls zurueckdraengt.
    const [verfuegbarMb, container] = await Promise.all([
      planung.verfuegbarMb(),
      this.list().catch((): readonly ContainerState[] => []),
    ]);
    const laufende = Array.isArray(container)
      ? container.filter((eintrag) => eintrag.status === 'running').length
      : 0;

    return javaHeapMib({
      availableMb: verfuegbarMb,
      reserveMb: planung.reserveMb,
      runningContainers: laufende,
      hardLimitMb: planung.hardLimitMb,
      maxHeapMb: planung.maxHeapMb,
      ...(zuweisungMb === undefined || zuweisungMb <= 0 ? {} : { zuweisungMb }),
    });
  }

  /**
   * Zuweisung eines laufenden Containers in MiB – seine weiche Grenze.
   *
   * Steht als `MemoryReservation` am Container, seit die harte Grenze für alle
   * gleich ist. So gilt beim Start dieselbe Zahl wie beim Anlegen, ohne dass
   * der Agent das Panel fragen müsste. `undefined`, wenn keine gesetzt ist
   * (ältere Container) – dann rechnet der Agent wie bisher aus dem freien
   * Speicher.
   */
  async #zuweisungMib(containerId: string): Promise<number | undefined> {
    try {
      const antwort = await this.#inspectRoh(containerId);
      const bytes = antwort.HostConfig?.MemoryReservation ?? 0;

      return bytes > 0 ? Math.floor(bytes / (1024 * 1024)) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Den Heap fuer den naechsten Start in den Datenordner schreiben
   * (`.palantir/heap.mib`), damit ihn das Image beim Hochfahren liest.
   *
   * **Warum nicht nur die Umgebungsvariable.** Sie steht beim Anlegen des
   * Containers fest. Am 19.09.2026 hing daran ein Server fest: Er startete
   * wieder und wieder mit 20 307 MiB Heap und wurde jedes Mal vom Kernel
   * beendet, obwohl der Agent laengst einen gedeckelten Wert rechnete – der
   * alte Wert klebte im Container, und „Aktualisieren" baut ihn nur neu, wenn
   * sich das Image aendert. Die Datei schreibt der Agent vor jedem Start neu;
   * das Image liest sie mit Vorrang (`images/base/java/java.sh`).
   *
   * **Ein Fehlschlag bricht den Start nicht ab.** Faellt das Schreiben aus
   * (Rechte, Platte voll, Ordner weg), soll der Server trotzdem hochkommen –
   * dann gilt eben der Wert aus der Umgebung. Ein nicht startender Server
   * waere der schlechtere Tausch.
   */
  async #schreibeHeapDatei(containerId: string): Promise<void> {
    // Ohne Speicherplanung gibt es nichts zu schreiben - und vor allem keinen
    // Grund, die Engine nach dem Container zu fragen.
    if (this.#speicherPlanung === undefined) {
      return;
    }

    try {
      /*
       * Die Zuweisung steht am Container selbst (`MemoryReservation`, gesetzt
       * beim Anlegen): So gilt beim Start dieselbe Zahl wie beim Anlegen, ohne
       * dass der Agent das Panel fragen müsste.
       */
      const heapMib = await this.#heapJetztMib(await this.#zuweisungMib(containerId));

      if (heapMib === null) {
        return;
      }

      const volume = await this.dataVolumePaths(containerId);
      const ordner = path.join(volume.hostPath, '.palantir');

      await fs.mkdir(ordner, { recursive: true });
      await fs.writeFile(path.join(ordner, 'heap.mib'), `${String(heapMib)}\n`, 'utf8');
    } catch {
      // Absichtlich still: siehe Kopfkommentar.
    }
  }

  async create(spec: ContainerSpec): Promise<ContainerHandle> {
    const body = buildCreateContainerBody(await this.#mitJavaHeap(spec), this.#hardening);

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
    // Vor dem Start, nicht danach: Das Image liest die Datei in seinen ersten
    // Zeilen, und ein Wert von gestern waere genau der Fehler, den sie
    // beheben soll.
    await this.#schreibeHeapDatei(containerId);

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
        ...fristFuerStopp(options.timeoutSeconds),
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
        ...fristFuerStopp(options.timeoutSeconds),
      });
      ausgeloest = true;
    } finally {
      if (!ausgeloest) this.#erwarteterStopp.delete(containerId);
    }
  }

  async updateResources(containerId: string, resources: ResourceLimits): Promise<void> {
    const zuweisungBytes = resources.memoryMb * 1024 * 1024;

    /*
     * **Dieselbe Rechnung wie beim Anlegen** (`hardening.ts`, Fundpunkt 303):
     * Die Zuweisung des Servers ist die weiche Grenze (`MemoryReservation`),
     * hart ist die Grenze der Node minus Ruecklage - fuer alle Container
     * dieselbe.
     *
     * Bis hierher setzte diese Stelle `Memory` auf die Zuweisung und liess
     * `MemoryReservation` weg. Ein Verschieben des RAM-Reglers machte die
     * weiche Grenze damit wieder zu einer harten und die Reservierung zu null -
     * der Container lief danach nach dem alten Modell, obwohl die Node laengst
     * das neue fuhr. Aufgefallen ist es nicht, weil ein neu angelegter
     * Container es richtig hatte und nur der spaeter geaenderte nicht.
     *
     * Kennt die Runtime die Grenze der Node nicht (die Tests, die ohne Node
     * laufen), bleibt es wie zuvor: Die Zuweisung ist die harte Grenze, und
     * eine Reservierung gibt es nicht.
     *
     * Die uebrigen Felder aus demselben Grund wie beim Anlegen:
     *
     * - `MemorySwap` gleich `Memory` heisst "kein Swap". Ohne das Feld liesse
     *   die Engine den Container seine RAM-Grenze ueber die Auslagerungsdatei
     *   des Hosts umgehen - und ein Update, das dieses Feld ausspart, setzt es
     *   auf den Vorgabewert zurueck.
     * - `PidsLimit` steht mit, weil die Engine beim Aktualisieren setzt, was
     *   dasteht: Ein ausgelassenes Feld hiesse "unbegrenzt", und der
     *   Fork-Bomb-Schutz waere nach dem ersten Verschieben des RAM-Reglers weg.
     * - `NanoCpus` fehlt aus demselben Grund, aus dem es beim Anlegen fehlt:
     *   Die CPU-Zuweisung ist entfallen, jeder Container sieht alle Kerne.
     */
    const nodeGrenze = this.#hardening.nodeMemoryHardLimitBytes;
    const harteGrenzeBytes =
      nodeGrenze === undefined ? zuweisungBytes : Math.max(nodeGrenze, zuweisungBytes);

    await this.#client.requestVoid('POST', `${this.#pfad(containerId)}/update`, {
      body: {
        Memory: harteGrenzeBytes,
        MemorySwap: harteGrenzeBytes,
        ...(nodeGrenze === undefined ? {} : { MemoryReservation: zuweisungBytes }),
        PidsLimit: resources.pidsLimit ?? DEFAULT_PIDS_LIMIT,
      },
    });
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

  #pfad(containerId: string): string {
    return `/containers/${encodeURIComponent(containerId)}`;
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

/**
 * Wie lange die Anfrage selbst auf `/stop` bzw. `/restart` warten darf.
 *
 * Docker antwortet erst, wenn der Container wirklich steht – also bis zu `t`
 * Sekunden später, wenn er das Signal nicht beachtet. Mit der üblichen Frist
 * von 30 Sekunden brach die Anfrage bei jedem Spiel mit längerer Kulanzzeit
 * vorher ab, und der Stopp endete als „Der Docker-Socket-Proxy ist nicht
 * erreichbar", obwohl Docker ihn gerade ausführte. Aufgefallen bei CS2 (60 s,
 * 23.09.2026): jedes Stoppen endete im Fehlerzustand.
 *
 * Darum: die Kulanzzeit plus ein Nachlauf für das Aufräumen der Engine. Ohne
 * Kulanzzeit gilt Dockers Vorgabe von 10 Sekunden, und die übliche Frist reicht.
 */
const STOPP_NACHLAUF_MS = 30_000;

function fristFuerStopp(timeoutSeconds: number | undefined): { timeoutMs?: number } {
  return timeoutSeconds === undefined
    ? {}
    : { timeoutMs: timeoutSeconds * 1_000 + STOPP_NACHLAUF_MS };
}
