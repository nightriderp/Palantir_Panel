/**
 * Datei-Manager eines Servers – Pfadprüfung und DTO-Aufbau (Arbeitspaket P2,
 * Lastenheft §3.3).
 *
 * Zwei Sichten treffen hier aufeinander:
 *
 *  - **Frontend/DTO:** Pfade sind *relativ* zum Datenordner des Servers; `''`
 *    ist die Wurzel (`ServerFileEntryDto.path`, `ServerFileListDto.path`).
 *  - **Agent/Protokoll:** Pfade sind *absolute* Container-Pfade
 *    (`FileListCommandPayload.path`).
 *
 * Die Übersetzung zwischen beiden passiert ausschließlich in dieser Datei, und
 * sie ist zugleich die erste von zwei Sperren gegen einen Ausbruch aus dem
 * Datenordner (Gefundener Punkt 100): Ein Pfad, der über `..` oder als
 * absoluter Fremdpfad hinausführt, erreicht den Agent gar nicht erst. Die
 * zweite Sperre ist `resolveWithinRoot()` im Agent selbst – sie bleibt
 * verbindlich, weil das Backend nicht die einzige Quelle von Befehlen sein
 * muss.
 */

import path from 'node:path';
import {
  type AgentFileEntry,
  type ServerFileContentDto,
  type ServerFileEntryDto,
  type ServerFileListDto,
} from '@palantir/contracts';
import { ServerOrchestrationError } from './errors.js';

/**
 * Obergrenze, bis zu der eine Datei im eingebauten Editor geöffnet wird.
 *
 * Der Editor lädt den Inhalt vollständig in den Browser; alles darüber gehört
 * in den Download, nicht in ein Textfeld.
 */
export const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;

/**
 * Harte Obergrenze für alles, was über den Agent-Kanal in einem Stück läuft.
 *
 * Spiegelt `DEFAULT_MAX_FILE_BYTES` der Container-Runtime (64 MiB). Der Agent
 * lehnt größere Dateien ohnehin mit `AGENT_FILE_TOO_LARGE` ab – das Backend
 * puffert sie deshalb erst gar nicht: `MAX_UPLOAD_SIZE_BYTES` (Pflichtenheft
 * §12.1) darf größer sein, wirksam ist der kleinere der beiden Werte.
 *
 * Ohne diese Grenze wäre der Upload-Puffer allein durch die
 * Umgebungsvariable begrenzt (Vorgabe dort: 2 GB) – ein einziger Upload könnte
 * den Backend-Speicher füllen.
 */
export const AGENT_FILE_CHANNEL_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Endungen, die der eingebaute Editor öffnet.
 *
 * Bewusst eine Positivliste: Eine Binärdatei im Textfeld ist beim Speichern
 * zerstört, und „ist das Text?" lässt sich an einem Verzeichniseintrag ohne
 * Inhalt nicht anders beantworten.
 */
