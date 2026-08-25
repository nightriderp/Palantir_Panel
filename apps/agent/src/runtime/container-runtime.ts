/**
 * `ContainerRuntime` - die einzige Schnittstelle, ueber die Agent-Code Container
 * ansteuert (CLAUDE.md §4, Pflichtenheft §2.5).
 *
 * Verbindlich:
 *   - Kein anderer Agent-Code spricht mit der Docker-API oder dem
 *     Docker-Socket-Proxy. Wer Container braucht, bekommt eine
 *     `ContainerRuntime` injiziert.
 *   - Es gibt genau zwei Implementierungen: `DockerContainerRuntime` (Produktion,
 *     ueber den Docker-Socket-Proxy) und `FakeContainerRuntime` (Tests, ohne
 *     Docker-Host).
 *   - Jeder Fehler verlaesst die Runtime als `ContainerRuntimeError` mit
 *     benanntem Code.
 *
 * Die Methodennamen bilden die Agent-Befehle aus Pflichtenheft §5.3 ab:
 *
 * | Befehl                | Methode              |
 * | --------------------- | -------------------- |
 * | `CREATE`              | `create`             |
 * | `START`               | `start`              |
 * | `STOP`                | `stop`               |
 * | `RESTART`             | `restart`            |
 * | `DELETE`              | `remove`             |
 * | `GET_STATS`           | `getStats`           |
 * | `GET_LOGS`            | `getLogs`            |
 * | `EXEC_CONSOLE`        | `execConsole`        |
 * | `FILE_LIST`           | `listFiles`          |
 * | `FILE_READ`           | `readFile`           |
 * | `FILE_WRITE`          | `writeFile`          |
 *
 * `CREATE_BACKUP`, `RESTORE_BACKUP` und `GET_STORAGE_BREAKDOWN` aus derselben
 * Liste sind Dateisystem- und Job-Aufgaben und gehoeren zu A3, nicht zur
 * Container-Ansteuerung.
 */

import { type ContainerRuntimeEventListener, type Unsubscribe } from './events.js';
import {
  type ContainerHandle,
  type ContainerSpec,
  type ContainerState,
  type ContainerStats,
  type ExecResult,
  type FileEntry,
  type GetLogsOptions,
  type LogLine,
  type RemoveOptions,
  type StopOptions,
  type WatchOptions,
} from './types.js';

export interface ContainerRuntime {
  /**
   * Verbindung zur Container-Engine aufbauen und den Statuskanal oeffnen.
   * Ab hier liefert die Runtime `STATUS_CHANGED`- und `CRASHED`-Events fuer alle
   * von Palantir verwalteten Container. Mehrfachaufrufe sind wirkungslos.
   */
  connect(): Promise<void>;

  /** Alle Streams schliessen und Listener abmelden. Mehrfachaufrufe sind wirkungslos. */
  dispose(): Promise<void>;

  /** `CREATE`: Container anlegen (gehaertet, siehe `hardening.ts`), aber nicht starten. */
  create(spec: ContainerSpec): Promise<ContainerHandle>;

  /** `START`: Container starten. Ist er bereits gestartet, passiert nichts. */
  start(containerId: string): Promise<void>;

  /** `STOP`: SIGTERM, nach Ablauf der Kulanzzeit SIGKILL. Bereits gestoppt ist kein Fehler. */
  stop(containerId: string, options?: StopOptions): Promise<void>;

  /** `RESTART`: Stoppen und wieder starten. */
  restart(containerId: string, options?: StopOptions): Promise<void>;

  /** `DELETE`: Container entfernen. Bind-Mounts auf dem Host bleiben unberuehrt. */
  remove(containerId: string, options?: RemoveOptions): Promise<void>;

  /** Aktueller Zustand eines Containers - Grundlage des Ist-/Soll-Abgleichs nach Reconnect (Pflichtenheft §2.2). */
  inspect(containerId: string): Promise<ContainerState>;

  /** Alle von Palantir verwalteten Container - vollstaendiger Ist-Zustand fuer den Reconnect-Abgleich. */
  list(): Promise<readonly ContainerState[]>;

  /** `GET_STATS`: einmalige Momentaufnahme der Auslastung. */
  getStats(containerId: string): Promise<ContainerStats>;

  /** `GET_LOGS`: die letzten Logzeilen als Block (nicht als Stream). */
  getLogs(containerId: string, options?: GetLogsOptions): Promise<readonly LogLine[]>;

  /**
   * `EXEC_CONSOLE`: Befehl im laufenden Container ausfuehren und Ausgabe
   * zurueckgeben. Der Befehl wird als Argumentliste uebergeben - es gibt bewusst
   * keine Shell-Interpolation, damit aus einer Konsoleneingabe keine
   * Shell-Injection werden kann.
   */
  execConsole(containerId: string, command: readonly string[]): Promise<ExecResult>;

  /** `FILE_LIST`: Verzeichnisinhalt im Container (nicht rekursiv). */
  listFiles(containerId: string, path: string): Promise<readonly FileEntry[]>;

  /** `FILE_READ`: Dateiinhalt aus dem Container lesen. */
  readFile(containerId: string, path: string): Promise<Buffer>;

  /** `FILE_WRITE`: Datei im Container schreiben bzw. ueberschreiben. */
  writeFile(containerId: string, path: string, content: Buffer): Promise<void>;

  /** Auf Runtime-Events hoeren. Rueckgabe meldet den Listener wieder ab. */
  on(listener: ContainerRuntimeEventListener): Unsubscribe;

  /**
   * Live-Kanaele eines Containers oeffnen (`LOG_LINE`, `STATS_UPDATE`).
   * `STATUS_CHANGED`/`CRASHED` kommen unabhaengig davon ueber `connect()`.
   * Rueckgabe beendet genau dieses Abonnement.
   */
  watch(containerId: string, options?: WatchOptions): Promise<Unsubscribe>;

  /** Alle Live-Kanaele eines Containers schliessen. */
  unwatch(containerId: string): Promise<void>;
}
