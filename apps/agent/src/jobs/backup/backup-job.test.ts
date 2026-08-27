import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContainerRuntimeError,
  FakeContainerRuntime,
  type ContainerRuntime,
  type ContainerSpec,
} from '../../runtime/index.js';
import { BackupJob } from './backup-job.js';

const SERVER_ID = '3f1d6f4e-1b1e-4b6a-9a3f-2c1d4e5f6a7b';
const BACKUP_ID = '11111111-2222-4333-8444-555555555555';

let wurzel: string;
let dataDir: string;
let backupDir: string;
let runtime: FakeContainerRuntime;
let job: BackupJob;
let datenordner: string;

/**
 * Der Fake der Runtime prüft Bind-Mount-Pfade gegen POSIX-Wurzeln (A2). Die
 * Testverzeichnisse liegen dagegen im temporären Ordner des Betriebssystems –
 * deshalb wird die erlaubte Wurzel hier auf `/` gesetzt. Die Prüfung der
 * *Job*-Pfade läuft davon unabhängig über `jobs/paths.ts` und wird unten
 * eigenständig geprüft.
 */
function fakeRuntime(): FakeContainerRuntime {
  return new FakeContainerRuntime({ hardening: { allowedHostRoots: ['/'] } });
}

const SPEC: ContainerSpec = {
  name: `palantir-${SERVER_ID}`,
  image: 'palantir/testserver:1',
  env: {},
  ports: [],
  resources: { memoryMb: 512, cpuCores: 1 },
  dataVolume: { hostPath: '/srv/palantir/servers/abc', containerPath: '/data' },
};

beforeEach(async () => {
  wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-backup-'));
  dataDir = path.join(wurzel, 'servers');
  backupDir = path.join(wurzel, 'backups');
  datenordner = path.join(dataDir, SERVER_ID);
  await fs.mkdir(datenordner, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(datenordner, 'server.properties'), 'max-players=20\n');

  runtime = fakeRuntime();
  await runtime.connect();
  job = new BackupJob({ runtime, dataDir, backupDir });
});

afterEach(async () => {
  await runtime.dispose();
  await fs.rm(wurzel, { recursive: true, force: true });
});

function createNutzlast(ueberschreibung: Record<string, unknown> = {}) {
  return {
    backupId: BACKUP_ID,
    serverId: SERVER_ID,
    sourcePath: datenordner,
    ...ueberschreibung,
  } as Parameters<BackupJob['createBackup']>[0];
}

