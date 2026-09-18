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
import { ContainerRuntimeError } from './errors.js';

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

/**
 * Ein roher TAR-Eintrag mit frei waehlbarem Typ-Flag – fuer alles, was
 * `createTar` absichtlich nicht erzeugt (Symlinks, Hardlinks, Geraetedateien,
 * PAX-Kopfsaetze). Kopfsatz nach USTAR mit gueltiger Pruefsumme.
 */
function rohEintrag(
  name: string,
  flag: string,
  inhalt: Buffer = Buffer.alloc(0),
  linkname = '',
): Buffer {
  const kopf = Buffer.alloc(512);
  kopf.write(name, 0, 100, 'utf8');
  kopf.write('0000644\0', 100, 8, 'ascii');
  kopf.write('0000000\0', 108, 8, 'ascii');
  kopf.write('0000000\0', 116, 8, 'ascii');
  kopf.write(`${inhalt.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  kopf.write('00000000000\0', 136, 12, 'ascii');
  kopf.write(flag, 156, 1, 'ascii');
  kopf.write(linkname, 157, 100, 'utf8');
  kopf.write('ustar\0', 257, 6, 'ascii');
  kopf.write('00', 263, 2, 'ascii');
  kopf.fill(0x20, 148, 156);
  let summe = 0;
  for (const byte of kopf) summe += byte;
  kopf.write(`${summe.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');

  const fuellung = Buffer.alloc((512 - (inhalt.length % 512)) % 512);
  return Buffer.concat([kopf, inhalt, fuellung]);
}

/** Ein tar.gz aus rohen Eintraegen, abgeschlossen mit zwei Nullbloecken. */
function rohesTarGz(...eintraege: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...eintraege, Buffer.alloc(1024)]));
}

/** Ein PAX-Datensatz `laenge schluessel=wert\n` – die Laenge zaehlt sich selbst mit. */
function paxDatensatz(schluessel: string, wert: string): Buffer {
  const rumpf = ` ${schluessel}=${wert}\n`;
  let laenge = rumpf.length + 1;
  while (String(laenge).length + rumpf.length !== laenge) laenge += 1;
  return Buffer.from(`${laenge}${rumpf}`, 'utf8');
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

  it('weist einen Namen mit NUL ab (Befund 7.4)', () => {
    // Aus einem PAX-Datensatz kann ein NUL mitten im Pfad kommen; ein
    // Dateisystem schneidet dort ab – und aus `welt/x\0/../..` wuerde `welt/x`.
    expect(safeArchivePath('welt/level.dat\0.txt')).toBeNull();
  });

  it('weist einen Windows-Ausbruch mit Rueckwaertsschraegstrichen ab', () => {
    expect(safeArchivePath('..\\..\\Windows\\win.ini')).toBeNull();
    expect(safeArchivePath('welt\\..\\..\\weg')).toBeNull();
  });
});

describe('tar.gz lesen – Sonderdateien und Kopfsatz-Erweiterungen (Befund 7.4)', () => {
  it('ueberspringt einen Symlink und meldet ihn', () => {
    const inhalt = readArchive(
      rohesTarGz(
        rohEintrag('welt/level.dat', '0', Buffer.from('ok')),
        rohEintrag('welt/passwd', '2', Buffer.alloc(0), '/etc/passwd'),
      ),
    );

    expect(inhalt.entries.map((eintrag) => eintrag.path)).toEqual(['welt/level.dat']);
    expect(inhalt.skipped).toEqual(['welt/passwd']);
  });

  it.each([
    ['Hardlink', '1'],
    ['Zeichengeraet', '3'],
    ['Blockgeraet', '4'],
    ['FIFO', '6'],
  ])('ueberspringt %s statt eine leere Datei anzulegen', (_bezeichnung, flag) => {
    const inhalt = readArchive(
      rohesTarGz(rohEintrag('welt/sonder', flag, Buffer.alloc(0), 'welt/level.dat')),
    );

    expect(inhalt.entries).toEqual([]);
    expect(inhalt.skipped).toEqual(['welt/sonder']);
  });

  it('nimmt eine zusammenhaengende Datei (Flag 7) als Datei', () => {
    const inhalt = readArchive(rohesTarGz(rohEintrag('welt/alt.dat', '7', Buffer.from('alt'))));

    expect(inhalt.entries.map((eintrag) => eintrag.path)).toEqual(['welt/alt.dat']);
  });

  it('prueft den Pfad aus einem PAX-Kopfsatz genauso wie den aus dem Kopf', () => {
    const pax = paxDatensatz('path', '../../etc/cron.d/boese');
    const inhalt = readArchive(
      rohesTarGz(
        rohEintrag('./PaxHeader/harmlos', 'x', pax),
        rohEintrag('harmlos', '0', Buffer.from('boese')),
        rohEintrag('welt/level.dat', '0', Buffer.from('ok')),
      ),
    );

    expect(inhalt.entries.map((eintrag) => eintrag.path)).toEqual(['welt/level.dat']);
    expect(inhalt.skipped).toEqual(['../../etc/cron.d/boese']);
  });

  it('prueft den Pfad aus einem GNU-Langnamen genauso', () => {
    const langerName = `${'a'.repeat(60)}/../../${'b'.repeat(60)}\0`;
    const inhalt = readArchive(
      rohesTarGz(
        rohEintrag('././@LongLink', 'L', Buffer.from(langerName)),
        rohEintrag('kurz', '0', Buffer.from('boese')),
      ),
    );

    expect(inhalt.entries).toEqual([]);
    expect(inhalt.skipped).toHaveLength(1);
  });

  it('ueberspringt einen PAX-Pfad mit NUL statt ihn abzuschneiden', () => {
    const pax = paxDatensatz('path', 'welt/level.dat\0/../../weg');
    const inhalt = readArchive(
      rohesTarGz(rohEintrag('./PaxHeader/x', 'x', pax), rohEintrag('x', '0', Buffer.from('?'))),
    );

    expect(inhalt.entries).toEqual([]);
    expect(inhalt.skipped).toHaveLength(1);
  });
});

