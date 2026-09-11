import { type GameTypeDefinition } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { TEST_GAME_TYPE } from './game-registry.js';
import {
  STARTUP_PARAMETERS_ENV,
  STEAM_KONTO_CONTAINER_PATH,
  STEAM_KONTO_HOST_PATH,
  VIRTUAL_HOST_HOSTNAME_LABEL,
  VIRTUAL_HOST_TARGET_PORT_LABEL,
  buildContainerSpec,
  containerSpecFingerprint,
} from './container-spec.js';
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
      hostname: 'mein-server.example.tld',
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

/**
 * Startparameter (WORK_STATUS.md, Punkt 115).
 *
 * Sie wurden gespeichert und angezeigt, erreichten den Container aber nie.
 * Jetzt stehen sie als Umgebungsvariable im Bauplan – und nur dann, wenn
 * wirklich welche gesetzt sind.
 */
describe('Startparameter im Bauplan', () => {
  function spec(record: ServerRecord) {
    return buildContainerSpec({
      server: record,
      definition: TEST_GAME_TYPE,
      containerName: 'palantir-s1',
      dataHostPath: '/srv/palantir/s1',
      hostname: 'mein-server.example.tld',
    });
  }

  it('reicht gesetzte Parameter als Umgebungsvariable durch', () => {
    const mitParametern = server({ startupParameters: '-Xmx4G -Dfoo=bar' });

    expect(spec(mitParametern).env[STARTUP_PARAMETERS_ENV]).toBe('-Xmx4G -Dfoo=bar');
  });

  it('schneidet Leerraum ab', () => {
    expect(spec(server({ startupParameters: '  -Xmx4G  ' })).env[STARTUP_PARAMETERS_ENV]).toBe(
      '-Xmx4G',
    );
  });

  it('lässt die Variable weg, wenn nichts gesetzt ist', () => {
    // Sonst änderte sich der Fingerabdruck jedes bestehenden Containers, und
    // jeder würde beim nächsten Start einmal umsonst neu gebaut (Punkt 114).
    expect(spec(server({ startupParameters: '   ' })).env).not.toHaveProperty(
      STARTUP_PARAMETERS_ENV,
    );
    expect(spec(server()).env).not.toHaveProperty(STARTUP_PARAMETERS_ENV);
  });

  it('macht geänderte Parameter zu einem neuen Fingerabdruck', () => {
    // Damit greift der Neuaufbau aus Punkt 114 auch für diese Änderung.
    expect(containerSpecFingerprint(spec(server({ startupParameters: '-Xmx4G' })))).not.toBe(
      containerSpecFingerprint(spec(server())),
    );
  });
});

/**
 * Hostname-Routing im Bauplan (Pflichtenheft §2.4, §13).
 *
 * Zwei Dinge unterscheiden einen Server mit Hostname-Routing vom Rest, und
 * beide entscheiden sich hier:
 *
 *  1. Er trägt die Labels, aus denen der Agent auf der Gamenode die Routen-
 *     Datei des Reverse-Proxys baut. Ohne sie legt der Agent keine an.
 *  2. Sein primärer Port wird NICHT auf den Host gebunden. Alle Instanzen
 *     teilen sich denselben öffentlichen Port; als Host-Bindung wäre er nach
 *     dem ersten Server belegt.
 *
 * Beides bleibt so lange folgenlos, wie kein Spieltyp
 * `supportsVirtualHostRouting` auf `true` stehen hat - genau deshalb steht es
 * hier und nicht erst im Betrieb.
 */
