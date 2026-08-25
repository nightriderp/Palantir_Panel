import { ERROR_CATALOG, isFail, isOk } from '@palantir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ContainerRuntimeError,
  FakeContainerRuntime,
  RUNTIME_ERROR_CODES,
  type ContainerRuntimeErrorCode,
} from '../runtime/index.js';
import { ContainerRuntimeAdapter, RUNTIME_ERROR_TO_API_CODE } from './runtime-adapter.js';
import type { OutboundEvent } from './ports.js';

const SERVER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CORRELATION_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

const CREATE_PAYLOAD = {
  name: `palantir-${SERVER_ID}`,
  image: 'palantir/testserver:1',
  env: { EULA: 'true' },
  ports: [{ containerPort: 25565, hostPort: 30000, protocol: 'tcp' as const }],
  resources: { memoryMb: 2048, cpuCores: 2 },
  dataVolume: { hostPath: `/srv/palantir/servers/${SERVER_ID}`, containerPath: '/data' },
};

let runtime: FakeContainerRuntime;
let adapter: ContainerRuntimeAdapter;
let ereignisse: OutboundEvent[];

beforeEach(async () => {
  runtime = new FakeContainerRuntime();
  ereignisse = [];
  adapter = new ContainerRuntimeAdapter({ runtime });
  await runtime.connect();
});

function befehl(command: string, payload: unknown, serverId: string | null = SERVER_ID) {
  return adapter.execute({
    correlationId: CORRELATION_ID,
    // Die Verbindung hat den Namen bereits gegen das Protokoll geprüft.
    command: command as Parameters<ContainerRuntimeAdapter['execute']>[0]['command'],
    serverId,
    payload,
  });
}

async function containerAnlegen(): Promise<string> {
  const antwort = await befehl('CREATE', CREATE_PAYLOAD);
  if (!isOk(antwort)) {
    throw new Error('CREATE ist fehlgeschlagen');
  }
  return (antwort.data as { containerId: string }).containerId;
}

describe('Befehl → Runtime-Aufruf', () => {
  it('legt einen Container an und liefert die Container-ID zurück', async () => {
    const antwort = await befehl('CREATE', CREATE_PAYLOAD);

    expect(isOk(antwort)).toBe(true);
    const daten = antwort.data as { containerId: string; name: string; warnings: string[] };
    expect(daten.containerId).toBeTruthy();
    expect(daten.name).toBe(CREATE_PAYLOAD.name);
    expect(Array.isArray(daten.warnings)).toBe(true);
  });

  it('gibt die serverId als Label an die Runtime weiter', async () => {
    const containerId = await containerAnlegen();

    // Über das Label kann A2 den Container später zuordnen, ohne den Namen zu
    // zerlegen.
    expect(runtime.getSpec(containerId).serverId).toBe(SERVER_ID);
  });

  it('startet, stoppt und startet neu', async () => {
    const containerId = await containerAnlegen();

    expect(isOk(await befehl('START', { containerId }))).toBe(true);
    expect((await runtime.inspect(containerId)).status).toBe('running');

    expect(isOk(await befehl('STOP', { containerId }))).toBe(true);
    expect((await runtime.inspect(containerId)).status).toBe('exited');

    expect(isOk(await befehl('RESTART', { containerId }))).toBe(true);
    expect((await runtime.inspect(containerId)).status).toBe('running');
  });

  it('entfernt einen Container', async () => {
    const containerId = await containerAnlegen();

    const antwort = await befehl('DELETE', { containerId, force: true });

    expect(isOk(antwort)).toBe(true);
    expect(antwort.data).toBeNull();
    await expect(runtime.inspect(containerId)).rejects.toThrow();
  });

  it('liefert Auslastungswerte', async () => {
    const containerId = await containerAnlegen();
    await befehl('START', { containerId });
    runtime.setStats(containerId, { cpuPercent: 42, memoryUsedBytes: 1024 });

    const antwort = await befehl('GET_STATS', { containerId });

    expect(isOk(antwort)).toBe(true);
    expect(antwort.data).toMatchObject({ containerId, cpuPercent: 42, memoryUsedBytes: 1024 });
  });

  it('liefert Logzeilen im Protokollformat', async () => {
    const containerId = await containerAnlegen();
    await befehl('START', { containerId });
    runtime.appendLog(containerId, 'Server gestartet');

    const antwort = await befehl('GET_LOGS', { containerId, tail: 10 });

    expect(isOk(antwort)).toBe(true);
    const daten = antwort.data as { containerId: string; lines: { message: string }[] };
    expect(daten.containerId).toBe(containerId);
    expect(daten.lines.at(-1)?.message).toBe('Server gestartet');
  });

  it('führt einen Konsolenbefehl aus und gibt die Ausgabe zurück', async () => {
    const containerId = await containerAnlegen();
    await befehl('START', { containerId });
    runtime.setExecHandler(() => ({ exitCode: 0, stdout: 'pong', stderr: '' }));

    const antwort = await befehl('EXEC_CONSOLE', { containerId, command: ['ping'] });

    expect(isOk(antwort)).toBe(true);
    expect(antwort.data).toEqual({ exitCode: 0, stdout: 'pong', stderr: '' });
  });

  it('schreibt und liest eine Datei Base64-kodiert', async () => {
    const containerId = await containerAnlegen();
    await befehl('START', { containerId });
    const inhalt = 'max-players=20';

    const schreiben = await befehl('FILE_WRITE', {
      containerId,
      path: '/data/server.properties',
      contentBase64: Buffer.from(inhalt).toString('base64'),
    });
    expect(isOk(schreiben)).toBe(true);

    const lesen = await befehl('FILE_READ', { containerId, path: '/data/server.properties' });
    expect(isOk(lesen)).toBe(true);
    const daten = lesen.data as { contentBase64: string; sizeBytes: number };
    expect(Buffer.from(daten.contentBase64, 'base64').toString()).toBe(inhalt);
    expect(daten.sizeBytes).toBe(Buffer.byteLength(inhalt));
  });

  it('listet ein Verzeichnis auf', async () => {
    const containerId = await containerAnlegen();
    await befehl('START', { containerId });
    runtime.seedFile(containerId, '/data/eula.txt', Buffer.from('eula=true'));

    const antwort = await befehl('FILE_LIST', { containerId, path: '/data' });

    expect(isOk(antwort)).toBe(true);
    const daten = antwort.data as { path: string; entries: { name: string }[] };
    expect(daten.path).toBe('/data');
    expect(daten.entries.map((e) => e.name)).toContain('eula.txt');
  });
});

