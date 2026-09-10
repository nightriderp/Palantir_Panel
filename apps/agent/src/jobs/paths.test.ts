import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertOhnePfadausbruch,
  assertOhnePfadausbruchInEinem,
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

  /*
   * Fundpunkt 201: Vorher gab die Funktion die Wurzel zurück, und zwei
   * Aufrufer löschten danach rekursiv – `RESTORE_BACKUP` mit `targetPath: '.'`
   * leerte den Datenordner **aller** Server der Node.
   */
  it('lehnt die Wurzel selbst ab', () => {
    expect(() => resolveWithinDirectory(WURZEL, WURZEL)).toThrow(/kein gültiges Ziel/);
    expect(() => resolveWithinDirectory(WURZEL, '.')).toThrow(/kein gültiges Ziel/);
    expect(() => resolveWithinDirectory(WURZEL, '')).toThrow(/kein gültiges Ziel/);
  });

  it('gibt die Wurzel heraus, wenn der Aufrufer sie ausdrücklich verlangt', () => {
    expect(resolveWithinDirectory(WURZEL, WURZEL, { erlaubeWurzel: true })).toBe(WURZEL);
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

/*
 * Fundpunkt 201: Die lexikalische Pruefung sieht `..` und absolute Pfade, nicht
 * aber eine symbolische Verknuepfung. Der Datenordner haengt im Spielcontainer;
 * wer dort Code ausfuehren darf, legt einen Link auf einen fremden Server, und
 * der Agent folgt ihm auf dem Host.
 */
/**
 * Kann dieses System ueberhaupt Verknuepfungen anlegen?
 *
 * Unter Windows braucht `symlink` erhoehte Rechte. Die Probe laeuft einmal beim
 * Laden, damit die betroffenen Faelle sichtbar **uebersprungen** werden statt
 * still durchzulaufen - ein Test, der nichts prueft und trotzdem gruen ist,
 * waere schlimmer als keiner. In der CI (Linux) laufen sie.
 */
const symlinksMoeglich = ((): boolean => {
  const basis = mkdtempSync(path.join(os.tmpdir(), 'palantir-symlink-probe-'));

  try {
    mkdirSync(path.join(basis, 'ziel'));
    symlinkSync(path.join(basis, 'ziel'), path.join(basis, 'link'), 'dir');

    return true;
  } catch {
    return false;
  } finally {
    rmSync(basis, { recursive: true, force: true });
  }
})();

describe('assertOhnePfadausbruch()', () => {
  let wurzel: string;
  let daneben: string;

  beforeEach(async () => {
    const basis = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-pfade-'));
    wurzel = path.join(basis, 'servers');
    daneben = path.join(basis, 'geheim');
    await fs.mkdir(path.join(wurzel, 'server-a'), { recursive: true });
    await fs.mkdir(daneben, { recursive: true });
    await fs.writeFile(path.join(daneben, 'welt.dat'), 'fremd');

    if (symlinksMoeglich) {
      await fs.symlink(daneben, path.join(wurzel, 'server-a', 'link'), 'dir');
    }
  });

  afterEach(async () => {
    await fs.rm(path.dirname(wurzel), { recursive: true, force: true });
  });

  it('laesst einen gewoehnlichen Pfad innerhalb der Wurzel durch', async () => {
    await expect(
      assertOhnePfadausbruch(wurzel, path.join(wurzel, 'server-a')),
    ).resolves.toBeUndefined();
  });

  it('laesst einen noch nicht vorhandenen Pfad innerhalb der Wurzel durch', async () => {
    await expect(
      assertOhnePfadausbruch(wurzel, path.join(wurzel, 'server-b', 'welt', 'region')),
    ).resolves.toBeUndefined();
  });

  it.skipIf(!symlinksMoeglich)(
    'lehnt einen Pfad ab, der ueber eine Verknuepfung nach draussen fuehrt',
    async () => {
      await expect(
        assertOhnePfadausbruch(wurzel, path.join(wurzel, 'server-a', 'link', 'welt.dat')),
      ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    },
  );

  it('prueft gegen mehrere Wurzeln und nimmt die erste passende', async () => {
    await expect(
      assertOhnePfadausbruchInEinem([daneben, wurzel], path.join(wurzel, 'server-a')),
    ).resolves.toBeUndefined();
  });

  it.skipIf(!symlinksMoeglich)(
    'lehnt auch gegen mehrere Wurzeln eine Verknuepfung nach draussen ab',
    async () => {
      await expect(
        assertOhnePfadausbruchInEinem([wurzel], path.join(wurzel, 'server-a', 'link', 'welt.dat')),
      ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    },
  );
});
