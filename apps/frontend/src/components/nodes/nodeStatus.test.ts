import { type GameTypeDto, type HostNodeDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { formatCores, formatMegabytes, percentOf } from '@/components/shared';
import {
  NODE_EXPLAINERS,
  nodeAgentHint,
  nodeHasRoomFor,
  nodeMetrics,
  nodeStatusMeta,
  nodesSummary,
  smallestGameType,
  startCapacityHint,
} from './nodeStatus';

function node(overrides: Partial<HostNodeDto> = {}): HostNodeDto {
  const total = { ramMb: 16384, cpuCores: 8, diskMb: 512_000 };
  const allocated = { ramMb: 8192 };
  const available = { ramMb: total.ramMb - allocated.ramMb };
  return {
    id: 'n1',
    name: 'Homeserver',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: { total, allocated, available },
    /*
     * Die Node misst. RAM wie Platz stehen nur noch hier – zugewiesen wird
     * beides nicht mehr fest. Der RAM-Wert weicht bewusst von der Buchung ab:
     * Die Karte rechnet aus der Messung, und das soll ein Test zeigen können.
     */
    usage: {
      cpuPercent: 12,
      ramUsedMb: 15_000,
      diskUsedMb: 128_000,
      sampledAt: '2026-08-27T10:00:00.000Z',
      source: 'measured',
    },
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
    resourceDefaults: { ramMb, diskMb },
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

/*
 * Seit der weichen RAM-Zuweisung (Betreiber-Entscheidung 2026-09-18) zeigt die
 * Karte beim RAM die Messung, nicht die Buchung: Ein Server darf ueber seiner
 * Zuweisung liegen, solange die Node Platz hat – die Summe der Buchungen sagt
 * also nichts mehr darueber, wie voll die Maschine ist. Damit sind auch die
 * Zusaetze „ueberbucht" (Fundpunkt 209) und „davon laufend" (Fundpunkt 203)
 * gegenstandslos: Beide verglichen Buchungen.
 */
describe('nodeMetrics', () => {
  it('rechnet die RAM-Belegung aus der Messung, nicht aus capacity', () => {
    // 15 000 von 16 384 MiB gemessen – gebucht waeren nur 8 192.
    const ram = nodeMetrics(node()).find((m) => m.key === 'ram');
    expect(ram?.percent).toBe(92);
    expect(ram?.tone).toBe('warning');
    expect(ram?.usedLabel).toBe(formatMegabytes(15_000));
    expect(ram?.freeLabel).toBe(formatMegabytes(16_384 - 15_000));
  });

  it('laesst eine ueberbuchte, aber gemessen halbleere Node gruen', () => {
    const ueberbucht = node({
      capacity: {
        total: { ramMb: 28_672, cpuCores: 8, diskMb: 512_000 },
        allocated: { ramMb: 32_768 },
        available: { ramMb: 0 },
      },
      usage: {
        cpuPercent: 12,
        ramUsedMb: 10_000,
        diskUsedMb: 128_000,
        sampledAt: '2026-08-27T10:00:00.000Z',
        source: 'measured',
      },
    });
    const ram = nodeMetrics(ueberbucht).find((m) => m.key === 'ram');
    expect(ram?.percent).toBe(35);
    expect(ram?.tone).toBe('brand');
  });

  it('zeigt ohne Messung beim RAM einen Strich, keine Buchung', () => {
    const ram = nodeMetrics(node({ usage: null })).find((m) => m.key === 'ram');
    expect(ram?.percent).toBeNull();
    expect(ram?.usedLabel).toBe('—');
    expect(ram?.freeLabel).toBe('—');
    expect(ram?.tone).toBe('neutral');
  });

  it('färbt eine gemessen fast volle Node rot', () => {
    const full = node({
      usage: {
        cpuPercent: 12,
        ramUsedMb: 16_000,
        diskUsedMb: 128_000,
        sampledAt: '2026-08-27T10:00:00.000Z',
        source: 'measured',
      },
    });
    const ram = nodeMetrics(full).find((m) => m.key === 'ram');
    expect(ram?.tone).toBe('danger');
  });

  it('meldet fehlende Ausstattung als null-Prozent', () => {
    const empty = node({
      capacity: {
        total: { ramMb: 0, cpuCores: 8, diskMb: 0 },
        allocated: { ramMb: 0 },
        available: { ramMb: 0 },
      },
      usage: null,
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

  /*
   * Die beiden Kennzahlen beantworten verschiedene Fragen, so wie im Entwurf:
   * „RAM gebucht" zeigt das Vergebene, „Platte frei" das Verbleibende. Die
   * Beschriftung darf deshalb nie ohne den passenden Wert geändert werden.
   */
  it('nimmt beim RAM das Gemessene und beim Platz das Freie', () => {
    const summary = nodesSummary([node(), node({ id: 'n2' })]);

    const ram = summary.find((entry) => entry.key === 'ram');
    expect(ram?.label).toBe('RAM belegt');
    // 2 × 15 000 MiB gemessen – nicht die 2 × 8192 MiB, die gebucht sind.
    expect(ram?.value).toBe(formatMegabytes(2 * 15_000));

    const disk = summary.find((entry) => entry.key === 'disk');
    expect(disk?.label).toBe('Platte frei');
    expect(disk?.value).toBe(formatMegabytes(2 * (512_000 - 128_000)));
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
  it('prüft den RAM gegen die freie Buchung', () => {
    const n = node();
    expect(nodeHasRoomFor(n, { ramMb: 8192, diskMb: 384_000 })).toBe(true);
    expect(nodeHasRoomFor(n, { ramMb: 8193, diskMb: 384_000 })).toBe(false);
  });

  it('prüft den Platz gegen die Messung, nicht gegen eine Buchung', () => {
    const n = node();
    expect(nodeHasRoomFor(n, { ramMb: 1024, diskMb: 384_001 })).toBe(false);
  });

  it('lässt eine ungemessene Node beim Platz durch', () => {
    // Ohne Messung gibt es keine Zahl; eine Absage wäre geraten.
    expect(nodeHasRoomFor(node({ usage: null }), { ramMb: 1024, diskMb: 9_000_000 })).toBe(true);
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
        allocated: { ramMb: 16000 },
        available: { ramMb: 384 },
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

describe('nodeAgentHint', () => {
  const agent = {
    version: '1.4.2',
    protocolVersion: 1,
    expectedProtocolVersion: 1,
    compatible: true,
    reportedAt: '2026-09-16T10:00:00.000Z',
  };

  it('ist null, solange sich kein Agent gemeldet hat', () => {
    expect(nodeAgentHint(node())).toBeNull();
    expect(nodeAgentHint(node({ agent: null }))).toBeNull();
  });

  it('nennt die Fassung ohne Warnung, wenn das Protokoll passt', () => {
    expect(nodeAgentHint(node({ agent }))).toEqual({ label: 'Agent 1.4.2', warning: null });
  });

  it('warnt mit beiden Protokollnummern und dem Handgriff, wenn es nicht passt', () => {
    const hint = nodeAgentHint(
      node({ agent: { ...agent, protocolVersion: 3, compatible: false } }),
    );

    expect(hint?.label).toBe('Agent 1.4.2');
    expect(hint?.warning).toContain('Protokoll 3, erwartet 1');
    expect(hint?.warning).toContain('aktualisieren');
  });
});
