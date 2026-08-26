import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { createAuditService } from './audit.js';
import { createHostNodeService } from './nodes.js';
import { createPortPoolService } from './ports.js';
import {
  type RegistrationRequestService,
  createRegistrationRequestService,
} from './registration-requests.js';
import { registerAdminRoutes, ipHintOf } from './routes.js';
import { createStorageExplorerService } from './storage.js';
import {
  NODE_ID,
  SERVER_ID,
  actorWith,
  agentEntry,
  createFakeAuditRepository,
  createFakeHostNodeRepository,
  createFakePortPoolRepository,
  createFakeStorageRepository,
  nodeRecord,
  ownerActor,
  portRange,
  snapshotRecord,
} from './test-support.js';

/**
 * Fastify-Instanz mit den Admin-Routen.
 *
 * `resolveActor` steht für die Sitzungsauflösung aus B1: Der Actor wird über
 * den Header `x-test-actor` gesteuert, damit die Routen ohne Auth-Modul
 * prüfbar sind – genauso wie im Guard-Test von B2.
 */
async function buildTestApp(): Promise<FastifyInstance> {
  const actors: Record<string, PermissionActor> = {
    owner: ownerActor(),
    gast: actorWith(),
    nodeViewer: actorWith('node.view'),
    nodeAdmin: actorWith('node.manage'),
    addressAdmin: actorWith('address.manage'),
    auditor: actorWith('audit.view'),
    userAdmin: actorWith('user.manage'),
  };

  const app = Fastify({ logger: false });

  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  const audit = createAuditService(createFakeAuditRepository());
  const nodes = createHostNodeService({
    repository: createFakeHostNodeRepository([nodeRecord()]),
    audit,
  });
  const ports = createPortPoolService({
    repository: createFakePortPoolRepository([portRange()]),
    audit,
  });
  const storage = createStorageExplorerService({
    repository: createFakeStorageRepository(snapshotRecord([agentEntry()])),
    nodes,
    knownServers: { load: async () => new Map([[SERVER_ID, { name: 'Beispielserver' }]]) },
  });
  const registrationRequests: RegistrationRequestService = createRegistrationRequestService({
    repository: {
      list: async () => ({ rows: [], total: 0 }),
      findByUserId: async () => null,
      setBanned: async () => undefined,
    },
    roles: {} as never,
    audit,
  });

  await registerAdminRoutes(app, { nodes, ports, audit, storage, registrationRequests });
  await app.ready();

  return app;
}

async function get(app: FastifyInstance, url: string, actor?: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: actor ? { 'x-test-actor': actor } : {},
  });
}

describe('Admin-Routen: Envelope und Berechtigungen', () => {
  it('antwortet auf die Node-Übersicht im Envelope-Format (Pflichtenheft §5.1)', async () => {
    const app = await buildTestApp();

    const response = await get(app, '/admin/nodes', 'nodeViewer');
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].permissions).toEqual({
      canView: true,
      canManage: false,
      canManageStorage: false,
    });

    await app.close();
  });

  it('antwortet ohne Sitzung mit AUTH_REQUIRED', async () => {
    const app = await buildTestApp();

    const response = await get(app, '/admin/nodes');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'AUTH_REQUIRED', message: expect.any(String) },
    });

    await app.close();
  });

  it('antwortet ohne passende Permission mit PERMISSION_DENIED', async () => {
    const app = await buildTestApp();

    const response = await get(app, '/admin/nodes', 'gast');

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');

    await app.close();
  });

  it('trennt die Bereiche: node.manage öffnet nicht den Port-Pool', async () => {
    const app = await buildTestApp();

    const response = await get(app, '/admin/addresses/ports', 'nodeAdmin');

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('liefert dem Owner jeden Bereich', async () => {
    const app = await buildTestApp();

    for (const url of [
      '/admin/nodes',
      '/admin/addresses/ports',
      '/admin/audit',
      '/admin/requests',
    ]) {
      const response = await get(app, url, 'owner');

      expect(response.statusCode, url).toBe(200);
      expect(response.json().success, url).toBe(true);
    }

    await app.close();
  });

  it('lehnt eine ungültige Eingabe mit VALIDATION_FAILED ab, statt 500 zu antworten', async () => {
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/addresses/ranges',
      headers: { 'x-test-actor': 'addressAdmin' },
      payload: { label: 'Zu klein', startPort: 80, endPort: 90, protocol: 'udp' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');

    await app.close();
  });

  it('lehnt das Löschen eines aktiven Server-Datenordners auch über die Route ab', async () => {
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'DELETE',
      url: `/admin/storage/${NODE_ID}/entries`,
      headers: { 'x-test-actor': 'nodeAdmin' },
      payload: { entryId: `/srv/palantir/servers/${SERVER_ID}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('STORAGE_ENTRY_NOT_DELETABLE');

    await app.close();
  });

  it('bietet keinen Endpunkt zum Ändern oder Löschen einzelner Audit-Einträge', async () => {
    const app = await buildTestApp();

    const routes = app.printRoutes({ commonPrefix: false });

    expect(routes).toContain('/admin/audit');
    // Ein append-only Log hat keinen Schreibpfad auf den Einzeleintrag.
    expect(routes).not.toContain('/admin/audit/:');

    await app.close();
  });
});

describe('Herkunft des Requests für das Audit-Log', () => {
  it('kürzt eine IPv4-Adresse auf das Netz', () => {
    expect(ipHintOf({ ip: '203.0.113.42' } as never)).toBe('203.0.113.x');
  });

  it('kürzt eine IPv6-Adresse auf die ersten vier Gruppen', () => {
    expect(ipHintOf({ ip: '2001:db8:1234:5678:9abc:def0:1234:5678' } as never)).toBe(
      '2001:db8:1234:5678::x',
    );
  });

  it('kommt ohne Adresse zurecht', () => {
    expect(ipHintOf({ ip: '' } as never)).toBeNull();
  });
});