const EDITABLE_EXTENSIONS = new Set([
  '.cfg',
  '.conf',
  '.config',
  '.csv',
  '.ini',
  '.json',
  '.log',
  '.lua',
  '.md',
  '.properties',
  '.sh',
  '.toml',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

/** Dateinamen ohne Endung, die trotzdem Text sind. */
const EDITABLE_NAMES = new Set(['eula', 'dockerfile', 'readme', 'license', 'changelog']);

function invalidPath(details: Readonly<Record<string, unknown>>): ServerOrchestrationError {
  return new ServerOrchestrationError(
    'AGENT_INVALID_PATH',
    'Der Pfad liegt außerhalb des Datenordners dieses Servers.',
    details,
  );
}

/**
 * Prüft einen vom Frontend gelieferten Pfad und gibt ihn normalisiert zurück.
 *
 * Erlaubt sind ausschließlich Pfade *relativ* zum Datenordner. Ein führender
 * `/`, ein `..`, das aus dem Ordner führt, oder ein NUL-Byte werden abgelehnt –
 * nicht bereinigt: Wer einen solchen Pfad schickt, meint etwas anderes als der
 * Datei-Manager anbietet, und ein stillschweigend zurechtgebogener Pfad wäre
 * die schlechtere Antwort.
 *
 * @returns Der normalisierte relative Pfad; `''` für die Wurzel.
 * @throws {ServerOrchestrationError} `AGENT_INVALID_PATH`
 */
export function normalizeRelativePath(requested: string): string {
  if (requested.includes('\0')) {
    throw invalidPath({ requested });
  }

  // Windows-Trenner kommen vom Datei-Dialog des Browsers; im Container ist
  // alles POSIX.
  const vereinheitlicht = requested.replaceAll('\\', '/');

  if (vereinheitlicht.startsWith('/')) {
    throw invalidPath({ requested });
  }

  if (vereinheitlicht.trim().length === 0) return '';

  const normalisiert = path.posix.normalize(vereinheitlicht).replace(/\/+$/, '');

  if (
    normalisiert === '..' ||
    normalisiert.startsWith('../') ||
    normalisiert.split('/').includes('..')
  ) {
    throw invalidPath({ requested, resolved: normalisiert });
  }

  return normalisiert === '.' ? '' : normalisiert;
}

/**
 * Relativer Pfad → absoluter Container-Pfad, eingesperrt auf `dataRoot`.
 *
 * @throws {ServerOrchestrationError} `AGENT_INVALID_PATH`, wenn `dataRoot`
 * selbst nicht absolut ist oder das Ergebnis aus ihm herausführt.
 */
export function toContainerPath(dataRoot: string, relative: string): string {
  const wurzel = path.posix.normalize(dataRoot);

  if (!path.posix.isAbsolute(wurzel)) {
    throw invalidPath({ dataRoot });
  }

  const relativ = normalizeRelativePath(relative);
  const ziel = relativ === '' ? wurzel : path.posix.join(wurzel, relativ);
  const wurzelMitTrenner = wurzel.endsWith('/') ? wurzel : `${wurzel}/`;

  // Gürtel und Hosenträger: `normalizeRelativePath` hat den Ausbruch bereits
  // abgefangen. Bleibt die Prüfung trotzdem hier stehen, kann ein späterer
  // zweiter Aufrufer der Funktion sie nicht versehentlich umgehen.
  if (ziel !== wurzel && !ziel.startsWith(wurzelMitTrenner)) {
    throw invalidPath({ dataRoot: wurzel, requested: relative, resolved: ziel });
  }

  return ziel;
}

/** Absoluter Container-Pfad → Pfad relativ zum Datenordner (`''` = Wurzel). */
export function toRelativePath(dataRoot: string, containerPath: string): string {
  const wurzel = path.posix.normalize(dataRoot);
  const relativ = path.posix.relative(wurzel, path.posix.normalize(containerPath));

  return relativ === '.' ? '' : relativ;
}

/** Übergeordnetes Verzeichnis eines relativen Pfades; `null` in der Wurzel. */
export function parentPathOf(relative: string): string | null {
  if (relative === '') return null;

  const eltern = path.posix.dirname(relative);

  return eltern === '.' || eltern === '/' ? '' : eltern;
}

/** Öffnet der eingebaute Editor diesen Eintrag? */
export function isEditable(entry: { type: string; name: string; sizeBytes: number }): boolean {
  if (entry.type !== 'file') return false;
  if (entry.sizeBytes > MAX_EDITABLE_FILE_BYTES) return false;

  const endung = path.posix.extname(entry.name).toLowerCase();

  return endung === ''
    ? EDITABLE_NAMES.has(entry.name.toLowerCase())
    : EDITABLE_EXTENSIONS.has(endung);
}

export interface ServerFileViewLimits {
  /** Maximale Upload-Größe pro Datei, wie sie das Backend tatsächlich zulässt. */
  readonly maxUploadBytes: number;
  /** Darf der Aufrufer in diesem Ordner schreiben? */
  readonly writable: boolean;
}

export function toServerFileEntryDto(
  dataRoot: string,
  entry: AgentFileEntry,
  limits: ServerFileViewLimits,
): ServerFileEntryDto {
  return {
    name: entry.name,
    path: toRelativePath(dataRoot, entry.path),
    type: entry.type,
    sizeBytes: entry.sizeBytes,
    modifiedAt: entry.modifiedAt,
    editable: limits.writable && isEditable(entry),
    downloadable: entry.type === 'file',
  };
}

export function toServerFileListDto(
  serverId: string,
  dataRoot: string,
  relativePath: string,
  entries: readonly AgentFileEntry[],
  limits: ServerFileViewLimits,
): ServerFileListDto {
  return {
    serverId,
    path: relativePath,
    parentPath: parentPathOf(relativePath),
    entries: entries.map((entry) => toServerFileEntryDto(dataRoot, entry, limits)),
    writable: limits.writable,
    maxUploadBytes: limits.maxUploadBytes,
    maxEditableBytes: MAX_EDITABLE_FILE_BYTES,
  };
}

export function toServerFileContentDto(
  serverId: string,
  relativePath: string,
  content: Buffer,
  modifiedAt: string,
  writable: boolean,
): ServerFileContentDto {
  return {
    serverId,
    path: relativePath,
    content: content.toString('utf8'),
    sizeBytes: content.byteLength,
    modifiedAt,
    writable,
  };
}
