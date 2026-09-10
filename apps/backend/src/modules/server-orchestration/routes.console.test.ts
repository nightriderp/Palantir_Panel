/**
 * Missbrauchsgrenze der Konsole (Audit W2-3, `security-matrix-05` Szenario d).
 *
 * Ein Konsolenbefehl ist ein Roundtrip zum Agent und von dort in den Container.
 * Ohne Bremse ließ sich der Spielserver im Sekundentakt fernsteuern – auch von
 * einem regulären Mitglied mit `canUseConsole`. Geprüft wird deshalb die
 * Schranke an der Route, nicht der Befehl selbst; der Dienst ist ein Fake ohne
 * Agent und ohne Datenbank (CLAUDE.md §4).
 */

import { type ExecConsoleCommandResult } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ABUSE_LIMITS, ABUSE_LIMIT_ERROR_CODE } from '../../lib/abuse-limits.js';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { ALLE_GAME_TYPE_DEFINITIONS, createGameRegistry } from './game-registry.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const BESITZER_ID = '22222222-2222-4222-8222-222222222222';
const ZWEITER_ID = '33333333-3333-4333-8333-333333333333';

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
  lastStartedAt: null,
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

const ERGEBNIS: ExecConsoleCommandResult = { exitCode: 0, stdout: 'pong', stderr: '' };

/**
 * Beide Konten dürfen die Konsole benutzen: `server.manage.any` macht sie zum
 * Verwalter jedes Servers, ohne dass eine Mitgliedschaft nötig wäre.
 */
const actors: Record<string, PermissionActor> = {
  besitzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.any', 'server.manage.any'], name: 'Admin' }],
  }),
  zweiter: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.any', 'server.manage.any'], name: 'Admin' }],
  }),
};

const kontoIds: Record<string, string> = { besitzer: BESITZER_ID, zweiter: ZWEITER_ID };

/** Befehle, die den Dienst tatsächlich erreicht haben. */
let befehle: string[] = [];

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

function buildApp(): FastifyInstance {
  befehle = [];

  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
    execConsole: async (_serverId: string, command: string) => {
      befehle.push(command);

      return ERGEBNIS;
    },
  } as unknown as ServerOrchestrationService;

  const instance = Fastify({ logger: false });

  registerErrorHandler(instance);
  registerRbac(instance, {
    resolveActor: (request) => {
      const kopf = request.headers['x-test-actor'];

      return typeof kopf === 'string' ? (actors[kopf] ?? null) : null;
    },
  });

  instance.decorateRequest('viewerUserId', null);
  instance.addHook('onRequest', async (request) => {
    const kopf = request.headers['x-test-actor'];

    request.viewerUserId = typeof kopf === 'string' ? (kontoIds[kopf] ?? null) : null;
  });

  registerServerRoutes(instance, {
    service,
    repository: {
      listMembers: async () => [],
      listPinnedServerIds: async () => new Set<string>(),
    } as unknown as ServerRepository,
    registry: createGameRegistry(1, ALLE_GAME_TYPE_DEFINITIONS),
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
    },
    worldArchives: {
      save: async () => {
        throw new Error('nicht benutzt');
      },
      take: async () => null,
      sweep: async () => 0,
    },
  });

  app = instance;

  return instance;
}

function befehlSenden(instance: FastifyInstance, actor: string) {
  return instance.inject({
    method: 'POST',
    url: `/api/servers/${SERVER_ID}/console`,
    headers: { 'x-test-actor': actor },
    payload: { command: 'say hallo' },
  });
}

describe('Konsole: Missbrauchsgrenze je Konto', () => {
  it('lehnt den Befehl nach der zulässigen Anzahl in der Minute mit 429 ab', async () => {
    const instance = buildApp();
    await instance.ready();

    for (let nummer = 0; nummer < ABUSE_LIMITS['server.console'].maxAttempts; nummer += 1) {
      expect((await befehlSenden(instance, 'besitzer')).statusCode).toBe(200);
    }

    const abgelehnt = await befehlSenden(instance, 'besitzer');

    expect(abgelehnt.statusCode).toBe(429);
    expect(abgelehnt.json()).toMatchObject({
      success: false,
      data: null,
      error: { code: ABUSE_LIMIT_ERROR_CODE },
    });
    // Der abgewiesene Befehl hat den Agent nicht mehr erreicht.
    expect(befehle).toHaveLength(ABUSE_LIMITS['server.console'].maxAttempts);
  });

  it('trifft nur das Konto, das die Grenze reißt', async () => {
    const instance = buildApp();
    await instance.ready();

    for (let nummer = 0; nummer <= ABUSE_LIMITS['server.console'].maxAttempts; nummer += 1) {
      await befehlSenden(instance, 'besitzer');
    }

    expect((await befehlSenden(instance, 'besitzer')).statusCode).toBe(429);
    expect((await befehlSenden(instance, 'zweiter')).statusCode).toBe(200);
  });
});
