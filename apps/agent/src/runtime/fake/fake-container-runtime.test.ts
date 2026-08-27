import { beforeEach, describe, expect, it } from 'vitest';
import { FAKE_DATA_ROOT, FakeContainerRuntime } from './fake-container-runtime.js';
import { runContainerRuntimeConformance } from '../container-runtime.conformance.js';
import { ContainerRuntimeError } from '../errors.js';
import { type ContainerRuntimeEvent } from '../events.js';
import { PALANTIR_MANAGED_LABEL } from '../hardening.js';
import { type ContainerSpec } from '../types.js';

function spec(ueberschreibung: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    name: 'palantir-testserver',
    image: 'palantir/testserver:1',
    env: {},
    ports: [{ containerPort: 25565, hostPort: 30001, protocol: 'tcp' }],
    resources: { memoryMb: 1024, cpuCores: 1 },
    dataVolume: { hostPath: `${FAKE_DATA_ROOT}/srv-1`, containerPath: '/data' },
    ...ueberschreibung,
  };
}

// Der Fake muss denselben Vertrag erfuellen wie die Docker-Implementierung.
runContainerRuntimeConformance('FakeContainerRuntime', async () => ({
  runtime: new FakeContainerRuntime(),
  spec,
}));

describe('FakeContainerRuntime – Testhilfen', () => {
  let runtime: FakeContainerRuntime;
  let events: ContainerRuntimeEvent[];
  let id: string;

  beforeEach(async () => {
    runtime = new FakeContainerRuntime({ now: () => new Date('2026-08-26T10:00:00.000Z') });
    events = [];
    await runtime.connect();
    runtime.on((event) => events.push(event));
    id = (await runtime.create(spec())).containerId;
  });

  it('wendet dieselbe Haertung an wie die Docker-Variante', () => {
    const body = runtime.getCreateBody(id);

    expect(body.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
    expect(body.HostConfig.CapDrop).toEqual(['ALL']);
    expect(body.HostConfig.ReadonlyRootfs).toBe(true);
    expect(body.HostConfig.Memory).toBe(1024 * 1024 * 1024);
    expect(body.Labels[PALANTIR_MANAGED_LABEL]).toBe('true');
  });

  it('meldet einen Absturz als STATUS_CHANGED und CRASHED', async () => {
    await runtime.start(id);
    events.length = 0;

    runtime.simulateCrash(id, { exitCode: 1 });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'STATUS_CHANGED',
        status: 'exited',
        previousStatus: 'running',
        exitCode: 1,
      }),
      expect.objectContaining({ type: 'CRASHED', exitCode: 1, oomKilled: false }),
    ]);
    expect((await runtime.inspect(id)).exitCode).toBe(1);
  });

  it('kennzeichnet ein OOM-Kill als solches', async () => {
    await runtime.start(id);
    runtime.simulateCrash(id, { oomKilled: true });

    const absturz = events.find((event) => event.type === 'CRASHED');
    expect(absturz).toMatchObject({ type: 'CRASHED', exitCode: 137, oomKilled: true });
    expect((await runtime.inspect(id)).oomKilled).toBe(true);
  });

  it('meldet ein regulaeres Ende ohne CRASHED', async () => {
    await runtime.start(id);
    events.length = 0;

    runtime.simulateExit(id, 0);

    expect(events.filter((event) => event.type === 'CRASHED')).toEqual([]);
    expect(events.filter((event) => event.type === 'STATUS_CHANGED')).toHaveLength(1);
  });

  it('liefert LOG_LINE nur bei aktivem watch()', async () => {
    runtime.appendLog(id, 'vor dem watch');
    expect(events.filter((event) => event.type === 'LOG_LINE')).toEqual([]);

    const beenden = await runtime.watch(id);
    runtime.appendLog(id, 'Server bereit', 'stderr');

    const logEvents = events.filter((event) => event.type === 'LOG_LINE');
    expect(logEvents).toHaveLength(1);
    expect(logEvents[0]).toMatchObject({
      type: 'LOG_LINE',
      line: { message: 'Server bereit', stream: 'stderr', containerId: id },
    });

    beenden();
    runtime.appendLog(id, 'danach');
    expect(events.filter((event) => event.type === 'LOG_LINE')).toHaveLength(1);
  });

  it('haelt auch ungesehene Logzeilen fuer GET_LOGS vor', async () => {
    runtime.appendLog(id, 'zeile 1');
    runtime.appendLog(id, 'zeile 2');

    const zeilen = await runtime.getLogs(id, { tail: 1 });
    expect(zeilen.map((zeile) => zeile.message)).toEqual(['zeile 2']);
  });

  it('liefert STATS_UPDATE bei aktivem watch()', async () => {
    await runtime.watch(id, { logs: false });
    runtime.setStats(id, { cpuPercent: 42, memoryUsedBytes: 1000 });

    const statsEvents = events.filter((event) => event.type === 'STATS_UPDATE');
    expect(statsEvents).toHaveLength(1);
    expect((await runtime.getStats(id)).cpuPercent).toBe(42);
  });

  it('laesst sich fuer Fehlerpfade praeparieren', async () => {
    runtime.failNext('start', new ContainerRuntimeError('RUNTIME_UNAVAILABLE'));

    await expect(runtime.start(id)).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
    // Nur der naechste Aufruf scheitert.
    await expect(runtime.start(id)).resolves.toBeUndefined();
  });

  it('erlaubt ein eigenes Antwortverhalten der Konsole', async () => {
    await runtime.start(id);
    runtime.setExecHandler((_containerId, command) => ({
      exitCode: 0,
      stdout: `ausgefuehrt: ${command.join(' ')}`,
      stderr: '',
    }));

    const ergebnis = await runtime.execConsole(id, ['say', 'hallo']);
    expect(ergebnis.stdout).toBe('ausgefuehrt: say hallo');
  });

  it('nimmt vorbereitete Dateien entgegen', async () => {
    runtime.seedFile(id, '/data/eula.txt', Buffer.from('eula=true'));
    expect((await runtime.readFile(id, '/data/eula.txt')).toString('utf8')).toBe('eula=true');
  });

  it('begrenzt die Dateigroesse', async () => {
    const klein = new FakeContainerRuntime({ maxFileBytes: 8 });
    await klein.connect();
    const kleinId = (await klein.create(spec())).containerId;

    await expect(
      klein.writeFile(kleinId, '/data/gross.bin', Buffer.alloc(9)),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('vergibt fortlaufende, deterministische IDs', async () => {
    const zweite = await runtime.create(spec({ name: 'palantir-zwei' }));
    expect(id).toBe('fake-container-1');
    expect(zweite.containerId).toBe('fake-container-2');
  });
  describe('Images (Pflichtenheft §16, Ergaenzung aus A3)', () => {
    it('meldet geseedete Images mit Groesse und Tag', async () => {
      runtime.seedImage({ imageId: 'sha256:aaa', tag: 'palantir/test:1', sizeBytes: 120 });

      await expect(runtime.listImages()).resolves.toEqual([
        expect.objectContaining({ imageId: 'sha256:aaa', tag: 'palantir/test:1', sizeBytes: 120 }),
      ]);
    });

    it('meldet ein von einem Container benutztes Image als inUse', async () => {
      runtime.seedImage({ imageId: 'sha256:aaa', tag: 'palantir/testserver:1' });
      runtime.seedImage({ imageId: 'sha256:bbb', tag: 'alt/ungenutzt:2' });

      const images = await runtime.listImages();
      expect(images.find((i) => i.imageId === 'sha256:aaa')?.inUse).toBe(true);
      expect(images.find((i) => i.imageId === 'sha256:bbb')?.inUse).toBe(false);
    });

    it('entfernt ein ungenutztes Image', async () => {
      runtime.seedImage({ imageId: 'sha256:bbb', tag: 'alt/ungenutzt:2' });

      await expect(runtime.removeImage('sha256:bbb')).resolves.toBe(true);
      await expect(runtime.listImages()).resolves.toEqual([]);
    });

    it('lehnt das Entfernen eines benutzten Images ab', async () => {
      runtime.seedImage({ imageId: 'sha256:aaa', tag: 'palantir/testserver:1' });

      await expect(runtime.removeImage('sha256:aaa')).rejects.toMatchObject({
        code: 'RUNTIME_ERROR',
      });
    });

    it('entfernt ein benutztes Image mit force', async () => {
      runtime.seedImage({ imageId: 'sha256:aaa', tag: 'palantir/testserver:1' });

      await expect(runtime.removeImage('sha256:aaa', { force: true })).resolves.toBe(true);
    });
  });
});