describe('Hostname-Routing im Bauplan', () => {
  const MIT_ROUTING = { ...TEST_GAME_TYPE, supportsVirtualHostRouting: true };

  function spec(definition = TEST_GAME_TYPE, record = server()) {
    return buildContainerSpec({
      server: record,
      definition,
      containerName: 'palantir-s1',
      dataHostPath: '/srv/palantir/s1',
      hostname: 'mein-server.example.tld',
    });
  }

  it('setzt die Router-Labels bei einem Spieltyp mit dem Flag', () => {
    const labels = spec(MIT_ROUTING).labels ?? {};

    expect(labels[VIRTUAL_HOST_HOSTNAME_LABEL]).toBe('mein-server.example.tld');
    // Der Port IM Container, nicht der öffentliche: Dorthin verbindet der
    // Router über das Spielenetz.
    expect(labels[VIRTUAL_HOST_TARGET_PORT_LABEL]).toBe('8080');
    expect(labels['palantir.serverId']).toBe('s1');
  });

  it('setzt sie bei jedem anderen Spieltyp nicht', () => {
    const labels = spec().labels ?? {};

    expect(labels).not.toHaveProperty(VIRTUAL_HOST_HOSTNAME_LABEL);
    expect(labels).not.toHaveProperty(VIRTUAL_HOST_TARGET_PORT_LABEL);
    expect(labels['palantir.serverId']).toBe('s1');
  });

  it('lässt den primären Port ohne Host-Bindung', () => {
    // Der zweite Server desselben Spiels käme sonst mit „port is already
    // allocated" nicht hoch - beide bekämen dieselbe Nummer.
    expect(spec(MIT_ROUTING).ports).toEqual([]);
  });

  it('bindet die übrigen Ports weiterhin auf den Host', () => {
    const mitZweitport = server({
      assignedPorts: [
        { containerPort: 8080, publicPort: 25_565, protocol: 'tcp', primary: true, label: 'Spiel' },
        {
          containerPort: 8081,
          publicPort: 27_015,
          protocol: 'udp',
          primary: false,
          label: 'Query',
        },
      ],
    });

    expect(spec(MIT_ROUTING, mitZweitport).ports).toEqual([
      { containerPort: 8081, hostPort: 27_015, protocol: 'udp' },
    ]);
  });

  it('bindet ohne das Flag unverändert alle Ports', () => {
    expect(spec().ports).toEqual([{ containerPort: 8080, hostPort: 27_000, protocol: 'tcp' }]);
  });

  it('lässt die Labels weg, wenn es keinen primären Port gibt', () => {
    // Ein Label ohne Ziel wäre schlimmer als keines: Der Agent legte eine
    // Route an, hinter der nichts steht.
    const ohnePrimaer = server({
      assignedPorts: [
        {
          containerPort: 8081,
          publicPort: 27_015,
          protocol: 'udp',
          primary: false,
          label: 'Query',
        },
      ],
    });

    expect(spec(MIT_ROUTING, ohnePrimaer).labels).not.toHaveProperty(VIRTUAL_HOST_HOSTNAME_LABEL);
  });

  it('macht einen geänderten Hostnamen zu einem neuen Fingerabdruck', () => {
    // Sonst behielte ein umbenannter Server seine alte Route bis zum nächsten
    // Neuaufbau aus anderem Grund.
    const anderer = buildContainerSpec({
      server: server(),
      definition: MIT_ROUTING,
      containerName: 'palantir-s1',
      dataHostPath: '/srv/palantir/s1',
      hostname: 'anderer-name.example.tld',
    });

    expect(containerSpecFingerprint(anderer)).not.toBe(containerSpecFingerprint(spec(MIT_ROUTING)));
  });

  it('lässt den Fingerabdruck ohne das Flag unberührt vom Hostnamen', () => {
    const anderer = buildContainerSpec({
      server: server(),
      definition: TEST_GAME_TYPE,
      containerName: 'palantir-s1',
      dataHostPath: '/srv/palantir/s1',
      hostname: 'anderer-name.example.tld',
    });

    expect(containerSpecFingerprint(anderer)).toBe(containerSpecFingerprint(spec()));
  });
});

/**
 * Ein Port, der drinnen dieselbe Nummer traegt wie draussen
 * (`usesPublicPortNumber`).
 *
 * Gewoehnlich lauscht der Container auf seiner festen Nummer und der Pool
 * vergibt nach aussen eine beliebige freie. Spiele, die ihre eigene Nummer
 * weitersagen - Assetto Corsa Competizione meldet sie dem Lobby-Dienst -,
 * vertragen diese Uebersetzung nicht.
 */
