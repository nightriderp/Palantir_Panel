/**
 * `FakeContainerRuntime` - vollstaendige In-Memory-Implementierung des
 * `ContainerRuntime`-Interfaces (Pflichtenheft §2.5).
 *
 * Damit laufen Unit- und Integrationstests von A1, A3 und - ueber den Agent
 * hinaus - jeder Code, der Container ansteuert, **ohne echten Docker-Host**.
 *
 * Zwei Eigenschaften machen den Fake als Testdouble erst brauchbar:
 *
 *  1. Er nutzt denselben `buildCreateContainerBody()` wie die Docker-Variante.
 *     Ein Spec, der gegen die Haertungsvorgaben verstoesst, scheitert im Test
 *     genauso wie in Produktion - und der erzeugte Payload ist ueber
 *     `getCreateBody()` pruefbar.
 *  2. Er verhaelt sich bei Zustaenden und Fehlern wie die Engine: `START` auf
 *     einen laufenden Container ist folgenlos, `EXEC_CONSOLE` auf einen
 *     gestoppten Container scheitert, Events kommen erst nach `connect()`.
 *
 * Alles Nichtdeterministische ist injizierbar (`now`, IDs sind fortlaufend),
 * damit Tests keine Zeitabhaengigkeit bekommen.
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
  buildCreateContainerBody,
  type DockerCreateContainerBody,
  type HardeningOptions,
} from '../hardening.js';
import { assertAbsoluteContainerPath } from '../paths.js';
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
  type LogStreamName,
  type RemoveImageOptions,
  type RemoveOptions,
  type StopOptions,
  type WatchOptions,
} from '../types.js';

/** Standardwurzel fuer Bind-Mounts in Tests. */
export const FAKE_DATA_ROOT = '/srv/palantir/servers';

export interface FakeContainerRuntimeOptions {
  /** Ohne Angabe gilt {@link FAKE_DATA_ROOT} als erlaubte Host-Wurzel. */
  readonly hardening?: HardeningOptions;
  /** Zeitquelle, damit Tests deterministisch bleiben. */
  readonly now?: () => Date;
  /** Groessenlimit fuer `readFile`/`writeFile`. */
  readonly maxFileBytes?: number;
}

interface FakeImage {
  readonly imageId: string;
  readonly tag: string | null;
  readonly sizeBytes: number;
  readonly createdAt: string | null;
}

interface FakeDatei {
  content: Buffer;
  mode: string;
  modifiedAt: string;
}

interface FakeContainer {
  readonly id: string;
  readonly spec: ContainerSpec;
  readonly createBody: DockerCreateContainerBody;
  status: ContainerStatus;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  oomKilled: boolean;
  restartCount: number;
  stats: ContainerStats;
  readonly logs: LogLine[];
  readonly dateien: Map<string, FakeDatei>;
  watchLogs: boolean;
  watchStats: boolean;
}

/** Methoden, deren naechster Aufruf ueber `failNext()` scheitern kann. */
export type FakeFailableMethod =
  | 'create'
  | 'start'
  | 'stop'
  | 'restart'
  | 'remove'
  | 'inspect'
  | 'list'
  | 'getStats'
  | 'getLogs'
  | 'execConsole'
  | 'listFiles'
  | 'readFile'
  | 'writeFile'
  | 'watch'
  | 'listImages'
  | 'removeImage';

export type FakeExecHandler = (
  containerId: string,
  command: readonly string[],
) => ExecResult | Promise<ExecResult>;

const LEERE_STATS = (containerId: string, sampledAt: string): ContainerStats => ({
  containerId,
  cpuPercent: 0,
  memoryUsedBytes: 0,
  memoryLimitBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
  blockReadBytes: 0,
  blockWriteBytes: 0,
  pids: 0,
  sampledAt,
});

export class FakeContainerRuntime implements ContainerRuntime {
  readonly #emitter = new RuntimeEventEmitter();
  readonly #container = new Map<string, FakeContainer>();
  /** Images des virtuellen Hosts - ueber `seedImage()` befuellt. */
  readonly #images = new Map<string, FakeImage>();
  readonly #fehlerfaelle = new Map<FakeFailableMethod, ContainerRuntimeError>();
  readonly #hardening: HardeningOptions;
  readonly #now: () => Date;
  readonly #maxFileBytes: number;

