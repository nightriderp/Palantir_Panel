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
  /** Unix-Rechte, Vorgabe `0o644`. */
  readonly mode?: number;
  /** Aenderungszeitpunkt, Vorgabe: jetzt. */
  readonly modifiedAt?: Date;
}

function schreibeOktal(block: Buffer, start: number, laenge: number, wert: number): void {
  // TAR erwartet oktal, rechtsbuendig mit fuehrenden Nullen, abgeschlossen mit NUL.
  const text = wert.toString(8).padStart(laenge - 1, '0');
  block.write(text.slice(-(laenge - 1)), start, laenge - 1, 'ascii');
  block.writeUInt8(0, start + laenge - 1);
}

/**
 * Erzeugt ein TAR-Archiv mit einfachen Dateieintraegen.
 *
 * Namen ueber 100 Zeichen werden abgelehnt statt still abgeschnitten: der
 * Datei-Manager arbeitet relativ zum Zielverzeichnis, dort sind so lange Namen
 * kein realistischer Fall - und ein abgeschnittener Name wuerde die falsche
 * Datei ueberschreiben.
 */
export function createTar(dateien: readonly TarFileInput[]): Buffer {
  const bloecke: Buffer[] = [];

  for (const datei of dateien) {
    if (Buffer.byteLength(datei.name, 'utf8') > 100) {
      throw new Error(`Dateiname zu lang fuer das TAR-Format: ${datei.name}`);
    }

    const kopf = Buffer.alloc(BLOCK_SIZE);
    kopf.write(datei.name, 0, 100, 'utf8');
    schreibeOktal(kopf, 100, 8, datei.mode ?? 0o644);
    schreibeOktal(kopf, 108, 8, 0);
    schreibeOktal(kopf, 116, 8, 0);
    schreibeOktal(kopf, 124, 12, datei.content.length);
    schreibeOktal(kopf, 136, 12, Math.floor((datei.modifiedAt ?? new Date()).getTime() / 1000));
    kopf.write('0', 156, 1, 'ascii');
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

    const fuellung = Buffer.alloc((BLOCK_SIZE - (datei.content.length % BLOCK_SIZE)) % BLOCK_SIZE);
    bloecke.push(kopf, datei.content, fuellung);
  }

  // Ein Archiv endet mit zwei Nullbloecken.
  bloecke.push(Buffer.alloc(BLOCK_SIZE * 2));
  return Buffer.concat(bloecke);
}
