import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeContainerRuntime, type ContainerSpec } from '../../runtime/index.js';
import { StorageScanner } from './storage-scanner.js';

const SERVER_A = '3f1d6f4e-1b1e-4b6a-9a3f-2c1d4e5f6a7b';
const SERVER_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let wurzel: string;
let dataDir: string;
let backupDir: string;
let runtime: FakeContainerRuntime;
let scanner: StorageScanner;

const BELEGUNG = { totalBytes: 1_000_000, usedBytes: 400_000, freeBytes: 600_000 };

function spec(serverId: string, image = 'palantir/testserver:1'): ContainerSpec {
  return {
    name: `palantir-${serverId}`,
    image,
    env: {},
    ports: [],
    resources: { memoryMb: 512, cpuCores: 1 },
    dataVolume: { hostPath: '/srv/palantir/servers/x', containerPath: '/data' },
  };
}

async function schreibe(relativ: string, inhalt: string): Promise<void> {
  const pfad = path.join(wurzel, relativ);
  await fs.mkdir(path.dirname(pfad), { recursive: true });
  await fs.writeFile(pfad, inhalt);
}

beforeEach(async () => {
  wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-storage-'));
  dataDir = path.join(wurzel, 'servers');
  backupDir = path.join(wurzel, 'backups');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  runtime = new FakeContainerRuntime({ hardening: { allowedHostRoots: ['/'] } });
  await runtime.connect();

  scanner = new StorageScanner({
    runtime,
    dataDir,
    backupDir,
    diskUsage: async () => BELEGUNG,
    now: () => new Date('2026-08-26T12:00:00.000Z'),
  });
});

afterEach(async () => {
  await runtime.dispose();
  await fs.rm(wurzel, { recursive: true, force: true });
});

describe('GET_STORAGE_BREAKDOWN – Rahmen', () => {
  it('meldet Zeitpunkt und Belegung des Datenträgers', async () => {
    const ergebnis = await scanner.scan();

    expect(ergebnis.scannedAt).toBe('2026-08-26T12:00:00.000Z');
    expect(ergebnis).toMatchObject(BELEGUNG);
  });

  it('kommt mit noch nicht angelegten Verzeichnissen zurecht', async () => {
    const leer = new StorageScanner({
      runtime,
      dataDir: path.join(wurzel, 'gibt-es-nicht'),
      backupDir: path.join(wurzel, 'auch-nicht'),
      diskUsage: async () => BELEGUNG,
    });

    await expect(leer.scan({ includeImages: false })).resolves.toMatchObject({ entries: [] });
  });
});

describe('GET_STORAGE_BREAKDOWN – Serverdaten', () => {
  it('meldet einen Datenordner mit Container als serverData', async () => {
    await schreibe(`servers/${SERVER_A}/welt/level.dat`, 'zwoelf-zeichen');
    await runtime.create(spec(SERVER_A));

    const ergebnis = await scanner.scan({ includeImages: false });
    const eintrag = ergebnis.entries.find((e) => e.serverId === SERVER_A);

    expect(eintrag).toMatchObject({
      kind: 'serverData',
      path: path.join(path.resolve(dataDir), SERVER_A),
      serverId: SERVER_A,
      inUse: false,
    });
    expect(eintrag?.sizeBytes).toBe('zwoelf-zeichen'.length);
  });

  it('meldet inUse, solange der Container läuft', async () => {
    await schreibe(`servers/${SERVER_A}/a.txt`, 'x');
    const handle = await runtime.create(spec(SERVER_A));
    await runtime.start(handle.containerId);

    const ergebnis = await scanner.scan({ includeImages: false });
    expect(ergebnis.entries[0]).toMatchObject({ kind: 'serverData', inUse: true });
  });

  it('meldet einen Ordner ohne Container als orphaned – ohne serverId', async () => {
    // Ob dahinter ein noch existierender Server steckt, weiß nur das Backend.
    // Der Agent rät nicht (Pflichtenheft §16).
    await schreibe(`servers/${SERVER_B}/a.txt`, 'x');

    const ergebnis = await scanner.scan({ includeImages: false });
    expect(ergebnis.entries[0]).toMatchObject({ kind: 'orphaned', serverId: null });
  });

  it('summiert einen Verzeichnisbaum über mehrere Ebenen', async () => {
    await schreibe(`servers/${SERVER_A}/a.txt`, '12345');
    await schreibe(`servers/${SERVER_A}/welt/region/b.mca`, '1234567890');
    await runtime.create(spec(SERVER_A));

    const ergebnis = await scanner.scan({ includeImages: false });
    expect(ergebnis.entries[0]?.sizeBytes).toBe(15);
  });
});

describe('GET_STORAGE_BREAKDOWN – Backups', () => {
  it('meldet Archive mit Dateiname und zugehörigem Server', async () => {
    await schreibe(`backups/${SERVER_A}/backup-1.tar.gz`, 'abc');

    const ergebnis = await scanner.scan({ includeImages: false });
    expect(ergebnis.entries).toEqual([
      expect.objectContaining({
        kind: 'backup',
        serverId: SERVER_A,
        backupFileName: 'backup-1.tar.gz',
        sizeBytes: 3,
        inUse: false,
      }),
    ]);
  });

  it('meldet ein Archiv ohne Server-Ordner ohne serverId', async () => {
    await schreibe('backups/lose.tar.gz', 'abc');

    const ergebnis = await scanner.scan({ includeImages: false });
    expect(ergebnis.entries[0]).toMatchObject({ kind: 'backup', serverId: null });
  });
});

