/**
 * HTTP-Ebene des Datei-Managers (Arbeitspaket P2, Lastenheft §3.3).
 *
 * Geprüft wird, was an der Route hängt und nicht im Dienst: die Pfade, auf die
 * das Frontend zeigt (`lib/api/servers.ts`), der Guard `canManageFiles`, das
 * Envelope-Format (Pflichtenheft §5.1) – und dass der Download bewusst **kein**
 * Envelope liefert, sondern die Datei.
 *
 * Der Dienst ist ein Stub: Was er tut, prüft `service.test.ts` gegen einen
 * echten Agent-Kanal. Hier zählt nur, was zwischen HTTP und Dienst passiert.
 */

import { type ServerFileContentDto, type ServerFileListDto } from '@palantir/contracts';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { ServerOrchestrationError } from './errors.js';
import { createGameRegistry } from './game-registry.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerOrchestrationService } from './service.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const FREMD_ID = '33333333-3333-4333-8333-333333333333';

const SERVER: ServerRecord = {
  id: SERVER_ID,
  ownerId: OWNER_ID,
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

const actors: Record<string, PermissionActor> = {
  besitzer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
  fremd: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.manage.own'] }],
  }),
};

const LIST_DTO: ServerFileListDto = {
  serverId: SERVER_ID,
  path: 'welt',
  parentPath: '',
  entries: [
    {
      name: 'level.dat',
      path: 'welt/level.dat',
      type: 'file',
      sizeBytes: 12,
      modifiedAt: '2026-08-30T10:00:00.000Z',
      editable: false,
      downloadable: true,
    },
  ],
  writable: true,
  maxUploadBytes: 1_000,
  maxEditableBytes: 1_024,
};

const CONTENT_DTO: ServerFileContentDto = {
  serverId: SERVER_ID,
  path: 'index.html',
  content: '<h1>hallo</h1>',
  sizeBytes: 14,
  modifiedAt: '2026-08-30T10:00:00.000Z',
  writable: true,
};

/** Mitschrift dessen, was die Routen am Dienst aufrufen. */
interface Aufrufe {
  list: { path: string; writable: boolean }[];
  read: { path: string; writable: boolean }[];
  write: { path: string; content: string }[];
  upload: { path: string; fileName: string; size: number; overwrite?: boolean }[];
  remove: { path: string; recursive: boolean }[];
  download: string[];
}

async function buildApp(options: { fehler?: ServerOrchestrationError } = {}): Promise<{
  app: FastifyInstance;
  aufrufe: Aufrufe;
}> {
  const aufrufe: Aufrufe = { list: [], read: [], write: [], upload: [], remove: [], download: [] };

  function pruefeFehler(): void {
    if (options.fehler) throw options.fehler;
  }

  const service = {
    requireServer: async () => SERVER,
    recentCrashCount: () => 0,
    listFiles: async (_id: string, path: string, opts: { writable: boolean }) => {
      pruefeFehler();
      aufrufe.list.push({ path, writable: opts.writable });

      return LIST_DTO;
    },
    readFile: async (_id: string, path: string, opts: { writable: boolean }) => {
      pruefeFehler();
      aufrufe.read.push({ path, writable: opts.writable });

      return CONTENT_DTO;
    },
    writeFile: async (_id: string, path: string, content: string) => {
      pruefeFehler();
      aufrufe.write.push({ path, content });

      return CONTENT_DTO;
    },
    uploadFile: async (
      _id: string,
      path: string,
      fileName: string,
      content: Buffer,
      opts: { overwrite?: boolean },
    ) => {
      pruefeFehler();
      aufrufe.upload.push({
        path,
        fileName,
        size: content.byteLength,
        ...(opts.overwrite === undefined ? {} : { overwrite: opts.overwrite }),
      });

      return LIST_DTO;
    },
    deleteFile: async (_id: string, path: string, recursive: boolean) => {
      pruefeFehler();
      aufrufe.remove.push({ path, recursive });
    },
    downloadFile: async (_id: string, path: string) => {
      pruefeFehler();
      aufrufe.download.push(path);

      return { fileName: 'level.dat', content: Buffer.from('rohdaten') };
    },
  } as unknown as ServerOrchestrationService;

  const repository = { listMembers: async () => [] } as unknown as ServerRepository;

  const app = Fastify({ logger: false });

  // Wie im Betrieb (`buildServer`): Der globale Handler übersetzt die Fehler,
  // die eine Route bewusst durchfallen lässt – etwa `AUTH_REQUIRED` aus dem
  // RBAC-Guard (N6, Gefundener Punkt 97).
  registerErrorHandler(app);

  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  // Im Betrieb setzt `registerServerOrchestration` beides; hier steht nur der
  // Routen-Teil unter Test.
  app.decorateRequest('viewerUserId', null);
  app.addHook('onRequest', async (request) => {
    request.viewerUserId = request.headers['x-test-actor'] === 'fremd' ? FREMD_ID : OWNER_ID;
  });

  await app.register(multipart, { limits: { fileSize: 1_000, files: 1 } });

  registerServerRoutes(app, {
    service,
    repository,
    registry: createGameRegistry(1),
    baseDomain: 'example.tld',
    // Geplante Aufgaben stehen in `routes.schedules.test.ts` unter Test.
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
    // Weltdaten-Uploads stehen in `routes.world-import.test.ts` unter Test.
    worldArchives: {
      save: async () => {
        throw new Error('nicht benutzt');
      },
      take: async () => null,
      sweep: async () => 0,
    },
  });
  await app.ready();

  return { app, aufrufe };
}

