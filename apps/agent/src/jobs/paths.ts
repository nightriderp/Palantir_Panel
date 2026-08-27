/**
 * Pfadprüfung für die Dateisystem-Jobs (Arbeitspaket A3).
 *
 * **Abgrenzung zu `runtime/paths.ts` (A2):** Die Funktionen dort prüfen
 * *Container*-Pfade und die Host-Pfade von Bind-Mounts und rechnen deshalb
 * durchgängig mit `path.posix` – der Homeserver ist Linux, und ein Bind-Mount
 * ist eine Angabe an die Container-Engine, kein Zugriff des Agents.
 *
 * Hier geht es um das Gegenteil: um Pfade, die der Agent **selbst** öffnet,
 * liest und beschreibt (Backup-Archive, Datenordner, Speicher-Scan). Die laufen
 * über `node:fs` und damit über das Pfadverständnis des Betriebssystems, auf
 * dem der Agent gerade läuft. Deshalb `node:path` statt `path.posix` – sonst
 * ließen sich diese Jobs auf einem Entwicklungsrechner unter Windows nicht
 * testen, obwohl sie in Produktion identisch arbeiten.
 *
 * Der Fehlertyp bleibt `ContainerRuntimeError`: Der Agent führt genau einen
 * benannten Fehlerkatalog (`RUNTIME_ERROR_CATALOG`), und der Adapter in A1
 * bildet ihn bereits vollständig auf den API-Katalog ab. Ein zweiter Katalog
 * für dieselben Fälle (`INVALID_PATH`, `FILE_NOT_FOUND`, ...) wäre eine
 * Parallelstruktur ohne Gewinn (CLAUDE.md §3, §5).
 */

import path from 'node:path';
import { ContainerRuntimeError } from '../runtime/index.js';

/**
 * Löst `candidate` gegen `root` auf und stellt sicher, dass das Ergebnis
 * innerhalb von `root` liegt.
 *
 * Der Vergleich läuft über `path.relative()` und nicht über einen
 * Präfix-Vergleich der Zeichenketten: `/srv/palantir/servers-alt` beginnt mit
 * `/srv/palantir/servers`, liegt aber nicht darin.
 *
 * @throws {ContainerRuntimeError} `INVALID_PATH`
 */
export function resolveWithinDirectory(root: string, candidate: string): string {
  if (root.includes('\0') || candidate.includes('\0')) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Pfade dürfen kein NUL-Byte enthalten.',
      details: { candidate },
    });
  }

  const wurzel = path.resolve(root);
  const ziel = path.resolve(wurzel, candidate);
  const relativ = path.relative(wurzel, ziel);

  if (relativ === '') {
    return ziel;
  }

  if (relativ.startsWith('..') || path.isAbsolute(relativ)) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Der Pfad liegt außerhalb des erlaubten Verzeichnisses.',
      details: { root: wurzel, candidate, resolved: ziel },
    });
  }

  return ziel;
}

/**
 * Wie {@link resolveWithinDirectory}, aber gegen mehrere erlaubte Wurzeln.
 *
 * Nützlich dort, wo sowohl Datenordner als auch Backup-Ablage in Frage kommen
 * (etwa beim Entfernen verwaister Daten).
 */
export function resolveWithinAny(roots: readonly string[], candidate: string): string {
  if (roots.length === 0) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Es ist kein erlaubtes Verzeichnis konfiguriert.',
      details: { candidate },
    });
  }

  for (const root of roots) {
    try {
      return resolveWithinDirectory(root, candidate);
    } catch {
      // Nächste erlaubte Wurzel probieren.
    }
  }

  throw new ContainerRuntimeError('INVALID_PATH', {
    message: 'Der Pfad liegt außerhalb der erlaubten Verzeichnisse.',
    details: { candidate, roots },
  });
}

/** UUID-Format der Entitäts-Ids – Ordnernamen der Server folgen ihm. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server-Id aus einem Ordnernamen, oder `null`.
 *
 * Der Agent rät hier bewusst nicht: Ein Ordner, dessen Name keine Id ist,
 * bekommt keine zugeordnet. Ob er wirklich verwaist ist, entscheidet erst das
 * Backend (Pflichtenheft §16).
 */
export function serverIdFromDirectoryName(name: string): string | null {
  return UUID.test(name) ? name.toLowerCase() : null;
}

/** Container-Namen der Form `palantir-<serverId>` auflösen. */
export function serverIdFromContainerName(name: string): string | null {
  const treffer = /^\/?palantir-(.+)$/.exec(name);
  const kandidat = treffer?.[1];
  return kandidat !== undefined && UUID.test(kandidat) ? kandidat.toLowerCase() : null;
}
