/**
 * Minimaler TAR-Codec fuer den Datei-Manager.
 *
 * Die Docker-Engine bietet fuer Dateizugriffe ausschliesslich
 * `GET/PUT /containers/{id}/archive` an - Inhalte gehen als TAR-Strom rein und
 * raus. Es gibt keinen Endpunkt, der ein Verzeichnis auflistet.
 *
 * Bewusste Entscheidung (CLAUDE.md §1): statt einer neuen Abhaengigkeit
 * (`tar-stream`) oder eines `ls`-Aufrufs im Container steht hier ein kleiner
 * eigener Codec. Ein `ls` im Container waere die schlechtere Loesung, weil es
 * eine Shell im Image voraussetzt - die es bei read-only Root-Filesystem und
 * schlanken Images oft nicht gibt.
 *
 * Unterstuetzt wird das, was die Docker-Engine tatsaechlich erzeugt: USTAR mit
 * PAX- und GNU-Erweiterung fuer lange Dateinamen.
 */

const BLOCK_SIZE = 512;

export type TarEntryType = 'file' | 'directory' | 'symlink';

export interface TarEntry {
  /** Pfad relativ zum Archivwurzelverzeichnis, wie im Archiv hinterlegt. */
  readonly name: string;
  readonly type: TarEntryType;
  readonly size: number;
  /** Unix-Rechte als Oktalstring ohne fuehrende Nullen, z. B. `644`. */
  readonly mode: string;
  /** Aenderungszeitpunkt als ISO-8601-String. */
  readonly modifiedAt: string;
  readonly content: Buffer;
}

function leseString(block: Buffer, start: number, laenge: number): string {
  const roh = block.subarray(start, start + laenge);
  const ende = roh.indexOf(0);
  return roh.subarray(0, ende === -1 ? roh.length : ende).toString('utf8');
}

function leseOktal(block: Buffer, start: number, laenge: number): number {
  const text = leseString(block, start, laenge).trim();
  if (text.length === 0) return 0;
  const wert = Number.parseInt(text, 8);
  return Number.isNaN(wert) ? 0 : wert;
}

function istNullblock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

function typAusFlag(flag: string): TarEntryType {
  switch (flag) {
    case '5':
      return 'directory';
    case '2':
      return 'symlink';
    default:
      return 'file';
  }
}

/** Zerlegt PAX-Datensaetze (`laenge schluessel=wert\n`). */
function parsePaxRecords(inhalt: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let position = 0;

  while (position < inhalt.length) {
    const leerzeichen = inhalt.indexOf(0x20, position);
    if (leerzeichen === -1) break;

    const laenge = Number.parseInt(inhalt.subarray(position, leerzeichen).toString('utf8'), 10);
    if (!Number.isFinite(laenge) || laenge <= 0 || position + laenge > inhalt.length) break;

    const datensatz = inhalt.subarray(leerzeichen + 1, position + laenge).toString('utf8');
    const trenner = datensatz.indexOf('=');
    if (trenner !== -1) {
      records[datensatz.slice(0, trenner)] = datensatz.slice(trenner + 1).replace(/\n$/, '');
    }
    position += laenge;
  }

  return records;
}

/**
 * Liest ein TAR-Archiv vollstaendig ein.
 *
 * Verzeichnisse und Dateien werden zurueckgegeben; PAX-/GNU-Kopfsaetze fliessen in
 * den jeweils folgenden Eintrag ein und tauchen selbst nicht in der Liste auf.
 */
