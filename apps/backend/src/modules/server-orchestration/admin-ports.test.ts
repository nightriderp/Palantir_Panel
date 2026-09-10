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
import {
  createAgentNodeConnectionSource,
  createAgentStorageEntryRemover,
  fasseBelegungZusammen,
} from './admin-ports.js';

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

/**
 * Auskunft für die Node-Verwaltung, ob der Agent gerade hängt.
 *
 * Gebraucht beim Ende einer Wartung: Ohne diese Frage schrieb die Verwaltung
 * pauschal `offline`, und `markHostConnected` holte das nur beim nächsten
 * Handshake zurück – ein durchgehend verbundener Agent macht keinen.
 */
describe('Verbindungsauskunft für die Node-Verwaltung', () => {
  it('meldet eine Node mit fertiger Sitzung als verbunden', () => {
    const { agents } = registryMitSitzung();

    expect(createAgentNodeConnectionSource(agents).isConnected(NODE.id)).toBe(true);
  });

  it('meldet eine Node ohne Sitzung als nicht verbunden', () => {
    const { agents } = registryMitSitzung();

    expect(
      createAgentNodeConnectionSource(agents).isConnected('22222222-2222-4222-8222-222222222222'),
    ).toBe(false);
  });

  it('zählt eine noch nicht fertig angemeldete Sitzung nicht als verbunden', () => {
    const agents = new AgentRegistry();
    agents.register({ hostId: NODE.id, isReady: false } as never);

    expect(createAgentNodeConnectionSource(agents).isConnected(NODE.id)).toBe(false);
  });
});

const BELEGUNG_NODE = '11111111-1111-4111-8111-111111111111';
const BELEGUNG_ZWEITE = '22222222-2222-4222-8222-222222222222';

function belegungsZeile(
  status: string,
  ramMb: number,
  cpuCores: number,
  diskMb: number,
  hostId = BELEGUNG_NODE,
) {
  return { hostId, status, resourceLimits: { ramMb, cpuCores, diskMb } };
}

/*
 * Fundpunkt 203: Die Uebersicht zeigte die Summe ueber alle Zustaende, die
 * harte Kapazitaetsschranke rechnete gegen die laufenden Server. Beide Zahlen
 * sind fuer sich richtig - die Anzeige nannte nur nicht, welche sie meint. Hier
 * steht die Rechnung, aus der beide entstehen.
 */
describe('Belegung je Node (Fundpunkt 203)', () => {
  const vierServer = [
    belegungsZeile('running', 8_192, 2, 20_480),
    belegungsZeile('stopped', 4_096, 1, 10_240),
    belegungsZeile('starting', 12_288, 4, 51_200),
    belegungsZeile('stopping', 2_048, 1, 4_096),
  ];

  it('zaehlt gebucht ueber alle Zustaende', () => {
    const belegung = fasseBelegungZusammen(vierServer);

    expect(belegung.get(BELEGUNG_NODE)?.allocated).toEqual({
      ramMb: 26_624,
      cpuCores: 8,
      diskMb: 86_016,
    });
    expect(belegung.get(BELEGUNG_NODE)?.serverCount).toBe(4);
  });

  it('zaehlt laufend nur RAM und CPU der laufenden und startenden Server', () => {
    const belegung = fasseBelegungZusammen(vierServer);

    expect(belegung.get(BELEGUNG_NODE)?.running).toEqual({
      ramMb: 20_480,
      cpuCores: 6,
      // Die Platte zaehlt auch hier ueber alle Zustaende: Der Datenordner
      // bleibt liegen, wenn der Server aus ist.
      diskMb: 86_016,
    });
  });

  it('zaehlt error, crashed und creating nicht als laufend', () => {
    const belegung = fasseBelegungZusammen([
      belegungsZeile('error', 1_024, 0.5, 2_048),
      belegungsZeile('crashed', 6_144, 2, 20_480),
      belegungsZeile('creating', 2_048, 1, 8_192),
    ]);

    expect(belegung.get(BELEGUNG_NODE)?.running).toEqual({
      ramMb: 0,
      cpuCores: 0,
      diskMb: 30_720,
    });
    expect(belegung.get(BELEGUNG_NODE)?.allocated.ramMb).toBe(9_216);
  });

  it('haelt die Nodes auseinander', () => {
    const belegung = fasseBelegungZusammen([
      belegungsZeile('running', 8_192, 2, 20_480),
      belegungsZeile('running', 1_024, 1, 4_096, BELEGUNG_ZWEITE),
    ]);

    expect(belegung.get(BELEGUNG_NODE)?.running?.ramMb).toBe(8_192);
    expect(belegung.get(BELEGUNG_ZWEITE)?.running?.ramMb).toBe(1_024);
  });

  it('liefert fuer keine Zeile eine leere Karte', () => {
    expect(fasseBelegungZusammen([]).size).toBe(0);
  });
});