  #naechsteId = 1;
  #verbunden = false;
  #execHandler: FakeExecHandler | undefined;

  constructor(options: FakeContainerRuntimeOptions = {}) {
    this.#hardening = options.hardening ?? { allowedHostRoots: [FAKE_DATA_ROOT] };
    this.#now = options.now ?? (() => new Date());
    this.#maxFileBytes = options.maxFileBytes ?? 64 * 1024 * 1024;
  }

  // ---------------------------------------------------------------- Lebenszyklus

  async connect(): Promise<void> {
    this.#verbunden = true;
  }

  async dispose(): Promise<void> {
    this.#verbunden = false;
    for (const container of this.#container.values()) {
      container.watchLogs = false;
      container.watchStats = false;
    }
    this.#emitter.removeAll();
  }

  on(listener: ContainerRuntimeEventListener): Unsubscribe {
    return this.#emitter.on(listener);
  }

  // ---------------------------------------------------------------- Lifecycle-Befehle

  async create(spec: ContainerSpec): Promise<ContainerHandle> {
    this.#pruefeFehlerfall('create');

    for (const vorhanden of this.#container.values()) {
      if (vorhanden.spec.name === spec.name) {
        throw new ContainerRuntimeError('CONTAINER_NAME_CONFLICT', {
          details: { name: spec.name },
        });
      }
    }

    // Bewusst dieselbe Haertung wie in Produktion: ein ungueltiger Spec muss im
    // Test genauso scheitern.
    const createBody = buildCreateContainerBody(spec, this.#hardening);

    const id = `fake-container-${this.#naechsteId++}`;
    const jetzt = this.#jetzt();

    this.#container.set(id, {
      id,
      spec,
      createBody,
      status: 'created',
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      oomKilled: false,
      restartCount: 0,
      stats: LEERE_STATS(id, jetzt),
      logs: [],
      dateien: new Map(),
      watchLogs: false,
      watchStats: false,
    });

