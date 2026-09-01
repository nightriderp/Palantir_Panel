/**
 * HTTP-Ebene der Rollenverwaltung (R6, Gefundener Punkt 68).
 *
 * Geprüft wird, was an der Route hängt: der Guard, das Envelope-Format aus
 * Pflichtenheft §5.1, die Schema-Prüfung der Eingaben und – besonders – dass
 * die Fehlercodes des `RoleService` aus B2 als fachliche Antwort ankommen und
 * nicht als unerwarteter Fehler mit Status 500.
 *
 * Eigene Datei statt Anbau an `routes.test.ts`: Diese Tests brauchen Zugriff
 * auf die Attrappen hinter der Instanz (Audit-Zeilen, Rollenablage), der dortige
 * Aufbau liefert nur die Fastify-Instanz.
 */

import { createInstanceSettingsService } from './instance-settings.js';
import { GUEST_ROLE_NAME, type RoleDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { createAuditService } from './audit.js';
import { createHostNodeService } from './nodes.js';
import { createPortPoolService } from './ports.js';
import { createRegistrationRequestService } from './registration-requests.js';
import { registerAdminRoutes } from './routes.js';
import { createStorageExplorerService } from './storage.js';
import {
  type FakeAuditRepository,
  GUEST_ROLE_ID,
  ROLE_ID,
  ROLE_PERMISSION_BUNDLE,
  USER_ID,
  actorWith,
  createFakeAuditRepository,
  createFakeHostNodeRepository,
  createFakePortPoolRepository,
  createFakeRoleRepository,
  createFakeStorageRepository,
  createTestRoleAdminService,
  ownerActor,
  roleRecord,
} from './test-support.js';

const NUTZER_ROLE_ID = ROLE_ID;
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

let app: FastifyInstance;
let auditRepository: FakeAuditRepository;
let roleRepository: ReturnType<typeof createFakeRoleRepository>;

/**
 * Instanz mit den Admin-Routen.
 *
 * `resolveActor` steht für die Sitzungsauflösung aus B1: Der Actor kommt über
 * den Header `x-test-actor` – dasselbe Vorgehen wie in `routes.test.ts`.
 */
async function buildApp(): Promise<FastifyInstance> {
  const actors: Record<string, PermissionActor> = {
    owner: ownerActor(),
    gast: actorWith(),
    roleAdmin: actorWith('role.manage'),
    userAdmin: actorWith('user.manage'),
  };

  const instance = Fastify({ logger: false });

  registerRbac(instance, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  auditRepository = createFakeAuditRepository();
  roleRepository = createFakeRoleRepository([
    roleRecord(),
    roleRecord({
      id: GUEST_ROLE_ID,
      name: GUEST_ROLE_NAME,
      permissions: [],
      isProtected: true,
    }),
  ]);

  const audit = createAuditService(auditRepository);
  const nodes = createHostNodeService({ repository: createFakeHostNodeRepository(), audit });

  await registerAdminRoutes(instance, {
    nodes,
    audit,
    ports: createPortPoolService({ repository: createFakePortPoolRepository(), audit }),
    storage: createStorageExplorerService({
      repository: createFakeStorageRepository(),
      nodes,
    }),
    instanceSettings: createInstanceSettingsService({
      repository: {
        load: () => Promise.resolve({ selfRegistrationEnabled: true, updatedAt: null }),
        save: () => Promise.resolve(),
      },
    }),
    registrationRequests: createRegistrationRequestService({
      repository: {
        list: () => Promise.resolve({ rows: [], total: 0 }),
        findByUserId: () => Promise.resolve(null),
        setBanned: () => Promise.resolve(undefined),
      },
      roles: {} as never,
      audit,
    }),
    roles: createTestRoleAdminService({ repository: roleRepository, audit }),
  });

  await instance.ready();

  return instance;
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { actor?: string; payload?: Record<string, unknown> } = {},
) {
  const request: InjectOptions = {
    method,
    url,
    headers: options.actor ? { 'x-test-actor': options.actor } : {},
  };

  if (options.payload !== undefined) {
    request.payload = options.payload;
  }

  return await app.inject(request);
}

beforeEach(async () => {
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('GET /admin/roles', () => {
  it('antwortet im Envelope-Format aus Pflichtenheft §5.1', async () => {
    const response = await call('GET', '/admin/roles', { actor: 'roleAdmin' });
    const body = response.json<{ success: boolean; data: RoleDto[]; error: null }>();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data.map((role: RoleDto) => role.name)).toEqual([GUEST_ROLE_NAME, 'Nutzer']);
  });

  it('lässt auch `user.manage` lesen', async () => {
    // Das ist der eigentliche Anlass des Punktes: Ohne diese Liste kann die
    // Freischaltung eines wartenden Kontos nur die Standardrolle vergeben.
    const response = await call('GET', '/admin/roles', { actor: 'userAdmin' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: RoleDto[] }>().data[0]?.permissions.canEdit).toBe(false);
  });

  it('antwortet ohne Sitzung mit AUTH_REQUIRED', async () => {
    const response = await call('GET', '/admin/roles');

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });

  it('antwortet ohne passendes Recht mit PERMISSION_DENIED', async () => {
    const response = await call('GET', '/admin/roles', { actor: 'gast' });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
  });
});

describe('GET /admin/roles/:roleId', () => {
  it('liefert die einzelne Rolle', async () => {
    const response = await call('GET', `/admin/roles/${NUTZER_ROLE_ID}`, { actor: 'roleAdmin' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: RoleDto }>().data.name).toBe('Nutzer');
  });

  it('reicht ROLE_NOT_FOUND als fachliche Antwort durch, nicht als 500', async () => {
    // Der `RoleService` aus B2 wirft `RbacError`; ohne die Übersetzung in
    // `routes.ts` käme das als unerwarteter Fehler zurück.
    const response = await call('GET', `/admin/roles/${UNKNOWN_ID}`, { actor: 'roleAdmin' });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('ROLE_NOT_FOUND');
  });
});

describe('POST /admin/roles', () => {
  it('legt eine Rolle an und protokolliert sie', async () => {
    const response = await call('POST', '/admin/roles', {
      actor: 'roleAdmin',
      payload: {
        name: 'Supporter',
        description: 'Hilft bei Rückfragen.',
        permissions: [...ROLE_PERMISSION_BUNDLE],
      },
    });

    expect(response.statusCode).toBe(200);

    const role = response.json<{ data: RoleDto }>().data;

    expect(role.grantedPermissions).toEqual([...ROLE_PERMISSION_BUNDLE]);
    expect(role.isProtected).toBe(false);
    expect(auditRepository.rows.at(-1)?.action).toBe('role.created');
  });

  it('lehnt eine unbekannte Permission mit VALIDATION_FAILED ab', async () => {
    const response = await call('POST', '/admin/roles', {
      actor: 'roleAdmin',
      payload: { name: 'Supporter', permissions: ['server.alles'] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
    expect(roleRepository.rows).toHaveLength(2);
  });

  it('lehnt einen vergebenen Namen mit ROLE_NAME_TAKEN ab', async () => {
    const response = await call('POST', '/admin/roles', {
      actor: 'roleAdmin',
      payload: { name: 'nutzer', permissions: [] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('ROLE_NAME_TAKEN');
  });

  it('verlangt role.manage – `user.manage` reicht zum Anlegen nicht', async () => {
    const response = await call('POST', '/admin/roles', {
      actor: 'userAdmin',
      payload: { name: 'Supporter', permissions: [] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_DENIED');
  });
});

describe('PATCH und DELETE /admin/roles/:roleId', () => {
  it('ändert eine Rolle und liefert den neuen Stand', async () => {
    const response = await call('PATCH', `/admin/roles/${NUTZER_ROLE_ID}`, {
      actor: 'roleAdmin',
      payload: { name: 'Mitglied' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: RoleDto }>().data.name).toBe('Mitglied');
    expect(auditRepository.rows.at(-1)?.action).toBe('role.updated');
  });

  it('lehnt ein leeres Änderungspaket ab', async () => {
    const response = await call('PATCH', `/admin/roles/${NUTZER_ROLE_ID}`, {
      actor: 'roleAdmin',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });

  it('löscht eine Rolle und antwortet mit data: null', async () => {
    const response = await call('DELETE', `/admin/roles/${NUTZER_ROLE_ID}`, { actor: 'roleAdmin' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: null, error: null });
    expect(roleRepository.rows.map((role) => role.id)).toEqual([GUEST_ROLE_ID]);
    expect(auditRepository.rows.at(-1)?.action).toBe('role.deleted');
  });

  it('schützt die Systemrolle „Gast" – auch vor dem Owner', async () => {
    // Lastenheft §2: Die Auffangrolle jeder Registrierung ist unantastbar.
    const patched = await call('PATCH', `/admin/roles/${GUEST_ROLE_ID}`, {
      actor: 'owner',
      payload: { name: 'Besucher' },
    });
    const deleted = await call('DELETE', `/admin/roles/${GUEST_ROLE_ID}`, { actor: 'owner' });

    expect(patched.statusCode).toBe(403);
    expect(patched.json<{ error: { code: string } }>().error.code).toBe('ROLE_PROTECTED');
    expect(deleted.statusCode).toBe(403);
    expect(roleRepository.rows.some((role) => role.id === GUEST_ROLE_ID)).toBe(true);
  });
});

describe('Zuweisen und Entziehen', () => {
  it('weist zu und liefert die Rolle mit neuer Mitgliederzahl', async () => {
    const response = await call('PUT', `/admin/roles/${NUTZER_ROLE_ID}/members/${USER_ID}`, {
      actor: 'userAdmin',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: RoleDto }>().data.memberCount).toBe(1);
    expect(auditRepository.rows.at(-1)?.action).toBe('user.roleAssigned');
  });

  it('ist wiederholbar – dieselbe Zuweisung ist kein Fehler', async () => {
    await call('PUT', `/admin/roles/${NUTZER_ROLE_ID}/members/${USER_ID}`, { actor: 'userAdmin' });
    const second = await call('PUT', `/admin/roles/${NUTZER_ROLE_ID}/members/${USER_ID}`, {
      actor: 'userAdmin',
    });

    expect(second.statusCode).toBe(200);
    expect(second.json<{ data: RoleDto }>().data.memberCount).toBe(1);
  });

  it('entzieht wieder', async () => {
    await call('PUT', `/admin/roles/${NUTZER_ROLE_ID}/members/${USER_ID}`, { actor: 'userAdmin' });
    const response = await call('DELETE', `/admin/roles/${NUTZER_ROLE_ID}/members/${USER_ID}`, {
      actor: 'userAdmin',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: RoleDto }>().data.memberCount).toBe(0);
    expect(auditRepository.rows.at(-1)?.action).toBe('user.roleRemoved');
  });

  it('lehnt ein unbekanntes Konto mit USER_NOT_FOUND ab', async () => {
    const response = await call('PUT', `/admin/roles/${NUTZER_ROLE_ID}/members/${UNKNOWN_ID}`, {
      actor: 'userAdmin',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('USER_NOT_FOUND');
    expect(roleRepository.assignments).toHaveLength(0);
  });

  it('lehnt eine Konto-Id ab, die keine Id ist', async () => {
    const response = await call('PUT', `/admin/roles/${NUTZER_ROLE_ID}/members/keine-id`, {
      actor: 'userAdmin',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });
});
