import { describe, expect, it } from 'vitest';
import { toGameServerDto } from './dto.js';
import { ALLE_GAME_TYPE_DEFINITIONS, TEST_GAME_TYPE, createGameRegistry } from './game-registry.js';
import { type ServerRecord } from './repository.js';
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
    gameType,
    status: 'stopped',
    statusMessage: null,
    hostId: '33333333-3333-4333-8333-333333333333',
    hostName: 'Homeserver',
    subdomain: 'alt',
    assignedPorts: [
      { publicPort: 25_001, containerPort: 25_565, protocol: 'tcp', label: 'Spiel', primary: true },
    ],
    resourceLimits: { ramMb: 2048, cpuCores: 1, diskMb: 10_240 },
    configJson: {},
    startupParameters: '',
    autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 10 },
    restartRequired: false,
    dockerContainerId: null,
    imageRef: 'ghcr.io/nightriderp/palantir-test-echo:1',
    crashTimestamps: [],
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
    // Ohne bekannte Definition gibt es keine Soll-Fassung zum Vergleichen.
    expect(dto.updateAvailable).toBe(false);
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
