/**
 * Datei oder Verzeichnis im Datenordner entfernen (WORK_STATUS.md, Gefundener
 * Punkt 105).
 *
 * **Warum host-seitig und nicht im Container.** Die Engine-API kennt zum Lesen
 * und Schreiben den Archiv-Endpunkt, aber kein Loeschen; der einzige Weg ueber
 * die Container-Schnittstelle waere `exec` – und der setzt einen **laufenden**
 * Container voraus. Aufraeumen will man aber gerade dann, wenn der Server steht:
 * die Welt loeschen, bevor er neu startet. Auflisten, Lesen, Schreiben und
 * Hochladen gehen ohnehin schon im gestoppten Zustand ueber den
 * Archiv-Endpunkt; das Loeschen war die letzte Ausnahme.
 *
 * Der Agent hat den Datenordner selbst gemountet (`AGENT_DATA_DIR`), kommt also
 * ohne Umweg an die Dateien. Das ist Dateisystemarbeit und gehoert deshalb
 * hierher und nicht in die Container-Runtime (CLAUDE.md §4) – die liefert nur
 * die beiden Pfade.
 */

import { mkdir, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FileDeleteCommandPayload } from '@palantir/contracts';
import { type ContainerRuntime } from '../../runtime/container-runtime.js';
import { ContainerRuntimeError } from '../../runtime/errors.js';
import { resolveWithinRoot } from '../../runtime/paths.js';
import { type DataVolumePaths } from '../../runtime/types.js';
import { resolveWithinDirectory } from '../paths.js';

export interface DeleteServerFileOptions {
  /** Verzeichnis samt Inhalt entfernen. Ohne das scheitert ein nicht-leeres. */
  readonly recursive?: boolean;
  /**
   * Wurzel, unterhalb derer der Agent ueberhaupt arbeiten darf
   * (`AGENT_DATA_DIR`). Liegt der Datenordner woanders, wird nichts geloescht –
   * ein Pfad ausserhalb waere entweder eine Fehlkonfiguration oder ein
   * Angriffsversuch.
   */
  readonly allowedRoot?: string;
}

/** Fehlt der Pfad bereits? */
function istNichtVorhanden(fehler: unknown): boolean {
  return (fehler as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Entfernt einen Pfad aus dem Datenordner eines Servers.
 *
 * `ziel` ist ein **Container-Pfad**, wie ihn der Datei-Manager kennt (z. B.
 * `/data/welt`); er wird auf den Host-Pfad umgerechnet. Beide Wurzeln kommen
 * aus {@link DataVolumePaths}.
 *
 * Bewusst **idempotent**: Ein bereits fehlender Pfad ist kein Fehler – sonst
 * bliebe nach einem Abbruch ein Eintrag zurueck, der sich nie wieder loeschen
 * liesse. Der Datenordner selbst laesst sich nicht entfernen; ein Server ohne
 * Datenordner waere kaputt, und Loeschen gehoert zum Server-Lifecycle.
 */
export async function deleteServerFile(
  volume: DataVolumePaths,
  ziel: string,
  options: DeleteServerFileOptions = {},
): Promise<void> {
  // Erst im Container-Pfadraum begrenzen: Dort denkt der Aufrufer, und dort
  // liegt der Versuch, ueber `..` auszubrechen. Dieser Teil rechnet mit
  // `path.posix` (`resolveWithinRoot` aus A2) – Container-Pfade sind immer
  // Linux-Pfade, auch wenn der Agent selbst auf Windows entwickelt wird.
  const wurzel = path.posix.normalize(volume.containerPath);
  const imContainer = resolveWithinRoot(wurzel, ziel);

  if (imContainer === wurzel) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Der Datenordner selbst kann nicht geloescht werden.',
      details: { path: ziel },
    });
  }

  // Ab hier der Host-Pfadraum: `node:path` und `resolveWithinDirectory` aus A3,
  // denn diese Pfade oeffnet der Agent selbst.
  const relativ = path.posix.relative(wurzel, imContainer);
  const aufDemHost = path.resolve(volume.hostPath, ...relativ.split('/'));

  if (options.allowedRoot !== undefined) {
    // Zweite Schranke, diesmal im Host-Pfadraum: Der Datenordner muss dort
    // liegen, wo der Agent ueberhaupt arbeiten darf.
    resolveWithinDirectory(options.allowedRoot, aufDemHost);
  }

  let istVerzeichnis: boolean;

  try {
    istVerzeichnis = (await stat(aufDemHost)).isDirectory();
  } catch (fehler: unknown) {
    if (istNichtVorhanden(fehler)) {
      return;
    }

    throw fehler;
  }

  if (!istVerzeichnis) {
    await rm(aufDemHost, { force: true });

    return;
  }

  if (options.recursive === true) {
    await rm(aufDemHost, { recursive: true, force: true });

    return;
  }

  try {
    // `rmdir` scheitert von sich aus an einem nicht-leeren Verzeichnis – genau
    // die Grenze, die `recursive` aufhebt.
    await rmdir(aufDemHost);
  } catch (fehler: unknown) {
    if (istNichtVorhanden(fehler)) {
      return;
    }

    if ((fehler as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
      throw new ContainerRuntimeError('RUNTIME_ERROR', {
        message:
          'Das Verzeichnis ist nicht leer. Zum Entfernen samt Inhalt braucht es die ausdrueckliche Angabe.',
        details: { path: ziel },
      });
    }

    throw fehler;
  }
}

