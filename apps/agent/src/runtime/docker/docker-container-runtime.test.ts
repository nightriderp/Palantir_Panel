/**
 * Tests der Docker-Implementierung gegen einen `fetch`-Stub.
 *
 * Damit laesst sich pruefen, **was** die Runtime an den Docker-Socket-Proxy
 * schickt und wie sie dessen Antworten deutet - ohne laufenden Docker-Host
 * (Pflichtenheft §2.5).
 *
 * Der Stub bildet zusaetzlich die **Positivliste des Socket-Proxys** nach
 * (Audit spec-pflichtenheft-05, Massnahme W2-26): `deploy/gamenode/
 * docker-compose.yml` gibt nur noch CONTAINERS, IMAGES, EXEC, EVENTS und POST
 * frei. Jeder Aufruf auf einen anderen Pfad beantwortet der Stub mit HTTP 403 -
 * genau wie der echte Proxy. Damit belegt jeder gruene Test dieser Datei, dass
 * der betroffene Produktivpfad ohne die gesperrten Endpunkte auskommt; ein
 * kuenftiger Aufruf auf `/networks`, `/volumes`, `/info` oder `/_ping` faellt
 * hier sofort auf, statt erst im Betrieb.
 */

import { gzipSync } from 'node:zlib';
import { AGENT_FILE_CHANNEL_MAX_BYTES } from '@palantir/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_FILE_BYTES,
  DockerContainerRuntime,
  ENGINE_RECONNECT_INITIAL_MS,
  ENGINE_RECONNECT_MAX_MS,
  MAX_LISTING_ENTRIES,
} from './docker-container-runtime.js';
import { DockerHttpClient } from './http-client.js';
import { createTar } from './tar.js';
import { type ContainerRuntimeEvent } from '../events.js';
import {
  DEFAULT_GAME_NETWORK,
  PALANTIR_DATA_VOLUME_PATH_LABEL,
  PALANTIR_MANAGED_LABEL,
} from '../hardening.js';
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

/**
 * Die Pfade, die der Docker-Socket-Proxy auf der Gamenode noch durchlaesst.
 *
 * Gegenstueck zu den Schaltern in `deploy/gamenode/docker-compose.yml`:
 * CONTAINERS -> `/containers/*`, IMAGES -> `/images/*`, EXEC -> `/exec/*`,
 * EVENTS -> `/events`. VOLUMES, NETWORKS, INFO und PING stehen auf 0.
 */
export const PROXY_ERLAUBTE_PFADE: readonly RegExp[] = [
  /^\/containers(\/|$)/,
  /^\/images(\/|$)/,
  /^\/exec\//,
  /^\/events$/,
];

let aufrufe: Aufruf[] = [];
let antwortgeber: Antwortgeber;

