/**
 * Streamender TAR-GZIP-Codec für Backups (Arbeitspaket A3, Lastenheft §3.3).
 *
 * **Warum nicht `runtime/docker/tar.ts` (A2):** Der Codec dort arbeitet auf
 * einem `Buffer` im Speicher. Das ist für den Datei-Manager richtig – dort geht
 * es um einzelne Dateien –, für ein Backup aber nicht: Der Datenordner eines
 * Spielservers kann mehrere Gigabyte groß sein, und ein vollständiges Archiv im
 * Speicher würde den Agent auf einem Homeserver zuverlässig umbringen. Hier
 * fließen die Daten deshalb durchgängig als Strom von der Platte über `gzip` in
 * die Zieldatei und zurück.
 *
 * **Warum keine Bibliothek:** Wie A2 bei seinem TAR-Codec (CLAUDE.md §1 – neue
 * Abhängigkeiten werden begründet, nicht eingebaut, weil es bequem ist). Das
 * geschriebene Format ist USTAR mit der GNU-Erweiterung für lange Namen; das
 * lesen `tar`, `7-Zip` und der Codec von A2 gleichermaßen, ein Archiv bleibt
 * also auch ohne Palantir zu öffnen.
 *
 * **Sicherheit beim Zurückspielen:** Jeder Eintrag wird gegen das
 * Zielverzeichnis geprüft, bevor irgendetwas geschrieben wird – ein Archiv mit
 * `../` darf nicht aus dem Datenordner herauslaufen. Symbolische Verknüpfungen
 * werden nur wiederhergestellt, wenn ihr Ziel ebenfalls im Datenordner liegt;
 * alles andere wird übersprungen und gemeldet, statt einen Pfad nach außen zu
 * legen.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { ContainerRuntimeError } from '../../runtime/index.js';

const BLOCK = 512;
const LEERBLOCK = Buffer.alloc(BLOCK);
/** Lesegröße für Dateiinhalte – klein genug für den Speicher, groß genug fürs Tempo. */
const CHUNK = 64 * 1024;

// ---------------------------------------------------------------------------
// Kopfsätze schreiben
// ---------------------------------------------------------------------------

function schreibeString(block: Buffer, wert: string, start: number, laenge: number): void {
  block.write(wert.slice(0, laenge - 1), start, laenge - 1, 'utf8');
}

function schreibeOktal(block: Buffer, wert: number, start: number, laenge: number): void {
  // USTAR speichert Zahlen als oktalen Text mit abschließendem NUL.
  const text = Math.max(0, Math.trunc(wert))
    .toString(8)
    .padStart(laenge - 1, '0');
  block.write(text.slice(-(laenge - 1)), start, laenge - 1, 'ascii');
}

type TarTyp = '0' | '5' | '2' | 'L';

interface KopfsatzAngaben {
  readonly name: string;
  readonly typ: TarTyp;
  readonly size: number;
  readonly mode: number;
  readonly mtimeSeconds: number;
  readonly linkname?: string;
}

