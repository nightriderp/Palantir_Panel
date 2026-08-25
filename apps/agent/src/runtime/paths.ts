/**
 * Pfadpruefung fuer Bind-Mounts und den Datei-Manager.
 *
 * Der Datei-Manager (Lastenheft §3.3) nimmt Pfade aus dem Frontend entgegen.
 * Ohne Pruefung liesse sich damit ueber `..` aus dem Server-Datenordner
 * herauslaufen. Alle Pfade laufen deshalb durch die Funktionen dieser Datei,
 * bevor sie die Container-Engine erreichen.
 *
 * Container-Pfade sind immer POSIX-Pfade, unabhaengig vom Betriebssystem, auf
 * dem der Agent laeuft - deshalb durchgaengig `path.posix`.
 */

import path from 'node:path';
import { ContainerRuntimeError } from './errors.js';

/**
 * Normalisiert einen absoluten POSIX-Pfad und stellt sicher, dass er innerhalb
 * von `root` liegt.
 *
 * @throws {ContainerRuntimeError} `INVALID_PATH`, wenn der Pfad relativ ist,
 * ein NUL-Byte enthaelt oder aus `root` herausfuehrt.
 */
export function resolveWithinRoot(root: string, requested: string): string {
  if (requested.includes('\0') || root.includes('\0')) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Pfade duerfen kein NUL-Byte enthalten.',
      details: { requested },
    });
  }

  const normalizedRoot = path.posix.normalize(root);
  if (!path.posix.isAbsolute(normalizedRoot)) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Der Wurzelpfad muss absolut sein.',
      details: { root },
    });
  }

  // Relative Angaben werden bewusst gegen die Wurzel aufgeloest, statt sie
  // abzulehnen: das Frontend schickt Pfade relativ zum Serverordner.
  const candidate = path.posix.isAbsolute(requested)
    ? path.posix.normalize(requested)
    : path.posix.normalize(path.posix.join(normalizedRoot, requested));

  const rootWithSep = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;

  if (candidate !== normalizedRoot && !candidate.startsWith(rootWithSep)) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Der Pfad liegt ausserhalb des erlaubten Bereichs.',
      details: { root: normalizedRoot, requested, resolved: candidate },
    });
  }

  return candidate;
}

/**
 * Prueft einen Host-Pfad, der als Bind-Mount in einen Container soll.
 *
 * Der Agent darf ausschliesslich Verzeichnisse unterhalb von `AGENT_DATA_DIR`
 * (bzw. `AGENT_BACKUP_DIR`) mounten - andernfalls koennte eine fehlerhafte oder
 * manipulierte `CREATE`-Anweisung beliebige Hostverzeichnisse in einen
 * Container spiegeln.
 */
export function assertHostPathAllowed(allowedRoots: readonly string[], hostPath: string): string {
  if (allowedRoots.length === 0) {
    throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
      message: 'Es ist kein erlaubtes Host-Wurzelverzeichnis konfiguriert.',
    });
  }

  if (!path.posix.isAbsolute(hostPath)) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Host-Pfade muessen absolut sein.',
      details: { hostPath },
    });
  }

  for (const root of allowedRoots) {
    try {
      return resolveWithinRoot(root, hostPath);
    } catch {
      // Naechste erlaubte Wurzel probieren.
    }
  }

  throw new ContainerRuntimeError('INVALID_PATH', {
    message: 'Der Host-Pfad liegt ausserhalb der erlaubten Verzeichnisse.',
    details: { hostPath, allowedRoots },
  });
}

/** Absoluter Container-Pfad, normalisiert. Relative Pfade sind hier nicht erlaubt. */
export function assertAbsoluteContainerPath(containerPath: string): string {
  if (containerPath.includes('\0')) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Pfade duerfen kein NUL-Byte enthalten.',
      details: { containerPath },
    });
  }
  if (!path.posix.isAbsolute(containerPath)) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Container-Pfade muessen absolut sein.',
      details: { containerPath },
    });
  }
  return path.posix.normalize(containerPath);
}
