import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checksumOfFile, packDirectory, unpackArchive } from './tar-gz.js';

let wurzel: string;
let quelle: string;
let ziel: string;
let archiv: string;

beforeEach(async () => {
  wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-tar-'));
  quelle = path.join(wurzel, 'quelle');
  ziel = path.join(wurzel, 'ziel');
  archiv = path.join(wurzel, 'archiv', 'backup.tar.gz');
  await fs.mkdir(quelle, { recursive: true });
});

afterEach(async () => {
  await fs.rm(wurzel, { recursive: true, force: true });
});

async function schreibe(relativ: string, inhalt: string | Buffer): Promise<void> {
  const pfad = path.join(quelle, relativ);
  await fs.mkdir(path.dirname(pfad), { recursive: true });
  await fs.writeFile(pfad, inhalt);
}

async function lies(relativ: string): Promise<string> {
  return fs.readFile(path.join(ziel, relativ), 'utf8');
}

describe('packDirectory() / unpackArchive()', () => {
  it('spielt einen Verzeichnisbaum unverändert zurück', async () => {
    await schreibe('server.properties', 'max-players=20\n');
    await schreibe('welt/region/r.0.0.mca', 'Blöcke');
    await schreibe('welt/level.dat', Buffer.from([0x00, 0x01, 0x02, 0xff]));

    const gepackt = await packDirectory(quelle, archiv);
    expect(gepackt.fileCount).toBe(3);
    expect(gepackt.sizeBytes).toBeGreaterThan(0);

    const entpackt = await unpackArchive(archiv, ziel);
    expect(entpackt.fileCount).toBe(3);

    await expect(lies('server.properties')).resolves.toBe('max-players=20\n');
    await expect(lies('welt/region/r.0.0.mca')).resolves.toBe('Blöcke');
    await expect(fs.readFile(path.join(ziel, 'welt/level.dat'))).resolves.toEqual(
      Buffer.from([0x00, 0x01, 0x02, 0xff]),
    );
  });

  it('packt auf einer niedrigeren Stufe und bleibt entpackbar', async () => {
    // Der Ordner-Download waehlt Stufe 1, weil Wartezeit dort teurer ist als
    // Plattenplatz (Leistungsbericht 19.09.2026). Das Archiv muss dabei
    // dasselbe bleiben - nur eben schneller gepackt.
    await schreibe('welt/level.dat', 'x'.repeat(5000));

    const gepackt = await packDirectory(quelle, archiv, { level: 1 });
    expect(gepackt.fileCount).toBe(1);

    const entpackt = await unpackArchive(archiv, ziel);
    expect(entpackt.fileCount).toBe(1);
    await expect(lies('welt/level.dat')).resolves.toBe('x'.repeat(5000));
  });

  it('meldet eine SHA-256 des fertigen Archivs', async () => {
    await schreibe('a.txt', 'Inhalt');
    const gepackt = await packDirectory(quelle, archiv);

    expect(gepackt.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(checksumOfFile(archiv)).resolves.toBe(gepackt.checksumSha256);
  });

  it('erzeugt für denselben Stand dasselbe Archiv', async () => {
    // Reproduzierbar, weil die Einträge sortiert geschrieben werden – sonst
    // hinge die Prüfsumme an der Reihenfolge des Dateisystems.
    await schreibe('b.txt', 'zwei');
    await schreibe('a.txt', 'eins');

    const erst = await packDirectory(quelle, archiv);
    const zweit = await packDirectory(quelle, path.join(wurzel, 'archiv', 'zweit.tar.gz'));

    expect(zweit.checksumSha256).toBe(erst.checksumSha256);
  });

  it('behält leere Verzeichnisse', async () => {
    await fs.mkdir(path.join(quelle, 'leer'), { recursive: true });
    await packDirectory(quelle, archiv);
    await unpackArchive(archiv, ziel);

    await expect(fs.stat(path.join(ziel, 'leer'))).resolves.toMatchObject({});
  });

  it('kommt mit einer leeren Quelle zurecht', async () => {
    const gepackt = await packDirectory(quelle, archiv);
    expect(gepackt.fileCount).toBe(0);

    const entpackt = await unpackArchive(archiv, ziel);
    expect(entpackt).toMatchObject({ fileCount: 0, restoredBytes: 0 });
  });

  it('überträgt Dateien über mehrere Blöcke hinweg vollständig', async () => {
    // 200 KiB: mehr als die Leseblockgröße von 64 KiB und kein Vielfaches von
    // 512 – prüft Blockfüllung und mehrfaches Nachlesen zugleich.
    const gross = Buffer.alloc(200 * 1024 + 137, 0x41);
    await schreibe('welt/gross.bin', gross);

    await packDirectory(quelle, archiv);
    const entpackt = await unpackArchive(archiv, ziel);

    expect(entpackt.restoredBytes).toBe(gross.length);
    await expect(fs.readFile(path.join(ziel, 'welt/gross.bin'))).resolves.toEqual(gross);
  });

  it('überträgt sehr lange Pfade über die GNU-Erweiterung', async () => {
    const tief = `${'verzeichnis/'.repeat(12)}datei-mit-langem-namen.txt`;
    expect(tief.length).toBeGreaterThan(100);
    await schreibe(tief, 'tief');

    await packDirectory(quelle, archiv);
    await unpackArchive(archiv, ziel);

    await expect(lies(tief)).resolves.toBe('tief');
  });

  it('lässt beim Fehlschlag kein halbes Archiv zurück', async () => {
    await schreibe('a.txt', 'Inhalt');
    // Ein Verzeichnis als Archivpfad lässt den Schreibstrom scheitern.
    await fs.mkdir(path.join(wurzel, 'blockiert'), { recursive: true });

    await expect(packDirectory(quelle, path.join(wurzel, 'blockiert'))).rejects.toThrow();
    await expect(fs.stat(path.join(wurzel, 'blockiert'))).resolves.toMatchObject({});
  });

  it('meldet ein beschädigtes Archiv als solches', async () => {
    await schreibe('a.txt', 'Inhalt');
    await packDirectory(quelle, archiv);
    // Halbieren: Der Gzip-Strom endet dann mitten im Inhalt.
    const roh = await fs.readFile(archiv);
    await fs.writeFile(archiv, roh.subarray(0, Math.floor(roh.length / 2)));

    await expect(unpackArchive(archiv, ziel)).rejects.toThrow();
  });
});

describe('unpackArchive() – Schutz vor Pfaden nach außen', () => {
  /** Baut ein TAR mit einem einzelnen, frei wählbaren Eintrag (Name, Typ, Rechte, Linkziel). */
  async function archivMitEintrag(
    name: string,
    inhalt: string,
    optionen: { flag?: string; mode?: string; linkname?: string } = {},
  ): Promise<string> {
    const zlib = await import('node:zlib');
    const block = Buffer.alloc(512);
    block.write(name, 0, 100, 'utf8');
    block.write(`${optionen.mode ?? '0000644'}\0`, 100, 8, 'ascii');
    block.write('0000000\0', 108, 8, 'ascii');
    block.write('0000000\0', 116, 8, 'ascii');
    block.write(`${inhalt.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    block.write('00000000000\0', 136, 12, 'ascii');
    block.write(optionen.flag ?? '0', 156, 1, 'ascii');
    block.write(optionen.linkname ?? '', 157, 100, 'utf8');
    block.write('ustar\0', 257, 6, 'ascii');
    block.write('00', 263, 2, 'ascii');
    block.fill(0x20, 148, 156);
    let summe = 0;
    for (const byte of block) {
      summe += byte;
    }
    block.write(`${summe.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');

    const daten = Buffer.alloc(512);
    daten.write(inhalt, 0, 'utf8');
    const tar = Buffer.concat([block, daten, Buffer.alloc(1024)]);

    const pfad = path.join(wurzel, 'boese.tar.gz');
    await fs.writeFile(pfad, zlib.gzipSync(tar));
    return pfad;
  }

  it('lehnt einen Eintrag mit ../ ab, statt daneben zu schreiben', async () => {
    const boese = await archivMitEintrag('../ausbruch.txt', 'nein');

    await expect(unpackArchive(boese, ziel)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(fs.stat(path.join(wurzel, 'ausbruch.txt'))).rejects.toThrow();
  });

  it('lehnt einen absoluten Eintragspfad ab', async () => {
    const boese = await archivMitEintrag('/etc/passwort', 'nein');
    await expect(unpackArchive(boese, ziel)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('lässt einen Symlink mit absolutem Ziel aus und meldet ihn (Befund 7.4)', async () => {
    const boese = await archivMitEintrag('passwd', '', { flag: '2', linkname: '/etc/passwd' });

    const ergebnis = await unpackArchive(boese, ziel);

    expect(ergebnis.skipped).toEqual(['passwd']);
    await expect(fs.lstat(path.join(ziel, 'passwd'))).rejects.toThrow();
  });

  it('lässt einen Symlink aus, dessen relatives Ziel aus dem Zielordner führt', async () => {
    const boese = await archivMitEintrag('welt/link', '', {
      flag: '2',
      linkname: '../../../etc/passwd',
    });

    const ergebnis = await unpackArchive(boese, ziel);

    expect(ergebnis.skipped).toEqual(['welt/link']);
    await expect(fs.lstat(path.join(ziel, 'welt', 'link'))).rejects.toThrow();
  });

  it('streicht setuid/setgid beim Zurückspielen (Befund 7.4)', async () => {
    // 4755: setuid + rwxr-xr-x. Nach dem Zurückspielen darf nur 755 übrig sein.
    const archivPfad = await archivMitEintrag('start.sh', 'echo hallo', { mode: '0004755' });

    await unpackArchive(archivPfad, ziel);

    const angaben = await fs.stat(path.join(ziel, 'start.sh'));
    // Unter Windows kennt das Dateisystem diese Bits nicht; dort ist 0 ohnehin
    // die Antwort. Unter Linux (CI) ist es die Zusicherung.
    expect(angaben.mode & 0o7000).toBe(0);
  });
});

describe('Zusatzdateien im Archiv (Arbeitspaket P8)', () => {
  it('packt sie neben den Verzeichnisbaum', async () => {
    await schreibe('welt/level.dat', 'Spielstand');

    const gepackt = await packDirectory(quelle, archiv, {
      extraFiles: [
        { relativ: 'palantir-server.json', inhalt: Buffer.from('{"formatVersion":1}', 'utf8') },
      ],
    });

    // Die Zusatzdatei zaehlt mit: Sie liegt im Archiv wie jede andere Datei.
    expect(gepackt.fileCount).toBe(2);

    await unpackArchive(archiv, ziel);

    await expect(lies('palantir-server.json')).resolves.toBe('{"formatVersion":1}');
    await expect(lies('welt/level.dat')).resolves.toBe('Spielstand');
  });

  it('laesst das Quellverzeichnis unberuehrt', async () => {
    await schreibe('welt/level.dat', 'Spielstand');

    await packDirectory(quelle, archiv, {
      extraFiles: [{ relativ: 'palantir-server.json', inhalt: Buffer.from('{}', 'utf8') }],
    });

    await expect(fs.readdir(quelle)).resolves.toEqual(['welt']);
  });

  it('kommt mit einem langen Pfad zurecht', async () => {
    const name = `${'x'.repeat(60)}/${'y'.repeat(60)}.json`;

    await packDirectory(quelle, archiv, {
      extraFiles: [{ relativ: name, inhalt: Buffer.from('lang', 'utf8') }],
    });
    await unpackArchive(archiv, ziel);

    await expect(lies(name)).resolves.toBe('lang');
  });

  it('packt ohne Angabe wie bisher', async () => {
    await schreibe('a.txt', 'eins');

    const mitLeerListe = await packDirectory(quelle, archiv, { extraFiles: [] });
    const ohne = await packDirectory(quelle, path.join(wurzel, 'archiv', 'ohne.tar.gz'));

    expect(mitLeerListe.checksumSha256).toBe(ohne.checksumSha256);
  });
});
