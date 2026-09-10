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

import fs from 'node:fs/promises';
import path from 'node:path';
import { ContainerRuntimeError } from '../runtime/index.js';

export interface ResolveOptionen {
  /**
   * Die Wurzel selbst als Ergebnis zulassen.
   *
   * Vorgabe `false`: Fast jeder Aufrufer meint einen Pfad **in** der Wurzel,
   * und die beiden, die das Ergebnis zum Löschen benutzen, meinten es ganz
   * sicher (Fundpunkt 201).
   */
  readonly erlaubeWurzel?: boolean;
}

/**
 * Löst `candidate` gegen `root` auf und stellt sicher, dass das Ergebnis
 * innerhalb von `root` liegt.
 *
 * Der Vergleich läuft über `path.relative()` und nicht über einen
 * Präfix-Vergleich der Zeichenketten: `/srv/palantir/servers-alt` beginnt mit
 * `/srv/palantir/servers`, liegt aber nicht darin.
 *
 * Rein lexikalisch – gegen symbolische Verknüpfungen hilft erst
 * {@link assertOhnePfadausbruch}, und die kostet einen Dateisystemzugriff.
 *
 * @throws {ContainerRuntimeError} `INVALID_PATH`
 */
export function resolveWithinDirectory(
  root: string,
  candidate: string,
  optionen: ResolveOptionen = {},
): string {
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
    /*
     * Die Wurzel selbst ist kein gültiger Pfad (Audit 2026-09-10,
     * Fundpunkt 201).
     *
     * Vorher gab die Funktion sie zurück, und zwei Aufrufer löschten danach
     * rekursiv: `RESTORE_BACKUP` leerte mit `targetPath: '.'` den Datenordner
     * **aller** Server der Node, `REMOVE_STORAGE_ENTRY` entfernte denselben
     * Baum. Ein Kandidat, der auf nichts innerhalb der Wurzel zeigt, ist kein
     * Ziel – wer die Wurzel wirklich meint, sagt es mit `erlaubeWurzel`.
     */
    if (optionen.erlaubeWurzel !== true) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Das Verzeichnis selbst ist kein gültiges Ziel – erwartet wird ein Pfad darin.',
        details: { root: wurzel, candidate },
      });
    }

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

/**
 * Prüft, dass der Pfad auch **nach** Auflösung aller Verknüpfungen noch in
 * `root` liegt (Audit 2026-09-10, Fundpunkt 201).
 *
 * {@link resolveWithinDirectory} vergleicht Zeichenketten. Das genügt gegen
 * `..` und absolute Pfade, nicht aber gegen eine symbolische Verknüpfung: Der
 * Datenordner ist in den Spielcontainer eingehängt, und wer dort Code
 * ausführen darf – bei Paper reicht eine hochgeladene Erweiterung – legt darin
 * `ln -s /srv/palantir/servers/<fremd> welt/link`. Der Agent läuft auf dem Host
 * und öffnet den Pfad mit `node:fs`; ohne diese Prüfung folgt er dem Link über
 * alle Server der Node hinweg.
 *
 * Aufgelöst wird der **längste vorhandene** Teil des Pfades: Ein Ziel, das noch
 * nicht existiert (frisch angelegter Ordner, Datei vor dem Schreiben), soll
 * nicht daran scheitern, dass `realpath` es nicht findet. Was darunter noch
 * entsteht, kann keine Verknüpfung mehr sein, die vor der Prüfung lag.
 *
 * Bewusst getrennt von {@link resolveWithinDirectory}: Diese Prüfung kostet
 * einen Dateisystemzugriff und gehört deshalb dorthin, wo anschließend
 * wirklich geöffnet, geschrieben oder gelöscht wird – nicht in jede
 * Pfadberechnung.
 *
 * @throws {ContainerRuntimeError} `INVALID_PATH`
 */
export async function assertOhnePfadausbruch(root: string, ziel: string): Promise<void> {
  const wurzel = await echterPfad(path.resolve(root));
  const aufgeloest = await echterPfad(path.resolve(ziel));
  const relativ = path.relative(wurzel, aufgeloest);

  if (relativ !== '' && (relativ.startsWith('..') || path.isAbsolute(relativ))) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: 'Der Pfad führt über eine Verknüpfung aus dem erlaubten Verzeichnis heraus.',
      details: { root: wurzel, target: ziel, resolved: aufgeloest },
    });
  }
}

/**
 * Wie {@link assertOhnePfadausbruch}, aber gegen mehrere erlaubte Wurzeln –
 * das Gegenstück zu {@link resolveWithinAny}.
 */
export async function assertOhnePfadausbruchInEinem(
  roots: readonly string[],
  ziel: string,
): Promise<void> {
  const aufgeloest = await echterPfad(path.resolve(ziel));

  for (const root of roots) {
    const wurzel = await echterPfad(path.resolve(root));
    const relativ = path.relative(wurzel, aufgeloest);

    if (relativ === '' || (!relativ.startsWith('..') && !path.isAbsolute(relativ))) {
      return;
    }
  }

  throw new ContainerRuntimeError('INVALID_PATH', {
    message: 'Der Pfad führt über eine Verknüpfung aus den erlaubten Verzeichnissen heraus.',
    details: { roots, target: ziel, resolved: aufgeloest },
  });
}

/** `realpath` des längsten vorhandenen Teils; nicht Vorhandenes bleibt stehen. */
async function echterPfad(kandidat: string): Promise<string> {
  let vorhanden = kandidat;
  const rest: string[] = [];

  for (;;) {
    try {
      const aufgeloest = await fs.realpath(vorhanden);

      return rest.length === 0 ? aufgeloest : path.join(aufgeloest, ...rest.reverse());
    } catch {
      const eltern = path.dirname(vorhanden);

      if (eltern === vorhanden) {
        // Bis zur Wurzel des Dateisystems nichts gefunden – dann bleibt der
        // Pfad, wie er ist; der lexikalische Vergleich hat bereits gegriffen.
        return kandidat;
      }

      rest.push(path.basename(vorhanden));
      vorhanden = eltern;
    }
  }
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
