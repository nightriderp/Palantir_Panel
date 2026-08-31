import { describe, expect, it } from 'vitest';
import {
  berechneCpuProzent,
  berechneSpeicherVerbrauch,
  toContainerState,
  toContainerStats,
  toContainerStatus,
} from './mapping.js';

describe('toContainerStatus', () => {
  it('uebernimmt bekannte Zustaende', () => {
    expect(toContainerStatus('running')).toBe('running');
    expect(toContainerStatus('exited')).toBe('exited');
  });

  it('faellt bei Unbekanntem auf unknown zurueck', () => {
    expect(toContainerStatus('etwas-neues')).toBe('unknown');
    expect(toContainerStatus(undefined)).toBe('unknown');
  });
});

describe('toContainerState', () => {
  it('entfernt den fuehrenden Schraegstrich aus dem Namen', () => {
    const state = toContainerState({ Id: 'c1', Name: '/palantir-srv-1' });
    expect(state.name).toBe('palantir-srv-1');
  });

  it('nimmt die serverId aus dem Label statt aus dem Namen', () => {
    // Gefundener Punkt 19: Der Name kann von Hand geaendert sein, das Label
    // setzt die Runtime beim Anlegen selbst.
    const state = toContainerState({
      Id: 'c1',
      Name: '/irgendwas-anderes',
      Config: { Labels: { 'palantir.serverId': 'a3f1c2d4-0000-4000-8000-000000000001' } },
    });
    expect(state.serverId).toBe('a3f1c2d4-0000-4000-8000-000000000001');
  });

  it('meldet keine serverId fuer einen fremden Container', () => {
    expect(toContainerState({ Id: 'c1', Name: '/palantir-fremd' }).serverId).toBeNull();
  });

  it('liefert keinen Exit-Code, solange der Container nie beendet wurde', () => {
    const state = toContainerState({
      Id: 'c1',
      State: {
        Status: 'running',
        ExitCode: 0,
        StartedAt: '2026-08-26T10:00:00Z',
        FinishedAt: '0001-01-01T00:00:00Z',
      },
    });
    expect(state.exitCode).toBeNull();
    expect(state.finishedAt).toBeNull();
    expect(state.startedAt).toBe('2026-08-26T10:00:00.000Z');
  });

  it('liefert den Exit-Code nach einem beendeten Lauf', () => {
    const state = toContainerState({
      Id: 'c1',
      RestartCount: 2,
      State: {
        Status: 'exited',
        ExitCode: 137,
        StartedAt: '2026-08-26T10:00:00Z',
        FinishedAt: '2026-08-26T10:05:00Z',
        OOMKilled: true,
      },
    });
    expect(state.exitCode).toBe(137);
    expect(state.oomKilled).toBe(true);
    expect(state.restartCount).toBe(2);
  });
});

describe('berechneCpuProzent', () => {
  it('rechnet die Differenz zweier Messpunkte auf Kerne hoch', () => {
    const prozent = berechneCpuProzent({
      cpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 1000,
        online_cpus: 4,
      },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 800 },
    });
    // (100/200) * 4 * 100 = 200 Prozent, also zwei ausgelastete Kerne.
    expect(prozent).toBe(200);
  });

  it('liefert 0 ohne zweiten Messpunkt', () => {
    expect(
      berechneCpuProzent({
        cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000 },
      }),
    ).toBe(0);
  });

  it('liefert 0 bei ruecklaeufigen Zaehlern statt eines negativen Werts', () => {
    expect(
      berechneCpuProzent({
        cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 800 },
        precpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000 },
      }),
    ).toBe(0);
  });
});

describe('berechneSpeicherVerbrauch', () => {
  it('zieht den Page-Cache ab (cgroup v2)', () => {
    expect(
      berechneSpeicherVerbrauch({
        memory_stats: { usage: 1000, stats: { inactive_file: 400 } },
      }),
    ).toBe(600);
  });

  it('zieht den Page-Cache ab (cgroup v1)', () => {
    expect(
      berechneSpeicherVerbrauch({ memory_stats: { usage: 1000, stats: { cache: 250 } } }),
    ).toBe(750);
  });

  it('wird nie negativ', () => {
    expect(
      berechneSpeicherVerbrauch({ memory_stats: { usage: 100, stats: { inactive_file: 400 } } }),
    ).toBe(0);
  });
});

describe('toContainerStats', () => {
  it('summiert Netzwerk- und Blockzaehler ueber alle Schnittstellen', () => {
    const stats = toContainerStats('c1', {
      read: '2026-08-26T10:00:00Z',
      pids_stats: { current: 42 },
      memory_stats: { usage: 500, limit: 2048 },
      networks: {
        eth0: { rx_bytes: 100, tx_bytes: 200 },
        eth1: { rx_bytes: 50, tx_bytes: 25 },
      },
      blkio_stats: {
        io_service_bytes_recursive: [
          { op: 'Read', value: 10 },
          { op: 'Write', value: 20 },
          { op: 'Sync', value: 999 },
        ],
      },
    });

    expect(stats).toMatchObject({
      containerId: 'c1',
      memoryUsedBytes: 500,
      memoryLimitBytes: 2048,
      networkRxBytes: 150,
      networkTxBytes: 225,
      blockReadBytes: 10,
      blockWriteBytes: 20,
      pids: 42,
      sampledAt: '2026-08-26T10:00:00.000Z',
    });
  });
});
