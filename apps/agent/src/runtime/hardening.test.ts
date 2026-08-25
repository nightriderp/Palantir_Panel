import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STOP_TIMEOUT_SECONDS,
  PALANTIR_MANAGED_LABEL,
  PALANTIR_SERVER_ID_LABEL,
  TMPFS_OPTIONS,
  assertValidContainerSpec,
  buildCreateContainerBody,
  type HardeningOptions,
} from './hardening.js';
import { ContainerRuntimeError } from './errors.js';
import { DEFAULT_PIDS_LIMIT, type ContainerSpec } from './types.js';

const DATEN_WURZEL = '/srv/palantir/servers';

const optionen: HardeningOptions = { allowedHostRoots: [DATEN_WURZEL] };

function spec(ueberschreibung: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    name: 'palantir-testserver',
    image: 'palantir/testserver:1',
    env: { SERVER_PORT: '25565' },
    ports: [{ containerPort: 25565, hostPort: 30001, protocol: 'tcp' }],
    resources: { memoryMb: 2048, cpuCores: 2 },
    dataVolume: { hostPath: `${DATEN_WURZEL}/srv-1`, containerPath: '/data' },
    serverId: 'a3f1c2d4-0000-4000-8000-000000000001',
    ...ueberschreibung,
  };
}

