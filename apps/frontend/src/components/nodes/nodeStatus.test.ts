import { type GameTypeDto, type HostNodeDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  NODE_EXPLAINERS,
  formatCores,
  nodeHasRoomFor,
  nodeMetrics,
  nodeStatusMeta,
  nodesSummary,
  percentOf,
  smallestGameType,
  startCapacityHint,
} from './nodeStatus';

function node(overrides: Partial<HostNodeDto> = {}): HostNodeDto {
  const total = { ramMb: 16384, cpuCores: 8, diskMb: 512_000 };
  const allocated = { ramMb: 8192, cpuCores: 4, diskMb: 128_000 };
  const available = {
    ramMb: total.ramMb - allocated.ramMb,
    cpuCores: total.cpuCores - allocated.cpuCores,
    diskMb: total.diskMb - allocated.diskMb,
  };
  return {
    id: 'n1',
    name: 'Homeserver',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: { total, allocated, available },
    usage: null,
    serverCount: 3,
    lastSeenAt: '2026-08-27T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: { canView: true, canManage: false, canManageStorage: false },
    ...overrides,
  };
}

function gameType(id: string, ramMb: number, diskMb: number, available = true): GameTypeDto {
  return {
    id,
    name: id,
    description: '',
    iconUrl: null,
    coverImageUrl: null,
    supportsVirtualHostRouting: false,
    supportsWorldImport: false,
    defaultPorts: [],
    resourceDefaults: { ramMb, cpuCores: 1, diskMb },
    configFields: [],
    available,
    unavailableReason: available ? null : 'Kommt später',
  };
}

describe('nodeStatusMeta', () => {
  it('nur online nimmt Starts an', () => {
    expect(nodeStatusMeta('online').acceptsStarts).toBe(true);
    expect(nodeStatusMeta('offline').acceptsStarts).toBe(false);
    expect(nodeStatusMeta('maintenance').acceptsStarts).toBe(false);
  });

  it('trennt Wartung (Hinweis) von Ausfall (Störung) farblich', () => {
    expect(nodeStatusMeta('maintenance').tone).toBe('warning');
    expect(nodeStatusMeta('offline').tone).toBe('danger');
  });
});

describe('percentOf', () => {
  it('rechnet ganze Prozent', () => {
    expect(percentOf(4, 8)).toBe(50);
  });

  it('liefert null ohne Bezugsgröße', () => {
    expect(percentOf(4, 0)).toBeNull();
  });
});

describe('formatCores', () => {
  it('nutzt deutsches Dezimalkomma und Singular', () => {
    expect(formatCores(1)).toBe('1 Kern');
    expect(formatCores(7.5)).toBe('7,5 Kerne');
  });
});

describe('nodeMetrics', () => {
  it('rechnet Belegung aus capacity, nicht aus usage', () => {
    const metrics = nodeMetrics(node());
    const ram = metrics.find((m) => m.key === 'ram');
    expect(ram?.percent).toBe(50);
    expect(ram?.tone).toBe('brand');
  });

  it('färbt eine fast volle Node rot', () => {
    const full = node({
      capacity: {
        total: { ramMb: 16384, cpuCores: 8, diskMb: 512_000 },
        allocated: { ramMb: 16000, cpuCores: 8, diskMb: 512_000 },
        available: { ramMb: 384, cpuCores: 0, diskMb: 0 },
      },
    });
    const ram = nodeMetrics(full).find((m) => m.key === 'ram');
    expect(ram?.tone).toBe('danger');
  });

  it('meldet fehlende Ausstattung als null-Prozent', () => {
    const empty = node({
      capacity: {
        total: { ramMb: 0, cpuCores: 0, diskMb: 0 },
        allocated: { ramMb: 0, cpuCores: 0, diskMb: 0 },
        available: { ramMb: 0, cpuCores: 0, diskMb: 0 },
      },
    });
    expect(nodeMetrics(empty).every((m) => m.percent === null)).toBe(true);
  });
});

describe('nodesSummary', () => {
  it('zählt nur die übergebenen Nodes', () => {
    const summary = nodesSummary([node(), node({ id: 'n2', status: 'offline' })]);
    const online = summary.find((entry) => entry.key === 'online');
    expect(online?.value).toBe('1/2');
  });
});

describe('smallestGameType', () => {
  it('ignoriert gesperrte Typen und nimmt den sparsamsten', () => {
    const result = smallestGameType([
      gameType('gross', 8192, 20000),
      gameType('klein', 1024, 2000),
      gameType('winzig-gesperrt', 256, 500, false),
    ]);
    expect(result?.name).toBe('klein');
  });

  it('liefert null ohne verfügbare Typen', () => {
    expect(smallestGameType([gameType('x', 1024, 2000, false)])).toBeNull();
  });
});

describe('nodeHasRoomFor', () => {
  it('prüft alle drei Ressourcen', () => {
    const n = node();
    expect(nodeHasRoomFor(n, { ramMb: 8192, cpuCores: 4, diskMb: 384_000 })).toBe(true);
    expect(nodeHasRoomFor(n, { ramMb: 8193, cpuCores: 4, diskMb: 384_000 })).toBe(false);
  });
});

describe('startCapacityHint', () => {
  const types = [gameType('klein', 1024, 2000)];

  it('kein Hinweis, solange Platz für den sparsamsten Typ ist', () => {
    expect(startCapacityHint([node()], types)).toBeNull();
  });

  it('warnt, wenn keine Node online ist', () => {
    const hint = startCapacityHint([node({ status: 'offline' })], types);
    expect(hint?.title).toContain('kein Server');
  });

  it('unterscheidet Wartung von Ausfall im Text', () => {
    const hint = startCapacityHint([node({ status: 'maintenance' })], types);
    expect(hint?.description).toContain('Wartung');
  });

  it('warnt, wenn online, aber nirgends genug frei ist', () => {
    const cramped = node({
      capacity: {
        total: { ramMb: 16384, cpuCores: 8, diskMb: 512_000 },
        allocated: { ramMb: 16000, cpuCores: 8, diskMb: 511_000 },
        available: { ramMb: 384, cpuCores: 0, diskMb: 1000 },
      },
    });
    const hint = startCapacityHint([cramped], types);
    expect(hint?.title).toContain('reicht für keinen');
  });

  it('kein Hinweis ohne Nodes (die Übersicht sagt das anders)', () => {
    expect(startCapacityHint([], types)).toBeNull();
  });
});

describe('NODE_EXPLAINERS', () => {
  it('nennt keine sicherheitsrelevanten Interna', () => {
    const text = NODE_EXPLAINERS.map((e) => `${e.title} ${e.body}`)
      .join(' ')
      .toLowerCase();
    expect(text).not.toContain('wireguard');
    expect(text).not.toContain('token');
    expect(text).not.toContain('10.10.0');
  });
});
