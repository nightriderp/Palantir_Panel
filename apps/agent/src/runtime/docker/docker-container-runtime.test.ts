/**
 * Tests der Docker-Implementierung gegen einen `fetch`-Stub.
 *
 * Damit laesst sich pruefen, **was** die Runtime an den Docker-Socket-Proxy
 * schickt und wie sie dessen Antworten deutet - ohne laufenden Docker-Host
 * (Pflichtenheft §2.5).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DockerContainerRuntime } from './docker-container-runtime.js';
import { DockerHttpClient } from './http-client.js';
import { createTar } from './tar.js';
import { type ContainerRuntimeEvent } from '../events.js';
import { PALANTIR_DATA_VOLUME_PATH_LABEL, PALANTIR_MANAGED_LABEL } from '../hardening.js';
import { type ContainerSpec } from '../types.js';

const PROXY_URL = 'http://127.0.0.1:2375';
const DATEN_WURZEL = '/srv/palantir/servers';

interface Aufruf {
  readonly method: string;
  readonly pfad: string;
  readonly query: URLSearchParams;
  readonly body: string | undefined;
}

type Antwortgeber = (aufruf: Aufruf) => Response | Promise<Response>;

let aufrufe: Aufruf[] = [];
let antwortgeber: Antwortgeber;

const stubFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const url = new URL(input);
  const koerper = init?.body;
  aufrufe.push({
    method: init?.method ?? 'GET',
    pfad: url.pathname,
    query: url.searchParams,
    body: typeof koerper === 'string' ? koerper : undefined,
  });
  return antwortgeber(aufrufe[aufrufe.length - 1] as Aufruf);
};

function json(daten: unknown, status = 200): Response {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Stream, in den ein Test von aussen Zeilen schieben kann. */
function steuerbarerStream(): {
  antwort: Response;
  push: (text: string) => void;
  close: () => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    antwort: new Response(readable),
    push: (text) => controller?.enqueue(new TextEncoder().encode(text)),
    close: () => controller?.close(),
  };
}

function dockerRahmen(streamTyp: 1 | 2, text: string): Buffer {
  const nutzlast = Buffer.from(text, 'utf8');
  const kopf = Buffer.alloc(8);
  kopf.writeUInt8(streamTyp, 0);
  kopf.writeUInt32BE(nutzlast.length, 4);
  return Buffer.concat([kopf, nutzlast]);
}

function spec(ueberschreibung: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    name: 'palantir-srv-1',
    image: 'palantir/testserver:1',
    env: { EULA: 'true' },
    ports: [{ containerPort: 25565, hostPort: 30001, protocol: 'tcp' }],
    resources: { memoryMb: 1024, cpuCores: 1 },
    dataVolume: { hostPath: `${DATEN_WURZEL}/srv-1`, containerPath: '/data' },
    ...ueberschreibung,
  };
}

function baueRuntime(): DockerContainerRuntime {
  return new DockerContainerRuntime({
    client: new DockerHttpClient({ baseUrl: PROXY_URL, fetchImpl: stubFetch }),
    hardening: { allowedHostRoots: [DATEN_WURZEL] },
    onStreamError: () => undefined,
  });
}

/** Laesst die Ereignisschleife weiterlaufen, damit Hintergrund-Streams zum Zug kommen. */
async function tick(runden = 3): Promise<void> {
  for (let i = 0; i < runden; i += 1) await new Promise((fertig) => setImmediate(fertig));
}

let runtime: DockerContainerRuntime;

beforeEach(() => {
  aufrufe = [];
  antwortgeber = () => json({});
  runtime = baueRuntime();
});

afterEach(async () => {
  await runtime.dispose();
});

