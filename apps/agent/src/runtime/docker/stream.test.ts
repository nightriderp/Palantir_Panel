import { describe, expect, it } from 'vitest';
import { LogLineAssembler, collectStream, demuxDockerStream, readNdjson } from './stream.js';

function rahmen(streamTyp: 1 | 2, text: string): Buffer {
  const nutzlast = Buffer.from(text, 'utf8');
  const kopf = Buffer.alloc(8);
  kopf.writeUInt8(streamTyp, 0);
  kopf.writeUInt32BE(nutzlast.length, 4);
  return Buffer.concat([kopf, nutzlast]);
}

async function* alsStrom(...teile: Buffer[]): AsyncGenerator<Uint8Array> {
  for (const teil of teile) yield teil;
}

async function sammle<T>(quelle: AsyncIterable<T>): Promise<T[]> {
  const ergebnis: T[] = [];
  for await (const eintrag of quelle) ergebnis.push(eintrag);
  return ergebnis;
}

describe('demuxDockerStream', () => {
  it('trennt stdout und stderr', async () => {
    const rahmenListe = await sammle(
      demuxDockerStream(alsStrom(rahmen(1, 'hallo\n'), rahmen(2, 'fehler\n'))),
    );

    expect(rahmenListe.map((r) => r.stream)).toEqual(['stdout', 'stderr']);
    expect(rahmenListe[0]?.payload.toString('utf8')).toBe('hallo\n');
    expect(rahmenListe[1]?.payload.toString('utf8')).toBe('fehler\n');
  });

  it('setzt Rahmen zusammen, die ueber mehrere Chunks verteilt ankommen', async () => {
    const voll = rahmen(1, 'geteilte Nachricht\n');
    const rahmenListe = await sammle(
      demuxDockerStream(alsStrom(voll.subarray(0, 3), voll.subarray(3, 10), voll.subarray(10))),
    );

    expect(rahmenListe).toHaveLength(1);
    expect(rahmenListe[0]?.payload.toString('utf8')).toBe('geteilte Nachricht\n');
  });

  it('behandelt einen nicht multiplexten Stream als stdout', async () => {
    const rahmenListe = await sammle(demuxDockerStream(alsStrom(Buffer.from('nur Text\n'))));
    expect(rahmenListe[0]?.stream).toBe('stdout');
    expect(rahmenListe[0]?.payload.toString('utf8')).toBe('nur Text\n');
  });
});

describe('LogLineAssembler', () => {
  it('zerlegt Nutzlasten in Zeilen und liest den Zeitstempel', () => {
    const assembler = new LogLineAssembler('c1');
    const zeilen = assembler.push({
      stream: 'stdout',
      payload: Buffer.from('2026-08-26T10:00:00.123456789Z Server bereit\n', 'utf8'),
    });

    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.message).toBe('Server bereit');
    expect(zeilen[0]?.timestamp).toBe('2026-08-26T10:00:00.123Z');
    expect(zeilen[0]?.containerId).toBe('c1');
  });

  it('haelt angefangene Zeilen bis zum naechsten Rahmen zurueck', () => {
    const assembler = new LogLineAssembler('c1');

    expect(assembler.push({ stream: 'stdout', payload: Buffer.from('Teil ') })).toEqual([]);
    const zeilen = assembler.push({ stream: 'stdout', payload: Buffer.from('eins\n') });
    expect(zeilen[0]?.message).toBe('Teil eins');
  });

  it('haelt stdout und stderr getrennt', () => {
    const assembler = new LogLineAssembler('c1');
    assembler.push({ stream: 'stdout', payload: Buffer.from('aus') });
    assembler.push({ stream: 'stderr', payload: Buffer.from('fehler\n') });
    const zeilen = assembler.push({ stream: 'stdout', payload: Buffer.from('gabe\n') });

    expect(zeilen[0]?.message).toBe('ausgabe');
  });

  it('gibt den Rest beim Abschluss aus', () => {
    const assembler = new LogLineAssembler('c1');
    assembler.push({ stream: 'stdout', payload: Buffer.from('ohne Zeilenumbruch') });

    const rest = assembler.flush();
    expect(rest[0]?.message).toBe('ohne Zeilenumbruch');
    expect(assembler.flush()).toEqual([]);
  });

  it('kommt ohne Zeitstempel zurecht', () => {
    const assembler = new LogLineAssembler('c1');
    const zeilen = assembler.push({ stream: 'stdout', payload: Buffer.from('kein Zeitstempel\n') });
    expect(zeilen[0]?.timestamp).toBeNull();
    expect(zeilen[0]?.message).toBe('kein Zeitstempel');
  });
});

describe('readNdjson', () => {
  it('liest ein Objekt je Zeile, auch ueber Chunkgrenzen hinweg', async () => {
    const objekte = await sammle(
      readNdjson(alsStrom(Buffer.from('{"a":1}\n{"b'), Buffer.from('":2}\n'))),
    );
    expect(objekte).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('ignoriert Leerzeilen und gibt den Abschluss ohne Zeilenumbruch aus', async () => {
    const objekte = await sammle(readNdjson(alsStrom(Buffer.from('\n{"a":1}\n\n{"b":2}'))));
    expect(objekte).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('collectStream', () => {
  it('fuegt alle Chunks zusammen', async () => {
    const puffer = await collectStream(alsStrom(Buffer.from('ab'), Buffer.from('cd')));
    expect(puffer.toString('utf8')).toBe('abcd');
  });
});
