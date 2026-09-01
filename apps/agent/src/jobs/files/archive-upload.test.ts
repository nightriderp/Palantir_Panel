import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTar } from '../../runtime/docker/tar.js';
import { FakeContainerRuntime, type ContainerSpec } from '../../runtime/index.js';
import { ARCHIVE_UPLOAD_DIRNAME, ArchiveUploadJob } from './archive-upload.js';

const SERVER_ID = '3f1d6f4e-1b1e-4b6a-9a3f-2c1d4e5f6a7b';
const TRANSFER = 'transfer-1';

let dataDir: string;
let runtime: FakeContainerRuntime;
let job: ArchiveUploadJob;
let containerId: string;

function spec(): ContainerSpec {
  return {
    name: `palantir-${SERVER_ID}`,
    image: 'palantir/testserver:1',
    env: {},
    ports: [],
    resources: { memoryMb: 512, cpuCores: 1 },
    dataVolume: { hostPath: `/srv/palantir/servers/${SERVER_ID}`, containerPath: '/data' },
    serverId: SERVER_ID,
  };
}

/** Ein kleines Weltarchiv – zwei Dateien, wie es der Wizard hochlädt. */
function archiv(): Buffer {
  return gzipSync(
    createTar([
      { name: 'welt/level.dat', content: Buffer.from('welt') },
      { name: 'server.properties', content: Buffer.from('motd=x') },
    ]),
  );
}

function block(inhalt: Buffer, offset: number, last: boolean) {
  return {
    containerId,
    transferId: TRANSFER,
    offset,
    contentBase64: inhalt.toString('base64'),
    last,
    path: '',
    format: 'tar.gz' as const,
  };
}

/** Liegt noch eine angefangene Übertragung auf der Platte? */
async function reste(): Promise<string[]> {
  return fs.readdir(path.join(dataDir, ARCHIVE_UPLOAD_DIRNAME)).catch(() => []);
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-upload-'));
  runtime = new FakeContainerRuntime();
  job = new ArchiveUploadJob({ runtime, dataDir });
  containerId = (await runtime.create(spec())).containerId;
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('ArchiveUploadJob (Gefundener Punkt 106)', () => {
  it('setzt ein Archiv aus mehreren Blöcken zusammen und entpackt am Ende', async () => {
    const daten = archiv();
    const mitte = Math.floor(daten.byteLength / 2);

    const erster = await job.receive(block(daten.subarray(0, mitte), 0, false));
    expect(erster).toEqual({ transferId: TRANSFER, receivedBytes: mitte, extract: null });

    const letzter = await job.receive(block(daten.subarray(mitte), mitte, true));

    expect(letzter.receivedBytes).toBe(daten.byteLength);
    expect(letzter.extract).toMatchObject({ fileCount: 2, skipped: [] });
    expect(await runtime.listFiles(containerId, '/data/welt')).toHaveLength(1);
  });

  it('räumt die Zwischendatei nach dem Entpacken weg', async () => {
    const daten = archiv();
    await job.receive(block(daten.subarray(0, 10), 0, false));
    expect(await reste()).toHaveLength(1);

    await job.receive(block(daten.subarray(10), 10, true));

    expect(await reste()).toEqual([]);
  });

  it('lehnt einen Block ab, der nicht an das Empfangene passt', async () => {
    const daten = archiv();
    await job.receive(block(daten.subarray(0, 10), 0, false));

    // Doppelt gesendeter Block nach einem Verbindungsabriss: Ohne diese
    // Prüfung entstünde still ein Archiv mit doppeltem Stück.
    await expect(job.receive(block(daten.subarray(0, 10), 0 + 20, true))).rejects.toMatchObject({
      code: 'RUNTIME_ERROR',
    });
  });

  it('fängt bei offset 0 neu an, statt an einen Rest anzuhängen', async () => {
    const daten = archiv();
    await job.receive(block(Buffer.from('unbrauchbarer rest'), 0, false));

    const ergebnis = await job.receive(block(daten, 0, true));

    expect(ergebnis.receivedBytes).toBe(daten.byteLength);
    expect(ergebnis.extract).toMatchObject({ fileCount: 2 });
  });

  it('lehnt eine Kennung mit Pfadanteilen ab', async () => {
    await expect(
      job.receive({ ...block(Buffer.from('x'), 0, false), transferId: '../../etc/passwd' }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('lässt nach einem Fehler beim Entpacken nichts liegen', async () => {
    await expect(
      job.receive(block(Buffer.from('das ist kein Archiv'), 0, true)),
    ).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });

    expect(await reste()).toEqual([]);
  });

  it('räumt abgelaufene Reste beim Beginn der nächsten Übertragung weg', async () => {
    const alt = path.join(dataDir, ARCHIVE_UPLOAD_DIRNAME, 'alt.archive');
    await fs.mkdir(path.dirname(alt), { recursive: true });
    await fs.writeFile(alt, 'rest');
    const gestern = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await fs.utimes(alt, gestern, gestern);

    await job.receive(block(archiv(), 0, true));

    expect(await reste()).toEqual([]);
  });
});