describe('Container-Haertung (Pflichtenheft §2.3)', () => {
  it('setzt no-new-privileges immer', () => {
    const body = buildCreateContainerBody(spec(), optionen);
    expect(body.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
  });

  it('entzieht alle Capabilities und laesst keinen privilegierten Container zu', () => {
    const body = buildCreateContainerBody(spec(), optionen);
    expect(body.HostConfig.CapDrop).toEqual(['ALL']);
    expect(body.HostConfig.Privileged).toBe(false);
  });

  it('gibt ein konfiguriertes Seccomp-Profil an die Engine weiter', () => {
    const profil = '{"defaultAction":"SCMP_ACT_ERRNO"}';
    const body = buildCreateContainerBody(spec(), { ...optionen, seccompProfile: profil });
    expect(body.HostConfig.SecurityOpt).toContain(`seccomp=${profil}`);
  });

  it('setzt nie seccomp=unconfined', () => {
    const body = buildCreateContainerBody(spec(), { ...optionen, seccompProfile: undefined });
    for (const eintrag of body.HostConfig.SecurityOpt) {
      expect(eintrag).not.toMatch(/unconfined/);
    }
  });

  it('setzt feste CPU- und RAM-Grenzen und deaktiviert Swap', () => {
    const body = buildCreateContainerBody(
      spec({ resources: { memoryMb: 1024, cpuCores: 1.5 } }),
      optionen,
    );
    expect(body.HostConfig.Memory).toBe(1024 * 1024 * 1024);
    // Gleicher Wert wie Memory bedeutet: kein Swap - das RAM-Limit ist nicht umgehbar.
    expect(body.HostConfig.MemorySwap).toBe(body.HostConfig.Memory);
    expect(body.HostConfig.NanoCpus).toBe(1_500_000_000);
  });

  it('begrenzt die Prozessanzahl gegen Fork-Bomben', () => {
    expect(buildCreateContainerBody(spec(), optionen).HostConfig.PidsLimit).toBe(
      DEFAULT_PIDS_LIMIT,
    );
    expect(
      buildCreateContainerBody(
        spec({ resources: { memoryMb: 512, cpuCores: 1, pidsLimit: 64 } }),
        optionen,
      ).HostConfig.PidsLimit,
    ).toBe(64);
  });

  it('nutzt standardmaessig ein read-only Root-Filesystem mit beschreibbarem tmpfs', () => {
    const body = buildCreateContainerBody(spec(), optionen);
    expect(body.HostConfig.ReadonlyRootfs).toBe(true);
    expect(body.HostConfig.Tmpfs['/tmp']).toBe(TMPFS_OPTIONS);
    // Das tmpfs ist beschreibbar, aber nicht ausfuehrbar.
    expect(TMPFS_OPTIONS).toContain('noexec');
  });

  it('erlaubt ein beschreibbares Root-Filesystem nur auf ausdrueckliche Ansage des Spieltyps', () => {
    const body = buildCreateContainerBody(spec({ readOnlyRootFilesystem: false }), optionen);
    expect(body.HostConfig.ReadonlyRootfs).toBe(false);
    expect(body.HostConfig.Tmpfs).toEqual({});
  });

  it('mountet den Datenordner beschreibbar', () => {
    const body = buildCreateContainerBody(spec(), optionen);
    expect(body.HostConfig.Binds).toEqual([`${DATEN_WURZEL}/srv-1:/data:rw`]);
  });

  it('ueberlaesst Neustarts nach Absturz Palantir, nicht der Engine', () => {
    // Pflichtenheft §9 verlangt Crash-Loop-Schutz - den kann die Engine nicht.
    expect(buildCreateContainerBody(spec(), optionen).HostConfig.RestartPolicy).toEqual({
      Name: 'no',
    });
  });

  it('begrenzt die Logdateien', () => {
    const logConfig = buildCreateContainerBody(spec(), optionen).HostConfig.LogConfig;
    expect(logConfig.Type).toBe('json-file');
    expect(logConfig.Config['max-size']).toBe('10m');
  });

  it('bindet Ports nicht an 0.0.0.0, sondern an das konfigurierte Interface', () => {
    const body = buildCreateContainerBody(spec(), optionen);
    expect(body.HostConfig.PortBindings['25565/tcp']).toEqual([
      { HostIp: '127.0.0.1', HostPort: '30001' },
    ]);

    const mitTunnel = buildCreateContainerBody(spec(), { ...optionen, defaultHostIp: '10.10.0.2' });
    expect(mitTunnel.HostConfig.PortBindings['25565/tcp']?.[0]?.HostIp).toBe('10.10.0.2');
  });

  it('kennzeichnet Container als von Palantir verwaltet', () => {
    const body = buildCreateContainerBody(spec(), optionen);
    expect(body.Labels[PALANTIR_MANAGED_LABEL]).toBe('true');
    expect(body.Labels[PALANTIR_SERVER_ID_LABEL]).toBe('a3f1c2d4-0000-4000-8000-000000000001');
  });

  it('uebernimmt Env, Kommando und Stop-Timeout', () => {
    const body = buildCreateContainerBody(
      spec({ command: ['./start.sh'], stopTimeoutSeconds: 90 }),
      optionen,
    );
    expect(body.Env).toEqual(['SERVER_PORT=25565']);
    expect(body.Cmd).toEqual(['./start.sh']);
    expect(body.StopTimeout).toBe(90);
    expect(buildCreateContainerBody(spec(), optionen).StopTimeout).toBe(
      DEFAULT_STOP_TIMEOUT_SECONDS,
    );
  });
});

describe('Spec-Pruefung', () => {
  function erwarteFehler(ueberschreibung: Partial<ContainerSpec>, code: string): void {
    try {
      assertValidContainerSpec(spec(ueberschreibung), optionen);
      throw new Error('Es wurde ein Fehler erwartet.');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ContainerRuntimeError);
      expect((fehler as ContainerRuntimeError).code).toBe(code);
    }
  }

  it('lehnt fehlende oder unsinnige Ressourcen-Grenzen ab', () => {
    erwarteFehler({ resources: { memoryMb: 0, cpuCores: 1 } }, 'INVALID_CONTAINER_SPEC');
    erwarteFehler({ resources: { memoryMb: 512, cpuCores: 0 } }, 'INVALID_CONTAINER_SPEC');
    erwarteFehler({ resources: { memoryMb: 512, cpuCores: -1 } }, 'INVALID_CONTAINER_SPEC');
  });

  it('lehnt Bind-Mounts ausserhalb der erlaubten Verzeichnisse ab', () => {
    erwarteFehler({ dataVolume: { hostPath: '/etc', containerPath: '/data' } }, 'INVALID_PATH');
    // Der klassische Ausbruch ueber ..
    erwarteFehler(
      { dataVolume: { hostPath: `${DATEN_WURZEL}/../../etc`, containerPath: '/data' } },
      'INVALID_PATH',
    );
  });

  it('verlangt ein beschreibbares Datenvolume', () => {
    erwarteFehler(
      { dataVolume: { hostPath: `${DATEN_WURZEL}/srv-1`, containerPath: '/data', readOnly: true } },
      'INVALID_CONTAINER_SPEC',
    );
  });

  it('lehnt unzulaessige Container-Namen und Ports ab', () => {
    erwarteFehler({ name: 'nicht gueltig!' }, 'INVALID_CONTAINER_SPEC');
    erwarteFehler(
      { ports: [{ containerPort: 0, hostPort: 30001, protocol: 'tcp' }] },
      'INVALID_CONTAINER_SPEC',
    );
    erwarteFehler(
      {
        ports: [
          { containerPort: 25565, hostPort: 30001, protocol: 'tcp' },
          { containerPort: 25566, hostPort: 30001, protocol: 'tcp' },
        ],
      },
      'INVALID_CONTAINER_SPEC',
    );
  });

  it('lehnt ungueltige Namen von Umgebungsvariablen ab', () => {
    erwarteFehler({ env: { 'NICHT GUELTIG': 'x' } }, 'INVALID_CONTAINER_SPEC');
  });

  it('nimmt einen gueltigen Spec an', () => {
    expect(() => assertValidContainerSpec(spec(), optionen)).not.toThrow();
  });
});
