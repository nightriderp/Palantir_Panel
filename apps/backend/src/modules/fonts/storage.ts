/**
 * Ablage der Schriftdateien im Dateisystem (Arbeitspaket S-2).
 *
 * Eigener Port statt eines `readFile` mitten im Dienst – dieselbe Aufteilung
 * wie bei den Panel-Sicherungen (`panel-backups/files.ts`) und den
 * Audit-Archiven: Die Regeln des Dienstes bleiben ohne Dateisystem prüfbar
 * (CLAUDE.md §4), und alles, was mit Pfaden zu tun hat, steht an genau einer
 * Stelle.
 *
 * **Der Dateiname kommt nie vom Hochladenden.** Er wird aus der vom Backend
 * vergebenen UUID und dem erkannten Format gebildet ({@link fontFileName}).
 * Zusätzlich prüft {@link resolveInside} jeden Namen, bevor er zu einem Pfad
 * wird: Ein Name mit Trennzeichen oder `..` wird abgewiesen, und der fertige
 * Pfad muss innerhalb des Ablageorts liegen. Beide Prüfungen sind bewusst
 * doppelt – die erste ist die Regel, die zweite fängt sie ab, falls sie einmal
 * unvollständig wird.
 */

import { FONT_FORMAT_CATALOG, type FontFormat } from '@palantir/contracts';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dateiname einer hochgeladenen Schrift im Ablageort.
 *
 * Aus der Kennung, nicht aus dem hochgeladenen Namen: Der Ablageort bleibt
 * dadurch flach, kollisionsfrei und frei von allem, was ein Dateiname sonst
 * mitbringen kann (Leerzeichen, Umlaute, Steuerzeichen, `..`).
 */
export function fontFileName(id: string, format: FontFormat): string {
  return `${id}${FONT_FORMAT_CATALOG[format].extension}`;
}

/**
 * Vorgabe für `FONT_UPLOAD_DIR` – `data/fonts` neben der Auscheckung.
 *
 * Im Docker-Betrieb übersteuert die Compose-Datei die Variable mit dem
 * Einhängepunkt (`/data/fonts`), genau wie bei `AUDIT_ARCHIVE_DIR`. Diese
 * Vorgabe greift also nur auf einem Entwicklungsrechner, und dort ist
 * `/data/` von `.gitignore` abgedeckt.
 */
export function defaultFontUploadDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..', 'data/fonts');
}

/**
 * Zugriff auf einen Ablageort mit Schriftdateien.
 *
 * Bewusst schmal: Der Dienst kennt nur Dateinamen, nie Pfade.
 */
export interface FontFileStore {
  /** Legt eine Datei ab und erzeugt den Ablageort bei Bedarf. */
  write(fileName: string, content: Buffer): Promise<void>;
  /** Inhalt der Datei; `null`, wenn sie fehlt. */
  read(fileName: string): Promise<Buffer | null>;
  /** Größe in Bytes; `null`, wenn die Datei fehlt. */
  size(fileName: string): Promise<number | null>;
  /** Entfernt die Datei. Eine bereits fehlende ist der gewünschte Zustand. */
  remove(fileName: string): Promise<void>;
}

/**
 * Baut den Pfad zu einer Datei im Ablageort – oder wirft.
 *
 * Exportiert, damit der Nachweis gegen Pfad-Traversal genau diese Funktion
 * prüfen kann und nicht nur den Weg über die Route.
 */
export function resolveInside(directory: string, fileName: string): string {
  if (fileName.length === 0 || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error(`Unzulässiger Dateiname im Schriften-Ablageort: ${JSON.stringify(fileName)}`);
  }

  // Fängt `.`, `..` und jede Form, die `path.resolve` nach oben führen würde.
  if (fileName === '.' || fileName === '..' || fileName.startsWith('..')) {
    throw new Error(`Unzulässiger Dateiname im Schriften-Ablageort: ${JSON.stringify(fileName)}`);
  }

  const wurzel = path.resolve(directory);
  const ziel = path.resolve(wurzel, fileName);
  const relativ = path.relative(wurzel, ziel);

  if (relativ.length === 0 || relativ.startsWith('..') || path.isAbsolute(relativ)) {
    throw new Error(`Unzulässiger Dateiname im Schriften-Ablageort: ${JSON.stringify(fileName)}`);
  }

  return ziel;
}

/** Ist der Fehler ein „Datei nicht vorhanden"? */
function istNichtVorhanden(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

/** Ablage im Dateisystem – der Betriebsfall. */
export function createNodeFontFileStore(directory: string): FontFileStore {
  return {
    async write(fileName, content) {
      const ziel = resolveInside(directory, fileName);
      await mkdir(path.dirname(ziel), { recursive: true });
      await writeFile(ziel, content);
    },

    async read(fileName) {
      try {
        return await readFile(resolveInside(directory, fileName));
      } catch (error: unknown) {
        if (istNichtVorhanden(error)) {
          return null;
        }

        throw error;
      }
    },

    async size(fileName) {
      try {
        return (await stat(resolveInside(directory, fileName))).size;
      } catch (error: unknown) {
        if (istNichtVorhanden(error)) {
          return null;
        }

        throw error;
      }
    },

    async remove(fileName) {
      // `force` – eine bereits fehlende Datei ist genau der gewünschte Zustand
      // (dieselbe Überlegung wie beim Entfernen einer Panel-Sicherung).
      await rm(resolveInside(directory, fileName), { force: true });
    },
  };
}