describe('Nutzdaten-Prüfung', () => {
  it('lehnt einen Befehl mit fehlender containerId ab, ohne die Runtime zu rufen', async () => {
    const antwort = await befehl('START', {});

    expect(isFail(antwort)).toBe(true);
    expect(antwort.error?.code).toBe('AGENT_COMMAND_INVALID');
  });

  it('lehnt einen CREATE-Spec ohne Ressourcengrenzen ab', async () => {
    const { resources: _weg, ...ohneGrenzen } = CREATE_PAYLOAD;

    const antwort = await befehl('CREATE', ohneGrenzen);

    expect(antwort.error?.code).toBe('AGENT_COMMAND_INVALID');
  });

  it('nennt in der Meldung das beanstandete Feld', async () => {
    const antwort = await befehl('EXEC_CONSOLE', { containerId: 'abc', command: [] });

    expect(antwort.error?.message).toContain('command');
  });
});

describe('Noch nicht gebaute Befehle', () => {
  it.each(['CREATE_BACKUP', 'RESTORE_BACKUP', 'GET_STORAGE_BREAKDOWN'])(
    '%s wird als noch nicht unterstützt gemeldet',
    async (command) => {
      const antwort = await befehl(command, {});

      // Bewusst nicht AGENT_COMMAND_FAILED: Das Backend soll "noch nicht gebaut"
      // von "hat nicht funktioniert" unterscheiden können.
      expect(antwort.error?.code).toBe('AGENT_COMMAND_NOT_IMPLEMENTED');
    },
  );
});

