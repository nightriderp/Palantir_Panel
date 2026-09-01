/**
 * Entfernen abgelegter Abzüge auf der VPS.
 *
 * Eigene, winzige Umsetzung statt eines direkten `rm` im Dienst: So bleibt der
 * Ablauf ohne Dateisystem prüfbar (CLAUDE.md §4) – dieselbe Aufteilung wie beim
 * {@link DatabaseDumper}.
 */

import { rm } from 'node:fs/promises';
import { type BackupFileRemover } from './index.js';

export function createNodeBackupFileRemover(): BackupFileRemover {
  return {
    async remove(path: string): Promise<void> {
      // `force` – eine bereits fehlende Datei ist genau der gewünschte Zustand.
      await rm(path, { force: true });
    },
  };
}
