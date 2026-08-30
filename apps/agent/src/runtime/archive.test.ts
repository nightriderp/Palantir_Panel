/**
 * Lesen hochgeladener Archive (Arbeitspaket P4).
 *
 * Geprueft wird das, worauf beim Entpacken fremder Archive alles ankommt:
 * beide Formate, die Formaterkennung an den Bytes - und vor allem die drei
 * Grenzen aus dem Kopfkommentar von `archive.ts` (Pfad-Ausbruch, Sonderdateien,
 * Entpack-Bombe).
 */

import { deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAX_ARCHIVE_ENTRIES, detectArchiveKind, readArchive, safeArchivePath } from './archive.js';
import { createTar } from './docker/tar.js';

function tarGz(dateien: { name: string; content: string; type?: 'file' | 'directory' }[]): Buffer {
  return gzipSync(
    createTar(
      dateien.map((datei) => ({
        name: datei.name,
        content: Buffer.from(datei.content),
        ...(datei.type === undefined ? {} : { type: datei.type }),
      })),
    ),
  );
}

/** Minimales ZIP mit Zentralverzeichnis - genau so, wie `readArchive` es liest. */
function zip(
  dateien: { name: string; content: Buffer; deflate?: boolean }[],
  options: { kommentar?: Buffer } = {},
): Buffer {
  const lokal: Buffer[] = [];
  const zentral: Buffer[] = [];
  let offset = 0;

  for (const datei of dateien) {
    const name = Buffer.from(datei.name, 'utf8');
    const verfahren = datei.deflate === true ? 8 : 0;
    const daten = datei.deflate === true ? deflateRawSync(datei.content) : datei.content;

    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x0403_4b50, 0);
    kopf.writeUInt16LE(20, 4);
    kopf.writeUInt16LE(verfahren, 8);
    kopf.writeUInt32LE(0, 14);
    kopf.writeUInt32LE(daten.length, 18);
    kopf.writeUInt32LE(datei.content.length, 22);
    kopf.writeUInt16LE(name.length, 26);
    kopf.writeUInt16LE(0, 28);

    lokal.push(kopf, name, daten);

    const eintrag = Buffer.alloc(46);
    eintrag.writeUInt32LE(0x0201_4b50, 0);
    eintrag.writeUInt16LE(20, 4);
    eintrag.writeUInt16LE(20, 6);
    eintrag.writeUInt16LE(verfahren, 10);
    eintrag.writeUInt32LE(0, 16);
    eintrag.writeUInt32LE(daten.length, 20);
    eintrag.writeUInt32LE(datei.content.length, 24);
    eintrag.writeUInt16LE(name.length, 28);
    eintrag.writeUInt32LE(offset, 42);

    zentral.push(eintrag, name);
    offset += kopf.length + name.length + daten.length;
  }

  const lokalTeil = Buffer.concat(lokal);
  const zentralTeil = Buffer.concat(zentral);
  const kommentar = options.kommentar ?? Buffer.alloc(0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x0605_4b50, 0);
  eocd.writeUInt16LE(dateien.length, 8);
  eocd.writeUInt16LE(dateien.length, 10);
  eocd.writeUInt32LE(zentralTeil.length, 12);
  eocd.writeUInt32LE(lokalTeil.length, 16);
  eocd.writeUInt16LE(kommentar.length, 20);

  return Buffer.concat([lokalTeil, zentralTeil, eocd, kommentar]);
}

describe('Formaterkennung', () => {
  it('erkennt ZIP und tar.gz an den ersten Bytes', () => {
    expect(detectArchiveKind(zip([{ name: 'a.txt', content: Buffer.from('a') }]))).toBe('zip');
    expect(detectArchiveKind(tarGz([{ name: 'a.txt', content: 'a' }]))).toBe('tar.gz');
  });

  it('erkennt nichts anderes', () => {
    expect(detectArchiveKind(Buffer.from('MZ\u0090\u0000'))).toBeNull();
    expect(detectArchiveKind(Buffer.alloc(0))).toBeNull();
  });
});

describe('Pfad-Pruefung', () => {
  it.each([
    ['welt/level.dat', 'welt/level.dat'],
    ['./welt//region/r.0.0.mca', 'welt/region/r.0.0.mca'],
    ['welt\\region\\r.0.0.mca', 'welt/region/r.0.0.mca'],
  ])('nimmt %s an', (roh, erwartet) => {
    expect(safeArchivePath(roh)).toBe(erwartet);
  });

  it.each(['/etc/passwd', '../../etc/passwd', 'welt/../../weg', 'C:/Windows/system.ini', '', '.'])(
    'weist %s ab',
    (roh) => {
      expect(safeArchivePath(roh)).toBeNull();
    },
  );
});