describe('ZIP lesen – Windows-Pfade (Befund 7.4)', () => {
  it('ueberspringt einen Ausbruch mit Rueckwaertsschraegstrichen', () => {
    const inhalt = readArchive(
      zip([
        { name: '..\\..\\Windows\\win.ini', content: Buffer.from('boese') },
        { name: 'welt\\level.dat', content: Buffer.from('ok') },
      ]),
    );

    expect(inhalt.entries.map((eintrag) => eintrag.path)).toEqual(['welt/level.dat']);
    expect(inhalt.skipped).toEqual(['..\\..\\Windows\\win.ini']);
  });
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

  // Die Grenze wird auf 1 MiB gesetzt, damit die Bombe mit wenigen Megabyte
  // nachstellbar ist - der Mechanismus ist derselbe wie bei 512 MiB.
  const GRENZE = 1024 * 1024;

  /** Muster aus `hardening.test.ts`: Code UND Meldung des geworfenen Fehlers pruefen. */
  function erwarteZuGross(lesen: () => unknown): void {
    try {
      lesen();
      throw new Error('Es wurde ein Fehler erwartet.');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ContainerRuntimeError);
      expect((fehler as ContainerRuntimeError).code).toBe('ARCHIVE_INVALID');
      expect((fehler as ContainerRuntimeError).message).toMatch(/zu gross/);
    }
  }

  it('lehnt eine gzip-Bombe ab, bevor sie sich entfaltet (Fundpunkt 122)', () => {
    // 4 MiB Nullen schrumpfen auf wenige KiB gzip. Ohne Deckel an `gunzip`
    // wuerde der Sammler die Grenze erst NACH dem vollstaendigen Entpacken sehen.
    const bombe = gzipSync(
      createTar([{ name: 'welt/level.dat', content: Buffer.alloc(4 * 1024 * 1024) }]),
    );

    expect(bombe.length).toBeLessThan(16 * 1024);
    erwarteZuGross(() => readArchive(bombe, 'tar.gz', { maxExtractedBytes: GRENZE }));
  });

  it('entpackt ein tar.gz knapp unter der Grenze weiterhin', () => {
    // Nutzdaten + tar-Kopfsatz (512 B) + zwei Nullbloecke (1024 B) bleiben
    // zusammen unter der Grenze - der Deckel darf hier nicht zuschlagen.
    const nutzdaten = Buffer.alloc(GRENZE - 4096, 7);
    const archiv = gzipSync(createTar([{ name: 'welt/level.dat', content: nutzdaten }]));

    const inhalt = readArchive(archiv, 'tar.gz', { maxExtractedBytes: GRENZE });

    // `Buffer.equals` statt `toEqual`: Letzteres vergleicht 1 MiB elementweise.
    expect(inhalt.entries[0]?.content.equals(nutzdaten)).toBe(true);
    expect(inhalt.totalBytes).toBe(nutzdaten.length);
  });

  it('lehnt einen ZIP-Eintrag ab, der sich groesser entfaltet als angekuendigt', () => {
    const archiv = zip([
      { name: 'gross.bin', content: Buffer.alloc(4 * 1024 * 1024), deflate: true },
    ]);
    // Die angekuendigte Groesse im Zentralverzeichnis kleinreden: Die
    // Vorpruefung laesst den Eintrag durch, erst der Deckel an `inflateRaw`
    // stoppt ihn - und auch der muss "zu gross" melden, nicht "beschaedigt".
    const zentralStart = archiv.readUInt32LE(archiv.length - 6);
    archiv.writeUInt32LE(1024, zentralStart + 24);

    erwarteZuGross(() => readArchive(archiv, 'zip', { maxExtractedBytes: GRENZE }));
  });
});
