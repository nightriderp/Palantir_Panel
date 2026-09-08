/**
 * Routen-Dateien des Hostname-Routers (Pflichtenheft §2.4, §13).
 *
 * Geprüft wird alles, was ohne Docker prüfbar ist: dass eine Route beim
 * Anlegen entsteht und beim Löschen verschwindet, dass ein Container ohne die
 * Labels keine erzeugt, dass der Inhalt genau die Felder trägt, die die
 * gepinnte Infrared-Fassung v1.3.4 liest, und dass ein bösartiger Hostname
 * weder aus der Datei noch aus dem Verzeichnis ausbricht.
 *
 * **Was hier NICHT geprüft werden kann:** ob Infrared die Datei tatsächlich
 * übernimmt. Dafür bräuchte es den laufenden Dienst und einen Minecraft-Client
 * – siehe den Bericht des Arbeitspakets.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isContainerRuntimeError, type ContainerSpec } from '../../runtime/index.js';
import {
  HostnameRouterJob,
  PROXIES_DIRNAME,
  STAGING_DIRNAME,
  VIRTUAL_HOST_HOSTNAME_LABEL,
  VIRTUAL_HOST_TARGET_PORT_LABEL,
  routeFileContent,
  routeFromSpec,
} from './hostname-routes.js';

const SERVER_ID = '11111111-2222-4333-8444-555555555555';

let wurzel: string;

beforeEach(async () => {
  wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-router-'));
});

afterEach(async () => {
  await fs.rm(wurzel, { recursive: true, force: true });
});

function spec(overrides: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    name: `palantir-${SERVER_ID}`,
    image: 'ghcr.io/nightriderp/palantir-minecraft:1',
    env: {},
    ports: [],
    resources: { memoryMb: 4096, cpuCores: 2 },
    dataVolume: { hostPath: '/srv/palantir/servers/x', containerPath: '/data' },
    serverId: SERVER_ID,
    labels: {
      'palantir.serverId': SERVER_ID,
      [VIRTUAL_HOST_HOSTNAME_LABEL]: 'welt.example.tld',
      [VIRTUAL_HOST_TARGET_PORT_LABEL]: '25565',
    },
    ...overrides,
  };
}

function job(routerDir: string | null = wurzel): HostnameRouterJob {
  return new HostnameRouterJob({ routerDir, listenPort: 25_565 });
}

function routenPfad(id = SERVER_ID): string {
  return path.join(wurzel, PROXIES_DIRNAME, `${id}.json`);
}

async function gelesen(id = SERVER_ID): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(routenPfad(id), 'utf8')) as Record<string, unknown>;
}

/** Fehlercode eines erwarteten `ContainerRuntimeError`. */
async function fehlercode(lauf: () => Promise<unknown>): Promise<string> {
  try {
    await lauf();
  } catch (error: unknown) {
    return isContainerRuntimeError(error) ? error.code : `kein Runtime-Fehler: ${String(error)}`;
  }
  return 'kein Fehler';
}

describe('Route anlegen und entfernen', () => {
  it('legt beim Anlegen genau eine Datei an, benannt nach der Server-Id', async () => {
    expect(await job().writeFromSpec(spec())).toBe(true);

    expect(await fs.readdir(path.join(wurzel, PROXIES_DIRNAME))).toEqual([`${SERVER_ID}.json`]);
  });

  it('entfernt sie beim Löschen wieder', async () => {
    const router = job();
    await router.writeFromSpec(spec());

    expect(await router.remove(SERVER_ID)).toBe(true);
    expect(await fs.readdir(path.join(wurzel, PROXIES_DIRNAME))).toEqual([]);
  });

  it('nimmt eine fehlende Datei als erledigt hin', async () => {
    // Der Regelfall: ein Server, der nie eine Route hatte. Ein Fehler hier
    // machte ihn unlöschbar.
    expect(await job().remove(SERVER_ID)).toBe(false);
  });

  it('erzeugt für einen Container ohne die Labels keine', async () => {
    const ohne = spec({ labels: { 'palantir.serverId': SERVER_ID } });

    expect(await job().writeFromSpec(ohne)).toBe(false);
    await expect(fs.readdir(path.join(wurzel, PROXIES_DIRNAME))).rejects.toThrow();
  });

  it('tut ohne eingerichtetes Verzeichnis nichts', async () => {
    // Eine Installation ohne Router soll am Anlegen eines Servers nicht
    // scheitern - auch dann nicht, wenn die Labels da wären.
    const ohneOrdner = job(null);

    expect(ohneOrdner.eingerichtet).toBe(false);
    expect(await ohneOrdner.writeFromSpec(spec())).toBe(false);
    expect(await ohneOrdner.remove(SERVER_ID)).toBe(false);
  });

  it('schreibt die Datei erst fertig und schiebt sie dann hinüber', async () => {
    // Infrared beobachtet den Routen-Ordner; eine halb geschriebene Datei wäre
    // eine kaputte Route. Der Zwischenordner liegt deshalb daneben und ist
    // hinterher leer.
    await job().writeFromSpec(spec());

    expect(await fs.readdir(path.join(wurzel, STAGING_DIRNAME))).toEqual([]);
  });

  it('ersetzt eine bestehende Route beim Neuaufbau', async () => {
    const router = job();
    await router.writeFromSpec(spec());
    await router.writeFromSpec(
      spec({
        labels: {
          'palantir.serverId': SERVER_ID,
          [VIRTUAL_HOST_HOSTNAME_LABEL]: 'neue-welt.example.tld',
          [VIRTUAL_HOST_TARGET_PORT_LABEL]: '25565',
        },
      }),
    );

    expect(await fs.readdir(path.join(wurzel, PROXIES_DIRNAME))).toHaveLength(1);
    expect((await gelesen())['domainName']).toBe('neue-welt.example.tld');
  });
});

