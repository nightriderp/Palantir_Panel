/**
 * HTTP-Ebene der Lifecycle- und Zugriffsrouten (Audit W2-29, `test-gaps-02`).
 *
 * Geprüft wird die Stelle, an der Rollen, Mitgliedsstufe und Route
 * zusammenkommen – nicht die Rechteberechnung selbst (die steht in
 * `permissions.test.ts`) und nicht der Dienst (der steht in `service.test.ts`).
 * Der Befund dazu: „Ein Refactoring vertauscht `loadAuthorized(request, id,
 * 'canStart')` gegen `'canView'` – ein `viewer`-Mitglied kann fremde Server
 * starten. Kein Test fällt."
 *
 * Deshalb prüft jeder Fall der Matrix **zwei** Dinge:
 *
 * 1. Statuscode und Fehlercode im Envelope (Pflichtenheft §5.1) und
 * 2. ob der Dienst überhaupt aufgerufen wurde. Ein Guard, der erst nach der
 *    Wirkung greift, wäre sonst nicht von einem Guard davor zu unterscheiden.
 *
 * Die Akteure decken die im Rechtemodell unterschiedenen Fälle ab: Besitzer,
 * Mitglied der Stufe `manager`, `operator` und `viewer`, ein Konto mit
 * `server.*.any`, ein fremdes Konto, ein noch nicht freigeschaltetes Konto
 * (Guard `requireApproved()`, W2-15) und ein anonymer Aufruf.
 *
 * Ohne Datenbank und ohne Agent: Dienst und Repository sind Attrappen, der
 * Zugriff läuft über `app.inject()` (CLAUDE.md §4).
 */

import {
  type AgentContainerStats,
  type ErrorCode,
  type ExecConsoleCommandResult,
  type GetLogsCommandResult,
  type ServerMemberLevel,
} from '@palantir/contracts';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { ServerOrchestrationError } from './errors.js';
import { createGameRegistry } from './game-registry.js';
import { type ServerMemberRecord, type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerScheduleService } from './schedules.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const BESITZER_ID = '22222222-2222-4222-8222-222222222222';
const FREMD_ID = '33333333-3333-4333-8333-333333333333';
const VERWALTER_ID = '55555555-5555-4555-8555-555555555555';
const BEDIENER_ID = '66666666-6666-4666-8666-666666666666';
const ZUSEHER_ID = '77777777-7777-4777-8777-777777777777';
const ADMIN_ID = '88888888-8888-4888-8888-888888888888';
const GAST_ID = '99999999-9999-4999-8999-999999999999';
/** Konto, das im Test neu freigegeben wird. */
const NEU_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SERVER: ServerRecord = {
  id: SERVER_ID,
  ownerId: BESITZER_ID,
  ownerDisplayName: 'Besitzer',
  hostId: '44444444-4444-4444-8444-444444444444',
  hostName: 'homeserver',
  name: 'Testserver',
  gameType: 'test-echo',
  status: 'running',
  statusMessage: null,
  statusChangedAt: '2026-08-30T10:00:00.000Z',
  lastStartedAt: '2026-08-30T10:00:00.000Z',
  lastActivityAt: null,
  crashTimestamps: [],
  dockerContainerId: 'container-1',
  imageRef: 'ghcr.io/test:1',
  containerSpecHash: null,
  subdomain: 'testserver',
  dnsRecordId: null,
  assignedPorts: [],
  resourceLimits: { ramMb: 2048, cpuCores: 2, diskMb: 10_240 },
  configJson: {},
  startupParameters: '',
  autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 15 },
  restartRequired: false,
  clonedFromServerId: null,
  createdAt: '2026-08-30T09:00:00.000Z',
};

const MITGLIEDER: readonly ServerMemberRecord[] = [
  {
    userId: VERWALTER_ID,
    displayName: 'Mitverwalter',
    level: 'manager',
    addedAt: '2026-08-31T08:00:00.000Z',
  },
  {
    userId: BEDIENER_ID,
    displayName: 'Bediener',
    level: 'operator',
    addedAt: '2026-08-31T08:00:00.000Z',
  },
  {
    userId: ZUSEHER_ID,
    displayName: 'Zuseher',
    level: 'viewer',
    addedAt: '2026-08-31T08:00:00.000Z',
  },
];

