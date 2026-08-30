/**
 * Lesen hochgeladener Archive (Weltdaten-Uebernahme, Lastenheft §3.3;
 * Arbeitspaket P4).
 *
 * **Warum eine eigene, kleine Umsetzung und keine Bibliothek** (CLAUDE.md §1):
 * Gebraucht wird genau eines - "welche Eintraege stehen in diesem Archiv und
 * was ist ihr Inhalt". Fuer `tar.gz` liegt der Codec schon da (`docker/tar.ts`
 * plus `zlib`); es fehlt allein das ZIP-Format, und dafuer reichen die
 * Zentralverzeichnis-Eintraege und `zlib.inflateRaw`. Eine Abhaengigkeit, die
 * auf dem Homeserver mitlaeuft und dort Archive aus fremder Hand auspackt,
 * waere schwerer zu rechtfertigen als diese Datei.
 *
 * **Was hier NICHT passiert:** Geschrieben wird nichts. Diese Datei liefert nur
 * die geprueften Eintraege; abgelegt werden sie von der Container-Runtime ueber
 * denselben Archiv-Endpunkt, den auch `FILE_UPLOAD` benutzt. So bleibt der
 * einzige Weg auf das Datenvolume der ueber die Runtime (CLAUDE.md §4).
 *
 * **Sicherheit.** Drei Grenzen, alle bewusst hier und nicht beim Aufrufer:
 *
 * 1. *Pfad-Ausbruch* - Eintraege mit fuehrendem Schraegstrich, Laufwerksbuchstabe
 *    oder `..` werden uebersprungen und gemeldet, nicht entpackt.
 * 2. *Entpack-Bombe* - Ein paar Kilobyte Archiv koennen sich zu Gigabyte
 *    entfalten. Sowohl die Gesamtgroesse als auch die Anzahl der Eintraege sind
 *    gedeckelt; darueber bricht der Vorgang mit `ARCHIVE_INVALID` ab.
 * 3. *Sonderdateien* - Symlinks, Hardlinks und Geraetedateien werden
 *    uebersprungen. Ein Symlink im Datenordner, der nach `/etc` zeigt, waere ein
 *    Ausbruch mit Umweg.
 */

import { gunzipSync, inflateRawSync } from 'node:zlib';
import { ContainerRuntimeError } from './errors.js';
import { parseTar } from './docker/tar.js';

/** Formate, die {@link readArchive} kennt - Gegenstueck zu `ARCHIVE_FORMATS`. */
export type ArchiveKind = 'tar.gz' | 'zip';

/**
 * Obergrenze fuer die Summe aller entpackten Nutzdaten.
 *
 * Bewusst deutlich groesser als ein Archiv sein darf (der Agent-Kanal traegt
 * 64 MiB in einem Stueck) und trotzdem endlich: Die Eintraege werden fuer die
 * Uebergabe an die Container-Engine einmal im Speicher gehalten.
 */
export const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;

/** Obergrenze fuer die Anzahl der Eintraege. Ein Weltordner bleibt weit darunter. */
export const MAX_ARCHIVE_ENTRIES = 50_000;

export interface ArchiveEntry {
  /** Pfad relativ zur Archivwurzel, ohne fuehrenden Schraegstrich. */
  readonly path: string;
  readonly type: 'file' | 'directory';
  readonly content: Buffer;
}

export interface ArchiveContents {
  readonly entries: readonly ArchiveEntry[];
  /** Eintraege, die aus dem Zielordner ausgebrochen waeren oder Sonderdateien sind. */
  readonly skipped: readonly string[];
  readonly totalBytes: number;
}

function ungueltig(grund: string, details: Record<string, unknown> = {}): never {
  throw new ContainerRuntimeError('ARCHIVE_INVALID', { message: grund, details });
}

/**
 * Erkennt das Format an den ersten Bytes.
 *
 * Die Dateiendung ist nur ein Hinweis des Nutzers; hier zaehlt der Inhalt.
 * `null`, wenn es keines der unterstuetzten Formate ist.
 */
export function detectArchiveKind(archiv: Buffer): ArchiveKind | null {
  if (archiv.length >= 4 && archiv[0] === 0x50 && archiv[1] === 0x4b) {
    // "PK" - lokaler Kopfsatz (03 04), leeres Archiv (05 06) oder Spanned (07 08).
    const dritte = archiv[2];
    const vierte = archiv[3];

    if (
      (dritte === 0x03 && vierte === 0x04) ||
      (dritte === 0x05 && vierte === 0x06) ||
      (dritte === 0x07 && vierte === 0x08)
    ) {
      return 'zip';
    }
  }

  if (archiv.length >= 2 && archiv[0] === 0x1f && archiv[1] === 0x8b) {
    return 'tar.gz';
  }

  return null;
}