function baueKopfsatz(angaben: KopfsatzAngaben): Buffer {
  const block = Buffer.alloc(BLOCK);

  schreibeString(block, angaben.name, 0, 100);
  schreibeOktal(block, angaben.mode & 0o7777, 100, 8);
  schreibeOktal(block, 0, 108, 8); // uid
  schreibeOktal(block, 0, 116, 8); // gid
  schreibeOktal(block, angaben.size, 124, 12);
  schreibeOktal(block, angaben.mtimeSeconds, 136, 12);
  block.write(angaben.typ, 156, 1, 'ascii');
  if (angaben.linkname !== undefined) {
    schreibeString(block, angaben.linkname, 157, 100);
  }
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');

  // Prüfsumme: Das Feld selbst zählt als Leerzeichen mit.
  block.fill(0x20, 148, 156);
  let summe = 0;
  for (const byte of block) {
    summe += byte;
  }
  block.write(`${summe.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');

  return block;
}

function fuellung(size: number): Buffer {
  const rest = size % BLOCK;
  return rest === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - rest);
}

/**
 * Kopfsatz für einen Namen, der nicht in 100 Zeichen passt.
 *
 * GNU-Erweiterung: ein Eintrag vom Typ `L`, dessen Inhalt der lange Name ist,
 * gefolgt vom eigentlichen Eintrag. Bewusst diese Variante und nicht die
 * USTAR-Aufteilung in `prefix`/`name`: Die scheitert an Namen, deren letzter
 * Bestandteil allein schon zu lang ist, und wäre damit nur fast richtig.
 */
function* langerName(name: string): Generator<Buffer> {
  const inhalt = Buffer.from(`${name}\0`, 'utf8');
  yield baueKopfsatz({
    name: '././@LongLink',
    typ: 'L',
    size: inhalt.length,
    mode: 0o644,
    mtimeSeconds: 0,
  });
  yield inhalt;
  const rest = fuellung(inhalt.length);
  if (rest.length > 0) {
    yield rest;
  }
}

// ---------------------------------------------------------------------------
// Packen
// ---------------------------------------------------------------------------

export interface PackResult {
  /** Größe des fertigen Archivs in Byte. */
  readonly sizeBytes: number;
  /** SHA-256 des Archivs in Kleinbuchstaben – Grundlage der Integritätsprüfung. */
  readonly checksumSha256: string;
  readonly fileCount: number;
}

interface Eintrag {
  /** Pfad relativ zur Archivwurzel, immer mit `/`. */
  readonly relativ: string;
  readonly absolut: string;
  readonly typ: 'file' | 'directory' | 'symlink';
  readonly size: number;
  readonly mode: number;
  readonly mtimeSeconds: number;
  readonly linkname: string | null;
}

async function* sammle(wurzel: string, unterordner: string): AsyncGenerator<Eintrag> {
  const verzeichnis = path.join(wurzel, unterordner);
  const eintraege = await fs.readdir(verzeichnis, { withFileTypes: true });
  // Sortiert, damit dasselbe Verzeichnis immer dasselbe Archiv ergibt – das
  // macht die Prüfsumme reproduzierbar und Tests unabhängig von der Reihenfolge
  // des Dateisystems.
  eintraege.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const eintrag of eintraege) {
    const absolut = path.join(verzeichnis, eintrag.name);
    const relativ = unterordner === '' ? eintrag.name : `${unterordner}/${eintrag.name}`;
    const stat = await fs.lstat(absolut);
    const mtimeSeconds = Math.floor(stat.mtimeMs / 1000);

    if (eintrag.isDirectory()) {
      yield {
        relativ: `${relativ}/`,
        absolut,
        typ: 'directory',
        size: 0,
        mode: stat.mode,
        mtimeSeconds,
        linkname: null,
      };
      yield* sammle(wurzel, relativ);
      continue;
    }

    if (eintrag.isSymbolicLink()) {
      yield {
        relativ,
        absolut,
        typ: 'symlink',
        size: 0,
        mode: stat.mode,
        mtimeSeconds,
        linkname: await fs.readlink(absolut),
      };
      continue;
    }

    if (eintrag.isFile()) {
      yield {
        relativ,
        absolut,
        typ: 'file',
        size: stat.size,
        mode: stat.mode,
        mtimeSeconds,
        linkname: null,
      };
    }
    // Alles andere (Sockets, Gerätedateien) gehört nicht in einen Spielstand
    // und wird stillschweigend ausgelassen.
  }
}

/**
 * Eine Datei, die nicht aus dem Quellverzeichnis kommt, aber mit ins Archiv
 * soll (Arbeitspaket P8: das Export-Manifest).
 */
export interface ZusatzDatei {
  /** Pfad im Archiv, relativ zu dessen Wurzel. */
  readonly relativ: string;
  readonly inhalt: Buffer;
}

/** Kopfsatz plus Inhalt fuer eine Datei, die schon im Speicher liegt. */
function* zusatzBloecke(datei: ZusatzDatei, mtimeSeconds: number): Generator<Buffer> {
  if (Buffer.byteLength(datei.relativ, 'utf8') > 99) {
    yield* langerName(datei.relativ);
  }

  yield baueKopfsatz({
    name: datei.relativ,
    typ: '0',
    size: datei.inhalt.length,
    mode: 0o644,
    mtimeSeconds,
  });
  yield datei.inhalt;

  const rest = fuellung(datei.inhalt.length);
  if (rest.length > 0) {
    yield rest;
  }
}

async function* tarBloecke(
  wurzel: string,
  zaehler: { dateien: number },
  zusatz: readonly ZusatzDatei[],
  mtimeSeconds: number,
): AsyncGenerator<Buffer> {
  // Zuerst die Zusatzdateien: So steht das Manifest am Anfang des Archivs und
  // laesst sich lesen, ohne mehrere Gigabyte Weltdaten zu entpacken.
  for (const datei of zusatz) {
    yield* zusatzBloecke(datei, mtimeSeconds);
    zaehler.dateien += 1;
  }

  for await (const eintrag of sammle(wurzel, '')) {
    const typ: TarTyp = eintrag.typ === 'directory' ? '5' : eintrag.typ === 'symlink' ? '2' : '0';

    if (Buffer.byteLength(eintrag.relativ, 'utf8') > 99) {
      yield* langerName(eintrag.relativ);
    }

    yield baueKopfsatz({
      name: eintrag.relativ,
      typ,
      size: eintrag.typ === 'file' ? eintrag.size : 0,
      mode: eintrag.mode,
      mtimeSeconds: eintrag.mtimeSeconds,
      ...(eintrag.linkname === null ? {} : { linkname: eintrag.linkname }),
    });

    if (eintrag.typ !== 'file') {
      continue;
    }

    zaehler.dateien += 1;

    let gelesen = 0;
    const quelle = createReadStream(eintrag.absolut, { highWaterMark: CHUNK });
    for await (const stueck of quelle) {
      const puffer = Buffer.from(stueck as Uint8Array);
      gelesen += puffer.length;
      yield puffer;
    }

    // Die Größe stand im Kopfsatz; wächst oder schrumpft die Datei während des
    // Sicherns, wäre das Archiv sonst unlesbar. Lieber auffüllen bzw. abbrechen.
    if (gelesen < eintrag.size) {
      yield Buffer.alloc(eintrag.size - gelesen);
    } else if (gelesen > eintrag.size) {
      throw new ContainerRuntimeError('RUNTIME_ERROR', {
        message: `Die Datei ${eintrag.relativ} ist während des Sicherns gewachsen.`,
        details: { path: eintrag.absolut, expected: eintrag.size, actual: gelesen },
      });
    }

    const rest = fuellung(eintrag.size);
    if (rest.length > 0) {
      yield rest;
    }
  }

  // Ein TAR endet mit zwei Leerblöcken.
  yield LEERBLOCK;
  yield LEERBLOCK;
}

/**
 * Packt ein Verzeichnis nach `archivePath` (`.tar.gz`).
 *
 * Die Prüfsumme wird über das **fertige, komprimierte** Archiv gebildet – also
 * über genau die Bytes, die später heruntergeladen und zurückgespielt werden.
 */
export interface PackOptions {
  /**
   * Dateien, die zusaetzlich zum Verzeichnis ins Archiv wandern (P8).
   *
   * Sie stehen am Anfang des Archivs und zaehlen in `fileCount` mit; im
   * Quellverzeichnis bleiben sie unsichtbar.
   */
  readonly extraFiles?: readonly ZusatzDatei[];
  /** Zeitstempel der Zusatzdateien; ohne Angabe der Zeitpunkt des Packens. */
  readonly now?: () => Date;
}

export async function packDirectory(
  sourceDir: string,
  archivePath: string,
  options: PackOptions = {},
): Promise<PackResult> {
  await fs.mkdir(path.dirname(archivePath), { recursive: true });

  const hash = createHash('sha256');
  let sizeBytes = 0;
  const zaehler = { dateien: 0 };
  const zusatz = options.extraFiles ?? [];
  const mtimeSeconds = Math.floor((options.now ?? ((): Date => new Date()))().getTime() / 1000);

  const messen = new Transform({
    transform(stueck: Buffer, _kodierung, weiter) {
      hash.update(stueck);
      sizeBytes += stueck.length;
      weiter(null, stueck);
    },
  });

  try {
    await pipeline(
      Readable.from(tarBloecke(sourceDir, zaehler, zusatz, mtimeSeconds)),
      createGzip(),
      messen,
      createWriteStream(archivePath),
    );
  } catch (ursache) {
    // Ein halbes Archiv ist schlimmer als keins: Es sähe wie ein gültiges
    // Backup aus.
    await fs.rm(archivePath, { force: true });
    throw ursache;
  }

  return { sizeBytes, checksumSha256: hash.digest('hex'), fileCount: zaehler.dateien };
}

/** SHA-256 einer vorhandenen Datei – für die Integritätsprüfung vor dem Zurückspielen. */
export async function checksumOfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const stueck of createReadStream(filePath, { highWaterMark: CHUNK })) {
    hash.update(stueck as Uint8Array);
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Entpacken
// ---------------------------------------------------------------------------

/** Liest aus einem Byte-Strom in genau bemessenen Häppchen. */
class BlockLeser {
  #puffer = Buffer.alloc(0);
  #fertig = false;
  readonly #quelle: AsyncIterator<Buffer>;

  constructor(quelle: AsyncIterator<Buffer>) {
    this.#quelle = quelle;
  }

  /** Genau `n` Byte lesen; `null`, wenn der Strom vorher endet. */
  async read(n: number): Promise<Buffer | null> {
    if (n === 0) {
      return Buffer.alloc(0);
    }

    while (this.#puffer.length < n && !this.#fertig) {
      const { value, done } = await this.#quelle.next();
      if (done === true) {
        this.#fertig = true;
        break;
      }
      this.#puffer = Buffer.concat([this.#puffer, Buffer.from(value)]);
    }

    if (this.#puffer.length < n) {
      return null;
    }

    const ergebnis = this.#puffer.subarray(0, n);
    this.#puffer = this.#puffer.subarray(n);
    return ergebnis;
  }
}

function leseString(block: Buffer, start: number, laenge: number): string {
  const roh = block.subarray(start, start + laenge);
  const ende = roh.indexOf(0);
  return roh.subarray(0, ende === -1 ? roh.length : ende).toString('utf8');
}

function leseOktal(block: Buffer, start: number, laenge: number): number {
  const text = leseString(block, start, laenge).trim();
  if (text.length === 0) {
    return 0;
  }
  const wert = Number.parseInt(text, 8);
  return Number.isNaN(wert) ? 0 : wert;
}

function istLeerblock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

export interface UnpackResult {
  /** Summe der geschriebenen Dateiinhalte in Byte. */
  readonly restoredBytes: number;
  readonly fileCount: number;
  /**
   * Einträge, die bewusst ausgelassen wurden – aktuell ausschließlich
   * symbolische Verknüpfungen, deren Ziel aus dem Zielverzeichnis herausführt.
   */
  readonly skipped: readonly string[];
}

/**
 * Entpackt ein `.tar.gz` nach `targetDir`.
 *
 * Das Zielverzeichnis muss bereits leer bzw. angelegt sein – das Aufräumen
 * davor gehört zum Backup-Job, nicht zum Codec.
 */
export async function unpackArchive(archivePath: string, targetDir: string): Promise<UnpackResult> {
  await fs.mkdir(targetDir, { recursive: true });
  const wurzel = path.resolve(targetDir);

  const quelle = createReadStream(archivePath, { highWaterMark: CHUNK });
  const strom = quelle.pipe(createGunzip());
  const leser = new BlockLeser(strom[Symbol.asyncIterator]() as unknown as AsyncIterator<Buffer>);

  let restoredBytes = 0;
  let fileCount = 0;
  const skipped: string[] = [];
  let langerNameVoraus: string | null = null;

  try {
    for (;;) {
      const kopf = await leser.read(BLOCK);
      if (kopf === null || istLeerblock(kopf)) {
        break;
      }

      const flag = leseString(kopf, 156, 1);
      const size = leseOktal(kopf, 124, 12);

      if (flag === 'L') {
        const inhalt = await leser.read(size);
        if (inhalt === null) {
          throw archivDefekt(archivePath, 'Ein langer Dateiname ist unvollständig.');
        }
        await leser.read(fuellung(size).length);
        langerNameVoraus = inhalt.toString('utf8').replace(/\0+$/, '');
        continue;
      }

      const name = langerNameVoraus ?? leseString(kopf, 0, 100);
      langerNameVoraus = null;

      // PAX-Kopfsätze tragen Metadaten, keine Nutzdaten – überspringen.
      if (flag === 'x' || flag === 'g') {
        await ueberspringe(leser, size);
        continue;
      }

      const ziel = sichererZielpfad(wurzel, name, archivePath);
      const mode = leseOktal(kopf, 100, 8);

      if (flag === '5' || name.endsWith('/')) {
        await fs.mkdir(ziel, { recursive: true });
        continue;
      }

      if (flag === '2') {
        const linkname = leseString(kopf, 157, 100);
        const linkZiel = path.resolve(path.dirname(ziel), linkname);
        const relativ = path.relative(wurzel, linkZiel);

        if (relativ.startsWith('..') || path.isAbsolute(relativ)) {
          // Kein Pfad nach außen – lieber ein fehlender Link als ein Zeiger
          // auf /etc im Datenordner.
          skipped.push(name);
          continue;
        }

        await fs.mkdir(path.dirname(ziel), { recursive: true });
        await fs.rm(ziel, { force: true });
        await fs.symlink(linkname, ziel);
        continue;
      }

      await fs.mkdir(path.dirname(ziel), { recursive: true });
      const datei = await fs.open(ziel, 'w', mode === 0 ? 0o644 : mode & 0o7777);
      try {
        let offen = size;
        while (offen > 0) {
          const stueck = await leser.read(Math.min(offen, CHUNK));
          if (stueck === null) {
            throw archivDefekt(archivePath, `Der Inhalt von ${name} ist unvollständig.`);
          }
          await datei.write(stueck);
          offen -= stueck.length;
        }
      } finally {
        await datei.close();
      }

      restoredBytes += size;
      fileCount += 1;
      await leser.read(fuellung(size).length);
    }
  } finally {
    quelle.destroy();
  }

  return { restoredBytes, fileCount, skipped };
}

/** Überspringt den Nutzdatenteil eines Eintrags samt Blockfüllung. */
async function ueberspringe(leser: BlockLeser, size: number): Promise<void> {
  let offen = size + fuellung(size).length;
  while (offen > 0) {
    const stueck = await leser.read(Math.min(offen, CHUNK));
    if (stueck === null) {
      return;
    }
    offen -= stueck.length;
  }
}

function sichererZielpfad(wurzel: string, name: string, archivePath: string): string {
  const bereinigt = name.replace(/\/+$/, '');
  if (bereinigt === '' || bereinigt.includes('\0')) {
    throw archivDefekt(archivePath, 'Das Archiv enthält einen leeren Eintragsnamen.');
  }

  const ziel = path.resolve(wurzel, bereinigt);
  const relativ = path.relative(wurzel, ziel);

  if (relativ.startsWith('..') || path.isAbsolute(relativ)) {
    throw new ContainerRuntimeError('INVALID_PATH', {
      message: `Das Archiv enthält einen Eintrag außerhalb des Zielverzeichnisses (${name}).`,
      details: { archivePath, entry: name },
    });
  }

  return ziel;
}

function archivDefekt(archivePath: string, grund: string): ContainerRuntimeError {
  return new ContainerRuntimeError('RUNTIME_ERROR', {
    message: `Das Backup-Archiv ist beschädigt: ${grund}`,
    details: { archivePath },
  });
}
