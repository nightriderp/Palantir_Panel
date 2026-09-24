import { describe, expect, it } from 'vitest';
import { toGameServerDto } from './dto.js';
import { ALLE_GAME_TYPE_DEFINITIONS, TEST_GAME_TYPE, createGameRegistry } from './game-registry.js';
import { type ServerRecord } from './repository.js';
import { imageVersionLabel } from './image-version.js';
import { type PermissionActor } from '../rbac/index.js';

/**
 * Der DTO eines Servers, dessen Spieltyp der Katalog nicht (mehr) kennt
 * (Fundpunkt 247).
 *
 * Am laufenden Prüfstand aufgetreten: Nachdem die Prüfstands-Spieltypen aus
 * `GAME_TYPE_DEFINITIONS` genommen wurden (#346), beantwortete
 * `GET /api/servers` die **ganze** Liste mit `404 GAME_TYPE_NOT_FOUND` – für
 * jedes Konto. Ein einzelner Datensatz nahm allen die Übersicht, und der
 * betroffene Server war über die Oberfläche nicht einmal mehr zu löschen.
 *
 * Dieselbe Klasse wie Fundpunkt 224 (eine unbekannte Postenart legte die
 * Speicherübersicht lahm): Ein Wert, den die Datenbank hergibt, muss die
 * Anzeige aushalten.
 */

const OWNER_ID = '11111111-1111-4111-8111-111111111111';

/** Besitzerin mit den eigenen Rechten – mehr braucht der DTO nicht. */
const ACTOR: PermissionActor = {
  isOwner: false,
  permissions: new Set<string>(['server.view.own', 'server.manage.own', 'server.delete.own']),
  approved: true,
} as unknown as PermissionActor;

function serverMit(gameType: string): ServerRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Alter Server',
    ownerId: OWNER_ID,
    ownerDisplayName: 'Besitzerin',
    ownerAvatarUpdatedAt: null,
    ownerTitleAchievementId: null,
    gameType,
    status: 'stopped',
    statusMessage: null,
    hostId: '33333333-3333-4333-8333-333333333333',
    hostName: 'Homeserver',
    hostStatus: 'online',
    hostCpuCores: 8,
    hostRamMb: null,
    subdomain: 'alt',
    assignedPorts: [
      { publicPort: 25_001, containerPort: 25_565, protocol: 'tcp', label: 'Spiel', primary: true },
    ],
    resourceLimits: { ramMb: 2048 },
    configJson: {},
    startupParameters: '',
    autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 10 },
    restartRequired: false,
    dockerContainerId: null,
    imageRef: 'ghcr.io/nightriderp/palantir-test-echo:1',
    gameVersion: null,
    gameVersionUrl: null,
    gameVersionHash: null,
    gameVersionHashAlgorithm: null,
    crashTimestamps: [],
    totalUptimeSeconds: 0,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    statusChangedAt: new Date('2026-09-01T10:00:00.000Z'),
    lastStartedAt: null,
    lastActivityAt: null,
  } as unknown as ServerRecord;
}

function kontext(registry: ReturnType<typeof createGameRegistry>) {
  return {
    actor: ACTOR,
    viewerId: OWNER_ID,
    viewerMemberLevel: null,
    memberCount: 0,
    registry,
    baseDomain: 'example.tld',
    recentCrashCount: 0,
  };
}