    this.#emitStatus(id, 'created', null, null);
    return { containerId: id, name: spec.name, warnings: [] };
  }

  async start(containerId: string): Promise<void> {
    this.#pruefeFehlerfall('start');
    const container = this.#hole(containerId);
    if (container.status === 'running') return;

    const vorher = container.status;
    container.status = 'running';
    container.startedAt = this.#jetzt();
    container.finishedAt = null;
    container.exitCode = null;
    container.oomKilled = false;
    this.#emitStatus(containerId, 'running', vorher, null);
  }

  async stop(containerId: string, _options: StopOptions = {}): Promise<void> {
    this.#pruefeFehlerfall('stop');
    const container = this.#hole(containerId);
    if (container.status !== 'running' && container.status !== 'paused') return;

    // Regulaeres Stoppen: Exit-Code 0 und ausdruecklich **kein** CRASHED.
    this.#beende(container, 0, false);
  }

  async restart(containerId: string, _options: StopOptions = {}): Promise<void> {
    this.#pruefeFehlerfall('restart');
    const container = this.#hole(containerId);

    if (container.status === 'running' || container.status === 'paused') {
      this.#beende(container, 0, false);
    }
    const vorher = container.status;
    container.restartCount += 1;
    container.status = 'running';
    container.startedAt = this.#jetzt();
    container.finishedAt = null;
    container.exitCode = null;
    this.#emitStatus(containerId, 'running', vorher, null);
  }

  async remove(containerId: string, options: RemoveOptions = {}): Promise<void> {
    this.#pruefeFehlerfall('remove');
    const container = this.#hole(containerId);

    if (container.status === 'running' && options.force !== true) {
      throw new ContainerRuntimeError('CONTAINER_STATE_CONFLICT', {
        message: 'Ein laufender Container kann nur mit force entfernt werden.',
        details: { containerId },
      });
    }

    this.#container.delete(containerId);
  }

  async inspect(containerId: string): Promise<ContainerState> {
    this.#pruefeFehlerfall('inspect');
    return this.#zuState(this.#hole(containerId));
  }

  async list(): Promise<readonly ContainerState[]> {
    this.#pruefeFehlerfall('list');
    return [...this.#container.values()].map((container) => this.#zuState(container));
  }

  // ---------------------------------------------------------------- Images (A3)

  async listImages(): Promise<readonly ContainerImage[]> {
    this.#pruefeFehlerfall('listImages');

    // Wie in der Docker-Variante zaehlt jeder Container, nicht nur die von
    // Palantir verwalteten.
    const benutzt = new Set<string>();
    for (const container of this.#container.values()) {
      benutzt.add(container.spec.image);
    }

    return [...this.#images.values()].map((image) => ({
      imageId: image.imageId,
      tag: image.tag,
      sizeBytes: image.sizeBytes,
      createdAt: image.createdAt,
      inUse: benutzt.has(image.imageId) || (image.tag !== null && benutzt.has(image.tag)),
    }));
  }

  async removeImage(imageId: string, options: RemoveImageOptions = {}): Promise<boolean> {
    this.#pruefeFehlerfall('removeImage');

    const image = this.#images.get(imageId);
    if (image === undefined) {
      // Idempotent wie die Docker-Variante.
      return false;
    }

    const benutzt = [...this.#container.values()].some(
      (container) =>
        container.spec.image === image.imageId ||
        (image.tag !== null && container.spec.image === image.tag),
    );

    if (benutzt && options.force !== true) {
      throw new ContainerRuntimeError('RUNTIME_ERROR', {
        message: 'Das Image wird von mindestens einem Container benutzt.',
        details: { imageId },
      });
    }

    this.#images.delete(imageId);
    return true;
  }

  // ---------------------------------------------------------------- Beobachtung

  async getStats(containerId: string): Promise<ContainerStats> {
    this.#pruefeFehlerfall('getStats');
    return this.#hole(containerId).stats;
  }

  async getLogs(containerId: string, options: GetLogsOptions = {}): Promise<readonly LogLine[]> {
    this.#pruefeFehlerfall('getLogs');
    const container = this.#hole(containerId);

    const gefiltert = container.logs.filter((zeile) => {
      if (zeile.stream === 'stdout' && options.includeStdout === false) return false;
      if (zeile.stream === 'stderr' && options.includeStderr === false) return false;
      if (options.since !== undefined && zeile.timestamp !== null) {
        return zeile.timestamp >= options.since;
      }
      return true;
    });

    const tail = options.tail ?? DEFAULT_LOG_TAIL;
    return gefiltert.slice(-tail);
  }

  async watch(containerId: string, options: WatchOptions = {}): Promise<Unsubscribe> {
    this.#pruefeFehlerfall('watch');
    const container = this.#hole(containerId);

    const logs = options.logs ?? true;
    const stats = options.stats ?? true;
    if (logs) container.watchLogs = true;
    if (stats) container.watchStats = true;

    return () => {
      if (logs) container.watchLogs = false;
      if (stats) container.watchStats = false;
    };
  }

  async unwatch(containerId: string): Promise<void> {
    const container = this.#container.get(containerId);
    if (container === undefined) return;
    container.watchLogs = false;
    container.watchStats = false;
  }

  // ---------------------------------------------------------------- Konsole

  async execConsole(containerId: string, command: readonly string[]): Promise<ExecResult> {
    this.#pruefeFehlerfall('execConsole');
    const container = this.#hole(containerId);

    if (command.length === 0) {
      throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
        message: 'Es wurde kein Konsolenbefehl uebergeben.',
      });
    }
    if (container.status !== 'running') {
      throw new ContainerRuntimeError('CONTAINER_NOT_RUNNING', { details: { containerId } });
    }

    if (this.#execHandler !== undefined) {
      return this.#execHandler(containerId, command);
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // ---------------------------------------------------------------- Datei-Manager

  async listFiles(containerId: string, verzeichnis: string): Promise<readonly FileEntry[]> {
    this.#pruefeFehlerfall('listFiles');
    const container = this.#hole(containerId);
    const basis = assertAbsoluteContainerPath(verzeichnis);
    const praefix = basis === '/' ? '/' : `${basis}/`;

    const eintraege = new Map<string, FileEntry>();

    for (const [pfad, datei] of container.dateien) {
      if (!pfad.startsWith(praefix)) continue;

      const relativ = pfad.slice(praefix.length);
      const trenner = relativ.indexOf('/');

      if (trenner === -1) {
        eintraege.set(relativ, {
          name: relativ,
          path: pfad,
          type: 'file',
          sizeBytes: datei.content.length,
          modifiedAt: datei.modifiedAt,
          mode: datei.mode,
        });
        continue;
      }

      // Unterverzeichnisse ergeben sich implizit aus den Dateipfaden.
      const ordner = relativ.slice(0, trenner);
      if (!eintraege.has(ordner)) {
        eintraege.set(ordner, {
          name: ordner,
          path: path.posix.join(basis, ordner),
          type: 'directory',
          sizeBytes: 0,
          modifiedAt: datei.modifiedAt,
          mode: '755',
        });
      }
    }

    return [...eintraege.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  async readFile(containerId: string, datei: string): Promise<Buffer> {
    this.#pruefeFehlerfall('readFile');
    const container = this.#hole(containerId);
    const pfad = assertAbsoluteContainerPath(datei);

    const eintrag = container.dateien.get(pfad);
    if (eintrag === undefined) {
      throw new ContainerRuntimeError('FILE_NOT_FOUND', { details: { path: pfad } });
    }
    if (eintrag.content.length > this.#maxFileBytes) {
      throw new ContainerRuntimeError('FILE_TOO_LARGE', {
        details: { path: pfad, sizeBytes: eintrag.content.length, maxBytes: this.#maxFileBytes },
      });
    }
    return eintrag.content;
  }

  async writeFile(containerId: string, datei: string, inhalt: Buffer): Promise<void> {
    this.#pruefeFehlerfall('writeFile');
    const container = this.#hole(containerId);
    const pfad = assertAbsoluteContainerPath(datei);

    if (inhalt.length > this.#maxFileBytes) {
      throw new ContainerRuntimeError('FILE_TOO_LARGE', {
        details: { path: pfad, sizeBytes: inhalt.length, maxBytes: this.#maxFileBytes },
      });
    }

    container.dateien.set(pfad, {
      content: inhalt,
      mode: container.dateien.get(pfad)?.mode ?? '644',
      modifiedAt: this.#jetzt(),
    });
  }

  // ---------------------------------------------------------------- Test-Steuerung

  /** Erzeugungs-Payload eines Containers - damit laesst sich die Haertung pruefen. */
  getCreateBody(containerId: string): DockerCreateContainerBody {
    return this.#hole(containerId).createBody;
  }

  /** Spec, mit dem der Container angelegt wurde. */
  getSpec(containerId: string): ContainerSpec {
    return this.#hole(containerId).spec;
  }

  /** Laesst den naechsten Aufruf der genannten Methode mit diesem Fehler scheitern. */
  failNext(methode: FakeFailableMethod, fehler: ContainerRuntimeError): void {
    this.#fehlerfaelle.set(methode, fehler);
  }

  /** Antwortverhalten fuer `execConsole()` festlegen. */
  setExecHandler(handler: FakeExecHandler | undefined): void {
    this.#execHandler = handler;
  }

  /** Messwerte setzen; bei aktivem `watch()` folgt ein `STATS_UPDATE`. */
  setStats(containerId: string, stats: Partial<Omit<ContainerStats, 'containerId'>>): void {
    const container = this.#hole(containerId);
    container.stats = { ...container.stats, ...stats, containerId };

    if (container.watchStats) {
      this.#emit({
        type: 'STATS_UPDATE',
        containerId,
        stats: container.stats,
        at: this.#jetzt(),
      });
    }
  }

  /** Logzeile anhaengen; bei aktivem `watch()` folgt ein `LOG_LINE`. */
  appendLog(containerId: string, message: string, stream: LogStreamName = 'stdout'): void {
    const container = this.#hole(containerId);
    const line: LogLine = { containerId, stream, message, timestamp: this.#jetzt() };
    container.logs.push(line);

    if (container.watchLogs) {
      this.#emit({ type: 'LOG_LINE', containerId, line, at: this.#jetzt() });
    }
  }

  /**
   * Simuliert einen Absturz: der Container endet mit einem Exit-Code ungleich 0
   * bzw. wird wegen Speicherueberschreitung beendet. Fuehrt zu `STATUS_CHANGED`
   * **und** `CRASHED`.
   */
  simulateCrash(
    containerId: string,
    options: { exitCode?: number; oomKilled?: boolean } = {},
  ): void {
    const container = this.#hole(containerId);
    const oomKilled = options.oomKilled ?? false;
    const exitCode = options.exitCode ?? (oomKilled ? 137 : 1);
    this.#beende(container, exitCode, true, oomKilled);
  }

  /** Simuliert ein regulaeres Ende des Prozesses (kein `CRASHED`). */
  simulateExit(containerId: string, exitCode = 0): void {
    this.#beende(this.#hole(containerId), exitCode, false);
  }

  /** Image auf den virtuellen Host legen (Testvorbereitung fuer den Storage-Scanner). */
  seedImage(image: {
    imageId: string;
    tag?: string | null;
    sizeBytes?: number;
    createdAt?: string | null;
  }): void {
    this.#images.set(image.imageId, {
      imageId: image.imageId,
      tag: image.tag ?? null,
      sizeBytes: image.sizeBytes ?? 0,
      createdAt: image.createdAt ?? this.#jetzt(),
    });
  }

  /** Datei direkt in den virtuellen Container legen (Testvorbereitung). */
  seedFile(containerId: string, pfad: string, inhalt: Buffer, mode = '644'): void {
    const container = this.#hole(containerId);
    container.dateien.set(assertAbsoluteContainerPath(pfad), {
      content: inhalt,
      mode,
      modifiedAt: this.#jetzt(),
    });
  }

  // ---------------------------------------------------------------- Intern

  #jetzt(): string {
    return this.#now().toISOString();
  }

  #hole(containerId: string): FakeContainer {
    const container = this.#container.get(containerId);
    if (container === undefined) {
      throw new ContainerRuntimeError('CONTAINER_NOT_FOUND', { details: { containerId } });
    }
    return container;
  }

  #pruefeFehlerfall(methode: FakeFailableMethod): void {
    const fehler = this.#fehlerfaelle.get(methode);
    if (fehler === undefined) return;
    this.#fehlerfaelle.delete(methode);
    throw fehler;
  }

  #zuState(container: FakeContainer): ContainerState {
    return {
      containerId: container.id,
      name: container.spec.name,
      image: container.spec.image,
      status: container.status,
      exitCode: container.exitCode,
      startedAt: container.startedAt,
      finishedAt: container.finishedAt,
      oomKilled: container.oomKilled,
      restartCount: container.restartCount,
    };
  }

  #beende(
    container: FakeContainer,
    exitCode: number,
    alsAbsturz: boolean,
    oomKilled = false,
  ): void {
    const vorher = container.status;
    container.status = 'exited';
    container.exitCode = exitCode;
    container.finishedAt = this.#jetzt();
    container.oomKilled = oomKilled;

    if (vorher !== 'exited') {
      this.#emit({
        type: 'STATUS_CHANGED',
        containerId: container.id,
        status: 'exited',
        previousStatus: vorher,
        exitCode,
        at: this.#jetzt(),
      });
    }

    if (alsAbsturz) {
      this.#emit({
        type: 'CRASHED',
        containerId: container.id,
        exitCode,
        oomKilled,
        at: this.#jetzt(),
      });
    }
  }

  #emitStatus(
    containerId: string,
    status: ContainerStatus,
    previousStatus: ContainerStatus | null,
    exitCode: number | null,
  ): void {
    this.#emit({
      type: 'STATUS_CHANGED',
      containerId,
      status,
      previousStatus,
      exitCode,
      at: this.#jetzt(),
    });
  }

  /** Wie bei der Engine gibt es Events erst nach `connect()`. */
  #emit(event: Parameters<RuntimeEventEmitter['emit']>[0]): void {
    if (!this.#verbunden) return;
    this.#emitter.emit(event);
  }
}
