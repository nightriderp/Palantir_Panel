import { describe, expect, it } from 'vitest';
import { TEST_GAME_TYPE } from './game-registry.js';
import { buildContainerSpec, containerSpecFingerprint } from './container-spec.js';
import { type ServerRecord } from './repository.js';

/**
 * Fingerabdruck des Bauplans (WORK_STATUS.md, Punkt 114).
 *
 * Er entscheidet, ob ein Container vor dem Start neu gebaut wird. Zu oft
 * ausgelöst heißt: jeder Start baut neu und dauert Minuten. Zu selten heißt:
 * eine geänderte Konfiguration wirkt nie. Beide Richtungen stehen hier.
 */

function server(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: 's1',
    ownerId: 'u1',
    ownerDisplayName: 'Ich',
    hostId: 'n1',
    hostName: 'Homeserver',
    name: 'Mein Server',
    gameType: TEST_GAME_TYPE.id,
    status: 'stopped',
    statusMessage: null,
    statusChangedAt: '2026-09-01T10:00:00.000Z',
    lastStartedAt: null,
    lastActivityAt: null,
    crashTimestamps: [],
    dockerContainerId: 'container-1',
    imageRef: TEST_GAME_TYPE.dockerImage,
    containerSpecHash: null,
    subdomain: 'mein-server',
    dnsRecordId: 'dns-1',
    assignedPorts: [
      {
        containerPort: 8080,
        publicPort: 27_000,
        protocol: 'tcp',
        primary: true,
        label: 'Test-Port',
      },
    ],
    resourceLimits: TEST_GAME_TYPE.resourceDefaults,
    configJson: { greeting: 'Hallo', motdEnabled: true },
    startupParameters: '',
    autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 5 },
    restartRequired: false,
    clonedFromServerId: null,
    createdAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  };
}

function fingerabdruck(record: ServerRecord, definition = TEST_GAME_TYPE): string {
  return containerSpecFingerprint(
    buildContainerSpec({
      server: record,
      definition,
      containerName: 'palantir-s1',
      dataHostPath: '/srv/palantir/s1',
    }),
  );
}

describe('containerSpecFingerprint', () => {
  it('bleibt gleich, solange sich nichts ändert', () => {
    expect(fingerabdruck(server())).toBe(fingerabdruck(server()));
  });

  it('ändert sich mit der Konfiguration', () => {
    const geaendert = server({ configJson: { greeting: 'Moin', motdEnabled: true } });

    expect(fingerabdruck(geaendert)).not.toBe(fingerabdruck(server()));
  });

  it('ändert sich mit dem Image der Definition', () => {
    const neueresImage = { ...TEST_GAME_TYPE, dockerImage: 'ghcr.io/test/echo:2' };

    expect(fingerabdruck(server(), neueresImage)).not.toBe(fingerabdruck(server()));
  });

  it('ändert sich mit den Ressourcengrenzen', () => {
    const groesser = server({
      resourceLimits: { ...TEST_GAME_TYPE.resourceDefaults, ramMb: 2048 },
    });

    expect(fingerabdruck(groesser)).not.toBe(fingerabdruck(server()));
  });

  it('ändert sich mit der Portzuweisung', () => {
    const andererPort = server({
      assignedPorts: [
        {
          containerPort: 8080,
          publicPort: 27_001,
          protocol: 'tcp',
          primary: true,
          label: 'Test-Port',
        },
      ],
    });

    expect(fingerabdruck(andererPort)).not.toBe(fingerabdruck(server()));
  });

  it('ignoriert die Reihenfolge der Schlüssel', () => {
    // Dieselben Werte, andere Reihenfolge im Objekt: derselbe Bau, also
    // derselbe Fingerabdruck – sonst baute ein harmloser Umbau im Code jeden
    // Container neu.
    const andereReihenfolge = server({ configJson: { motdEnabled: true, greeting: 'Hallo' } });

    expect(fingerabdruck(andereReihenfolge)).toBe(fingerabdruck(server()));
  });
});