describe('tar.gz lesen', () => {
  it('liefert Dateien und Verzeichnisse', () => {
    const inhalt = readArchive(
      tarGz([
        { name: 'welt', content: '', type: 'directory' },
        { name: 'welt/level.dat', content: 'spielstand' },
      ]),
    );

    expect(inhalt.entries.map((eintrag) => eintrag.path)).toEqual(['welt', 'welt/level.dat']);
    expect(inhalt.entries[1]?.content.toString()).toBe('spielstand');
    expect(inhalt.totalBytes).toBe('spielstand'.length);
  });

  it('ueberspringt Eintraege, die aus dem Zielordner ausbrechen', () => {
    const inhalt = readArchive(
      tarGz([
        { name: '../boese.sh', content: 'rm -rf /' },
        { name: 'welt/level.dat', content: 'ok' },
      ]),
    );

    expect(inhalt.entries.map((eintrag) => eintrag.path)).toEqual(['welt/level.dat']);
    expect(inhalt.skipped).toEqual(['../boese.sh']);
  });

  it('lehnt ein kaputtes gzip ab', () => {
    expect(() => readArchive(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]))).toThrowError(
      /entpacken/,
    );
  });
});

describe('ZIP lesen', () => {
  it('liest gespeicherte und deflate-komprimierte Eintraege', () => {
    const inhalt = readArchive(
      zip([
        { name: 'welt/level.dat', content: Buffer.from('spielstand') },
        { name: 'welt/region/r.0.0.mca', content: Buffer.alloc(4096, 7), deflate: true },
      ]),
    );

    expect(inhalt.entries).toHaveLength(2);
    expect(inhalt.entries[0]?.content.toString()).toBe('spielstand');
    expect(inhalt.entries[1]?.content).toEqual(Buffer.alloc(4096, 7));
  });

  it('erkennt Verzeichniseintraege am abschliessenden Schraegstrich', () => {
    const inhalt = readArchive(zip([{ name: 'welt/', content: Buffer.alloc(0) }]));

    expect(inhalt.entries[0]).toMatchObject({ path: 'welt', type: 'directory' });
  });

  it('findet das Zentralverzeichnis auch hinter einem Kommentar', () => {
    const inhalt = readArchive(
      zip([{ name: 'a.txt', content: Buffer.from('a') }], {
        kommentar: Buffer.from('von einem anderen Hoster gepackt'),
      }),
    );

    expect(inhalt.entries).toHaveLength(1);
  });

  it('ueberspringt Eintraege, die aus dem Zielordner ausbrechen', () => {
    const inhalt = readArchive(
      zip([
        { name: '../../etc/passwd', content: Buffer.from('root') },
        { name: 'welt/level.dat', content: Buffer.from('ok') },
      ]),
    );

    expect(inhalt.entries.map((eintrag) => eintrag.path)).toEqual(['welt/level.dat']);
    expect(inhalt.skipped).toEqual(['../../etc/passwd']);
  });

  it('ueberspringt ein unbekanntes Kompressionsverfahren, statt abzubrechen', () => {
    const archiv = zip([
      { name: 'a.txt', content: Buffer.from('a') },
      { name: 'b.txt', content: Buffer.from('b') },
    ]);

    // Verfahren des ersten Zentralverzeichnis-Eintrags auf bzip2 (12) biegen.
    const zentralStart = archiv.readUInt32LE(archiv.length - 6);
    archiv.writeUInt16LE(12, zentralStart + 10);

    const inhalt = readArchive(archiv);

    expect(inhalt.skipped).toEqual(['a.txt']);
    expect(inhalt.entries.map((eintrag) => eintrag.path)).toEqual(['b.txt']);
  });

  it('lehnt ein Archiv ohne Zentralverzeichnis ab', () => {
    expect(() => readArchive(Buffer.from('PK\u0003\u0004und sonst nichts'))).toThrowError(
      /Zentralverzeichnis|unvollstaendig/,
    );
  });

  it('lehnt ein Archiv mit zu vielen Eintraegen ab', () => {
    const archiv = zip([{ name: 'a.txt', content: Buffer.from('a') }]);
    // Anzahl im EOCD hochsetzen: Der Leser laeuft dann ins beschaedigte
    // Zentralverzeichnis - genau der Fall, der nicht endlos laufen darf.
    archiv.writeUInt16LE(MAX_ARCHIVE_ENTRIES > 0xffff ? 0xfffe : 0x00ff, archiv.length - 12);

    expect(() => readArchive(archiv)).toThrowError(/Zentralverzeichnis/);
  });
});

describe('Entpack-Bombe', () => {
  it('lehnt ein Archiv ab, dessen entpackter Inhalt die Grenze sprengt', () => {
    const archiv = zip([{ name: 'gross.bin', content: Buffer.alloc(1024), deflate: true }]);
    // Die gemeldete entpackte Groesse im Zentralverzeichnis aufblaehen - genau
    // die Angabe, mit der eine Bombe sich ankuendigt.
    const zentralStart = archiv.readUInt32LE(archiv.length - 6);
    archiv.writeUInt32LE(0xffff_fff0, zentralStart + 24);

    expect(() => readArchive(archiv)).toThrowError(/zu gross/);
  });
});