/**
 * Der Inhalt ist das, was Infrared v1.3.4 liest - belegt aus `ProxyConfig` in
 * `config.go` und der Tabelle „Proxy Config" in der README des Tags.
 */
describe('Inhalt der Routen-Datei', () => {
  it('trägt genau die Felder der gepinnten Fassung', async () => {
    await job().writeFromSpec(spec());

    expect(await gelesen()).toEqual({
      domainName: 'welt.example.tld',
      listenTo: ':25565',
      proxyTo: `palantir-${SERVER_ID}:25565`,
      timeout: 5000,
      disconnectMessage: 'Dieser Server ist gerade nicht erreichbar.',
    });
  });

  it('zeigt auf den Containernamen, nicht auf eine Adresse', () => {
    // Die Adresse eines Containers ändert sich mit jedem Start, der Name
    // nicht - nur deshalb überlebt die Datei jeden Neustart und muss allein
    // beim Anlegen und Löschen angefasst werden.
    const inhalt = JSON.parse(
      routeFileContent(
        {
          serverId: SERVER_ID,
          hostname: 'welt.example.tld',
          containerName: 'palantir-abc',
          targetPort: 25_565,
        },
        25_565,
      ),
    ) as Record<string, unknown>;

    expect(inhalt['proxyTo']).toBe('palantir-abc:25565');
  });

  it('setzt listenTo aus dem eingestellten Router-Port', async () => {
    // Sonst lauschte der Router auf 25565, während frpc einen anderen Port
    // abholte - der Server liefe und wäre trotzdem nicht erreichbar.
    await new HostnameRouterJob({ routerDir: wurzel, listenPort: 25_599 }).writeFromSpec(spec());

    expect((await gelesen())['listenTo']).toBe(':25599');
  });

  it('endet mit einem Zeilenumbruch und ist gültiges JSON', async () => {
    await job().writeFromSpec(spec());

    const roh = await fs.readFile(routenPfad(), 'utf8');

    expect(roh.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(roh)).not.toThrow();
  });
});

/**
 * Erzeugte Konfiguration - dieselbe Sorgfalt wie beim Familiennamen im
 * Schriften-CSS des Backends: Der Hostname kommt aus einem Formular und landet
 * in einer Datei, die ein fremder Prozess ausliest.
 */
describe('Ein Hostname, der ausbrechen will, tut es nicht', () => {
  const boshaft = [
    'welt.example.tld", "proxyTo": "10.0.0.1:22',
    'welt.example.tld\n{"domainName":"x"}',
    '../../../etc/passwd',
    'welt.example.tld/../andere',
    '../ausserhalb',
    'welt example.tld',
    'WELT.EXAMPLE.TLD',
    'welt',
    '-welt.example.tld',
    `${'a'.repeat(64)}.example.tld`,
  ];

  for (const hostname of boshaft) {
    it(`lehnt ${JSON.stringify(hostname)} ab, statt ihn zu schreiben`, async () => {
      const code = await fehlercode(() =>
        job().writeFromSpec(
          spec({
            labels: {
              [VIRTUAL_HOST_HOSTNAME_LABEL]: hostname,
              [VIRTUAL_HOST_TARGET_PORT_LABEL]: '25565',
            },
          }),
        ),
      );

      expect(code).toBe('INVALID_CONTAINER_SPEC');
      // Und es liegt nichts herum - weder im Routen- noch im Zwischenordner.
      await expect(fs.readdir(path.join(wurzel, PROXIES_DIRNAME))).rejects.toThrow();
    });
  }

  it('schreibt keine Datei, deren Name nicht aus einer Server-Id entsteht', async () => {
    const code = await fehlercode(() =>
      job().writeFromSpec(spec({ serverId: '../../etc/cron.d/boese' })),
    );

    expect(code).toBe('INVALID_CONTAINER_SPEC');
  });

  it('entfernt nichts, wenn die Id keine ist', async () => {
    await job().writeFromSpec(spec());

    expect(await job().remove('../' + SERVER_ID)).toBe(false);
    expect(await job().remove(null)).toBe(false);
    // Die echte Route ist unberührt.
    expect(await fs.readdir(path.join(wurzel, PROXIES_DIRNAME))).toEqual([`${SERVER_ID}.json`]);
  });
});

describe('Unvollständige Labels', () => {
  it('lehnt ein Label ohne sein Gegenstück ab', async () => {
    // Halb gesetzt heißt: Der Server liefe und wäre für niemanden erreichbar.
    // Genau das soll auffallen.
    const code = await fehlercode(() =>
      job().writeFromSpec(spec({ labels: { [VIRTUAL_HOST_HOSTNAME_LABEL]: 'welt.example.tld' } })),
    );

    expect(code).toBe('INVALID_CONTAINER_SPEC');
  });

  it('lehnt einen Zielport ab, der keiner ist', async () => {
    for (const port of ['0', '65536', 'ssh', '25565; rm -rf /', '']) {
      const code = await fehlercode(() =>
        job().writeFromSpec(
          spec({
            labels: {
              [VIRTUAL_HOST_HOSTNAME_LABEL]: 'welt.example.tld',
              [VIRTUAL_HOST_TARGET_PORT_LABEL]: port,
            },
          }),
        ),
      );

      expect(code, `Port ${JSON.stringify(port)}`).toBe('INVALID_CONTAINER_SPEC');
    }
  });

  it('liefert für einen Container ganz ohne die Labels schlicht null', () => {
    expect(routeFromSpec(spec({ labels: {} }))).toBeNull();
    expect(routeFromSpec(spec({ labels: undefined }))).toBeNull();
  });
});
