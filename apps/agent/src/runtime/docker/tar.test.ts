import { describe, expect, it } from 'vitest';
import { createTar, parseTar } from './tar.js';

describe('TAR-Codec fuer den Datei-Manager', () => {
  it('schreibt und liest eine Datei verlustfrei', () => {
    const inhalt = Buffer.from('level-name=welt\nmax-players=20\n', 'utf8');
    const archiv = createTar([{ name: 'server.properties', content: inhalt, mode: 0o640 }]);

    const eintraege = parseTar(archiv);
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.name).toBe('server.properties');
    expect(eintraege[0]?.type).toBe('file');
    expect(eintraege[0]?.size).toBe(inhalt.length);
    expect(eintraege[0]?.mode).toBe('640');
    expect(eintraege[0]?.content.toString('utf8')).toBe(inhalt.toString('utf8'));
  });

  it('behandelt Binaerinhalte und Blockgrenzen korrekt', () => {
    // Genau eine Blockgroesse: hier wuerde eine falsche Fuellrechnung auffallen.
    const inhalt = Buffer.alloc(512, 0xab);
    const eintraege = parseTar(createTar([{ name: 'welt.dat', content: inhalt }]));
    expect(eintraege[0]?.content.equals(inhalt)).toBe(true);
  });

  it('schreibt mehrere Dateien hintereinander', () => {
    const archiv = createTar([
      { name: 'a.txt', content: Buffer.from('a') },
      { name: 'b.txt', content: Buffer.from('bb') },
    ]);
    expect(parseTar(archiv).map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('lehnt zu lange Dateinamen ab, statt sie stillschweigend zu kuerzen', () => {
    expect(() => createTar([{ name: 'x'.repeat(101), content: Buffer.alloc(0) }])).toThrow(
      /zu lang/,
    );
  });

  it('erkennt Verzeichniseintraege', () => {
    const archiv = tarMitEintrag('daten/', 0, '5');
    const eintraege = parseTar(archiv);
    expect(eintraege[0]?.type).toBe('directory');
    expect(eintraege[0]?.name).toBe('daten/');
  });

  it('wertet PAX-Kopfsaetze fuer lange Namen aus', () => {
    const langerName = `daten/${'unterordner/'.repeat(12)}datei.txt`;
    const paxDatensatz = paxRecord('path', langerName);
    const archiv = Buffer.concat([
      tarMitEintrag('PaxHeader', paxDatensatz.length, 'x', paxDatensatz),
      tarMitEintrag('kurz.txt', 3, '0', Buffer.from('abc')),
      Buffer.alloc(1024),
    ]);

    const eintraege = parseTar(archiv);
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.name).toBe(langerName);
    expect(eintraege[0]?.content.toString('utf8')).toBe('abc');
  });

  it('setzt Praefix und Namen wieder zusammen', () => {
    const archiv = tarMitEintrag('datei.txt', 0, '0', Buffer.alloc(0), 'sehr/tiefer/pfad');
    expect(parseTar(archiv)[0]?.name).toBe('sehr/tiefer/pfad/datei.txt');
  });

  it('liefert bei einem leeren Archiv keine Eintraege', () => {
    expect(parseTar(Buffer.alloc(1024))).toEqual([]);
  });
});

function paxRecord(schluessel: string, wert: string): Buffer {
  // Format: "<laenge> <schluessel>=<wert>\n", wobei die Laenge sich selbst einschliesst.
  const ohneLaenge = ` ${schluessel}=${wert}\n`.length;
  let laenge = ohneLaenge + 1;
  while (String(laenge).length + ohneLaenge !== laenge) {
    laenge = String(laenge).length + ohneLaenge;
  }
  return Buffer.from(`${laenge} ${schluessel}=${wert}\n`, 'utf8');
}

/** Baut einen einzelnen TAR-Block von Hand - fuer Faelle, die createTar nicht erzeugt. */
function tarMitEintrag(
  name: string,
  groesse: number,
  typFlag: string,
  inhalt: Buffer = Buffer.alloc(0),
  praefix = '',
): Buffer {
  const kopf = Buffer.alloc(512);
  kopf.write(name, 0, 100, 'utf8');
  kopf.write('0000644\0', 100, 8, 'ascii');
  kopf.write(groesse.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  kopf.write('00000000000\0', 136, 12, 'ascii');
  kopf.write(typFlag, 156, 1, 'ascii');
  kopf.write('ustar\0', 257, 6, 'ascii');
  if (praefix.length > 0) kopf.write(praefix, 345, 155, 'utf8');
  kopf.fill(0x20, 148, 156);

  const fuellung = Buffer.alloc((512 - (inhalt.length % 512)) % 512);
  return Buffer.concat([kopf, inhalt, fuellung]);
}
