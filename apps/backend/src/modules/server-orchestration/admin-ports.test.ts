/**
 * Tests der Umsetzung, die einen Posten der Speicherübersicht entfernt
 * (WORK_STATUS.md, Gefundener Punkt 75).
 *
 * Geprüft wird die Zuordnung „Posten → Agent-Befehl" und die Grenze, welche
 * Arten überhaupt hierüber verschwinden dürfen. Der Agent wird dafür durch eine
 * Sitzung ersetzt, die nur die Befehle mitschreibt (CLAUDE.md §4).
 */

import { type StorageEntryDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from './agent-gateway.js';
import { createAgentStorageEntryRemover } from './admin-ports.js';

const NODE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online' as const,
  totalResources: { ramMb: 32_768, cpuCores: 8, diskMb: 2_000_000 },
  statusMessage: null,
  lastSeenAt: null,
  hasAgentToken: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

function eintrag(overrides: Partial<StorageEntryDto> = {}): StorageEntryDto {
  return {
    id: '/srv/palantir/backups/a.tar.zst',
    kind: 'backup',
    label: 'Sicherung',
    path: '/srv/palantir/backups/a.tar.zst',
    sizeBytes: 4_096,
    serverId: null,
    backupId: null,
    imageTag: null,
    inUse: false,
    lastModifiedAt: null,
    deleteBlockedReason: null,
    ...overrides,
  } as StorageEntryDto;
}

/** Registry mit einer Sitzung, die jeden Befehl mitschreibt und Erfolg meldet. */
function registryMitSitzung(): {
  agents: AgentRegistry;
  befehle: { command: string; payload: unknown }[];
} {
  const befehle: { command: string; payload: unknown }[] = [];
  const agents = new AgentRegistry();

  agents.register({
    hostId: NODE.id,
    isReady: true,
    sendCommand: (command: string, _serverId: unknown, payload: unknown) => {
      befehle.push({ command, payload });

      return Promise.resolve({ removed: true, freedBytes: 4_096 });
    },
  } as never);

  return { agents, befehle };
}

describe('Speicher-Posten entfernen (Gefundener Punkt 75)', () => {
  it('schickt eine Sicherung mit ihrem Pfad an den Agent', async () => {
    const { agents, befehle } = registryMitSitzung();

    const antwort = await createAgentStorageEntryRemover(agents).remove(NODE, eintrag());

    expect(antwort.success).toBe(true);
    expect(befehle).toEqual([
      {
        command: 'REMOVE_STORAGE_ENTRY',
        payload: { kind: 'backup', path: '/srv/palantir/backups/a.tar.zst' },
      },
    ]);
  });

  it('schickt ein Image mit seiner Id statt eines Pfades', async () => {
    const { agents, befehle } = registryMitSitzung();

    await createAgentStorageEntryRemover(agents).remove(
      NODE,
      eintrag({ id: 'sha256:abc', kind: 'dockerImage', path: null, imageTag: 'spiel:v1' }),
    );

    expect(befehle[0]?.payload).toEqual({ kind: 'dockerImage', imageId: 'sha256:abc' });
  });

  it('lässt den Datenordner eines Servers gar nicht erst hinaus', async () => {
    const { agents, befehle } = registryMitSitzung();

    const antwort = await createAgentStorageEntryRemover(agents).remove(
      NODE,
      eintrag({ kind: 'serverData', path: '/srv/palantir/servers/abc' }),
    );

    // Ein Server wird über das Löschen des Servers entfernt, nicht hierüber.
    expect(antwort.success).toBe(false);
    expect(befehle).toEqual([]);
  });

  it('meldet eine fehlende Agent-Verbindung, statt es zu versuchen', async () => {
    const antwort = await createAgentStorageEntryRemover(new AgentRegistry()).remove(
      NODE,
      eintrag(),
    );

    expect(antwort.success).toBe(false);
    expect(antwort.error?.code).toBe('AGENT_NOT_CONNECTED');
  });
});