describe('toGameServerDto – unbekannter Spieltyp (Fundpunkt 247)', () => {
  /** Katalog **ohne** die Prüfstände – genau die Lage nach #346. */
  const ohnePruefstaende = createGameRegistry(3, [
    ...ALLE_GAME_TYPE_DEFINITIONS.filter((definition) => definition.id !== TEST_GAME_TYPE.id),
  ]);

  it('reicht die Kerne der Node durch – Bezugsgroesse der CPU-Anzeige', () => {
    /*
     * `cpuPercent` zaehlt in Prozent EINES Kerns. Ohne diese Zahl kann die
     * Detailansicht daraus keinen Anteil bilden und zeigt die nackte Kernzahl -
     * "2,5 Kerne" sagt nicht, ob die Maschine am Anschlag laeuft.
     */
    const dto = toGameServerDto(serverMit(TEST_GAME_TYPE.id), kontext(ohnePruefstaende));

    expect(dto.hostCpuCores).toBe(8);
  });

  it('baut den DTO trotzdem, statt zu werfen', () => {
    const dto = toGameServerDto(serverMit(TEST_GAME_TYPE.id), kontext(ohnePruefstaende));

    expect(dto.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(dto.gameType).toBe(TEST_GAME_TYPE.id);
    expect(dto.gameTypeName).toContain(TEST_GAME_TYPE.id);
  });

  it('bleibt bei der vorsichtigen Seite: keine Konsole, kein Update-Hinweis', () => {
    const dto = toGameServerDto(serverMit('gibt-es-nicht'), kontext(ohnePruefstaende));

    expect(dto.supportsConsole).toBe(false);
    expect(dto.consoleQuickCommands).toEqual([]);
    // Ohne bekannte Definition gibt es keine Soll-Version zum Vergleichen.
    expect(dto.updateAvailable).toBe(false);
  });

  it('zeigt die gefahrene und die angebotene Version', () => {
    const registry = createGameRegistry(3, ALLE_GAME_TYPE_DEFINITIONS);
    const dto = toGameServerDto(serverMit(TEST_GAME_TYPE.id), kontext(registry));

    // Der Prueftand faehrt Marke 1; angeboten wird, was in der Definition
    // steht. Beides zusammen macht den Update-Hinweis erst lesbar.
    expect(dto.imageVersion).toBe('1');
    expect(dto.latestImageVersion).toBe(imageVersionLabel(TEST_GAME_TYPE.dockerImage));
  });

  it('lässt den Server löschbar – sonst käme man nie an ihn heran', () => {
    const dto = toGameServerDto(serverMit('gibt-es-nicht'), kontext(ohnePruefstaende));

    expect(dto.permissions.canDelete).toBe(true);
  });

  it('ändert nichts an einem bekannten Spieltyp', () => {
    const registry = createGameRegistry(3, ALLE_GAME_TYPE_DEFINITIONS);
    const dto = toGameServerDto(serverMit(TEST_GAME_TYPE.id), kontext(registry));

    expect(dto.gameTypeName).toBe(TEST_GAME_TYPE.name);
  });
});

describe('toGameServerDto – weitere Adressen (CS2 GOTV)', () => {
  const registry = createGameRegistry(3, ALLE_GAME_TYPE_DEFINITIONS);

  function cs2(gotv: boolean): ServerRecord {
    return {
      ...serverMit('cs2'),
      configJson: { gotv },
      assignedPorts: [
        {
          publicPort: 25_003,
          containerPort: 27_015,
          protocol: 'tcp',
          label: 'Spiel-Port',
          primary: true,
        },
        {
          publicPort: 25_003,
          containerPort: 27_015,
          protocol: 'udp',
          label: 'Spiel-Port',
          primary: false,
        },
        {
          publicPort: 25_004,
          containerPort: 27_020,
          protocol: 'udp',
          label: 'GOTV',
          primary: false,
        },
      ],
    } as ServerRecord;
  }

  it('zeigt GOTV, solange der Schalter an ist', () => {
    expect(toGameServerDto(cs2(true), kontext(registry)).address?.extra).toEqual([
      { label: 'GOTV', port: 25_004 },
    ]);
  });

  it('lässt GOTV weg, wenn der Schalter aus ist – hinter der Adresse antwortete nichts', () => {
    expect(toGameServerDto(cs2(false), kontext(registry)).address).not.toHaveProperty('extra');
  });
});

describe('toGameServerDto – Adresse kopieren', () => {
  const registry = createGameRegistry(3, ALLE_GAME_TYPE_DEFINITIONS);

  it('gibt bei CS2 den Vorsatz „connect “ mit – nur fürs Kopieren', () => {
    const dto = toGameServerDto(serverMit('cs2'), kontext(registry));

    expect(dto.address).toEqual({
      hostname: 'alt.example.tld',
      port: 25_001,
      copyPrefix: 'connect ',
    });
  });

  it('lässt ihn bei Spielen ohne Vorsatz weg', () => {
    const dto = toGameServerDto(serverMit(TEST_GAME_TYPE.id), kontext(registry));

    expect(dto.address).not.toHaveProperty('copyPrefix');
  });
});
