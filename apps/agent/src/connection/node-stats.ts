/**
 * Gemessene Ist-Ressourcen der Node (Pflichtenheft §11).
 *
 * Der Agent liest sie beim Ist-Zustands-Bericht vom Betriebssystem ab und
 * schickt sie als `AgentNodeStats` mit. Das Backend rechnet die
 * Kapazitätsprüfung dagegen, statt gegen im Panel hinterlegte Sollwerte – so
 * folgt die Kapazität dem, was die VM wirklich hat (z. B. nach dem Vergrößern
 * der Platte), ohne dass jemand den Datensatz nachpflegt.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import type { AgentNodeStats } from '@palantir/contracts';
import { leseVerfuegbarenSpeicherMb } from '../runtime/memory.js';

const BYTES_PER_MB = 1024 * 1024;

function toMb(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}

/**
 * Liest die Ist-Ressourcen einmalig.
 *
 * `dataDir` bestimmt, welches Dateisystem für die Speicherwerte gemessen wird –
 * dort liegen die Server-Datenordner, deren Platzbedarf die Kapazitätsprüfung
 * deckelt. Scheitert die Messung (Verzeichnis fehlt, Plattform ohne `statfs`),
 * wird `null` zurückgegeben und der Bericht geht ohne `nodeStats` raus; das ist
 * additiv zulässig und besser als ein halber, irreführender Messwert.
 */
export async function readNodeStats(dataDir: string): Promise<AgentNodeStats | null> {
  try {
    const fsstat = await fs.statfs(dataDir);
    const diskTotalBytes = fsstat.blocks * fsstat.bsize;
    // `bavail` statt `bfree`: der für gewöhnliche Prozesse tatsächlich
    // verfügbare Platz, ohne die für root reservierten Blöcke.
    const diskAvailableBytes = fsstat.bavail * fsstat.bsize;

    return {
      cpuCores: os.cpus().length,
      // `loadavg` führt Unix; Windows liefert konstant [0,0,0]. Dort lieber
      // `null` als eine erfundene Null, die wie „keine Last" aussähe.
      cpuLoad1m: process.platform === 'win32' ? null : (os.loadavg()[0] ?? null),
      ramTotalMb: toMb(os.totalmem()),
      // `MemAvailable` aus /proc/meminfo statt `freemem`: Letzteres zählt den
      // Dateicache als belegt und meldete eine fast volle Node, obwohl der
      // Kernel den Cache jedem neuen Prozess sofort hergibt. Seit die
      // Zuweisungen weich sind, ist diese Zahl das, was im Panel als
      // „belegt“ steht – sie soll den echten Verbrauch zeigen (`memory.ts`).
      ramAvailableMb: await leseVerfuegbarenSpeicherMb(),
      diskTotalMb: toMb(diskTotalBytes),
      diskAvailableMb: toMb(diskAvailableBytes),
      observedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Bindet {@link readNodeStats} an ein festes Datenverzeichnis. */
export function createNodeStatsReader(dataDir: string): () => Promise<AgentNodeStats | null> {
  return () => readNodeStats(dataDir);
}
