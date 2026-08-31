/**
 * Auslastung je Node (R2, Gefundener Punkt 42).
 *
 * Der Punkt der Prüfung ist nicht die Prozentrechnung, sondern die Herkunft:
 * Die Zahlen kommen aus **derselben** Belegung, gegen die die harte
 * Kapazitätsprüfung vor jedem Start rechnet (Pflichtenheft §10) – nicht aus
 * einer zweiten Zählung.
 */

import { type NodeResourceUsage, type UserResourceUsage } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { createNodeUsageSource } from './node-usage.js';
import {
  type HostNodeRecord,
  type HostNodeRepository,
  type ServerUsageRepository,
} from './ports.js';

const NODE: HostNodeRecord = {
  id: 'node-1',
  name: 'Homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online',
  totalResources: { ramMb: 16_384, cpuCores: 8, diskMb: 2_000_000 },
};

const AT = new Date('2026-08-26T12:00:00.000Z');

function nodeRepository(nodes: readonly HostNodeRecord[]): HostNodeRepository {
  return {
    findById: (id) => Promise.resolve(nodes.find((node) => node.id === id) ?? null),
    listAll: () => Promise.resolve([...nodes]),
  };
}

function usageRepository(usage: NodeResourceUsage): ServerUsageRepository & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    usageForUser: (): Promise<UserResourceUsage> => {
      throw new Error('Die Node-Übersicht fragt nicht nach Nutzer-Belegung.');
    },
    usageForUsers: (): Promise<ReadonlyMap<string, UserResourceUsage>> => {
      throw new Error('Die Node-Übersicht fragt nicht nach Nutzer-Belegung.');
    },
    usageForNode: (nodeId): Promise<NodeResourceUsage> => {
      calls.push(nodeId);

      return Promise.resolve(usage);
    },
  };
}

describe('Auslastung je Node (Lastenheft §3.7)', () => {
  it('rechnet die Belegung aus `game_servers` in `HostNodeUsage` um', async () => {
    const usage = usageRepository({
      runningRamMb: 4096,
      runningCpuCores: 2,
      allocatedDiskMb: 120_000,
      runningServers: 2,
      totalServers: 5,
    });

    const source = createNodeUsageSource({
      nodes: nodeRepository([NODE]),
      usage,
      now: () => AT,
    });

    const result = await source.load();

    expect(usage.calls).toEqual([NODE.id]);
    expect(result.get(NODE.id)).toEqual({
      // 2 von 8 Kernen – bezogen auf die ganze Node, nicht auf einen Kern.
      cpuPercent: 25,
      ramUsedMb: 4096,
      // Speicherplatz zählt über alle Server, auch die gestoppten.
      diskUsedMb: 120_000,
      sampledAt: AT.toISOString(),
    });
  });

  it('meldet keinen Prozentwert, wenn die Node keine Kerne führt', async () => {
    const source = createNodeUsageSource({
      nodes: nodeRepository([{ ...NODE, totalResources: { ramMb: 0, cpuCores: 0, diskMb: 0 } }]),
      usage: usageRepository({
        runningRamMb: 0,
        runningCpuCores: 0,
        allocatedDiskMb: 0,
        runningServers: 0,
        totalServers: 0,
      }),
      now: () => AT,
    });

    expect((await source.load()).get(NODE.id)?.cpuPercent).toBeNull();
  });

  it('liefert für eine Installation ohne Nodes eine leere Zuordnung', async () => {
    const source = createNodeUsageSource({
      nodes: nodeRepository([]),
      usage: usageRepository({
        runningRamMb: 0,
        runningCpuCores: 0,
        allocatedDiskMb: 0,
        runningServers: 0,
        totalServers: 0,
      }),
      now: () => AT,
    });

    expect((await source.load()).size).toBe(0);
  });
});
