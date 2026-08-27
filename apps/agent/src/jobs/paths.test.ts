import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveWithinAny,
  resolveWithinDirectory,
  serverIdFromContainerName,
  serverIdFromDirectoryName,
} from './paths.js';

const WURZEL = path.resolve(path.sep, 'srv', 'palantir', 'servers');
const BACKUPS = path.resolve(path.sep, 'srv', 'palantir', 'backups');
const SERVER_ID = '3f1d6f4e-1b1e-4b6a-9a3f-2c1d4e5f6a7b';

describe('resolveWithinDirectory()', () => {
  it('lässt einen Pfad innerhalb der Wurzel durch', () => {
    expect(resolveWithinDirectory(WURZEL, path.join(WURZEL, SERVER_ID))).toBe(
      path.join(WURZEL, SERVER_ID),
    );
  });

  it('löst eine relative Angabe gegen die Wurzel auf', () => {
    expect(resolveWithinDirectory(WURZEL, SERVER_ID)).toBe(path.join(WURZEL, SERVER_ID));
  });

  it('lässt die Wurzel selbst zu', () => {
    expect(resolveWithinDirectory(WURZEL, WURZEL)).toBe(WURZEL);
  });

  it('lehnt einen Ausbruch über .. ab', () => {
    expect(() => resolveWithinDirectory(WURZEL, path.join(WURZEL, '..', 'geheim'))).toThrow(
      /außerhalb/,
    );
  });

  it('lehnt ein Nachbarverzeichnis mit gleichem Präfix ab', () => {
    // "/srv/palantir/servers-alt" beginnt mit "/srv/palantir/servers", liegt
    // aber nicht darin – deshalb der Vergleich über path.relative().
    expect(() => resolveWithinDirectory(WURZEL, `${WURZEL}-alt`)).toThrow(/außerhalb/);
  });

  it('lehnt NUL-Bytes ab', () => {
    expect(() => resolveWithinDirectory(WURZEL, 'a\0b')).toThrow(/NUL/);
  });
});

describe('resolveWithinAny()', () => {
  it('nimmt die passende Wurzel', () => {
    expect(resolveWithinAny([WURZEL, BACKUPS], path.join(BACKUPS, 'a.tar.gz'))).toBe(
      path.join(BACKUPS, 'a.tar.gz'),
    );
  });

  it('lehnt einen Pfad ab, der in keine Wurzel fällt', () => {
    expect(() =>
      resolveWithinAny([WURZEL, BACKUPS], path.resolve(path.sep, 'etc', 'passwd')),
    ).toThrow(/außerhalb/);
  });

  it('lehnt ohne konfigurierte Wurzel alles ab', () => {
    expect(() => resolveWithinAny([], WURZEL)).toThrow(/kein erlaubtes Verzeichnis/);
  });
});

describe('Zuordnung Ordner/Container → Server-Id', () => {
  it('erkennt einen Ordnernamen im Id-Format', () => {
    expect(serverIdFromDirectoryName(SERVER_ID)).toBe(SERVER_ID);
    expect(serverIdFromDirectoryName(SERVER_ID.toUpperCase())).toBe(SERVER_ID);
  });

  it('rät bei einem beliebigen Ordnernamen nicht', () => {
    expect(serverIdFromDirectoryName('alte-welt')).toBeNull();
    expect(serverIdFromDirectoryName('')).toBeNull();
  });

  it('löst Container-Namen der Form palantir-<serverId> auf', () => {
    expect(serverIdFromContainerName(`palantir-${SERVER_ID}`)).toBe(SERVER_ID);
    expect(serverIdFromContainerName(`/palantir-${SERVER_ID}`)).toBe(SERVER_ID);
  });

  it('meldet einen fremden Container-Namen als nicht zuordenbar', () => {
    expect(serverIdFromContainerName('nginx')).toBeNull();
    expect(serverIdFromContainerName('palantir-irgendwas')).toBeNull();
  });
});
