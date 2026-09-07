/**
 * Aufbau der Runtime aus der Umgebung.
 *
 * Geprueft wird hier vor allem die Verdrahtung des Spielenetzes
 * (`AGENT_CONTAINER_NETWORK`, Audit security-matrix-02): Zwischen der Variable
 * in der `.env` und dem `NetworkMode` im Erzeugungs-Payload liegen zwei
 * Schichten - und ein vergessener Durchreicher faellt sonst erst auf der Node
 * auf, wo der Container wieder im offenen Standardnetz landete.
 */

import { describe, expect, it } from 'vitest';
import { createContainerRuntimeFromEnv, type RuntimeEnv } from './factory.js';
import { DEFAULT_GAME_NETWORK } from './hardening.js';
import { type ContainerSpec } from './types.js';

const DATEN_WURZEL = '/srv/palantir/servers';

const basisEnv: RuntimeEnv = {
  DOCKER_SOCKET_PROXY_URL: 'http://127.0.0.1:2375',
  AGENT_DATA_DIR: DATEN_WURZEL,
  AGENT_BACKUP_DIR: '/srv/palantir/backups',
};

const spec: ContainerSpec = {
  name: 'palantir-srv-1',
  image: 'palantir/testserver:1',
  env: {},
  ports: [],
  resources: { memoryMb: 512, cpuCores: 1 },
  dataVolume: { hostPath: `${DATEN_WURZEL}/srv-1`, containerPath: '/data' },
};

/** Faengt das Erzeugungs-Payload ab, das an den Socket-Proxy ginge. */
async function netzModusBeimAnlegen(env: RuntimeEnv): Promise<string | undefined> {
  let gesendet: string | undefined;
  const runtime = createContainerRuntimeFromEnv(env, {
    fetchImpl: async (_input, init) => {
      gesendet = typeof init?.body === 'string' ? init.body : undefined;
      return new Response(JSON.stringify({ Id: 'c-1', Warnings: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onStreamError: () => undefined,
  });

  try {
    await runtime.create(spec);
  } finally {
    await runtime.dispose();
  }

  const koerper = JSON.parse(gesendet ?? '{}') as { HostConfig?: { NetworkMode?: string } };
  return koerper.HostConfig?.NetworkMode;
}

describe('createContainerRuntimeFromEnv', () => {
  it('nimmt ohne Angabe das Netz mit Egress-Regeln, nie das Standardnetz', async () => {
    await expect(netzModusBeimAnlegen(basisEnv)).resolves.toBe(DEFAULT_GAME_NETWORK);
  });

  it('reicht AGENT_CONTAINER_NETWORK bis in das Erzeugungs-Payload durch', async () => {
    await expect(
      netzModusBeimAnlegen({ ...basisEnv, AGENT_CONTAINER_NETWORK: 'spiele-nord' }),
    ).resolves.toBe('spiele-nord');
  });

  it('laesst der ausdruecklichen Option den Vorrang vor der Umgebung', async () => {
    let gesendet: string | undefined;
    const runtime = createContainerRuntimeFromEnv(
      { ...basisEnv, AGENT_CONTAINER_NETWORK: 'aus-der-env' },
      {
        networkMode: 'aus-der-option',
        fetchImpl: async (_input, init) => {
          gesendet = typeof init?.body === 'string' ? init.body : undefined;
          return new Response(JSON.stringify({ Id: 'c-1', Warnings: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        onStreamError: () => undefined,
      },
    );

    try {
      await runtime.create(spec);
    } finally {
      await runtime.dispose();
    }

    const koerper = JSON.parse(gesendet ?? '{}') as { HostConfig?: { NetworkMode?: string } };
    expect(koerper.HostConfig?.NetworkMode).toBe('aus-der-option');
  });
});