/** HTTP 403 wie vom Socket-Proxy, wenn die Ressourcengruppe gesperrt ist. */
function verboten(): Response {
  return new Response(JSON.stringify({ message: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

const stubFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const url = new URL(input);
  const koerper = init?.body;
  aufrufe.push({
    method: init?.method ?? 'GET',
    pfad: url.pathname,
    query: url.searchParams,
    body: typeof koerper === 'string' ? koerper : undefined,
  });
  // Sperre des Proxys vor dem Antwortgeber: Ein Test kann sie nicht versehentlich
  // umgehen, indem er auf jeden Pfad antwortet.
  if (!PROXY_ERLAUBTE_PFADE.some((muster) => muster.test(url.pathname))) {
    return verboten();
  }
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
        // Eigenes Netz mit Egress-Regeln statt `bridge` (security-matrix-02).
        NetworkMode: DEFAULT_GAME_NETWORK,
      },
    });
  });

  it('legt den Container im Netz palantir-games an, nicht im Standardnetz', async () => {
    antwortgeber = () => json({ Id: 'c-1', Warnings: [] });

    await runtime.create(spec());

    const gesendet = JSON.parse(aufrufe[0]?.body ?? '{}') as {
      HostConfig?: { NetworkMode?: string };
    };
    expect(gesendet.HostConfig?.NetworkMode).toBe('palantir-games');
    expect(gesendet.HostConfig?.NetworkMode).not.toBe('bridge');
  });

  it('holt ein fehlendes Image und legt danach an (Gefundener Punkt 111)', async () => {
    // Erst 404 („kein solches Image"), dann der Zug, dann der zweite Versuch.
    antwortgeber = (aufruf) => {
      if (aufruf.pfad.startsWith('/images/create')) {
        return new Response('{"status":"Pull complete"}', { status: 200 });
      }

      return aufrufe.filter((a) => a.pfad.startsWith('/containers/create')).length === 1
        ? json({ message: 'No such image: palantir/testserver:1' }, 404)
        : json({ Id: 'c-1', Warnings: [] });
    };

    const handle = await runtime.create(spec());

    expect(handle.containerId).toBe('c-1');
    expect(aufrufe.map((a) => a.pfad.split('?')[0])).toEqual([
      '/containers/create',
      '/images/create',
      '/containers/create',
    ]);
  });

  it('meldet einen gescheiterten Zug, statt es zweimal vergeblich zu versuchen', async () => {
    antwortgeber = (aufruf) =>
      aufruf.pfad.startsWith('/images/create')
        ? new Response('{"error":"manifest unknown"}', { status: 200 })
        : json({ message: 'No such image: palantir/testserver:1' }, 404);

    await expect(runtime.create(spec())).rejects.toMatchObject({ code: 'IMAGE_NOT_FOUND' });

    // Kein zweiter Anlege-Versuch, nachdem der Zug gescheitert ist.
    expect(aufrufe.filter((a) => a.pfad.startsWith('/containers/create'))).toHaveLength(1);
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

describe('Adresse im Spielenetz (Fundpunkt 188)', () => {
  it('liest die Adresse des Containers im genannten Netz aus dem Inspect', async () => {
    antwortgeber = () =>
      json({
        Id: 'c-1',
        State: { Status: 'running' },
        NetworkSettings: {
          Networks: {
            'palantir-games': { IPAddress: '172.31.240.7' },
          },
        },
      });

    expect(await runtime.networkAddress('c-1', 'palantir-games')).toBe('172.31.240.7');
    expect(aufrufe[0]).toMatchObject({ method: 'GET', pfad: '/containers/c-1/json' });
  });

  it('kennt keine Adresse, wenn der Container nicht in diesem Netz haengt', async () => {
    antwortgeber = () =>
      json({
        Id: 'c-1',
        NetworkSettings: { Networks: { bridge: { IPAddress: '172.17.0.5' } } },
      });

    expect(await runtime.networkAddress('c-1', 'palantir-games')).toBeNull();
  });

  it('wertet die leere Adresse eines gestoppten Containers als „keine“', async () => {
    antwortgeber = () =>
      json({
        Id: 'c-1',
        State: { Status: 'exited' },
        NetworkSettings: { Networks: { 'palantir-games': { IPAddress: '' } } },
      });

    expect(await runtime.networkAddress('c-1', 'palantir-games')).toBeNull();
  });

  it('meldet einen verschwundenen Container als „keine Adresse“, nicht als Fehler', async () => {
    antwortgeber = () => json({ message: 'No such container' }, 404);

    expect(await runtime.networkAddress('c-weg', 'palantir-games')).toBeNull();
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

  it('meldet einen gestoppten Container als CONTAINER_NOT_RUNNING (Fundpunkt 235)', async () => {
    /*
     * Der Vertrag (`container-runtime.conformance.ts`, EXEC_CONSOLE) verlangt
     * genau diesen Code, und die Fake-Fassung hielt ihn ein. Die Docker-Fassung
     * prueft den Laufzustand nicht selbst - sie deutet die Antwort der Engine,
     * und die lautet 409 mit „is not running". Bis hierher wurde daraus ein
     * `CONTAINER_STATE_CONFLICT`: im Panel ein Zustandsfehler ohne Aussage,
     * statt „der Server laeuft nicht".
     */
    antwortgeber = () => json({ message: 'Container 0123456789ab is not running' }, 409);

    await expect(runtime.execConsole('c-1', ['rcon-cli', 'list'])).rejects.toMatchObject({
      code: 'CONTAINER_NOT_RUNNING',
    });
  });

  it('bleibt bei einem echten Zustandskonflikt beim bisherigen Code', async () => {
    // Gegenprobe zur Zeile darueber: Nicht jede 409 ist ein nicht laufender
    // Container - sonst verschwaende die Unterscheidung wieder.
    antwortgeber = () => json({ message: 'container is marked for removal' }, 409);

    await expect(runtime.execConsole('c-1', ['rcon-cli', 'list'])).rejects.toMatchObject({
      code: 'CONTAINER_STATE_CONFLICT',
    });
  });

  it('meldet einen unbekannten Container als CONTAINER_NOT_FOUND', async () => {
    antwortgeber = () => json({ message: 'No such container: c-9' }, 404);

    await expect(runtime.execConsole('c-9', ['rcon-cli', 'list'])).rejects.toMatchObject({
      code: 'CONTAINER_NOT_FOUND',
    });
  });
});

describe('Kanal-Grenze (Audit contracts-validation-12)', () => {
  it('nimmt die Datei-Grenze aus dem Vertrag', () => {
    /*
     * Backend und Agent muessen dieselbe Zahl kennen: Das Backend puffert nichts
     * Groesseres, der Agent lehnt Groesseres mit AGENT_FILE_TOO_LARGE ab. Vorher
     * stand die 64 MiB auf beiden Seiten als eigenes Literal, verbunden nur
     * durch einen Kommentar. Das Gegenstueck steht in
     * `apps/backend/.../files.test.ts`.
     */
    expect(DEFAULT_MAX_FILE_BYTES).toBe(AGENT_FILE_CHANNEL_MAX_BYTES);
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

  it('listet auch einen Datenordner, der groesser ist als der Arbeitsspeicher-Vorrat', async () => {
    /*
     * Fundpunkt 274, der Fall aus dem Betrieb: Ein Spielserver unter Proton
     * legt Wine-Prefix und SteamCMD-Kopie in den Datenordner - zusammen leicht
     * ein Gigabyte. Die Engine packt beim Auflisten rekursiv **mit Inhalten**
     * ein; wurde das Archiv erst gesammelt, scheiterte es an der Grenze von
     * 128 MiB, und der Datei-Manager meldete nur noch, der Befehl sei
     * fehlgeschlagen.
     *
     * Der Koerper entsteht hier haeppchenweise, damit der Test nicht selbst
     * anlegt, was er verhindern soll.
     */
    const kopfteil = createTar([
      { name: 'data/configuration.json', content: Buffer.from('{}') },
      { name: 'data/.palantir', content: Buffer.alloc(0), type: 'directory' },
      { name: 'data/.palantir/proton/gross.bin', content: Buffer.alloc(0) },
    ]);
    const fuellung = 300 * 1024 * 1024;

    antwortgeber = mitDatenVolume(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(steuerung) {
              steuerung.enqueue(kopfteil);
              // Der Prefix: viele Bytes, die niemanden interessieren.
              for (let uebrig = fuellung; uebrig > 0; uebrig -= 1024 * 1024) {
                steuerung.enqueue(Buffer.alloc(Math.min(1024 * 1024, uebrig), 0x5a));
              }
              steuerung.close();
            },
          }),
        ),
    );

    const eintraege = await runtime.listFiles('c-1', '/data');

    expect(eintraege.map((eintrag) => eintrag.name)).toEqual(['.palantir', 'configuration.json']);
  });

  it('schneidet eine Auflistung ab, statt unbegrenzt zu sammeln', async () => {
    // Nicht die Groesse der Dateien ist die verbliebene Gefahr, sondern die
    // Zahl der Namen: Die landen als Liste im Speicher und gehen ans Panel.
    const viele = Array.from({ length: MAX_LISTING_ENTRIES + 50 }, (_, nummer) => ({
      name: `data/datei-${nummer}.txt`,
      content: Buffer.alloc(0),
    }));

    antwortgeber = mitDatenVolume(() => new Response(createTar(viele)));

    const eintraege = await runtime.listFiles('c-1', '/data');

    expect(eintraege).toHaveLength(MAX_LISTING_ENTRIES);
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

  it('liest nicht, wenn die Engine keinen verwertbaren Stat-Kopf liefert', async () => {
    // Audit agent-runtime-06: Frueher galt die Groesse dann als 0, die Pruefung
    // ging durch und `requestBuffer` lud das ganze Archiv ohne Grenze in den
    // Speicher. Jetzt faellt der Zugriff geschlossen.
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    await expect(runtime.readFile('c-1', '/data/ohne-stat.bin')).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    expect(archivAufruf()?.method).toBe('HEAD');
    expect(
      aufrufe.some((aufruf) => aufruf.method === 'GET' && aufruf.pfad.endsWith('/archive')),
    ).toBe(false);
  });

  it('entpackt ein Archiv oberhalb der Datei-Grenze', async () => {
    /*
     * Audit agent-runtime-02: `extractArchive` hing an derselben Grenze wie der
     * Datei-Editor (64 MiB). Damit scheiterte genau der Fall am letzten Block,
     * fuer den die blockweise Uebertragung gebaut wurde - ein gewachsener
     * Weltordner. Hier steht die Datei-Grenze bewusst winzig.
     */
    await runtime.dispose();
    runtime = new DockerContainerRuntime({
      client: new DockerHttpClient({ baseUrl: PROXY_URL, fetchImpl: stubFetch }),
      hardening: { allowedHostRoots: [DATEN_WURZEL] },
      onStreamError: () => undefined,
      maxFileBytes: 16,
    });
    aufrufe = [];
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    const archiv = gzipSync(createTar([{ name: 'welt/level.dat', content: Buffer.alloc(512, 7) }]));
    expect(archiv.byteLength).toBeGreaterThan(16);

    const ergebnis = await runtime.extractArchive('c-1', '', archiv, 'tar.gz');

    expect(ergebnis.fileCount).toBe(1);
    expect(aufrufe.some((aufruf) => aufruf.method === 'PUT')).toBe(true);
  });

  it('lehnt ein Archiv oberhalb der Archiv-Grenze ab, ohne es zu lesen', async () => {
    await runtime.dispose();
    runtime = new DockerContainerRuntime({
      client: new DockerHttpClient({ baseUrl: PROXY_URL, fetchImpl: stubFetch }),
      hardening: { allowedHostRoots: [DATEN_WURZEL] },
      onStreamError: () => undefined,
      maxArchiveBytes: 32,
    });
    aufrufe = [];
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    const archiv = gzipSync(createTar([{ name: 'welt/level.dat', content: Buffer.alloc(512, 7) }]));

    await expect(runtime.extractArchive('c-1', '', archiv, 'tar.gz')).rejects.toMatchObject({
      code: 'ARCHIVE_TOO_LARGE',
    });
    expect(aufrufe.some((aufruf) => aufruf.method === 'PUT')).toBe(false);
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

  it('sperrt den Upload auf das Datenvolume ein', async () => {
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    await expect(
      runtime.uploadFile('c-1', '/etc/cron.d/palantir', Buffer.from('x')),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(archivAufruf()).toBeUndefined();
  });

  it('nennt Container- und Host-Pfad des Datenordners', async () => {
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/containers/c-1/json') {
        return json({
          Id: 'c-1',
          Config: { Labels: { [PALANTIR_DATA_VOLUME_PATH_LABEL]: '/data' } },
          Mounts: [
            { Source: '/srv/palantir/anderes', Destination: '/backup' },
            { Source: '/srv/palantir/data/srv-1/', Destination: '/data' },
          ],
        });
      }
      return new Response(null, { status: 200 });
    };

    await expect(runtime.dataVolumePaths('c-1')).resolves.toEqual({
      containerPath: '/data',
      hostPath: '/srv/palantir/data/srv-1',
    });
  });

  it('meldet einen Container ohne passenden Mount', async () => {
    // Ohne Bind-Mount gibt es keinen Host-Pfad – dann darf host-seitig auch
    // nichts geloescht werden (Gefundener Punkt 105).
    antwortgeber = mitDatenVolume(() => new Response(null, { status: 200 }));

    await expect(runtime.dataVolumePaths('c-1')).rejects.toMatchObject({ code: 'INVALID_PATH' });
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

  afterEach(async () => {
    // Erst trennen, dann den Strom schliessen: Sonst plant das Ende des Stroms
    // noch einen Wiederaufbau, der in den naechsten Test hineinlaeuft.
    await runtime.dispose();
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

describe('Engine-Events: Wiederaufbau nach Abbruch', () => {
  let stroeme: ReturnType<typeof steuerbarerStream>[];
  let events: ContainerRuntimeEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    stroeme = [];
    events = [];
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/events') {
        const strom = steuerbarerStream();
        stroeme.push(strom);
        return strom.antwort;
      }
      if (aufruf.pfad === '/containers/json') return json([{ Id: 'c-1' }]);
      if (aufruf.pfad === '/containers/c-1/json') {
        return json({
          Id: 'c-1',
          Name: '/palantir-srv-1',
          Config: { Image: 'palantir/testserver:1' },
          State: {
            Status: 'exited',
            ExitCode: 1,
            StartedAt: '2026-08-26T10:00:00Z',
            FinishedAt: '2026-08-26T11:00:00Z',
          },
        });
      }
      return new Response(null, { status: 204 });
    };
  });

  afterEach(async () => {
    await runtime.dispose();
    for (const strom of stroeme) {
      try {
        strom.close();
      } catch {
        // Schon geschlossen - der Test hat den Abbruch selbst ausgeloest.
      }
    }
    vi.useRealTimers();
  });

  /** Laesst Leseschleifen und faellige Timer zum Zug kommen. */
  async function warte(ms: number): Promise<void> {
    for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(0);
  }

  function eventAufrufe(): number {
    return aufrufe.filter((aufruf) => aufruf.pfad === '/events').length;
  }

  it('oeffnet /events nach einem Abbruch erneut und gleicht den Zustand ab', async () => {
    // Audit agent-runtime-04: Ohne Wiederaufbau versiegen STATUS_CHANGED und
    // CRASHED dauerhaft - ein Absturz bliebe bis zum Agent-Neustart unsichtbar.
    await runtime.connect();
    runtime.on((event) => events.push(event));

    // Der Docker-Socket-Proxy startet neu: Der Strom endet.
    stroeme[0]?.close();
    await warte(ENGINE_RECONNECT_INITIAL_MS);

    expect(eventAufrufe()).toBe(2);
    // Was in der Luecke passiert ist, kommt nicht nach - deshalb einmal Ist-Abgleich.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'STATUS_CHANGED',
        containerId: 'c-1',
        status: 'exited',
        exitCode: 1,
      }),
    );
  });

  it('wartet zwischen zwei Fehlversuchen laenger', async () => {
    await runtime.connect();

    // Der Wiederaufbau selbst scheitert: /events antwortet nicht mehr.
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/events') throw new Error('ECONNREFUSED');
      return new Response(null, { status: 204 });
    };

    stroeme[0]?.close();
    await warte(ENGINE_RECONNECT_INITIAL_MS);
    expect(eventAufrufe()).toBe(2);

    // Der naechste Versuch kommt erst nach der doppelten Wartezeit.
    await warte(ENGINE_RECONNECT_INITIAL_MS);
    expect(eventAufrufe()).toBe(2);

    await warte(ENGINE_RECONNECT_INITIAL_MS);
    expect(eventAufrufe()).toBe(3);
  });

  it('baut nach dispose() nicht mehr auf', async () => {
    await runtime.connect();
    await runtime.dispose();

    await warte(ENGINE_RECONNECT_MAX_MS);

    expect(eventAufrufe()).toBe(1);
  });
});

describe('Erwarteter Stopp (Unterdrueckung von CRASHED)', () => {
  let engineStream: ReturnType<typeof steuerbarerStream>;
  let events: ContainerRuntimeEvent[];
  let stopStatus: number;

  beforeEach(async () => {
    engineStream = steuerbarerStream();
    events = [];
    stopStatus = 204;
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/events') return engineStream.antwort;
      if (aufruf.pfad === '/containers/c-1/stop') return new Response(null, { status: stopStatus });
      return new Response(null, { status: 204 });
    };

    await runtime.connect();
    runtime.on((event) => events.push(event));
  });

  afterEach(async () => {
    // Erst trennen, dann den Strom schliessen: Sonst plant das Ende des Stroms
    // noch einen Wiederaufbau, der in den naechsten Test hineinlaeuft.
    await runtime.dispose();
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

  it('meldet einen spaeteren Absturz, wenn der Container schon gestoppt war', async () => {
    // Audit agent-runtime-03: Auf 304 ("war schon gestoppt") folgt kein `die`.
    // Blieb das Merkmal liegen, verschluckte es den naechsten echten Absturz.
    stopStatus = 304;
    await runtime.stop('c-1');

    sendeEvent('start');
    await tick();
    sendeEvent('die', { exitCode: '1' });
    await tick();

    expect(events.filter((event) => event.type === 'CRASHED')).toHaveLength(1);
  });

  it('meldet einen spaeteren Absturz, wenn das Stoppen fehlschlaegt', async () => {
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/events') return engineStream.antwort;
      if (aufruf.pfad === '/containers/c-1/stop') return new Response('kaputt', { status: 500 });
      return new Response(null, { status: 204 });
    };

    await expect(runtime.stop('c-1')).rejects.toThrow();

    sendeEvent('start');
    await tick();
    sendeEvent('die', { exitCode: '1' });
    await tick();

    expect(events.filter((event) => event.type === 'CRASHED')).toHaveLength(1);
  });

  it('vergisst den erwarteten Stopp, sobald der Container wieder laeuft', async () => {
    // restart() auf einen gestoppten Container: kein `die`, nur `start`.
    await runtime.restart('c-1');

    sendeEvent('start');
    await tick();
    sendeEvent('die', { exitCode: '137' });
    await tick();

    expect(events.filter((event) => event.type === 'CRASHED')).toHaveLength(1);
  });
});

describe('DELETE: Zustand nur bei Erfolg freigeben', () => {
  let engineStream: ReturnType<typeof steuerbarerStream>;
  let events: ContainerRuntimeEvent[];
  let deleteStatus: number;

  beforeEach(async () => {
    engineStream = steuerbarerStream();
    events = [];
    deleteStatus = 204;
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/events') return engineStream.antwort;
      if (aufruf.method === 'DELETE') {
        return new Response(deleteStatus === 204 ? null : 'laeuft noch', { status: deleteStatus });
      }
      return new Response(null, { status: 204 });
    };

    await runtime.connect();
    runtime.on((event) => events.push(event));
  });

  afterEach(async () => {
    // Erst trennen, dann den Strom schliessen: Sonst plant das Ende des Stroms
    // noch einen Wiederaufbau, der in den naechsten Test hineinlaeuft.
    await runtime.dispose();
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

  it('behaelt Abos und gemerkten Zustand, wenn das Entfernen scheitert', async () => {
    // Audit agent-runtime-05: 409 heisst "laeuft noch". Wuerde hier aufgeraeumt,
    // waeren Konsole und Messwerte still abgeschaltet, und der naechste
    // Statuswechsel kaeme mit previousStatus null an, als sei der Container neu.
    const unwatch = vi.spyOn(runtime, 'unwatch');
    deleteStatus = 409;
    sendeEvent('start');
    await tick();

    await expect(runtime.remove('c-1')).rejects.toMatchObject({
      code: 'CONTAINER_STATE_CONFLICT',
    });

    expect(unwatch).not.toHaveBeenCalled();

    sendeEvent('die', { exitCode: '0' });
    await tick();

    expect(events.at(-1)).toMatchObject({
      type: 'STATUS_CHANGED',
      status: 'exited',
      previousStatus: 'running',
    });
  });

  it('gibt Abos und gemerkten Zustand nach erfolgreichem Entfernen frei', async () => {
    const unwatch = vi.spyOn(runtime, 'unwatch');
    sendeEvent('start');
    await tick();

    await runtime.remove('c-1');

    expect(unwatch).toHaveBeenCalledWith('c-1');

    // Der gemerkte Status ist weg: Ein Container mit derselben Id waere neu.
    sendeEvent('start');
    await tick();

    expect(events.at(-1)).toMatchObject({
      type: 'STATUS_CHANGED',
      status: 'running',
      previousStatus: null,
    });
  });
});

describe('Socket-Proxy-Positivliste (spec-pflichtenheft-05)', () => {
  /**
   * Die Gegenprobe: Der Stub bildet die Sperre nur dann glaubwuerdig nach, wenn
   * ein gesperrter Endpunkt auch wirklich scheitert. Ohne diesen Test koennte
   * die Positivliste stillschweigend jeden Pfad durchlassen und alle anderen
   * Tests waeren trotzdem gruen.
   */
  it('beantwortet gesperrte Endpunkte mit einem Fehler', async () => {
    const client = new DockerHttpClient({ baseUrl: PROXY_URL, fetchImpl: stubFetch });

    for (const pfad of ['/networks/create', '/volumes/prune', '/info', '/_ping']) {
      await expect(client.requestJson('POST', pfad)).rejects.toMatchObject({
        name: 'ContainerRuntimeError',
        code: 'RUNTIME_ERROR',
      });
    }

    expect(aufrufe.map((aufruf) => aufruf.pfad)).toEqual([
      '/networks/create',
      '/volumes/prune',
      '/info',
      '/_ping',
    ]);
  });

  it('kommt fuer den gesamten Server-Lebenszyklus ohne gesperrte Endpunkte aus', async () => {
    antwortgeber = (aufruf) => {
      if (aufruf.pfad === '/containers/create') return json({ Id: 'c-1', Warnings: [] });
      if (aufruf.pfad === '/containers/json') return json([{ Id: 'c-1' }]);
      if (aufruf.pfad === '/images/json') return json([]);
      if (aufruf.pfad === '/containers/c-1/exec') return json({ Id: 'exec-1' });
      if (aufruf.pfad === '/exec/exec-1/start') return new Response(dockerRahmen(1, 'ok'));
      if (aufruf.pfad === '/exec/exec-1/json') return json({ ExitCode: 0 });
      if (aufruf.pfad === '/containers/c-1/stats') {
        return json({
          cpu_stats: { cpu_usage: { total_usage: 2 }, system_cpu_usage: 20, online_cpus: 1 },
          precpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 10 },
          memory_stats: { usage: 100, limit: 1000 },
          pids_stats: { current: 4 },
        });
      }
      if (aufruf.pfad === '/containers/c-1/logs') return new Response(dockerRahmen(1, 'Zeile\n'));
      if (aufruf.pfad === '/containers/c-1/json') {
        return json({
          Id: 'c-1',
          State: { Status: 'running', ExitCode: 0 },
          Config: { Labels: { [PALANTIR_DATA_VOLUME_PATH_LABEL]: '/data' } },
        });
      }
      return json({});
    };

    // Ein durchgaengiger Lebenszyklus: anlegen, starten, abfragen, Konsole,
    // Logs, Statistik, stoppen, entfernen - dazu der Ereignisstrom aus connect().
    await runtime.connect();
    await runtime.create(spec());
    await runtime.start('c-1');
    await runtime.inspect('c-1');
    await runtime.list();
    await runtime.listImages();
    await runtime.getStats('c-1');
    await runtime.getLogs('c-1', { tail: 10 });
    await runtime.execConsole('c-1', ['rcon-cli', 'list']);
    await runtime.stop('c-1');
    await runtime.remove('c-1');
    await runtime.removeImage('sha256:aaa', { force: true });

    expect(aufrufe.length).toBeGreaterThan(10);
    const nichtErlaubt = aufrufe
      .map((aufruf) => aufruf.pfad)
      .filter((pfad) => !PROXY_ERLAUBTE_PFADE.some((muster) => muster.test(pfad)));
    expect(nichtErlaubt).toEqual([]);
  });
});