export function parseTar(archiv: Buffer): TarEntry[] {
  const eintraege: TarEntry[] = [];
  let position = 0;
  let ueberschriebenerName: string | undefined;

  while (position + BLOCK_SIZE <= archiv.length) {
    const kopf = archiv.subarray(position, position + BLOCK_SIZE);
    if (istNullblock(kopf)) break;

    const groesse = leseOktal(kopf, 124, 12);
    const typFlag = leseString(kopf, 156, 1);
    const inhaltStart = position + BLOCK_SIZE;
    const inhalt = archiv.subarray(inhaltStart, inhaltStart + groesse);
    position = inhaltStart + Math.ceil(groesse / BLOCK_SIZE) * BLOCK_SIZE;

    // PAX-Kopfsatz: liefert Metadaten fuer den naechsten echten Eintrag.
    if (typFlag === 'x' || typFlag === 'X') {
      const records = parsePaxRecords(Buffer.from(inhalt));
      ueberschriebenerName = records['path'] ?? ueberschriebenerName;
      continue;
    }
    // GNU-Langname: der Inhalt ist der Name des naechsten Eintrags.
    if (typFlag === 'L') {
      ueberschriebenerName = inhalt.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    // Globaler PAX-Kopfsatz und GNU-Langlink interessieren hier nicht.
    if (typFlag === 'g' || typFlag === 'K') {
      continue;
    }

    const prefix = leseString(kopf, 345, 155);
    const basisName = leseString(kopf, 0, 100);
    const name = ueberschriebenerName ?? (prefix.length > 0 ? `${prefix}/${basisName}` : basisName);
    ueberschriebenerName = undefined;

    if (name.length === 0) continue;

    eintraege.push({
      name,
      type: typAusFlag(typFlag),
      size: groesse,
      mode: (leseOktal(kopf, 100, 8) & 0o7777).toString(8),
      modifiedAt: new Date(leseOktal(kopf, 136, 12) * 1000).toISOString(),
      content: Buffer.from(inhalt),
    });
  }

  return eintraege;
}

export interface TarFileInput {
  /** Dateiname im Archiv (ohne fuehrenden Schraegstrich). */
  readonly name: string;
  readonly content: Buffer;
  /** Unix-Rechte, Vorgabe `0o644` fuer Dateien, `0o755` fuer Verzeichnisse. */
  readonly mode?: number;
  /** Aenderungszeitpunkt, Vorgabe: jetzt. */
  readonly modifiedAt?: Date;
  /**
   * Eintragsart; Vorgabe `file`.
   *
   * Verzeichniseintraege braucht das Entpacken eines Weltarchivs (P4): Ein
   * leerer Ordner im Quellarchiv soll auch im Datenordner ankommen.
   */
  readonly type?: 'file' | 'directory';
}

function schreibeOktal(block: Buffer, start: number, laenge: number, wert: number): void {
  // TAR erwartet oktal, rechtsbuendig mit fuehrenden Nullen, abgeschlossen mit NUL.
  const text = wert.toString(8).padStart(laenge - 1, '0');
  block.write(text.slice(-(laenge - 1)), start, laenge - 1, 'ascii');
  block.writeUInt8(0, start + laenge - 1);
}

/** Ein einzelner Kopfsatz samt Pruefsumme. */
function kopfBlock(
  name: string,
  groesse: number,
  mode: number,
  modifiedAt: Date,
  typFlag: string,
): Buffer {
  const kopf = Buffer.alloc(BLOCK_SIZE);
  kopf.write(name, 0, 100, 'utf8');
  schreibeOktal(kopf, 100, 8, mode);
  schreibeOktal(kopf, 108, 8, 0);
  schreibeOktal(kopf, 116, 8, 0);
  schreibeOktal(kopf, 124, 12, groesse);
  schreibeOktal(kopf, 136, 12, Math.floor(modifiedAt.getTime() / 1000));
  kopf.write(typFlag, 156, 1, 'ascii');
  kopf.write('ustar\0', 257, 6, 'ascii');
  kopf.write('00', 263, 2, 'ascii');

  // Pruefsumme: Summe aller Kopf-Bytes, wobei das Pruefsummenfeld selbst als
  // Leerzeichen zaehlt.
  kopf.fill(0x20, 148, 156);
  let summe = 0;
  for (const byte of kopf) summe += byte;
  const pruefsumme = summe.toString(8).padStart(6, '0');
  kopf.write(pruefsumme, 148, 6, 'ascii');
  kopf.writeUInt8(0, 154);
  kopf.writeUInt8(0x20, 155);

  return kopf;
}

function fuellblock(groesse: number): Buffer {
  return Buffer.alloc((BLOCK_SIZE - (groesse % BLOCK_SIZE)) % BLOCK_SIZE);
}

/**
 * Erzeugt ein TAR-Archiv mit Datei- und Verzeichniseintraegen.
 *
 * Namen ueber 100 Byte bekommen einen vorangestellten GNU-Langnamen-Kopfsatz
 * (Typ `L`) - genau die Erweiterung, die {@link parseTar} beim Lesen schon
 * beherrscht und die die Docker-Engine ebenfalls versteht. Frueher wurden
 * solche Namen abgelehnt; das reichte fuer den Datei-Manager (eine Datei,
 * relativ zum Zielordner), nicht aber fuer ein entpacktes Weltarchiv, in dem
 * verschachtelte Pfade der Normalfall sind (P4).
 */
export function createTar(dateien: readonly TarFileInput[]): Buffer {
  const bloecke: Buffer[] = [];

  for (const datei of dateien) {
    const istVerzeichnis = datei.type === 'directory';
    const name = istVerzeichnis && !datei.name.endsWith('/') ? `${datei.name}/` : datei.name;
    const inhalt = istVerzeichnis ? Buffer.alloc(0) : datei.content;
    const modifiedAt = datei.modifiedAt ?? new Date();
    const mode = datei.mode ?? (istVerzeichnis ? 0o755 : 0o644);

    if (Buffer.byteLength(name, 'utf8') > 100) {
      const nameBytes = Buffer.concat([Buffer.from(name, 'utf8'), Buffer.alloc(1)]);

      bloecke.push(
        kopfBlock('././@LongLink', nameBytes.length, 0o644, modifiedAt, 'L'),
        nameBytes,
        fuellblock(nameBytes.length),
      );
    }

    bloecke.push(
      kopfBlock(name.slice(0, 100), inhalt.length, mode, modifiedAt, istVerzeichnis ? '5' : '0'),
      inhalt,
      fuellblock(inhalt.length),
    );
  }

  // Ein Archiv endet mit zwei Nullbloecken.
  bloecke.push(Buffer.alloc(BLOCK_SIZE * 2));
  return Buffer.concat(bloecke);
}