describe('GET_STORAGE_BREAKDOWN – Images', () => {
  beforeEach(() => {
    runtime.seedImage({
      imageId: 'sha256:aaa',
      tag: 'palantir/testserver:1',
      sizeBytes: 120,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    runtime.seedImage({ imageId: 'sha256:bbb', tag: 'alt/ungenutzt:2', sizeBytes: 80 });
  });

  it('meldet Images mit Größe und Nutzungsstatus', async () => {
    await runtime.create(spec(SERVER_A, 'palantir/testserver:1'));

    const ergebnis = await scanner.scan();
    const images = ergebnis.entries.filter((e) => e.kind === 'dockerImage');

    expect(images).toHaveLength(2);
    expect(images.find((e) => e.imageId === 'sha256:aaa')).toMatchObject({
      imageTag: 'palantir/testserver:1',
      sizeBytes: 120,
      inUse: true,
      path: null,
      lastModifiedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(images.find((e) => e.imageId === 'sha256:bbb')).toMatchObject({ inUse: false });
  });

  it('lässt den Image-Scan bei includeImages: false aus', async () => {
    // Der Scan ist deutlich teurer als die Ordnergrößen und deshalb abschaltbar.
    const ergebnis = await scanner.scan({ includeImages: false });
    expect(ergebnis.entries.filter((e) => e.kind === 'dockerImage')).toEqual([]);
  });

  it('erhebt Images ohne Angabe mit', async () => {
    const ergebnis = await scanner.scan();
    expect(ergebnis.entries.filter((e) => e.kind === 'dockerImage')).toHaveLength(2);
  });
});

describe('REMOVE_STORAGE_ENTRY', () => {
  it('entfernt ein Backup-Archiv und meldet den freien Speicher', async () => {
    await schreibe(`backups/${SERVER_A}/backup-1.tar.gz`, 'abcdef');
    const pfad = path.join(backupDir, SERVER_A, 'backup-1.tar.gz');

    await expect(scanner.remove({ kind: 'backup', path: pfad })).resolves.toEqual({
      removed: true,
      freedBytes: 6,
    });
    await expect(fs.stat(pfad)).rejects.toThrow();
  });

  it('ist idempotent: ein bereits verschwundener Posten ist kein Fehler', async () => {
    await expect(
      scanner.remove({ kind: 'backup', path: path.join(backupDir, 'weg.tar.gz') }),
    ).resolves.toEqual({ removed: false, freedBytes: 0 });
  });

  it('entfernt verwaiste Daten samt Unterordnern', async () => {
    await schreibe(`servers/${SERVER_B}/welt/a.txt`, '12345');
    const pfad = path.join(dataDir, SERVER_B);

    await expect(scanner.remove({ kind: 'orphaned', path: pfad })).resolves.toEqual({
      removed: true,
      freedBytes: 5,
    });
    await expect(fs.stat(pfad)).rejects.toThrow();
  });

  it('verweigert einen Datenordner, zu dem es einen Container gibt', async () => {
    // Aktive Server-Datenordner sind über den Storage-Explorer grundsätzlich
    // nicht löschbar (Lastenheft §3.8) – auch dann nicht, wenn der Befehl sie
    // als verwaist bezeichnet.
    await schreibe(`servers/${SERVER_A}/a.txt`, 'x');
    await runtime.create(spec(SERVER_A));

    await expect(
      scanner.remove({ kind: 'orphaned', path: path.join(dataDir, SERVER_A) }),
    ).rejects.toMatchObject({ code: 'CONTAINER_STATE_CONFLICT' });
    await expect(fs.stat(path.join(dataDir, SERVER_A))).resolves.toMatchObject({});
  });

  it('lehnt einen Pfad außerhalb der erlaubten Verzeichnisse ab', async () => {
    await schreibe('fremd/geheim.txt', 'x');

    await expect(
      scanner.remove({ kind: 'orphaned', path: path.join(wurzel, 'fremd') }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(fs.stat(path.join(wurzel, 'fremd'))).resolves.toMatchObject({});
  });

  it('lehnt ein Backup außerhalb von AGENT_BACKUP_DIR ab', async () => {
    await expect(
      scanner.remove({ kind: 'backup', path: path.join(dataDir, SERVER_A) }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('verlangt bei einem Pfad-Posten einen Pfad', async () => {
    await expect(scanner.remove({ kind: 'backup' })).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
  });

  it('entfernt ein ungenutztes Image über die Runtime', async () => {
    runtime.seedImage({ imageId: 'sha256:bbb', tag: 'alt/ungenutzt:2', sizeBytes: 80 });

    await expect(
      scanner.remove({ kind: 'dockerImage', imageId: 'sha256:bbb' }),
    ).resolves.toEqual({ removed: true, freedBytes: 80 });
    await expect(runtime.listImages()).resolves.toEqual([]);
  });

  it('verweigert ein Image, das ein Container benutzt', async () => {
    runtime.seedImage({ imageId: 'sha256:aaa', tag: 'palantir/testserver:1', sizeBytes: 120 });
    await runtime.create(spec(SERVER_A, 'palantir/testserver:1'));

    await expect(
      scanner.remove({ kind: 'dockerImage', imageId: 'sha256:aaa' }),
    ).rejects.toMatchObject({ code: 'CONTAINER_STATE_CONFLICT' });
  });

  it('meldet ein bereits entferntes Image als "nichts entfernt"', async () => {
    await expect(
      scanner.remove({ kind: 'dockerImage', imageId: 'sha256:weg' }),
    ).resolves.toEqual({ removed: false, freedBytes: 0 });
  });

  it('verlangt bei einem Image eine imageId', async () => {
    await expect(scanner.remove({ kind: 'dockerImage' })).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
  });
});