const STATS: AgentContainerStats = {
  containerId: 'container-1',
  cpuPercent: 1,
  memoryUsedBytes: 100,
  memoryLimitBytes: 2048,
  networkRxBytes: 0,
  networkTxBytes: 0,
  blockReadBytes: 0,
  blockWriteBytes: 0,
  pids: 1,
  sampledAt: '2026-09-01T12:00:00.000Z',
};

const PROTOKOLL: GetLogsCommandResult = {
  containerId: 'container-1',
  lines: [{ stream: 'stdout', message: 'start', timestamp: null }],
};
const KONSOLE: ExecConsoleCommandResult = { exitCode: 0, stdout: 'pong', stderr: '' };

/** Gültiger Rumpf für `PATCH /api/servers/:id` – die Rechteprüfung liegt davor. */
const EINSTELLUNGEN = {
  name: 'Testserver',
  resourceLimits: { ramMb: 2048, cpuCores: 2, diskMb: 10_240 },
  config: {},
  startupParameters: '',
  autoShutdownEnabled: false,
  autoShutdownTimeoutMinutes: null,
};

type AkteurName =
  'besitzer' | 'admin' | 'verwalter' | 'bediener' | 'zuseher' | 'fremd' | 'gast' | 'anonym';

/**
 * Die Akteure der Matrix.
 *
 * Alle Mitglieder tragen dieselben Rollen wie ein gewöhnliches Konto
 * (`server.view.own` + `server.manage.own`) – der Unterschied zwischen ihnen ist
 * allein die Mitgliedsstufe. Genau diese zweite Schranke soll die Matrix
 * festhalten: ohne sie wäre die Stufe wirkungslos.
 */