describe('CREATE', () => {
  it('schickt das gehaertete Payload an den Docker-Socket-Proxy', async () => {
    antwortgeber = () => json({ Id: 'c-1', Warnings: [] });

    const handle = await runtime.create(spec());

    expect(handle).toEqual({ containerId: 'c-1', name: 'palantir-srv-1', warnings: [] });

    const aufruf = aufrufe[0];
    expect(aufruf?.method).toBe('POST');
    expect(aufruf?.pfad).toBe('/containers/create');
    expect(aufruf?.query.get('name')).toBe('palantir-srv-1');

    const gesendet = JSON.parse(aufruf?.body ?? '{}') as Record<string, never>;
    expect(gesendet).toMatchObject({
      Image: 'palantir/testserver:1',
      Env: ['EULA=true'],
      Labels: { [PALANTIR_MANAGED_LABEL]: 'true' },
      HostConfig: {
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        Privileged: false,
        ReadonlyRootfs: true,
        Memory: 1024 * 1024 * 1024,
        MemorySwap: 1024 * 1024 * 1024,
        NanoCpus: 1_000_000_000,
        RestartPolicy: { Name: 'no' },
        Binds: [`${DATEN_WURZEL}/srv-1:/data:rw`],
      },
    });
  });

  it('deutet 404 beim Anlegen als fehlendes Image', async () => {
    antwortgeber = () => json({ message: 'No such image: palantir/testserver:1' }, 404);

    await expect(runtime.create(spec())).rejects.toMatchObject({ code: 'IMAGE_NOT_FOUND' });
  });

  it('deutet 409 mit Namenskonflikt als CONTAINER_NAME_CONFLICT', async () => {
    antwortgeber = () =>
      json({ message: 'Conflict. The container name "/palantir-srv-1" is already in use' }, 409);

    await expect(runtime.create(spec())).rejects.toMatchObject({
      code: 'CONTAINER_NAME_CONFLICT',
    });
  });

  it('laesst einen ungueltigen Spec gar nicht erst zur Engine durch', async () => {
    await expect(
      runtime.create(spec({ dataVolume: { hostPath: '/etc', containerPath: '/data' } })),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });

    expect(aufrufe).toEqual([]);
  });

  it('meldet einen nicht erreichbaren Proxy als RUNTIME_UNAVAILABLE', async () => {
    antwortgeber = () => {
      throw new Error('ECONNREFUSED');
    };

    await expect(runtime.create(spec())).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  });
});

describe('START / STOP / RESTART / DELETE', () => {
  it('startet ueber den passenden Endpunkt', async () => {
    antwortgeber = () => new Response(null, { status: 204 });
    await runtime.start('c-1');

    expect(aufrufe[0]).toMatchObject({ method: 'POST', pfad: '/containers/c-1/start' });
  });

  it('wertet 304 beim Start als Erfolg (Container laeuft bereits)', async () => {
    antwortgeber = () => new Response(null, { status: 304 });
    await expect(runtime.start('c-1')).resolves.toBeUndefined();
  });

  it('gibt die Kulanzzeit beim Stoppen mit', async () => {
    antwortgeber = () => new Response(null, { status: 204 });
    await runtime.stop('c-1', { timeoutSeconds: 45 });

    expect(aufrufe[0]?.pfad).toBe('/containers/c-1/stop');
    expect(aufrufe[0]?.query.get('t')).toBe('45');
  });

  it('entfernt ohne Volumes und ohne force, solange nichts anderes verlangt ist', async () => {
    antwortgeber = () => new Response(null, { status: 204 });
    await runtime.remove('c-1');

    expect(aufrufe[0]).toMatchObject({ method: 'DELETE', pfad: '/containers/c-1' });
    expect(aufrufe[0]?.query.get('v')).toBe('false');
    expect(aufrufe[0]?.query.get('force')).toBe('false');
  });
});

describe('Ist-Zustand', () => {
  it('filtert die Liste auf von Palantir verwaltete Container und inspiziert jeden', async () => {
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/containers/json') return json([{ Id: 'c-1' }]);
      return json({
        Id: 'c-1',
        Name: '/palantir-srv-1',
        Config: { Image: 'palantir/testserver:1' },
        State: {
          Status: 'running',
          StartedAt: '2026-08-26T10:00:00Z',
          FinishedAt: '0001-01-01T00:00:00Z',
        },
      });
    };

    const zustaende = await runtime.list();

    const filter = JSON.parse(aufrufe[0]?.query.get('filters') ?? '{}') as { label?: string[] };
    expect(filter.label).toEqual([`${PALANTIR_MANAGED_LABEL}=true`]);
    expect(zustaende).toHaveLength(1);
    expect(zustaende[0]).toMatchObject({
      containerId: 'c-1',
      name: 'palantir-srv-1',
      status: 'running',
    });
  });
});