describe('CREATE_BACKUP', () => {
  it('legt das Archiv unter <backupDir>/<serverId>/<backupId>.tar.gz ab', async () => {
    const ergebnis = await job.createBackup(createNutzlast());

    expect(ergebnis.storagePath).toBe(job.archivePathFor(SERVER_ID, BACKUP_ID));
    expect(ergebnis.storagePath).toBe(
      path.join(path.resolve(backupDir), SERVER_ID, `${BACKUP_ID}.tar.gz`),
    );
    await expect(fs.stat(ergebnis.storagePath)).resolves.toMatchObject({});
  });

  it('meldet Größe und Prüfsumme des Archivs', async () => {
    const ergebnis = await job.createBackup(createNutzlast());

    expect(ergebnis.sizeBytes).toBeGreaterThan(0);
    expect(ergebnis.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(ergebnis.startedAt)).toBeLessThanOrEqual(Date.parse(ergebnis.completedAt));
  });

  it('lässt den Container in Ruhe, wenn das Backend nicht darum bittet', async () => {
    const handle = await runtime.create(SPEC);
    await runtime.start(handle.containerId);

    const ergebnis = await job.createBackup(createNutzlast({ containerId: handle.containerId }));

    expect(ergebnis.containerStopped).toBe(false);
    await expect(runtime.inspect(handle.containerId)).resolves.toMatchObject({
      status: 'running',
    });
  });

  it('hält den Container an und startet ihn danach wieder', async () => {
    const handle = await runtime.create(SPEC);
    await runtime.start(handle.containerId);

    const ergebnis = await job.createBackup(
      createNutzlast({ containerId: handle.containerId, stopContainer: true }),
    );

    expect(ergebnis.containerStopped).toBe(true);
    // Vorher lief er, hinterher läuft er wieder.
    await expect(runtime.inspect(handle.containerId)).resolves.toMatchObject({
      status: 'running',
    });
  });

  it('startet einen vorher gestoppten Container nicht ungefragt', async () => {
    const handle = await runtime.create(SPEC);

    await job.createBackup(
      createNutzlast({ containerId: handle.containerId, stopContainer: true }),
    );

    await expect(runtime.inspect(handle.containerId)).resolves.toMatchObject({
      status: 'created',
    });
  });

  it('startet den Container auch nach einem gescheiterten Backup wieder', async () => {
    // Ein Server, der wegen eines misslungenen Backups aus bleibt, ist der
    // schlimmere Ausgang.
    const handle = await runtime.create(SPEC);
    await runtime.start(handle.containerId);

    await expect(
      job.createBackup(
        createNutzlast({
          containerId: handle.containerId,
          stopContainer: true,
          sourcePath: path.join(dataDir, 'gibt-es-nicht'),
        }),
      ),
    ).rejects.toBeInstanceOf(ContainerRuntimeError);

    await expect(runtime.inspect(handle.containerId)).resolves.toMatchObject({
      status: 'running',
    });
  });

  it('meldet einen fehlenden Datenordner als FILE_NOT_FOUND', async () => {
    await expect(
      job.createBackup(createNutzlast({ sourcePath: path.join(dataDir, 'weg') })),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('lehnt eine Quelle außerhalb von AGENT_DATA_DIR ab', async () => {
    await expect(
      job.createBackup(createNutzlast({ sourcePath: path.join(wurzel, 'fremd') })),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});

describe('RESTORE_BACKUP', () => {
  async function gesichert(): Promise<string> {
    const ergebnis = await job.createBackup(createNutzlast());
    return ergebnis.storagePath;
  }

  it('spielt den gesicherten Stand zurück', async () => {
    const archiv = await gesichert();
    await fs.writeFile(path.join(datenordner, 'server.properties'), 'kaputt\n');

    const ergebnis = await job.restoreBackup({
      backupId: BACKUP_ID,
      serverId: SERVER_ID,
      storagePath: archiv,
      targetPath: datenordner,
    });

    expect(ergebnis.restoredBytes).toBeGreaterThan(0);
    await expect(fs.readFile(path.join(datenordner, 'server.properties'), 'utf8')).resolves.toBe(
      'max-players=20\n',
    );
  });

  it('räumt Dateien weg, die es im Backup nicht mehr gibt', async () => {
    // Sonst wäre der wiederhergestellte Stand eine Mischung aus altem und
    // neuem und damit keiner.
    const archiv = await gesichert();
    await fs.writeFile(path.join(datenordner, 'nachtraeglich.txt'), 'neu');

    await job.restoreBackup({
      backupId: BACKUP_ID,
      serverId: SERVER_ID,
      storagePath: archiv,
      targetPath: datenordner,
    });

    await expect(fs.stat(path.join(datenordner, 'nachtraeglich.txt'))).rejects.toThrow();
  });

  it('hält den Container an und lässt ihn aus', async () => {
    // Was danach mit dem Server passiert, entscheidet der Lifecycle im Backend.
    const archiv = await gesichert();
    const handle = await runtime.create(SPEC);
    await runtime.start(handle.containerId);

    const ergebnis = await job.restoreBackup({
      backupId: BACKUP_ID,
      serverId: SERVER_ID,
      storagePath: archiv,
      targetPath: datenordner,
      containerId: handle.containerId,
    });

    expect(ergebnis.containerStopped).toBe(true);
    await expect(runtime.inspect(handle.containerId)).resolves.toMatchObject({
      status: 'exited',
    });
  });

  it('lehnt ein Archiv außerhalb von AGENT_BACKUP_DIR ab', async () => {
    await expect(
      job.restoreBackup({
        backupId: BACKUP_ID,
        serverId: SERVER_ID,
        storagePath: path.join(wurzel, 'fremd.tar.gz'),
        targetPath: datenordner,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('lehnt ein Ziel außerhalb von AGENT_DATA_DIR ab', async () => {
    const archiv = await gesichert();

    await expect(
      job.restoreBackup({
        backupId: BACKUP_ID,
        serverId: SERVER_ID,
        storagePath: archiv,
        targetPath: path.join(wurzel, 'fremd'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});

describe('DOWNLOAD_BACKUP', () => {
  let archiv: string;
  let groesse: number;

  beforeEach(async () => {
    // Zufällige Bytes: Ein Archiv aus lauter gleichen Zeichen schrumpft unter
    // die Blockgrößen, die dieser Abschnitt prüfen will.
    await fs.writeFile(path.join(datenordner, 'gross.bin'), randomBytes(50_000));
    const ergebnis = await job.createBackup(createNutzlast());
    archiv = ergebnis.storagePath;
    groesse = ergebnis.sizeBytes;
  });

  it('liefert das Archiv blockweise und vollständig', async () => {
    const bloecke: Buffer[] = [];
    let offset = 0;

    for (;;) {
      const block = await job.downloadBackup({
        backupId: BACKUP_ID,
        storagePath: archiv,
        offset,
        maxBytes: 4_096,
      });

      bloecke.push(Buffer.from(block.contentBase64, 'base64'));
      expect(block.totalBytes).toBe(groesse);
      offset += block.bytesRead;

      if (block.eof) {
        break;
      }
    }

    await expect(fs.readFile(archiv)).resolves.toEqual(Buffer.concat(bloecke));
  });

  it('deckelt eine zu große Anforderung auf die konfigurierte Obergrenze', async () => {
    const enger = new BackupJob({ runtime, dataDir, backupDir, maxDownloadBlockBytes: 1_024 });

    const block = await enger.downloadBackup({
      backupId: BACKUP_ID,
      storagePath: archiv,
      offset: 0,
      maxBytes: 4_000_000_000,
    });

    expect(block.bytesRead).toBe(1_024);
    expect(block.eof).toBe(false);
  });

  it('meldet eof, sobald das Ende erreicht ist', async () => {
    const block = await job.downloadBackup({
      backupId: BACKUP_ID,
      storagePath: archiv,
      offset: 0,
      maxBytes: groesse + 1_000,
    });

    expect(block.bytesRead).toBe(groesse);
    expect(block.eof).toBe(true);
  });

  it('lehnt eine Leseposition hinter dem Archivende ab', async () => {
    await expect(
      job.downloadBackup({
        backupId: BACKUP_ID,
        storagePath: archiv,
        offset: groesse + 1,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('meldet ein fehlendes Archiv als FILE_NOT_FOUND', async () => {
    await expect(
      job.downloadBackup({
        backupId: BACKUP_ID,
        storagePath: path.join(backupDir, 'weg.tar.gz'),
        offset: 0,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
});

describe('DELETE_BACKUP', () => {
  it('entfernt das Archiv und meldet den freigegebenen Speicher', async () => {
    const erstellt = await job.createBackup(createNutzlast());

    const ergebnis = await job.deleteBackup({
      backupId: BACKUP_ID,
      storagePath: erstellt.storagePath,
    });

    expect(ergebnis).toEqual({
      backupId: BACKUP_ID,
      removed: true,
      freedBytes: erstellt.sizeBytes,
    });
    await expect(fs.stat(erstellt.storagePath)).rejects.toThrow();
  });

  it('ist idempotent: ein bereits fehlendes Archiv ist kein Fehler', async () => {
    // Sonst bliebe nach einem Abbruch mitten in der Aufbewahrungsprüfung ein
    // Datensatz zurück, der sich nie wieder löschen ließe.
    const ergebnis = await job.deleteBackup({
      backupId: BACKUP_ID,
      storagePath: path.join(backupDir, SERVER_ID, `${BACKUP_ID}.tar.gz`),
    });

    expect(ergebnis).toEqual({ backupId: BACKUP_ID, removed: false, freedBytes: 0 });
  });

  it('räumt den leer gewordenen Server-Ordner auf', async () => {
    const erstellt = await job.createBackup(createNutzlast());
    await job.deleteBackup({ backupId: BACKUP_ID, storagePath: erstellt.storagePath });

    await expect(fs.stat(path.join(backupDir, SERVER_ID))).rejects.toThrow();
    // Das Backup-Verzeichnis selbst bleibt stehen.
    await expect(fs.stat(backupDir)).resolves.toMatchObject({});
  });

  it('lehnt einen Pfad außerhalb von AGENT_BACKUP_DIR ab', async () => {
    await expect(
      job.deleteBackup({ backupId: BACKUP_ID, storagePath: path.join(wurzel, 'fremd.tar.gz') }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});

describe('Container-Zugriff', () => {
  it('läuft ausschließlich über das ContainerRuntime-Interface', async () => {
    // CLAUDE.md §4: Der Job kennt keine Docker-API. Geprüft über eine
    // Attrappe, die nur die beiden erlaubten Methoden anbietet.
    const aufrufe: string[] = [];
    const attrappe = {
      inspect: async () => {
        aufrufe.push('inspect');
        return { status: 'running' as const };
      },
      stop: async () => {
        aufrufe.push('stop');
      },
      start: async () => {
        aufrufe.push('start');
      },
    } as unknown as ContainerRuntime;

    const eigener = new BackupJob({ runtime: attrappe, dataDir, backupDir });
    await eigener.createBackup(createNutzlast({ containerId: 'c1', stopContainer: true }));

    expect(aufrufe).toEqual(['inspect', 'stop', 'start']);
  });
});
