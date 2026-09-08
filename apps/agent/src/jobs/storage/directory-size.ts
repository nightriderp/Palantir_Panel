/**
 * Größe eines Verzeichnisbaums (Arbeitspaket A2/A3).
 *
 * Diese Messung gab es bereits – sie steckte als private Methode im
 * {@link StorageScanner} und war nur über einen vollständigen
 * `GET_STORAGE_BREAKDOWN` erreichbar. Der belegte Plattenplatz **je Server**
 * (Fundpunkt 168) braucht dieselbe Rechnung, und zwar für genau einen Ordner.
 * Statt einer zweiten Implementierung steht sie jetzt hier, und beide Aufrufer
 * benutzen sie (CLAUDE.md §3: keine Parallelstrukturen).
 *
 * **Warum das Dateisystem und nicht die Container-Engine.** Der Datenordner ist
 * ein Bind-Mount auf der Node; der Agent hat ihn selbst gemountet
 * (`AGENT_DATA_DIR`) und kommt ohne Umweg an die Dateien – dieselbe Begründung
 * wie bei `FILE_DELETE` (`jobs/files/delete.ts`). Die Container-Engine kennt die
 * Belegung eines Bind-Mounts ohnehin nicht; sie zählt nur die
 * Schreib-Schicht des Containers. Diese Datei spricht deshalb nicht mit Docker
 * und braucht dafür auch keine `ContainerRuntime` (CLAUDE.md §4).
 */

import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Ergebnis einer Baummessung. */
export interface DirectorySize {
  /** Summe der Dateigrößen des gesamten Baums. */
  readonly sizeBytes: number;
  /** Jüngste Änderung im Baum als ISO-8601, `null` bei einem leeren Baum. */
  readonly lastModifiedAt: string | null;
}

/**
 * Summiert die Dateigrößen unterhalb von `wurzel`.
 *
 * **Symbolische Verknüpfungen werden nie verfolgt** (`lstat`, und ein
 * Verknüpfungs-Eintrag wird übersprungen). Das hat zwei Gründe: Sonst zählte
 * derselbe Speicher doppelt, und eine Verknüpfung nach `/` oder auf einen
 * Vorfahren ließe den Lauf nie enden. Zugleich ist damit ausgeschlossen, dass
 * die Messung den Datenordner verlässt – auch wenn jemand im Datenordner eine
 * Verknüpfung nach draußen ablegt.
 *
 * Fehler unterwegs beenden den Lauf nicht: Ein Unterordner ohne Leserecht und
 * eine Datei, die zwischen `readdir` und `lstat` verschwindet, werden
 * übersprungen. Eine Teilsumme ist hier mehr wert als gar keine Zahl.
 *
 * @returns `null`, wenn schon die Wurzel fehlt oder nicht lesbar ist – der
 *   Aufrufer entscheidet, ob das `0` oder „keine Angabe" bedeutet.
 */
export async function directorySize(wurzel: string): Promise<DirectorySize | null> {
  const wurzelEintraege = await leseVerzeichnis(wurzel);

  if (wurzelEintraege === null) {
    return null;
  }

  let sizeBytes = 0;
  let neuste = 0;

  const gehe = async (verzeichnis: string, eintraege: readonly Dirent[]): Promise<void> => {
    for (const eintrag of eintraege) {
      const pfad = path.join(verzeichnis, eintrag.name);

      if (eintrag.isSymbolicLink()) {
        continue;
      }

      if (eintrag.isDirectory()) {
        const kinder = await leseVerzeichnis(pfad);
        if (kinder !== null) {
          await gehe(pfad, kinder);
        }
        continue;
      }

      try {
        const stat = await fs.lstat(pfad);
        sizeBytes += stat.size;
        neuste = Math.max(neuste, stat.mtimeMs);
      } catch {
        // Zwischen `readdir` und `lstat` verschwunden – nicht mitzählen.
      }
    }
  };

  await gehe(wurzel, wurzelEintraege);

  try {
    const stat = await fs.lstat(wurzel);
    neuste = Math.max(neuste, stat.mtimeMs);
  } catch {
    // Wurzel ist während des Laufs verschwunden.
  }

  return {
    sizeBytes,
    lastModifiedAt: neuste === 0 ? null : new Date(neuste).toISOString(),
  };
}

/** `readdir`, das ein fehlendes oder gesperrtes Verzeichnis als `null` meldet. */
async function leseVerzeichnis(verzeichnis: string): Promise<Dirent[] | null> {
  try {
    return await fs.readdir(verzeichnis, { withFileTypes: true });
  } catch {
    return null;
  }
}