/**
 * Normalisiert einen Archivpfad und weist alles ab, was aus dem Zielordner
 * ausbricht.
 *
 * `null` bedeutet "nicht entpacken". Bewusst kein Abbruch: Ein einzelner
 * unsauberer Eintrag - etwa das `__MACOSX/`-Beiwerk eines Mac-ZIPs - soll eine
 * sonst brauchbare Welt nicht unbrauchbar machen. Der Aufrufer nennt die
 * uebersprungenen Eintraege in seiner Antwort.
 */
export function safeArchivePath(roh: string): string | null {
  const vereinheitlicht = roh.replaceAll('\\', '/').trim();

  if (vereinheitlicht.length === 0) {
    return null;
  }

  // Absoluter Pfad oder Laufwerksbuchstabe.
  if (vereinheitlicht.startsWith('/') || /^[a-zA-Z]:/.test(vereinheitlicht)) {
    return null;
  }

  const teile: string[] = [];

  for (const teil of vereinheitlicht.split('/')) {
    if (teil === '' || teil === '.') {
      continue;
    }

    if (teil === '..') {
      return null;
    }

    teile.push(teil);
  }

  return teile.length === 0 ? null : teile.join('/');
}

/** Ein Eintrag nach dem anderen einsammeln - mit den Grenzen aus dem Kopfkommentar. */
class Sammler {
  readonly #entries: ArchiveEntry[] = [];
  readonly #skipped: string[] = [];
  #totalBytes = 0;

  add(rohPfad: string, type: 'file' | 'directory', content: Buffer): void {
    const pfad = safeArchivePath(rohPfad);

    if (pfad === null) {
      this.#skipped.push(rohPfad);

      return;
    }

    if (this.#entries.length >= MAX_ARCHIVE_ENTRIES) {
      ungueltig(`Das Archiv enthaelt mehr als ${String(MAX_ARCHIVE_ENTRIES)} Eintraege.`, {
        maxEntries: MAX_ARCHIVE_ENTRIES,
      });
    }

    this.#totalBytes += content.length;

    if (this.#totalBytes > MAX_EXTRACTED_BYTES) {
      ungueltig('Der entpackte Inhalt des Archivs ist zu gross.', {
        maxExtractedBytes: MAX_EXTRACTED_BYTES,
      });
    }

    this.#entries.push({ path: pfad, type, content });
  }

  skip(rohPfad: string): void {
    this.#skipped.push(rohPfad);
  }