describe('Fehlerzuordnung Runtime → API-Katalog', () => {
  it('ordnet jedem Runtime-Fehlercode einen Code aus dem Katalog zu', () => {
    for (const code of RUNTIME_ERROR_CODES) {
      const apiCode = RUNTIME_ERROR_TO_API_CODE[code];
      expect(apiCode, code).toBeDefined();
      expect(Object.keys(ERROR_CATALOG)).toContain(apiCode);
    }
  });

  it('deckt die Tabelle genau die Runtime-Codes ab, nicht mehr', () => {
    expect(Object.keys(RUNTIME_ERROR_TO_API_CODE).sort()).toEqual([...RUNTIME_ERROR_CODES].sort());
  });

  it.each([
    ['CONTAINER_NOT_FOUND', 'AGENT_CONTAINER_NOT_FOUND'],
    ['CONTAINER_NOT_RUNNING', 'AGENT_CONTAINER_NOT_RUNNING'],
    ['IMAGE_NOT_FOUND', 'AGENT_IMAGE_NOT_FOUND'],
    ['RUNTIME_UNAVAILABLE', 'AGENT_RUNTIME_UNAVAILABLE'],
    ['FILE_TOO_LARGE', 'AGENT_FILE_TOO_LARGE'],
  ])('übersetzt %s in %s', async (runtimeCode, apiCode) => {
    const containerId = await containerAnlegen();
    runtime.failNext('start', new ContainerRuntimeError(runtimeCode as ContainerRuntimeErrorCode));

    const antwort = await befehl('START', { containerId });

    expect(isFail(antwort)).toBe(true);
    expect(antwort.error?.code).toBe(apiCode);
  });

  it('übersetzt RUNTIME_ERROR in einen allgemeinen Ausführungsfehler', async () => {
    const containerId = await containerAnlegen();
    runtime.failNext('stop', new ContainerRuntimeError('RUNTIME_ERROR'));

    const antwort = await befehl('STOP', { containerId });

    expect(antwort.error?.code).toBe('AGENT_COMMAND_FAILED');
  });

  it('fängt auch eine Ausnahme ab, die kein ContainerRuntimeError ist', async () => {
    // Kommt so aus der echten Runtime nicht vor, darf das Backend aber trotzdem
    // nie ohne Antwort auf eine Korrelations-ID zurücklassen.
    const kaputteRuntime = {
      ...runtime,
      on: () => () => {},
      start: () => Promise.reject(new TypeError('unerwartet')),
    } as unknown as FakeContainerRuntime;

    const eigenerAdapter = new ContainerRuntimeAdapter({ runtime: kaputteRuntime });

    const antwort = await eigenerAdapter.execute({
      correlationId: CORRELATION_ID,
      command: 'START',
      serverId: SERVER_ID,
      payload: { containerId: 'abc123' },
    });

    expect(isFail(antwort)).toBe(true);
    expect(antwort.error?.code).toBe('AGENT_COMMAND_FAILED');
    expect(antwort.error?.message).toContain('unerwartet');
  });
});

describe('Ist-Zustand für den Soll/Ist-Abgleich', () => {
  it('meldet alle bekannten Container im Protokollformat', async () => {
    const containerId = await containerAnlegen();
    await befehl('START', { containerId });

    const zustaende = await adapter.listContainerStates();

    expect(zustaende).toHaveLength(1);
    expect(zustaende[0]).toMatchObject({
      containerId,
      serverId: SERVER_ID,
      status: 'running',
      exitCode: null,
    });
    expect(zustaende[0]?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('meldet null als serverId, wenn der Container nicht zuordenbar ist', async () => {
    await befehl('CREATE', { ...CREATE_PAYLOAD, name: 'fremder-container' }, null);

    const zustaende = await adapter.listContainerStates();

    // Lieber ehrlich "nicht zuordenbar" als eine geratene serverId.
    expect(zustaende[0]?.serverId).toBeNull();
  });

  it('reicht einen Fehler durch, statt eine leere Liste zu liefern', async () => {
    // Eine leere Liste läse das Backend als "hier läuft nichts" und würde einen
    // Soll/Ist-Abgleich gegen laufende Server auslösen.
    runtime.failNext('list', new ContainerRuntimeError('RUNTIME_UNAVAILABLE'));

    await expect(adapter.listContainerStates()).rejects.toThrow();
  });
});

describe('Ereignisse Runtime → Protokoll', () => {
  it('reicht einen Absturz als CRASHED weiter', async () => {
    adapter.start((event) => ereignisse.push(event));
    const containerId = await containerAnlegen();
    await befehl('START', { containerId });

    runtime.simulateCrash(containerId, { exitCode: 137 });

    const crash = ereignisse.find((e) => e.event === 'CRASHED');
    expect(crash).toBeDefined();
    expect(crash?.payload).toMatchObject({ containerId, exitCode: 137 });
  });

  it('reicht Statuswechsel weiter', async () => {
    adapter.start((event) => ereignisse.push(event));
    const containerId = await containerAnlegen();

    await befehl('START', { containerId });

    // Die Runtime meldet bereits beim Anlegen einen Wechsel nach 'created';
    // hier interessiert der letzte.
    const statusEreignisse = ereignisse.filter((e) => e.event === 'STATUS_CHANGED');
    expect(statusEreignisse.at(-1)?.payload).toMatchObject({ containerId, status: 'running' });
  });

  it('meldet nach stop() keine Ereignisse mehr', async () => {
    adapter.start((event) => ereignisse.push(event));
    const containerId = await containerAnlegen();
    adapter.stop();
    ereignisse.length = 0;

    await befehl('START', { containerId });

    expect(ereignisse).toHaveLength(0);
  });

  it('meldet sich bei doppeltem start() nicht doppelt an', async () => {
    adapter.start((event) => ereignisse.push(event));
    adapter.start((event) => ereignisse.push(event));
    const containerId = await containerAnlegen();
    await befehl('START', { containerId });
    ereignisse.length = 0;

    runtime.simulateCrash(containerId, { exitCode: 137 });

    expect(ereignisse.filter((e) => e.event === 'CRASHED')).toHaveLength(1);
  });
});