describe('Images (Pflichtenheft §16, Ergaenzung aus A3)', () => {
  it('liest die Imageliste und bestimmt den Nutzungsstatus aus allen Containern', async () => {
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/images/json') {
        return json([
          {
            Id: 'sha256:aaa',
            RepoTags: ['palantir/testserver:1'],
            Size: 120,
            Created: 1_767_225_600,
          },
          { Id: 'sha256:bbb', RepoTags: ['<none>:<none>'], Size: 80, Created: 1_767_225_600 },
        ]);
      }
      if (aufruf.pfad === '/containers/json') {
        return json([{ Image: 'palantir/testserver:1', ImageID: 'sha256:aaa' }]);
      }
      return json({});
    };

    const images = await runtime.listImages();

    expect(images).toEqual([
      {
        imageId: 'sha256:aaa',
        tag: 'palantir/testserver:1',
        sizeBytes: 120,
        createdAt: new Date(1_767_225_600 * 1000).toISOString(),
        inUse: true,
      },
      {
        imageId: 'sha256:bbb',
        tag: null,
        sizeBytes: 80,
        createdAt: new Date(1_767_225_600 * 1000).toISOString(),
        inUse: false,
      },
    ]);
  });

  it('fragt fuer den Nutzungsstatus alle Container ab, nicht nur die von Palantir', async () => {
    // Ein Image, das ein fremder Container benutzt, darf der Storage-Explorer
    // nicht als ungenutzt anbieten.
    antwortgeber = (aufruf) => (aufruf.pfad === '/images/json' ? json([]) : json([]));

    await runtime.listImages();

    const containerAufruf = aufrufe.find((a) => a.pfad === '/containers/json');
    expect(containerAufruf?.query.get('all')).toBe('true');
    expect(containerAufruf?.query.get('filters')).toBeNull();
  });

  it('entfernt ein Image ueber den Socket-Proxy', async () => {
    antwortgeber = () => new Response(null, { status: 200 });

    await expect(runtime.removeImage('sha256:bbb')).resolves.toBe(true);

    const aufruf = aufrufe[0];
    expect(aufruf?.method).toBe('DELETE');
    expect(aufruf?.pfad).toBe('/images/sha256%3Abbb');
  });

  it('meldet ein bereits fehlendes Image als "nichts entfernt"', async () => {
    // Idempotenz wie bei DELETE_BACKUP (Lastenheft §3.8).
    antwortgeber = () => json({ message: 'no such image' }, 404);

    await expect(runtime.removeImage('sha256:weg')).resolves.toBe(false);
  });

  it('reicht einen Konflikt der Engine als benannten Fehler durch', async () => {
    // 409 heisst hier "Image wird noch benutzt". Der Client bildet das bereits
    // auf CONTAINER_STATE_CONFLICT ab; der Adapter macht daraus
    // AGENT_CONTAINER_STATE_CONFLICT statt eines pauschalen COMMAND_FAILED.
    antwortgeber = () => json({ message: 'image is being used' }, 409);

    await expect(runtime.removeImage('sha256:aaa')).rejects.toMatchObject({
      code: 'CONTAINER_STATE_CONFLICT',
    });
  });
});

describe('GET_LOGS', () => {
  it('fordert Zeitstempel an und zerlegt den multiplexten Stream', async () => {
    antwortgeber = () =>
      new Response(
        Buffer.concat([
          dockerRahmen(1, '2026-08-26T10:00:00.000000000Z Server startet\n'),
          dockerRahmen(2, '2026-08-26T10:00:01.000000000Z Warnung\n'),
        ]),
      );

    const zeilen = await runtime.getLogs('c-1', { tail: 50 });

    expect(aufrufe[0]?.query.get('timestamps')).toBe('true');
    expect(aufrufe[0]?.query.get('tail')).toBe('50');
    expect(zeilen).toEqual([
      {
        containerId: 'c-1',
        stream: 'stdout',
        message: 'Server startet',
        timestamp: '2026-08-26T10:00:00.000Z',
      },
      {
        containerId: 'c-1',
        stream: 'stderr',
        message: 'Warnung',
        timestamp: '2026-08-26T10:00:01.000Z',
      },
    ]);
  });
});

