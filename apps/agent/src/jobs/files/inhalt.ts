/**
 * Eine Datei im Datenordner lesen und schreiben (Fundpunkt 281).
 *
 * **Warum host-seitig.** Bis hierher liefen `FILE_READ`, `FILE_WRITE` und
 * `FILE_UPLOAD` über den Archiv-Endpunkt der Engine: Lesen holte ein TAR und
 * packte die eine Datei daraus aus, Schreiben packte sie in ein TAR und schob
 * es hinein. Falsch war das nie – eine einzelne Datei ist eine einzelne Datei,
 * und die Größengrenzen greifen dort sinnvoll. Nur ist es der Umweg: Der Agent
 * hat den Datenordner selbst gemountet (`AGENT_DATA_DIR`).
 *
 * Drei Dinge werden dadurch einfacher:
 *
 * 1. **Kein Hin und Her mehr für die Größe.** Vorher fragte ein `HEAD` die
 *    Engine nach Größe und Typ, bevor überhaupt gelesen wurde; kam von dort
 *    keine Größe, musste der Lesezugriff vorsichtshalber scheitern. `stat`
 *    beantwortet beides in einem Zug.
 * 2. **Hochladen wird wirklich atomar.** Die Engine bietet kein „nur anlegen,
 *    wenn nicht vorhanden"; zwischen Prüfung und Schreiben lag ein Fenster, in
 *    dem ein zweiter Upload dieselbe Datei anlegen konnte. `open(..., 'wx')`
 *    ist ein einziger Aufruf und hat dieses Fenster nicht.
 * 3. **Es geht auch ohne laufenden Container** – wie das Löschen seit
 *    Fundpunkt 105 und das Auflisten seit 276.
 *
 * Was hier **nicht** hingehört, ist `FILE_EXTRACT`: Das packt ein fremdes
 * Archiv aus und braucht die Grenzen aus `archive.ts`; dazu steht die
 * Begründung an der Runtime.
 *
 * Wie beim Löschen gilt: Die Runtime sagt, **wo** der Datenordner liegt, der
 * Zugriff passiert hier (Entwicklungsregeln §4).
 */

import { open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ContainerRuntimeError } from '../../runtime/errors.js';
import { resolveWithinRoot } from '../../runtime/paths.js';
import { type DataVolumePaths } from '../../runtime/types.js';
import { assertOhnePfadausbruch, resolveWithinDirectory } from '../paths.js';

export interface InhaltOptions {
  /**
   * Wurzel, unterhalb derer der Agent überhaupt arbeiten darf
   * (`AGENT_DATA_DIR`).
   */
  readonly allowedRoot?: string;
}

export interface SchreibOptions extends InhaltOptions {
  /**
   * Eine vorhandene Datei überschreiben.
   *
   * Ohne das scheitert der Aufruf mit `FILE_EXISTS`, und zwar **atomar**: Das
   * Anlegen selbst entscheidet, nicht eine Prüfung davor.
   */
  readonly overwrite?: boolean;
}

/** Fehlt der Pfad? */
function istNichtVorhanden(fehler: unknown): boolean {
  return (fehler as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Rechnet einen Container-Pfad auf den Host um und prüft ihn dreifach.
 *
 * Dieselben drei Schranken wie beim Löschen: erst im Container-Pfadraum, wo der
 * Aufrufer denkt und wo ein `..` auftaucht; dann im Host-Pfadraum gegen die
 * erlaubte Wurzel; und zuletzt gegen Verknüpfungen, denn die beiden davor
 * vergleichen nur Zeichenketten (Fundpunkt 201).
 */
async function aufDemHost(
  volume: DataVolumePaths,
  ziel: string,
  allowedRoot: string | undefined,
): Promise<string> {
  const wurzel = path.posix.normalize(volume.containerPath);
  const imContainer = resolveWithinRoot(wurzel, ziel);

  if (imContainer === wurzel) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Der Datenordner selbst ist keine Datei.',
      details: { path: ziel },
    });
  }

  const relativ = path.posix.relative(wurzel, imContainer);
  const pfad = path.resolve(volume.hostPath, ...relativ.split('/'));

  if (allowedRoot !== undefined) {
    resolveWithinDirectory(allowedRoot, pfad);
    await assertOhnePfadausbruch(allowedRoot, pfad);
  }

  return pfad;
}

/**
 * Liest eine Datei aus dem Datenordner eines Servers.
 *
 * `maxBytes` wird **vor** dem Lesen geprüft: Eine Datei, die größer ist als der
 * Kanal, soll den Agent nicht erst füllen und dann abgewiesen werden.
 */
export async function readServerFile(
  volume: DataVolumePaths,
  ziel: string,
  maxBytes: number,
  options: InhaltOptions = {},
): Promise<Buffer> {
  const pfad = await aufDemHost(volume, ziel, options.allowedRoot);

  let eintrag;

  try {
    eintrag = await stat(pfad);
  } catch (fehler: unknown) {
    if (istNichtVorhanden(fehler)) {
      throw new ContainerRuntimeError('FILE_NOT_FOUND', { details: { path: ziel } });
    }

    throw fehler;
  }

  if (!eintrag.isFile()) {
    throw new ContainerRuntimeError('FILE_NOT_FOUND', {
      message: 'Der Pfad verweist auf keine lesbare Datei.',
      details: { path: ziel },
    });
  }

  if (eintrag.size > maxBytes) {
    throw new ContainerRuntimeError('FILE_TOO_LARGE', {
      details: { path: ziel, sizeBytes: eintrag.size, maxBytes },
    });
  }

  return readFile(pfad);
}

/**
 * Schreibt eine Datei in den Datenordner eines Servers.
 *
 * Ohne `overwrite` entscheidet das Anlegen selbst, ob die Datei schon da ist –
 * `open(..., 'wx')` schlägt dann mit `EEXIST` fehl. Das ist der Unterschied zum
 * bisherigen Weg: Dort lagen Prüfung und Schreiben auseinander, und dazwischen
 * passte ein zweiter Upload.
 */
export async function writeServerFile(
  volume: DataVolumePaths,
  ziel: string,
  inhalt: Buffer,
  maxBytes: number,
  options: SchreibOptions = {},
): Promise<void> {
  if (inhalt.byteLength > maxBytes) {
    throw new ContainerRuntimeError('FILE_TOO_LARGE', {
      details: { path: ziel, sizeBytes: inhalt.byteLength, maxBytes },
    });
  }

  const pfad = await aufDemHost(volume, ziel, options.allowedRoot);

  if (options.overwrite === true) {
    await writeFile(pfad, inhalt);
    return;
  }

  let griff;

  try {
    griff = await open(pfad, 'wx');
  } catch (fehler: unknown) {
    if ((fehler as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
      throw new ContainerRuntimeError('FILE_EXISTS', { details: { path: ziel } });
    }

    throw fehler;
  }

  try {
    await griff.writeFile(inhalt);
  } finally {
    await griff.close();
  }
}
