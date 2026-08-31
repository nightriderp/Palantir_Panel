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
 * | `FILE_DELETE`         | (host-seitig, siehe `jobs/files/delete.ts`) |
 * | `FILE_UPLOAD`         | `uploadFile`         |
 * | `FILE_EXTRACT`        | `extractArchive`     |
 *
 * `CREATE_BACKUP`, `RESTORE_BACKUP` und `GET_STORAGE_BREAKDOWN` aus derselben
 * Liste sind Dateisystem- und Job-Aufgaben und gehoeren zu A3, nicht zur
 * Container-Ansteuerung.
 *
 * `listImages()`/`removeImage()` sind die einzige Ergaenzung aus A3: Der
 * Storage-Explorer (Pflichtenheft §16) braucht Image-Groessen und Nutzungsstatus,
 * und die kommen von der Container-Engine. Sie stehen deshalb hier und nicht im
 * Storage-Job - dieser Weg ist der einzige erlaubte (CLAUDE.md §4).
 */

import { type ArchiveKind } from './archive.js';
import { type ContainerRuntimeEventListener, type Unsubscribe } from './events.js';
import {
  type ContainerHandle,
  type ContainerImage,
  type ContainerSpec,
  type ContainerState,
  type ContainerStats,
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

  /**
   * Alle Container-Images des Hosts samt Groesse und Nutzungsstatus
   * (Pflichtenheft §16, Arbeitspaket A3).
   *
   * Ergaenzung aus A3: Der Storage-Explorer braucht die Image-Groessen, und
   * Agent-Code darf die Engine nur ueber dieses Interface ansprechen
   * (CLAUDE.md §4). Der Aufruf ist teurer als die Ordnergroessen - deshalb ist
   * er im Scan abschaltbar (`GetStorageBreakdownCommandPayload.includeImages`).
   */
  listImages(): Promise<readonly ContainerImage[]>;

  /**
   * Ein Image entfernen (Lastenheft §3.8: ungenutzte Images sind loeschbar).
   *
   * Bewusst **idempotent**: Ein bereits fehlendes Image ist kein Fehler,
   * sondern `false`. Ein noch benutztes Image lehnt die Engine dagegen ab
   * (`CONTAINER_STATE_CONFLICT`) - dann ist die Voraussetzung des Aufrufers
   * falsch, und das soll auffallen.
   *
   * @returns `true`, wenn tatsaechlich etwas entfernt wurde.
   */
  removeImage(imageId: string, options?: RemoveImageOptions): Promise<boolean>;

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

  /**
   * Wo der Datenordner eines Containers liegt - im Container und auf dem Host.
   *
   * Gebraucht fuer das Loeschen: Das laeuft host-seitig ueber das Dateisystem
   * (`jobs/files/delete.ts`) und nicht mehr ueber `exec` im Container, weil ein
   * gestoppter Container keine Befehle annimmt - und Aufraeumen will man
   * gerade dann (WORK_STATUS.md, Gefundener Punkt 105).
   *
   * Diese Umsetzung liest nur nach; das Loeschen selbst ist Dateisystemarbeit
   * und gehoert nicht in die Container-Runtime (CLAUDE.md §4).
   */
  dataVolumePaths(containerId: string): Promise<DataVolumePaths>;

  /**
   * `FILE_UPLOAD`: hochgeladene Datei im Datenordner ablegen.
   *
   * Unterscheidet sich von {@link writeFile} in genau einem Punkt: Der Zielpfad
   * wird **vor** dem Schreiben geprueft und ein belegter Pfad ohne `overwrite`
   * mit `FILE_EXISTS` abgelehnt.
   */
  uploadFile(
    containerId: string,
    path: string,
    content: Buffer,
    options?: UploadFileOptions,
  ): Promise<void>;

  /**
   * `FILE_EXTRACT`: ein hochgeladenes Archiv in den Datenordner entpacken
   * (Weltdaten-Uebernahme, Lastenheft §3.3; Arbeitspaket P4).
   *
   * `path` ist - wie ueberall im Datei-Manager - relativ zum Datenordner; `''`
   * ist die Wurzel. Bestehende Dateien werden ueberschrieben: Der Import laeuft
   * beim Anlegen in einen frischen Datenordner, und ein halb uebernommener
   * Weltordner waere schlimmer als ein ersetzter Standardstand.
   *
   * Archiveintraege, die aus dem Zielordner ausbrechen wuerden, und
   * Sonderdateien (Symlinks, Geraete) entpackt die Runtime nicht; sie nennt sie
   * in `skipped`. Ein unlesbares oder zu grosses Archiv endet mit
   * `ARCHIVE_INVALID`.
   */
  extractArchive(
    containerId: string,
    path: string,
    archive: Buffer,
    format: ArchiveKind,
  ): Promise<ExtractArchiveResult>;

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