describe('GET_STATS', () => {
  it('holt genau eine Messung mit Vorgaengerwert', async () => {
    antwortgeber = () =>
      json({
        read: '2026-08-26T10:00:00Z',
        cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000, online_cpus: 2 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 800 },
        memory_stats: { usage: 1000, limit: 2048, stats: { inactive_file: 200 } },
        pids_stats: { current: 12 },
      });

    const stats = await runtime.getStats('c-1');

    expect(aufrufe[0]?.query.get('stream')).toBe('false');
    expect(stats).toMatchObject({
      containerId: 'c-1',
      cpuPercent: 100,
      memoryUsedBytes: 800,
      pids: 12,
    });
  });
});

describe('EXEC_CONSOLE', () => {
  it('legt einen Exec an, startet ihn und liest den Exit-Code', async () => {
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/containers/c-1/exec') return json({ Id: 'exec-1' });
      if (aufruf.pfad === '/exec/exec-1/start') {
        return new Response(
          Buffer.concat([dockerRahmen(1, 'Spieler: 3'), dockerRahmen(2, 'Hinweis')]),
        );
      }
      return json({ ExitCode: 0 });
    };

    const ergebnis = await runtime.execConsole('c-1', ['rcon-cli', 'list']);

    expect(JSON.parse(aufrufe[0]?.body ?? '{}')).toMatchObject({
      Cmd: ['rcon-cli', 'list'],
      AttachStdin: false,
      Tty: false,
    });
    expect(ergebnis).toEqual({ exitCode: 0, stdout: 'Spieler: 3', stderr: 'Hinweis' });
  });

  it('lehnt einen leeren Befehl ab, ohne die Engine zu behelligen', async () => {
    await expect(runtime.execConsole('c-1', [])).rejects.toBeInstanceOf(Error);
    expect(aufrufe).toEqual([]);
  });
});