describe('Portnummer im Bauplan', () => {
  const GESPIEGELT: GameTypeDefinition = {
    ...TEST_GAME_TYPE,
    id: 'test-gespiegelt',
    ports: [
      {
        containerPort: 8080,
        protocol: 'tcp',
        primary: true,
        label: 'Test-Port',
        usesPublicPortNumber: true,
        envVar: 'TEST_PUBLIC_PORT',
      },
    ],
  };

  function spec(definition: GameTypeDefinition) {
    return buildContainerSpec({
      server: server(),
      definition,
      containerName: 'palantir-s1',
      dataHostPath: '/srv/palantir/s1',
      hostname: 'mein-server.example.tld',
    });
  }

  it('uebersetzt gewoehnlich zwischen drinnen und draussen', () => {
    expect(spec(TEST_GAME_TYPE).ports).toEqual([
      { containerPort: 8080, hostPort: 27_000, protocol: 'tcp' },
    ]);
  });

  it('nimmt mit `usesPublicPortNumber` drinnen dieselbe Nummer', () => {
    expect(spec(GESPIEGELT).ports).toEqual([
      { containerPort: 27_000, hostPort: 27_000, protocol: 'tcp' },
    ]);
  });

  it('nennt dem Image die oeffentliche Nummer', () => {
    // Ohne sie koennte das Image sie nicht in seine Konfiguration schreiben.
    expect(spec(GESPIEGELT).env.TEST_PUBLIC_PORT).toBe('27000');
  });

  it('setzt ohne `envVar` keine Variable', () => {
    // Eine leere Variable an jedem Container aenderte den Fingerabdruck aller
    // bestehenden und baute sie einmal umsonst neu (Punkt 114).
    expect(Object.keys(spec(TEST_GAME_TYPE).env)).not.toContain('TEST_PUBLIC_PORT');
  });
});

/**
 * Die Steam-Anmeldung im Bauplan (2026-09-11).
 *
 * Ein paar Spiele geben ihren dedizierten Server nicht anonym heraus. Fuer sie
 * liegt auf der Node ein Anmelde-Token; er wird schreibgeschuetzt eingehaengt -
 * und nur bei diesen Spielen.
 */
describe('Steam-Anmeldung im Bauplan', () => {
  const MIT_KONTO: GameTypeDefinition = {
    ...TEST_GAME_TYPE,
    id: 'test-steam-konto',
    requiresSteamAccount: true,
  };

  function spec(definition: GameTypeDefinition) {
    return buildContainerSpec({
      server: server(),
      definition,
      containerName: 'palantir-s1',
      dataHostPath: '/srv/palantir/s1',
      hostname: 'mein-server.example.tld',
    });
  }

  it('haengt den Ordner schreibgeschuetzt ein, wenn das Spiel ihn braucht', () => {
    expect(spec(MIT_KONTO).extraMounts).toEqual([
      {
        hostPath: STEAM_KONTO_HOST_PATH,
        containerPath: STEAM_KONTO_CONTAINER_PATH,
        readOnly: true,
      },
    ]);
  });

  it('zeigt ihn keinem anderen Container', () => {
    // Ein Token, den jeder Spielserver lesen kann, waere ein Token, den jedes
    // Spiel-Image verlieren kann.
    expect(spec(TEST_GAME_TYPE).extraMounts).toBeUndefined();
  });

  it('aendert den Fingerabdruck, wenn die Einhaengung dazukommt', () => {
    // Sonst liefe ein bestehender Container ohne den Ordner weiter, und das
    // Panel meldete nichts.
    expect(containerSpecFingerprint(spec(MIT_KONTO))).not.toBe(
      containerSpecFingerprint(spec(TEST_GAME_TYPE)),
    );
  });
});