const AKTEURE: Record<Exclude<AkteurName, 'anonym'>, PermissionActor> = {
  besitzer: buildPermissionActor({
    isOwner: false,
    roles: [
      {
        name: 'Nutzer',
        grantedPermissions: [
          'server.view.own',
          'server.manage.own',
          'server.delete.own',
          'server.create',
        ],
      },
    ],
  }),
  admin: buildPermissionActor({
    isOwner: false,
    roles: [
      {
        name: 'Administrator',
        grantedPermissions: [
          'server.view.any',
          'server.manage.any',
          'server.delete.any',
          'server.create',
        ],
      },
    ],
  }),
  verwalter: buildPermissionActor({
    isOwner: false,
    roles: [{ name: 'Nutzer', grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  bediener: buildPermissionActor({
    isOwner: false,
    roles: [{ name: 'Nutzer', grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  zuseher: buildPermissionActor({
    isOwner: false,
    roles: [{ name: 'Nutzer', grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  fremd: buildPermissionActor({
    isOwner: false,
    roles: [
      {
        name: 'Nutzer',
        grantedPermissions: ['server.view.own', 'server.manage.own', 'server.delete.own'],
      },
    ],
  }),
  // Frisch registriert: ausschließlich die Systemrolle „Gast" – nicht
  // freigeschaltet und ohne jedes Recht (Lastenheft §3.1, W2-15).
  gast: buildPermissionActor({ isOwner: false, roles: [{ name: 'Gast', grantedPermissions: [] }] }),
};

const KONTO_IDS: Record<Exclude<AkteurName, 'anonym'>, string> = {
  besitzer: BESITZER_ID,
  admin: ADMIN_ID,
  verwalter: VERWALTER_ID,
  bediener: BEDIENER_ID,
  zuseher: ZUSEHER_ID,
  fremd: FREMD_ID,
  gast: GAST_ID,
};

type AktionsName =
  | 'start'
  | 'stopp'
  | 'neustart'
  | 'loeschen'
  | 'einstellungen'
  | 'mitgliederLesen'
  | 'mitgliedFreigeben'
  | 'mitgliedEntfernen'
  | 'konsole'
  | 'messwerte'
  | 'protokoll';

interface Aktion {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly payload?: unknown;
  /**
   * Name der Mitschrift, die bei Erfolg genau einen Eintrag tragen muss.
   *
   * Fehlt bei einer reinen Leseroute ohne Wirkung im Dienst – dort gibt es
   * nichts, was ein Guard zu spät verhindern könnte.
   */
  readonly spur?: keyof Mitschrift;
}

const AKTIONEN: Record<AktionsName, Aktion> = {
  start: { method: 'POST', url: `/api/servers/${SERVER_ID}/start`, spur: 'start' },
  stopp: { method: 'POST', url: `/api/servers/${SERVER_ID}/stop`, spur: 'stopp' },
  neustart: { method: 'POST', url: `/api/servers/${SERVER_ID}/restart`, spur: 'neustart' },
  loeschen: { method: 'DELETE', url: `/api/servers/${SERVER_ID}`, spur: 'loeschen' },
  einstellungen: {
    method: 'PATCH',
    url: `/api/servers/${SERVER_ID}`,
    payload: EINSTELLUNGEN,
    spur: 'einstellungen',
  },
  mitgliederLesen: { method: 'GET', url: `/api/servers/${SERVER_ID}/members` },
  mitgliedFreigeben: {
    method: 'PUT',
    url: `/api/servers/${SERVER_ID}/members`,
    payload: { userId: NEU_ID, level: 'operator' },
    spur: 'freigeben',
  },
  mitgliedEntfernen: {
    method: 'DELETE',
    url: `/api/servers/${SERVER_ID}/members/${VERWALTER_ID}`,
    spur: 'entfernen',
  },
  konsole: {
    method: 'POST',
    url: `/api/servers/${SERVER_ID}/console`,
    payload: { command: 'say hallo' },
    spur: 'konsole',
  },
  messwerte: { method: 'GET', url: `/api/servers/${SERVER_ID}/stats`, spur: 'messwerte' },
  protokoll: { method: 'GET', url: `/api/servers/${SERVER_ID}/logs`, spur: 'protokoll' },
};

/** Erwarteter Ausgang: HTTP-Status und Fehlercode aus dem Katalog (`null` = Erfolg). */
type Erwartung = readonly [number, ErrorCode | null];

const OK: Erwartung = [200, null];
const VERWEIGERT: Erwartung = [403, 'PERMISSION_DENIED'];
/**
 * Ein Server, den der Aufrufer nicht sehen darf, ist „nicht gefunden".
 *
 * Die Existenz eines fremden Servers ist selbst schon eine Information –
 * deshalb 404 statt 403 (siehe `loadAuthorized` in `routes.ts`).
 */
const UNBEKANNT: Erwartung = [404, 'SERVER_NOT_FOUND'];
const ANMELDUNG: Erwartung = [401, 'AUTH_REQUIRED'];

/**
 * Die Matrix selbst – Rollen × Routen, mit erwartetem Status und Fehlercode.
 *
 * Bewusst als Tabelle ausgeschrieben statt aus dem Rechtemodell abgeleitet: Ein
 * Test, der dieselbe Regel rechnet wie der Code, würde jede Änderung daran
 * mitmachen, statt sie zu melden.
 */
const MATRIX: Record<AkteurName, Record<AktionsName, Erwartung>> = {
  besitzer: {
    start: OK,
    stopp: OK,
    neustart: OK,
    loeschen: OK,
    einstellungen: OK,
    mitgliederLesen: OK,
    mitgliedFreigeben: OK,
    mitgliedEntfernen: OK,
    konsole: OK,
    messwerte: OK,
    protokoll: OK,
  },
  admin: {
    start: OK,
    stopp: OK,
    neustart: OK,
    loeschen: OK,
    einstellungen: OK,
    mitgliederLesen: OK,
    mitgliedFreigeben: OK,
    mitgliedEntfernen: OK,
    konsole: OK,
    messwerte: OK,
    protokoll: OK,
  },
  // Stufe `manager`: Einstellungen ja, Löschen und Mitgliederverwaltung nein –
  // ein Mitglied soll den Server nicht unter dem Besitzer wegräumen können.
  verwalter: {
    start: OK,
    stopp: OK,
    neustart: OK,
    loeschen: VERWEIGERT,
    einstellungen: OK,
    mitgliederLesen: OK,
    mitgliedFreigeben: VERWEIGERT,
    mitgliedEntfernen: VERWEIGERT,
    konsole: OK,
    messwerte: OK,
    protokoll: OK,
  },
  // Stufe `operator`: bedienen ja, verwalten nein.
  bediener: {
    start: OK,
    stopp: OK,
    neustart: OK,
    loeschen: VERWEIGERT,
    einstellungen: VERWEIGERT,
    mitgliederLesen: OK,
    mitgliedFreigeben: VERWEIGERT,
    mitgliedEntfernen: VERWEIGERT,
    konsole: OK,
    messwerte: OK,
    protokoll: OK,
  },
  // Stufe `viewer`: sehen ja, alles andere nein – trotz `server.manage.own`.
  zuseher: {
    start: VERWEIGERT,
    stopp: VERWEIGERT,
    neustart: VERWEIGERT,
    loeschen: VERWEIGERT,
    einstellungen: VERWEIGERT,
    mitgliederLesen: OK,
    mitgliedFreigeben: VERWEIGERT,
    mitgliedEntfernen: VERWEIGERT,
    konsole: VERWEIGERT,
    messwerte: OK,
    protokoll: OK,
  },
  fremd: {
    start: UNBEKANNT,
    stopp: UNBEKANNT,
    neustart: UNBEKANNT,
    loeschen: UNBEKANNT,
    einstellungen: UNBEKANNT,
    mitgliederLesen: UNBEKANNT,
    mitgliedFreigeben: UNBEKANNT,
    mitgliedEntfernen: UNBEKANNT,
    konsole: UNBEKANNT,
    messwerte: UNBEKANNT,
    protokoll: UNBEKANNT,
  },
  gast: {
    start: UNBEKANNT,
    stopp: UNBEKANNT,
    neustart: UNBEKANNT,
    loeschen: UNBEKANNT,
    einstellungen: UNBEKANNT,
    mitgliederLesen: UNBEKANNT,
    mitgliedFreigeben: UNBEKANNT,
    mitgliedEntfernen: UNBEKANNT,
    konsole: UNBEKANNT,
    messwerte: UNBEKANNT,
    protokoll: UNBEKANNT,
  },
  anonym: {
    start: ANMELDUNG,
    stopp: ANMELDUNG,
    neustart: ANMELDUNG,
    loeschen: ANMELDUNG,
    einstellungen: ANMELDUNG,
    mitgliederLesen: ANMELDUNG,
    mitgliedFreigeben: ANMELDUNG,
    mitgliedEntfernen: ANMELDUNG,
    konsole: ANMELDUNG,
    messwerte: ANMELDUNG,
    protokoll: ANMELDUNG,
  },
};

/** Was der Dienst bzw. das Repository tatsächlich zu sehen bekommen hat. */
interface Mitschrift {
  start: { serverId: string; actorUserId: string }[];
  stopp: string[];
  neustart: { serverId: string; actorUserId: string }[];
  loeschen: string[];
  einstellungen: string[];
  freigeben: { userId: string; level: ServerMemberLevel }[];
  entfernen: string[];
  konsole: string[];
  messwerte: string[];
  protokoll: string[];
}

function leereMitschrift(): Mitschrift {
  return {
    start: [],
    stopp: [],
    neustart: [],
    loeschen: [],
    einstellungen: [],
    freigeben: [],
    entfernen: [],
    konsole: [],
    messwerte: [],
    protokoll: [],
  };
}

interface Aufbau {
  readonly app: FastifyInstance;
  readonly mitschrift: Mitschrift;
}

interface AufbauOptionen {
  /** Fehler, den der Dienst beim Start wirft – für die Fehlerabbildung. */
  readonly startFehler?: ServerOrchestrationError;
}

async function baueApp(optionen: AufbauOptionen = {}): Promise<Aufbau> {
  const mitschrift = leereMitschrift();
  const mitglieder = new Map<string, ServerMemberRecord>(
    MITGLIEDER.map((eintrag) => [eintrag.userId, eintrag]),
  );

  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
    startServer: async (serverId: string, actorUserId: string) => {
      if (optionen.startFehler !== undefined) throw optionen.startFehler;
      mitschrift.start.push({ serverId, actorUserId });

      return SERVER;
    },
    stopServer: async (serverId: string) => {
      mitschrift.stopp.push(serverId);

      return SERVER;
    },
    restartServer: async (serverId: string, actorUserId: string) => {
      mitschrift.neustart.push({ serverId, actorUserId });

      return SERVER;
    },
    deleteServer: async (serverId: string) => {
      mitschrift.loeschen.push(serverId);
    },
    updateServer: async (serverId: string) => {
      mitschrift.einstellungen.push(serverId);

      return SERVER;
    },
    execConsole: async (_serverId: string, command: string) => {
      mitschrift.konsole.push(command);

      return KONSOLE;
    },
    getStats: async (serverId: string) => {
      mitschrift.messwerte.push(serverId);

      return STATS;
    },
    getLogs: async (serverId: string) => {
      mitschrift.protokoll.push(serverId);

      return PROTOKOLL;
    },
  } as unknown as ServerOrchestrationService;

  const repository = {
    // `listMembers` läuft bei jedem DTO-Aufbau mit und taugt deshalb nicht als
    // Mitschrift der Leseroute – diese wird über ihren Antwortkörper geprüft.
    listMembers: async () => [...mitglieder.values()],
    listAll: async () => [SERVER],
    listByOwnerOrMembership: async () => [SERVER],
    isSubdomainTaken: async () => false,
    upsertMember: async (_serverId: string, userId: string, level: ServerMemberLevel) => {
      mitschrift.freigeben.push({ userId, level });
      mitglieder.set(userId, {
        userId,
        displayName: 'Neues Mitglied',
        level,
        addedAt: '2026-09-01T12:00:00.000Z',
      });
    },
    removeMember: async (_serverId: string, userId: string) => {
      mitschrift.entfernen.push(userId);
      mitglieder.delete(userId);
    },
    listPinnedServerIds: async () => new Set<string>(),
  } as unknown as ServerRepository;

  const app = Fastify({ logger: false });

  registerErrorHandler(app);
  registerRbac(app, {
    resolveActor: (request) => {
      const kopf = request.headers['x-test-actor'];

      if (typeof kopf !== 'string' || kopf === 'anonym') return null;

      return AKTEURE[kopf as Exclude<AkteurName, 'anonym'>] ?? null;
    },
  });

  app.decorateRequest('viewerUserId', null);
  app.addHook('onRequest', async (request) => {
    const kopf = request.headers['x-test-actor'];

    request.viewerUserId =
      typeof kopf === 'string' && kopf !== 'anonym'
        ? (KONTO_IDS[kopf as Exclude<AkteurName, 'anonym'>] ?? null)
        : null;
  });

  registerServerRoutes(app, {
    service,
    repository,
    registry: createGameRegistry(1),
    baseDomain: 'example.tld',
    schedules: {
      list: async () => [],
      create: async () => {
        throw new Error('nicht benutzt');
      },
      update: async () => {
        throw new Error('nicht benutzt');
      },
      remove: async () => undefined,
      tick: async () => ({ executedScheduleIds: [], failedScheduleIds: [] }),
    } as unknown as ServerScheduleService,
    worldArchives: {
      save: async () => {
        throw new Error('nicht benutzt');
      },
      take: async () => null,
      sweep: async () => 0,
    },
  });

  await app.ready();

  return { app, mitschrift };
}

function rufe(app: FastifyInstance, akteur: AkteurName, aktion: Aktion) {
  const optionen: InjectOptions = {
    method: aktion.method,
    url: aktion.url,
    headers: { 'x-test-actor': akteur },
  };

  if (aktion.payload !== undefined) {
    optionen.payload = aktion.payload as InjectOptions['payload'];
  }

  return app.inject(optionen);
}

let offen: FastifyInstance | null = null;

afterEach(async () => {
  await offen?.close();
  offen = null;
});

describe('Rechte-Matrix der Lifecycle- und Zugriffsrouten (test-gaps-02)', () => {
  const akteure = Object.keys(MATRIX) as AkteurName[];
  const aktionen = Object.keys(AKTIONEN) as AktionsName[];

  for (const akteur of akteure) {
    describe(akteur, () => {
      for (const name of aktionen) {
        const aktion = AKTIONEN[name];
        const [status, code] = MATRIX[akteur][name];

        it(`${name}: ${String(status)}${code === null ? '' : ` / ${code}`}`, async () => {
          const { app, mitschrift } = await baueApp();
          offen = app;

          const antwort = await rufe(app, akteur, aktion);
          const rumpf = antwort.json<{ success: boolean; error: { code: string } | null }>();

          expect(antwort.statusCode).toBe(status);
          expect(rumpf.success).toBe(code === null);

          if (code === null) {
            expect(rumpf.error).toBeNull();
            // Erfolg heißt: die Wirkung ist wirklich eingetreten.
            if (aktion.spur !== undefined) expect(mitschrift[aktion.spur]).toHaveLength(1);
          } else {
            expect(rumpf.error?.code).toBe(code);
            // Abgewiesen heißt: der Dienst hat den Aufruf nie gesehen. Ein
            // Guard hinter der Wirkung würde hier auffallen.
            if (aktion.spur !== undefined) expect(mitschrift[aktion.spur]).toHaveLength(0);
          }
        });
      }
    });
  }
});

describe('Envelope und Weitergabe an den Dienst', () => {
  it('reicht das handelnde Konto an den Start weiter (Betreiber im Audit-Log)', async () => {
    const { app, mitschrift } = await baueApp();
    offen = app;

    await rufe(app, 'verwalter', AKTIONEN.start);

    expect(mitschrift.start).toEqual([{ serverId: SERVER_ID, actorUserId: VERWALTER_ID }]);
  });

  it('liefert bei Erfolg das vollständige DTO samt permissions-Objekt (Pflichtenheft §5.2)', async () => {
    const { app } = await baueApp();
    offen = app;

    const antwort = await rufe(app, 'besitzer', AKTIONEN.start);
    const rumpf = antwort.json<{
      success: boolean;
      data: { id: string; permissions: Record<string, boolean> };
      error: null;
    }>();

    expect(rumpf.success).toBe(true);
    expect(rumpf.data.id).toBe(SERVER_ID);
    expect(rumpf.data.permissions.canStart).toBe(true);
    expect(rumpf.data.permissions.canDelete).toBe(true);
  });

  it('antwortet auf einen abgewiesenen Aufruf mit dem vollständigen Fehler-Envelope', async () => {
    const { app } = await baueApp();
    offen = app;

    const antwort = await rufe(app, 'zuseher', AKTIONEN.start);

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json()).toMatchObject({
      success: false,
      data: null,
      error: { code: 'PERMISSION_DENIED' },
    });
  });

  /**
   * Der Abgleich mit erwartetem Zustand (W2-10) endet im Dienst mit
   * `SERVER_STATE_CONFLICT`; die Route muss daraus 409 machen und nicht 500.
   */
  it('macht aus SERVER_STATE_CONFLICT des Dienstes eine 409-Antwort', async () => {
    const { app } = await baueApp({
      startFehler: new ServerOrchestrationError(
        'SERVER_STATE_CONFLICT',
        'Der Zustand des Servers hat sich zwischenzeitlich geändert.',
      ),
    });
    offen = app;

    const antwort = await rufe(app, 'besitzer', AKTIONEN.start);

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json().error.code).toBe('SERVER_STATE_CONFLICT');
  });

  it('lehnt einen Start ohne gültige Server-Id mit VALIDATION_FAILED ab', async () => {
    const { app, mitschrift } = await baueApp();
    offen = app;

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/servers/keine-uuid/start',
      headers: { 'x-test-actor': 'besitzer' },
    });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
    expect(mitschrift.start).toHaveLength(0);
  });
});

/**
 * `requireApproved()` (W2-15): Routen ohne eigene Permission verlangen
 * trotzdem ein freigeschaltetes Konto – sonst käme ein frisch registriertes
 * Konto an den Spiel-Katalog und an das Subdomain-Orakel (security-matrix-06).
 */
describe('Freischaltung als Schranke ohne Permission (W2-15)', () => {
  const routen = [
    { name: 'Spiel-Katalog', url: '/api/game-types' },
    { name: 'Subdomain-Prüfung', url: '/api/servers/subdomain-check?subdomain=neu' },
  ];

  for (const route of routen) {
    it(`${route.name}: freigeschaltetes Konto bekommt eine Antwort`, async () => {
      const { app } = await baueApp();
      offen = app;

      const antwort = await app.inject({
        method: 'GET',
        url: route.url,
        headers: { 'x-test-actor': 'besitzer' },
      });

      expect(antwort.statusCode).toBe(200);
      expect(antwort.json().success).toBe(true);
    });

    it(`${route.name}: Konto in der Warteliste wird mit 403 abgewiesen`, async () => {
      const { app } = await baueApp();
      offen = app;

      const antwort = await app.inject({
        method: 'GET',
        url: route.url,
        headers: { 'x-test-actor': 'gast' },
      });

      expect(antwort.statusCode).toBe(403);
      expect(antwort.json().error.code).toBe('PERMISSION_DENIED');
    });

    it(`${route.name}: ohne Anmeldung 401`, async () => {
      const { app } = await baueApp();
      offen = app;

      const antwort = await app.inject({ method: 'GET', url: route.url });

      expect(antwort.statusCode).toBe(401);
      expect(antwort.json().error.code).toBe('AUTH_REQUIRED');
    });
  }
});

/**
 * Die Serverliste ist die zweite Stelle, an der `canView` wirkt – dort als
 * Filter statt als Schranke (`routes.ts`, `GET /api/servers`).
 *
 * Beide Repository-Attrappen liefern den Server bewusst **immer** zurück: So
 * prüft der Test allein den Filter der Route und nicht die SQL-Sicht.
 */
describe('Sichtbarkeit in der Serverliste', () => {
  async function liste(akteur: AkteurName) {
    const { app } = await baueApp();
    offen = app;

    const antwort = await app.inject({
      method: 'GET',
      url: '/api/servers',
      ...(akteur === 'anonym' ? {} : { headers: { 'x-test-actor': akteur } }),
    });

    return antwort;
  }

  it('zeigt einem Konto mit server.view.any jeden Server', async () => {
    const antwort = await liste('admin');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json().data).toHaveLength(1);
  });

  it('zeigt dem Besitzer und einem Mitglied den Server', async () => {
    expect((await liste('besitzer')).json().data).toHaveLength(1);
  });

  it('streicht einen Server, den der Aufrufer nicht sehen darf, aus der Liste', async () => {
    const antwort = await liste('fremd');

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json().data).toEqual([]);
  });

  it('zeigt einem Konto in der Warteliste nichts', async () => {
    expect((await liste('gast')).json().data).toEqual([]);
  });

  it('verlangt für die Serverliste eine Anmeldung', async () => {
    const antwort = await liste('anonym');

    expect(antwort.statusCode).toBe(401);
    expect(antwort.json().error.code).toBe('AUTH_REQUIRED');
  });
});

/**
 * `canEdit` an jedem Mitglied ist das Recht des **Aufrufers**, nicht das der
 * Zuordnung (`toServerMemberDto` in `routes.ts`). Ein Mitglied darf die Liste
 * lesen, aber nichts daran ändern (orchestration-core-11).
 */
describe('Mitgliederliste je Aufrufer', () => {
  it('gibt dem Besitzer alle Einträge mit canEdit true', async () => {
    const { app } = await baueApp();
    offen = app;

    const antwort = await rufe(app, 'besitzer', AKTIONEN.mitgliederLesen);
    const daten = antwort.json<{ data: { userId: string; canEdit: boolean }[] }>().data;

    expect(daten).toHaveLength(MITGLIEDER.length);
    expect(daten.every((eintrag) => eintrag.canEdit)).toBe(true);
  });

  it('gibt einem Mitglied dieselbe Liste mit canEdit false', async () => {
    const { app } = await baueApp();
    offen = app;

    const antwort = await rufe(app, 'zuseher', AKTIONEN.mitgliederLesen);
    const daten = antwort.json<{ data: { userId: string; canEdit: boolean }[] }>().data;

    expect(daten).toHaveLength(MITGLIEDER.length);
    expect(daten.some((eintrag) => eintrag.canEdit)).toBe(false);
  });
});
