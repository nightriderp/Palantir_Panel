import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContainerRuntimeError,
  type ContainerSpec,
  FakeContainerRuntime,
} from '../../runtime/index.js';
import { RconError, type RconRequest } from '../../runtime/rcon.js';
import { RconConsole } from './rcon-console.js';

const SERVER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const NETZ = 'palantir-games';
const ZUGANG = { port: 25_575, passwordFile: '.palantir/rcon.password' };

const SPEC: ContainerSpec = {
  name: `palantir-${SERVER_ID}`,
  image: 'palantir/testserver:1',
  env: {},
  ports: [],
  resources: { memoryMb: 512, cpuCores: 1 },
  dataVolume: { hostPath: `/srv/palantir/servers/${SERVER_ID}`, containerPath: '/data' },
};

describe('RconConsole (P2-9)', () => {
  let wurzel: string;
  let runtime: FakeContainerRuntime;
  let containerId: string;
  let anfragen: RconRequest[];
  let antwort: () => Promise<string>;

  const konsole = (): RconConsole =>
    new RconConsole({
      runtime,
      dataDir: path.join(wurzel, 'servers'),
      network: NETZ,
      timeoutMs: 1_234,
      client: (anfrage) => {
        anfragen.push(anfrage);

        return antwort();
      },
    });

  const passwortAblegen = async (inhalt: string): Promise<void> => {
    const ordner = path.join(wurzel, 'servers', SERVER_ID, '.palantir');
    await fs.mkdir(ordner, { recursive: true });
    await fs.writeFile(path.join(ordner, 'rcon.password'), inhalt);
  };

  beforeEach(async () => {
    wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-rcon-'));
    runtime = new FakeContainerRuntime();
    await runtime.connect();
    // Wie Docker: Nur ein Container, den es gibt, hat eine Adresse.
    containerId = (await runtime.create(SPEC)).containerId;
    runtime.setNetworkAddress(containerId, NETZ, '172.31.240.7');
    anfragen = [];
    antwort = () => Promise.resolve('There are 1 of a max of 20 players online: Steve');
  });

  afterEach(async () => {
    await fs.rm(wurzel, { recursive: true, force: true });
  });

  it('spricht den Container im Spielenetz mit dem Passwort aus dem Datenordner an', async () => {
    await passwortAblegen('geheim-123\n');

    const ergebnis = await konsole().exec(SERVER_ID, containerId, ZUGANG, ['list']);

    expect(ergebnis).toEqual({
      exitCode: 0,
      stdout: 'There are 1 of a max of 20 players online: Steve',
      stderr: '',
    });
    expect(anfragen).toEqual([
      {
        host: '172.31.240.7',
        port: 25_575,
        password: 'geheim-123',
        command: 'list',
        timeoutMs: 1_234,
      },
    ]);
  });

  it('verbindet die Argumentliste zu einer Zeile – RCON kennt keine Argumente', async () => {
    await passwortAblegen('x');

    await konsole().exec(SERVER_ID, containerId, ZUGANG, ['whitelist', 'add', 'Steve']);

    expect(anfragen[0]?.command).toBe('whitelist add Steve');
  });

  it('nimmt die Farbcodes von Minecraft aus der Antwort', async () => {
    await passwortAblegen('x');
    antwort = () => Promise.resolve('§6TPS from last 1m, 5m, 15m: §a20.0, §a20.0, §a20.0§r');

    const ergebnis = await konsole().exec(SERVER_ID, containerId, ZUGANG, ['tps']);

    expect(ergebnis.stdout).toBe('TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0');
  });

  it('meldet einen Container ohne Adresse im Spielenetz als Zeile, nicht als Absturz', async () => {
    await passwortAblegen('x');
    runtime.setNetworkAddress(containerId, NETZ, null);

    const ergebnis = await konsole().exec(SERVER_ID, containerId, ZUGANG, ['list']);

    expect(ergebnis.exitCode).toBe(1);
    expect(ergebnis.stderr).toContain('nicht erreichbar');
    expect(anfragen).toHaveLength(0);
  });

  it('meldet ein fehlendes Passwort verständlich – der Server legt es erst beim Start an', async () => {
    const ergebnis = await konsole().exec(SERVER_ID, containerId, ZUGANG, ['list']);

    expect(ergebnis.exitCode).toBe(1);
    expect(ergebnis.stderr).toContain('.palantir/rcon.password');
    expect(anfragen).toHaveLength(0);
  });

  it('behandelt eine leere Passwortdatei wie eine fehlende', async () => {
    await passwortAblegen('\n');

    const ergebnis = await konsole().exec(SERVER_ID, containerId, ZUGANG, ['list']);

    expect(ergebnis.exitCode).toBe(1);
    expect(anfragen).toHaveLength(0);
  });

  it('gibt einen RCON-Fehler als stderr zurück', async () => {
    await passwortAblegen('x');
    antwort = () =>
      Promise.reject(new RconError('Der Server hat die Anmeldung abgelehnt.', 'AUTH_FAILED'));

    const ergebnis = await konsole().exec(SERVER_ID, containerId, ZUGANG, ['list']);

    expect(ergebnis).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'RCON: Der Server hat die Anmeldung abgelehnt.',
    });
  });

  it('lässt eine Passwortdatei außerhalb des Datenordners nicht zu', async () => {
    await expect(
      konsole().exec(SERVER_ID, containerId, { port: 25_575, passwordFile: '../../etc/passwd' }, [
        'list',
      ]),
    ).rejects.toBeInstanceOf(ContainerRuntimeError);
  });
});