export interface ServerFileJobOptions {
  readonly runtime: ContainerRuntime;
  /** `AGENT_DATA_DIR` – die Wurzel, unterhalb derer der Agent arbeiten darf. */
  readonly dataDir: string;
}

/**
 * `FILE_DELETE` als Job (A3) – dieselbe Rollenteilung wie beim
 * {@link StorageScanner}: Die Runtime sagt, **wo** der Datenordner liegt, das
 * Loeschen selbst passiert hier auf dem Dateisystem.
 */
export class ServerFileJob {
  readonly #runtime: ContainerRuntime;
  readonly #dataDir: string;

  constructor(options: ServerFileJobOptions) {
    this.#runtime = options.runtime;
    this.#dataDir = path.resolve(options.dataDir);
  }

  /**
   * Legt den Datenordner eines Servers an, bevor der Container entsteht
   * (WORK_STATUS.md, Gefundener Punkt 117).
   *
   * **Warum ueberhaupt.** Der Datenordner ist eine Bind-Quelle. Fehlt sie beim
   * Anlegen des Containers, erzeugt der Docker-Daemon sie selbst - und zwar als
   * `root:root`, denn der Daemon laeuft als root. Ein Spielprozess, der wie
   * gefordert nicht als root laeuft, koennte darin nichts schreiben; er
   * scheiterte beim ersten Start, ohne dass die Ursache am Container sichtbar
   * waere.
   *
   * **Warum kein `chown`.** Der Agent laeuft selbst als UID 1000 und ohne
   * Capabilities (`no-new-privileges`, siehe `deploy/gamenode/docker-compose.yml`).
   * Er kann den Ordner also nicht verschenken - er legt ihn an, und damit
   * gehoert er ihm. Genau diese UID verlangen die eigenen Spiel-Images
   * (SPIEL_IMAGES.md); mehr braucht es nicht.
   *
   * `0o700`, weil derselbe Benutzer schreibt, der auch liest: Spielstaende sind
   * fremde Daten und gehen den Rest des Homeservers nichts an.
   *
   * Idempotent: Ein vorhandener Ordner bleibt unangetastet - auch seine Rechte,
   * die der Betreiber bewusst gesetzt haben kann.
   */
  async ensureDataDirectory(hostPath: string): Promise<void> {
    // Dieselbe Schranke wie beim Loeschen: Der Agent legt nur unterhalb seines
    // Datenverzeichnisses etwas an. Ein Pfad daneben waere Fehlkonfiguration
    // oder ein untergeschobener Bind-Mount.
    const ziel = resolveWithinDirectory(this.#dataDir, hostPath);

    await mkdir(ziel, { recursive: true, mode: 0o700 });
  }

  /** Ergebnis ist `null` wie im Protokoll festgelegt. */
  async delete(payload: FileDeleteCommandPayload): Promise<null> {
    const volume = await this.#runtime.dataVolumePaths(payload.containerId);

    await deleteServerFile(volume, payload.path, {
      ...(payload.recursive === undefined ? {} : { recursive: payload.recursive }),
      allowedRoot: this.#dataDir,
    });

    return null;
  }
}