describe('Datei-Manager', () => {
  /** Beantwortet den Inspect-Aufruf (Datenvolume-Grenze) und reicht den Rest durch. */
  function mitDatenVolume(
    rest: Antwortgeber,
    containerPath: string | null = '/data',
  ): Antwortgeber {
    return (aufruf) => {
      if (aufruf.pfad === '/containers/c-1/json') {
        const Labels =
          containerPath === null ? {} : { [PALANTIR_DATA_VOLUME_PATH_LABEL]: containerPath };
        return json({ Id: 'c-1', Config: { Labels } });
      }
      return rest(aufruf);
    };
  }

  /** Der einzige `/archive`-Aufruf, unabhaengig vom vorgeschalteten Inspect. */
  function archivAufruf(): Aufruf | undefined {
    return aufrufe.find((aufruf) => aufruf.pfad === '/containers/c-1/archive');
  }

  it('listet nur die direkte Ebene eines Verzeichnisses', async () => {
    antwortgeber = mitDatenVolume(
      () =>
        new Response(
          createTar([
            { name: 'data/server.properties', content: Buffer.from('a') },
            { name: 'data/welt/level.dat', content: Buffer.from('b') },
          ]),
        ),
    );

    const eintraege = await runtime.listFiles('c-1', '/data');

    expect(archivAufruf()?.query.get('path')).toBe('/data');
    expect(eintraege.map((eintrag) => eintrag.name)).toEqual(['server.properties']);
  });

  it('prueft die Groesse per HEAD, bevor eine Datei geladen wird', async () => {
    const stat = Buffer.from(JSON.stringify({ name: 'gross.bin', size: 999_999_999 })).toString(
      'base64',
    );
    antwortgeber = mitDatenVolume(
      () => new Response(null, { status: 200, headers: { 'X-Docker-Container-Path-Stat': stat } }),
    );

    await expect(runtime.readFile('c-1', '/data/gross.bin')).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    // Der Inhalt wurde gar nicht erst angefordert: nur der HEAD auf /archive, kein GET.
    expect(archivAufruf()?.method).toBe('HEAD');
    expect(
      aufrufe.some((aufruf) => aufruf.method === 'GET' && aufruf.pfad.endsWith('/archive')),
    ).toBe(false);
  });

  it('liest eine Datei aus dem TAR-Strom', async () => {
    const stat = Buffer.from(JSON.stringify({ name: 'eula.txt', size: 9 })).toString('base64');
    antwortgeber = mitDatenVolume((aufruf) => {
      if (aufruf.method === 'HEAD') {
        return new Response(null, { headers: { 'X-Docker-Container-Path-Stat': stat } });
      }
      return new Response(createTar([{ name: 'eula.txt', content: Buffer.from('eula=true') }]));
    });

    const inhalt = await runtime.readFile('c-1', '/data/eula.txt');
    expect(inhalt.toString('utf8')).toBe('eula=true');
  });

  it('meldet eine fehlende Datei als FILE_NOT_FOUND', async () => {
    antwortgeber = mitDatenVolume(() => json({ message: 'Could not find the file' }, 404));

    await expect(runtime.readFile('c-1', '/data/fehlt.txt')).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });

  it('laedt beim Schreiben ein TAR in das Zielverzeichnis hoch', async () => {
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    await runtime.writeFile('c-1', '/data/server.properties', Buffer.from('max-players=20'));

    const archiv = archivAufruf();
    expect(archiv?.method).toBe('PUT');
    // Zielangabe ist das Verzeichnis; der Dateiname steckt im Archiv.
    expect(archiv?.query.get('path')).toBe('/data');
  });

  it('sperrt den Datei-Manager auf das Datenvolume ein (absoluter Fremdpfad)', async () => {
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    await expect(runtime.readFile('c-1', '/etc/passwd')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    // Der Ausbruch wird vor jedem Archiv-Zugriff abgefangen.
    expect(archivAufruf()).toBeUndefined();
  });

  it('lehnt einen ueber .. maskierten Ausbruch ab', async () => {
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    await expect(runtime.readFile('c-1', '/data/../etc/passwd')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(archivAufruf()).toBeUndefined();
  });

  it('lehnt relative Ausbruchspfade ab, ohne die Engine zu behelligen', async () => {
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    await expect(runtime.readFile('c-1', '../../etc/shadow')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(archivAufruf()).toBeUndefined();
  });

  it('respektiert ein abweichendes Datenvolume des Spiels', async () => {
    // Der erlaubte Bereich ist pro Spiel verschieden; hier /srv statt /data.
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }), '/srv/game');

    await expect(runtime.readFile('c-1', '/data/server.properties')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(archivAufruf()).toBeUndefined();
  });

  it('lehnt einen Upload auf einen belegten Pfad ohne overwrite ab (AGENT_FILE_EXISTS)', async () => {
    const stat = Buffer.from(JSON.stringify({ name: 'welt.zip', size: 12 })).toString('base64');
    antwortgeber = mitDatenVolume((aufruf) => {
      if (aufruf.method === 'HEAD') {
        return new Response(null, { headers: { 'X-Docker-Container-Path-Stat': stat } });
      }
      return new Response(null, { status: 200 });
    });

    await expect(
      runtime.uploadFile('c-1', '/data/welt.zip', Buffer.from('PK')),
    ).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    // Geschrieben wurde nichts: nur der HEAD, kein PUT.
    expect(aufrufe.some((aufruf) => aufruf.method === 'PUT')).toBe(false);
  });

  it('schreibt den Upload bei belegtem Pfad mit overwrite trotzdem', async () => {
    const stat = Buffer.from(JSON.stringify({ name: 'welt.zip', size: 12 })).toString('base64');
    antwortgeber = mitDatenVolume((aufruf) => {
      if (aufruf.method === 'HEAD') {
        return new Response(null, { headers: { 'X-Docker-Container-Path-Stat': stat } });
      }
      return new Response(null, { status: 200 });
    });

    await runtime.uploadFile('c-1', '/data/welt.zip', Buffer.from('PK'), { overwrite: true });

    expect(aufrufe.some((aufruf) => aufruf.method === 'PUT')).toBe(true);
  });

  it('legt einen Upload auf einen freien Pfad ohne Rueckfrage an', async () => {
    antwortgeber = mitDatenVolume((aufruf) => {
      if (aufruf.method === 'HEAD') return json({ message: 'not found' }, 404);
      return new Response(null, { status: 200 });
    });

    await runtime.uploadFile('c-1', '/data/neu.zip', Buffer.from('PK'));

    const put = aufrufe.find((aufruf) => aufruf.method === 'PUT');
    expect(put?.query.get('path')).toBe('/data');
  });

  it('entfernt eine Datei per rm, ohne eine Shell dazwischen', async () => {
    const stat = Buffer.from(JSON.stringify({ name: 'alt.log', size: 3 })).toString('base64');
    antwortgeber = mitDatenVolume((aufruf) => {
      if (aufruf.method === 'HEAD') {
        return new Response(null, { headers: { 'X-Docker-Container-Path-Stat': stat } });
      }
      if (aufruf.pfad === '/containers/c-1/exec') return json({ Id: 'exec-1' });
      if (aufruf.pfad === '/exec/exec-1/start') return new Response(Buffer.alloc(0));
      return json({ ExitCode: 0 });
    });

    await runtime.deleteFile('c-1', '/data/alt.log');

    const exec = aufrufe.find((aufruf) => aufruf.pfad === '/containers/c-1/exec');
    expect(JSON.parse(exec?.body ?? '{}')).toMatchObject({
      Cmd: ['rm', '-f', '--', '/data/alt.log'],
    });
  });

  it('loescht einen bereits fehlenden Pfad folgenlos (idempotent)', async () => {
    antwortgeber = mitDatenVolume(() => json({ message: 'not found' }, 404));

    await expect(runtime.deleteFile('c-1', '/data/weg.log')).resolves.toBeUndefined();
    expect(aufrufe.some((aufruf) => aufruf.pfad === '/containers/c-1/exec')).toBe(false);
  });

  it('raeumt ein Verzeichnis ohne recursive nur per rmdir ab', async () => {
    // Go-`FileMode` mit gesetztem Verzeichnis-Bit (1 << 31).
    const stat = Buffer.from(JSON.stringify({ name: 'welt', mode: 0x8000_01ed })).toString(
      'base64',
    );
    antwortgeber = mitDatenVolume((aufruf) => {
      if (aufruf.method === 'HEAD') {
        return new Response(null, { headers: { 'X-Docker-Container-Path-Stat': stat } });
      }
      if (aufruf.pfad === '/containers/c-1/exec') return json({ Id: 'exec-1' });
      if (aufruf.pfad === '/exec/exec-1/start') return new Response(Buffer.alloc(0));
      return json({ ExitCode: 0 });
    });

    await runtime.deleteFile('c-1', '/data/welt');

    const exec = aufrufe.find((aufruf) => aufruf.pfad === '/containers/c-1/exec');
    expect(JSON.parse(exec?.body ?? '{}')).toMatchObject({ Cmd: ['rmdir', '/data/welt'] });
  });

  it('meldet einen fehlgeschlagenen rm-Aufruf als Fehler', async () => {
    const stat = Buffer.from(JSON.stringify({ name: 'alt.log', size: 3 })).toString('base64');
    antwortgeber = mitDatenVolume((aufruf) => {
      if (aufruf.method === 'HEAD') {
        return new Response(null, { headers: { 'X-Docker-Container-Path-Stat': stat } });
      }
      if (aufruf.pfad === '/containers/c-1/exec') return json({ Id: 'exec-1' });
      if (aufruf.pfad === '/exec/exec-1/start') return new Response(Buffer.alloc(0));
      return json({ ExitCode: 1 });
    });

    await expect(runtime.deleteFile('c-1', '/data/alt.log')).rejects.toMatchObject({
      code: 'RUNTIME_ERROR',
    });
  });

  it('sperrt auch Loeschen und Upload auf das Datenvolume ein', async () => {
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    await expect(runtime.deleteFile('c-1', '/data/../etc/passwd')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    await expect(
      runtime.uploadFile('c-1', '/etc/cron.d/palantir', Buffer.from('x')),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    // Der Datenordner selbst ist ebenfalls tabu.
    await expect(runtime.deleteFile('c-1', '/data')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(archivAufruf()).toBeUndefined();
  });

  it('faellt geschlossen, wenn das Datenvolume nicht bestimmbar ist', async () => {
    // Container ohne Palantir-Label (fremd oder von Hand angelegt): kein Zugriff.
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }), null);

    await expect(runtime.readFile('c-1', '/data/server.properties')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(archivAufruf()).toBeUndefined();
  });
});

describe('Engine-Events', () => {
  let events: ContainerRuntimeEvent[];
  let engineStream: ReturnType<typeof steuerbarerStream>;

  beforeEach(async () => {
    engineStream = steuerbarerStream();
    events = [];
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/events') return engineStream.antwort;
      return new Response(null, { status: 204 });
    };

    await runtime.connect();
    runtime.on((event) => events.push(event));
  });

  afterEach(() => {
    engineStream.close();
  });

  function sendeEvent(status: string, attribute: Record<string, string> = {}): void {
    engineStream.push(
      `${JSON.stringify({
        status,
        id: 'c-1',
        time: 1_787_000_000,
        Actor: { ID: 'c-1', Attributes: attribute },
      })}\n`,
    );
  }

  it('abonniert nur die von Palantir verwalteten Container', () => {
    const filter = JSON.parse(aufrufe[0]?.query.get('filters') ?? '{}') as {
      type?: string[];
      label?: string[];
    };
    expect(filter.type).toEqual(['container']);
    expect(filter.label).toEqual([`${PALANTIR_MANAGED_LABEL}=true`]);
  });

  it('meldet den Wechsel nach running', async () => {
    sendeEvent('start');
    await tick();

    expect(events).toEqual([
      expect.objectContaining({
        type: 'STATUS_CHANGED',
        containerId: 'c-1',
        status: 'running',
        previousStatus: null,
      }),
    ]);
  });

  it('meldet einen unerwarteten Exit-Code als CRASHED', async () => {
    sendeEvent('start');
    await tick();
    sendeEvent('die', { exitCode: '1' });
    await tick();

    expect(events.map((event) => event.type)).toEqual([
      'STATUS_CHANGED',
      'STATUS_CHANGED',
      'CRASHED',
    ]);
    expect(events[2]).toMatchObject({ type: 'CRASHED', exitCode: 1, oomKilled: false });
  });

  it('meldet ein reguläres STOP nicht als CRASHED', async () => {
    sendeEvent('start');
    await tick();

    await runtime.stop('c-1');
    // Beim Stoppen per SIGTERM meldet die Engine einen Exit-Code ungleich 0.
    sendeEvent('die', { exitCode: '143' });
    await tick();

    expect(events.filter((event) => event.type === 'CRASHED')).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      type: 'STATUS_CHANGED',
      status: 'exited',
      exitCode: 143,
    });
  });

  it('kennzeichnet ein OOM-Kill', async () => {
    sendeEvent('start');
    await tick();
    sendeEvent('oom');
    sendeEvent('die', { exitCode: '137' });
    await tick();

    expect(events.at(-1)).toMatchObject({ type: 'CRASHED', exitCode: 137, oomKilled: true });
  });

  it('meldet ein Ende mit Exit-Code 0 nicht als CRASHED', async () => {
    sendeEvent('start');
    await tick();
    sendeEvent('die', { exitCode: '0' });
    await tick();

    expect(events.filter((event) => event.type === 'CRASHED')).toEqual([]);
  });

  it('unterdrueckt Wiederholungen desselben Zustands', async () => {
    sendeEvent('start');
    sendeEvent('start');
    await tick();

    expect(events.filter((event) => event.type === 'STATUS_CHANGED')).toHaveLength(1);
  });
});