  result(): ArchiveContents {
    return { entries: this.#entries, skipped: this.#skipped, totalBytes: this.#totalBytes };
  }
}

function readTarGz(archiv: Buffer, sammler: Sammler): void {
  let roh: Buffer;

  try {
    roh = gunzipSync(archiv);
  } catch (error: unknown) {
    ungueltig('Das Archiv liess sich nicht entpacken (gzip).', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  for (const eintrag of parseTar(roh)) {
    if (eintrag.type === 'symlink') {
      // Ein Symlink im Datenordner koennte nach aussen zeigen - siehe Kopf.
      sammler.skip(eintrag.name);
      continue;
    }

    sammler.add(eintrag.name, eintrag.type === 'directory' ? 'directory' : 'file', eintrag.content);
  }
}

// -- ZIP -------------------------------------------------------------------
//
// Gelesen wird ueber das Zentralverzeichnis am Dateiende: Nur dort stehen die
// Groessen zuverlaessig. Im lokalen Kopfsatz duerfen sie 0 sein, wenn der
// Packer sie nachtraeglich in einen Data Descriptor geschrieben hat - ein
// Archiv, das man nur von vorn liest, waere damit nicht sicher zerlegbar.

const EOCD_SIGNATUR = 0x0605_4b50;
const ZENTRAL_SIGNATUR = 0x0201_4b50;
const LOKAL_SIGNATUR = 0x0403_4b50;
/** Groesstmoegliches ZIP-Kommentarfeld - so weit muss die Suche zurueckgehen. */
const MAX_EOCD_SUCHE = 0xffff + 22;

function findeEocd(archiv: Buffer): number {
  const start = Math.max(0, archiv.length - MAX_EOCD_SUCHE);

  for (let position = archiv.length - 22; position >= start; position -= 1) {
    if (archiv.readUInt32LE(position) === EOCD_SIGNATUR) {
      return position;
    }
  }

  ungueltig('Das ZIP-Archiv hat kein lesbares Zentralverzeichnis.');
}

function readZip(archiv: Buffer, sammler: Sammler): void {
  if (archiv.length < 22) {
    ungueltig('Das ZIP-Archiv ist unvollstaendig.');
  }

  const eocd = findeEocd(archiv);
  const anzahl = archiv.readUInt16LE(eocd + 10);
  let position = archiv.readUInt32LE(eocd + 16);

  if (position === 0xffff_ffff || anzahl === 0xffff) {
    // ZIP64 - kommt bei Weltordnern ueber 4 GB oder ueber 65535 Dateien vor.
    // Solche Archive sind ohnehin groesser als der Agent-Kanal traegt.
    ungueltig('ZIP64-Archive werden nicht unterstuetzt.');
  }

  for (let index = 0; index < anzahl; index += 1) {
    if (position + 46 > archiv.length || archiv.readUInt32LE(position) !== ZENTRAL_SIGNATUR) {
      ungueltig('Das Zentralverzeichnis des ZIP-Archivs ist beschaedigt.', { index });
    }

    const verfahren = archiv.readUInt16LE(position + 10);
    const komprimiert = archiv.readUInt32LE(position + 20);
    const entpackt = archiv.readUInt32LE(position + 24);
    const nameLaenge = archiv.readUInt16LE(position + 28);
    const extraLaenge = archiv.readUInt16LE(position + 30);
    const kommentarLaenge = archiv.readUInt16LE(position + 32);
    const lokal = archiv.readUInt32LE(position + 42);
    const name = archiv.toString('utf8', position + 46, position + 46 + nameLaenge);

    position += 46 + nameLaenge + extraLaenge + kommentarLaenge;

    if (name.endsWith('/')) {
      sammler.add(name, 'directory', Buffer.alloc(0));
      continue;
    }

    if (komprimiert === 0xffff_ffff || entpackt === 0xffff_ffff) {
      ungueltig('ZIP64-Eintraege werden nicht unterstuetzt.', { name });
    }

    if (lokal + 30 > archiv.length || archiv.readUInt32LE(lokal) !== LOKAL_SIGNATUR) {
      ungueltig('Ein Eintrag des ZIP-Archivs verweist ins Leere.', { name });
    }

    const datenStart =
      lokal + 30 + archiv.readUInt16LE(lokal + 26) + archiv.readUInt16LE(lokal + 28);
    const daten = archiv.subarray(datenStart, datenStart + komprimiert);

    if (daten.length < komprimiert) {
      ungueltig('Ein Eintrag des ZIP-Archivs ist unvollstaendig.', { name });
    }

    if (entpackt > MAX_EXTRACTED_BYTES) {
      ungueltig('Der entpackte Inhalt des Archivs ist zu gross.', {
        name,
        maxExtractedBytes: MAX_EXTRACTED_BYTES,
      });
    }

    let inhalt: Buffer;

    if (verfahren === 0) {
      inhalt = Buffer.from(daten);
    } else if (verfahren === 8) {
      try {
        inhalt = inflateRawSync(daten, { maxOutputLength: MAX_EXTRACTED_BYTES });
      } catch (error: unknown) {
        ungueltig('Ein Eintrag des ZIP-Archivs liess sich nicht entpacken.', {
          name,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      // Nur "gespeichert" und "deflate" - alles andere (bzip2, LZMA, ZipCrypto)
      // kommt bei Weltarchiven nicht vor und braeuchte eine Abhaengigkeit.
      sammler.skip(name);
      continue;
    }

    sammler.add(name, 'file', inhalt);
  }
}

/**
 * Zerlegt ein Archiv in seine Eintraege.
 *
 * @throws {ContainerRuntimeError} `ARCHIVE_INVALID`, wenn das Archiv nicht
 *   lesbar ist, ein nicht unterstuetztes Format hat oder die Grenzen aus dem
 *   Kopfkommentar sprengt.
 */
export function readArchive(archiv: Buffer, kind?: ArchiveKind): ArchiveContents {
  const format = kind ?? detectArchiveKind(archiv);

  if (format === null) {
    ungueltig('Das Archiv ist weder ein ZIP- noch ein tar.gz-Archiv.');
  }

  const sammler = new Sammler();

  if (format === 'zip') {
    readZip(archiv, sammler);
  } else {
    readTarGz(archiv, sammler);
  }

  return sammler.result();
}