/** Multipart-Rumpf mit einem Textfeld und einer Datei. */
function multipartBody(
  felder: Record<string, string>,
  datei: { name: string; content: string },
): { payload: Buffer; headers: Record<string, string> } {
  const grenze = '----palantirtest';
  const teile = Object.entries(felder).map(
    ([name, wert]) =>
      `--${grenze}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${wert}\r\n`,
  );

  teile.push(
    `--${grenze}\r\nContent-Disposition: form-data; name="file"; filename="${datei.name}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n${datei.content}\r\n`,
  );

  return {
    payload: Buffer.from(`${teile.join('')}--${grenze}--\r\n`),
    headers: { 'content-type': `multipart/form-data; boundary=${grenze}` },
  };
}

async function call(
  app: FastifyInstance,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  options: { actor?: string; payload?: unknown; headers?: Record<string, string> } = {},
) {
  const request: InjectOptions = {
    method,
    url,
    headers: {
      ...(options.actor ? { 'x-test-actor': options.actor } : {}),
      ...options.headers,
    },
  };

  if (options.payload !== undefined) {
    request.payload = options.payload as InjectOptions['payload'];
  }

  return await app.inject(request);
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe('Datei-Manager-Routen', () => {
  it('listet ein Verzeichnis im Envelope und reicht den relativen Pfad durch', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/files?path=welt`, {
      actor: 'besitzer',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ success: boolean; data: ServerFileListDto }>()).toMatchObject({
      success: true,
      data: { path: 'welt', writable: true },
    });
    expect(gebaut.aufrufe.list).toEqual([{ path: 'welt', writable: true }]);
  });

  it('nimmt die Wurzel als leeren Pfad an', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/files?path=`, {
      actor: 'besitzer',
    });

    expect(response.statusCode).toBe(200);
    expect(gebaut.aufrufe.list).toEqual([{ path: '', writable: true }]);
  });

  it('liest und speichert Dateiinhalt über /files/content', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;

    const gelesen = await call(
      app,
      'GET',
      `/api/servers/${SERVER_ID}/files/content?path=index.html`,
      { actor: 'besitzer' },
    );
    const gespeichert = await call(app, 'PUT', `/api/servers/${SERVER_ID}/files/content`, {
      actor: 'besitzer',
      payload: { path: 'index.html', content: 'neu' },
    });

    expect(gelesen.statusCode).toBe(200);
    expect(gespeichert.statusCode).toBe(200);
    expect(gebaut.aufrufe.read).toEqual([{ path: 'index.html', writable: true }]);
    expect(gebaut.aufrufe.write).toEqual([{ path: 'index.html', content: 'neu' }]);
  });

  it('nimmt einen Upload als multipart entgegen – ohne overwrite', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;
    const body = multipartBody({ path: 'welt' }, { name: 'welt.zip', content: 'PKDATEN' });

    const response = await call(app, 'POST', `/api/servers/${SERVER_ID}/files`, {
      actor: 'besitzer',
      payload: body.payload,
      headers: body.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(gebaut.aufrufe.upload).toEqual([{ path: 'welt', fileName: 'welt.zip', size: 7 }]);
  });

  it('reicht overwrite=true aus dem Formular durch', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;
    const body = multipartBody(
      { path: '', overwrite: 'true' },
      { name: 'welt.zip', content: 'PK' },
    );

    await call(app, 'POST', `/api/servers/${SERVER_ID}/files`, {
      actor: 'besitzer',
      payload: body.payload,
      headers: body.headers,
    });

    expect(gebaut.aufrufe.upload[0]).toMatchObject({ overwrite: true });
  });

  it('lehnt einen Upload ohne Datei-Teil ab', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;

    const response = await call(app, 'POST', `/api/servers/${SERVER_ID}/files`, {
      actor: 'besitzer',
      payload: { path: 'welt' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
    expect(gebaut.aufrufe.upload).toEqual([]);
  });

  it('löscht und liefert null im Envelope', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;

    const response = await call(app, 'DELETE', `/api/servers/${SERVER_ID}/files`, {
      actor: 'besitzer',
      payload: { path: 'welt/alt.log' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ success: boolean; data: null }>()).toEqual({
      success: true,
      data: null,
      error: null,
    });
    expect(gebaut.aufrufe.remove).toEqual([{ path: 'welt/alt.log', recursive: true }]);
  });

  it('liefert den Download als Datei, nicht als Envelope', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;

    const response = await call(
      app,
      'GET',
      `/api/servers/${SERVER_ID}/files/download?path=welt/level.dat`,
      { actor: 'besitzer' },
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toBe('attachment; filename="level.dat"');
    expect(response.rawPayload.toString('utf8')).toBe('rohdaten');
    expect(gebaut.aufrufe.download).toEqual(['welt/level.dat']);
  });

  it('meldet einen Ausbruchspfad des Dienstes als AGENT_INVALID_PATH (400)', async () => {
    const gebaut = await buildApp({
      fehler: new ServerOrchestrationError(
        'AGENT_INVALID_PATH',
        'Der Pfad liegt außerhalb des Datenordners dieses Servers.',
      ),
    });
    app = gebaut.app;

    const response = await call(
      app,
      'GET',
      `/api/servers/${SERVER_ID}/files?path=${encodeURIComponent('../../etc/passwd')}`,
      { actor: 'besitzer' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AGENT_INVALID_PATH');
  });

  it('meldet einen belegten Zielpfad als AGENT_FILE_EXISTS (409)', async () => {
    const gebaut = await buildApp({
      fehler: new ServerOrchestrationError('AGENT_FILE_EXISTS'),
    });
    app = gebaut.app;
    const body = multipartBody({ path: '' }, { name: 'welt.zip', content: 'PK' });

    const response = await call(app, 'POST', `/api/servers/${SERVER_ID}/files`, {
      actor: 'besitzer',
      payload: body.payload,
      headers: body.headers,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AGENT_FILE_EXISTS');
  });

  it('verlangt eine Sitzung', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;

    const response = await call(app, 'GET', `/api/servers/${SERVER_ID}/files?path=`);

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
    expect(gebaut.aufrufe.list).toEqual([]);
  });

  it('verrät einem Fremden nicht einmal die Existenz des Servers', async () => {
    const gebaut = await buildApp();
    app = gebaut.app;

    for (const [method, url, payload] of [
      ['GET', `/api/servers/${SERVER_ID}/files?path=`, undefined],
      ['GET', `/api/servers/${SERVER_ID}/files/content?path=index.html`, undefined],
      ['PUT', `/api/servers/${SERVER_ID}/files/content`, { path: 'index.html', content: 'x' }],
      ['DELETE', `/api/servers/${SERVER_ID}/files`, { path: 'index.html' }],
      ['GET', `/api/servers/${SERVER_ID}/files/download?path=index.html`, undefined],
    ] as const) {
      const response = await call(app, method, url, {
        actor: 'fremd',
        ...(payload === undefined ? {} : { payload }),
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('SERVER_NOT_FOUND');
    }

    expect(gebaut.aufrufe).toMatchObject({ list: [], read: [], write: [], remove: [] });
  });
});
