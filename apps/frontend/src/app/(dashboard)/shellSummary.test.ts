import { type HostNodeDto, type ServerLiveStats } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { server } from '@/components/servers/testFixtures';
import { buildStatusMetrics, ownServersForNav } from './shellSummary';

/**
 * Tests der Gesamtstatus-Leiste.
 *
 * Geprüft wird die Rechnung, nicht die Darstellung: welche Kennzahlen bei
 * welcher Datenlage erscheinen und was sie anzeigen, wenn Messwerte fehlen.
 */

function usage(cpuPercent: number | null, diskUsedMb: number | null = 102400) {
  return { cpuPercent, ramUsedMb: 3072, diskUsedMb, sampledAt: '2026-08-31T12:00:00.000Z' };
}

function node(overrides: Partial<HostNodeDto> = {}): HostNodeDto {
  return {
    id: 'node-1',
    name: 'Node Alpha',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: {
      total: { ramMb: 16384, cpuCores: 8, diskMb: 512000 },
      allocated: { ramMb: 4096, cpuCores: 2, diskMb: 20480 },
      available: { ramMb: 12288, cpuCores: 6, diskMb: 491520 },
    },
    usage: usage(40),
    serverCount: 1,
    lastSeenAt: '2026-08-31T12:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: { canView: true, canManage: false, canManageStorage: false },
    ...overrides,
  };
}

function stats(overrides: Partial<ServerLiveStats> = {}): ServerLiveStats {
  return {
    cpuPercent: null,
    ramUsedMb: null,
    diskUsedMb: null,
    pingMs: null,
    playersOnline: null,
    playersMax: null,
    networkRxBytes: null,
    networkTxBytes: null,
    updatedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  };
}

function valueOf(metrics: ReturnType<typeof buildStatusMetrics>, key: string): string | undefined {
  return metrics.find((metric) => metric.key === key)?.value;
}

describe('buildStatusMetrics', () => {
  it('zählt nur laufende Server als online', () => {
    const metrics = buildStatusMetrics({
      servers: [
        server({ id: 'a', status: 'running' }),
        server({ id: 'b', status: 'starting' }),
        server({ id: 'c', status: 'stopped' }),
      ],
      nodes: null,
      statsById: {},
    });

    // `starting` läuft noch nicht – der Server gilt erst als online, wenn er
    // erreichbar ist (Pflichtenheft §9).
    expect(valueOf(metrics, 'servers')).toBe('1/3');
  });

  it('summiert Spieler nur über laufende Server, die Zahlen melden', () => {
    const metrics = buildStatusMetrics({
      servers: [
        server({ id: 'a', status: 'running' }),
        server({ id: 'b', status: 'running' }),
        server({ id: 'c', status: 'stopped' }),
      ],
      nodes: null,
      statsById: {
        a: stats({ playersOnline: 5 }),
        b: stats({ playersOnline: 7 }),
        c: stats({ playersOnline: 99 }),
      },
    });

    expect(valueOf(metrics, 'players')).toBe('12');
  });

  it('zeigt einen Strich, solange kein Server eine Spielerzahl meldet', () => {
    const metrics = buildStatusMetrics({
      servers: [server({ id: 'a', status: 'running' })],
      nodes: null,
      statsById: { a: stats() },
    });

    expect(valueOf(metrics, 'players')).toBe('—');
  });

  it('lässt die Node-Kennzahlen weg, wenn das Konto Nodes nicht sehen darf', () => {
    const metrics = buildStatusMetrics({
      servers: [server({ id: 'a' })],
      nodes: null,
      statsById: {},
    });

    expect(metrics.map((metric) => metric.key)).toEqual(['servers', 'players']);
  });

  it('mittelt die CPU-Last über die verbundenen Nodes', () => {
    const metrics = buildStatusMetrics({
      servers: [],
      nodes: [
        node({ id: 'n1', usage: usage(30) }),
        node({ id: 'n2', usage: usage(50) }),
        // Offline zählt nicht mit, sonst zöge eine tote Node den Schnitt herunter.
        node({ id: 'n3', status: 'offline', usage: usage(0) }),
      ],
      statsById: {},
    });

    expect(valueOf(metrics, 'cpu')).toBe('40%');
    expect(valueOf(metrics, 'nodes')).toBe('2/3');
  });

  it('zeigt beim RAM den gebuchten, bei der Platte den gemessenen Anteil', () => {
    const metrics = buildStatusMetrics({
      servers: [],
      nodes: [node()],
      statsById: {},
    });

    expect(valueOf(metrics, 'ram')).toBe('4 GB/16 GB');
    expect(valueOf(metrics, 'disk')).toBe('100 GB/500 GB');
  });

  it('zeigt einen Strich, solange keine Node eine Plattenbelegung meldet', () => {
    const metrics = buildStatusMetrics({
      servers: [],
      nodes: [node({ usage: null })],
      statsById: {},
    });

    expect(valueOf(metrics, 'disk')).toBe('—');
    expect(valueOf(metrics, 'cpu')).toBe('—');
  });

  it('blendet Bewegung, Fehler und Updates nur ein, wenn es etwas zu melden gibt', () => {
    const ruhig = buildStatusMetrics({
      servers: [server({ id: 'a', status: 'running' })],
      nodes: null,
      statsById: {},
    });

    expect(ruhig.map((metric) => metric.key)).not.toContain('motion');
    expect(ruhig.map((metric) => metric.key)).not.toContain('faulted');
    expect(ruhig.map((metric) => metric.key)).not.toContain('update');

    const unruhig = buildStatusMetrics({
      servers: [
        server({ id: 'a', status: 'starting' }),
        server({ id: 'b', status: 'creating' }),
        server({ id: 'c', status: 'error' }),
        server({ id: 'd', status: 'crashed' }),
        { ...server({ id: 'e', status: 'running' }), updateAvailable: true },
      ],
      nodes: null,
      statsById: {},
    });

    expect(valueOf(unruhig, 'motion')).toBe('2');
    expect(valueOf(unruhig, 'faulted')).toBe('2');
    expect(valueOf(unruhig, 'update')).toBe('1');
  });
});

describe('ownServersForNav', () => {
  it('nimmt nur eigene Server und sortiert sie nach Namen', () => {
    const list = ownServersForNav(
      [
        server({ id: 'a', name: 'Zeltlager', ownerId: 'user-1' }),
        server({ id: 'b', name: 'Baumhaus', ownerId: 'user-1' }),
        server({ id: 'c', name: 'Fremder', ownerId: 'user-2' }),
      ],
      'user-1',
    );

    expect(list.map((entry) => entry.name)).toEqual(['Baumhaus', 'Zeltlager']);
    expect(list.map((entry) => entry.initials)).toEqual(['BA', 'ZE']);
  });

  it('liefert nichts, solange kein Konto geladen ist', () => {
    expect(ownServersForNav([server({ id: 'a' })], null)).toEqual([]);
  });
});
