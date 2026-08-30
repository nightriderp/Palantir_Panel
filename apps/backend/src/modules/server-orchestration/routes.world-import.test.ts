/**
 * HTTP-Ebene des Weltdaten-Uploads (Arbeitspaket P4, Lastenheft §3.3).
 *
 * Geprüft wird, was an der Route hängt und nicht im Zwischenspeicher: der Pfad,
 * auf den `uploadWorldArchive()` im Frontend zeigt, die Schranke
 * `server.create` – der Upload passiert im Wizard, bevor es den Server gibt –
 * und das Envelope-Format (Pflichtenheft §5.1). Was der Zwischenspeicher tut,
 * prüft `world-import.test.ts`.
 */

import { type WorldArchiveUploadDto } from '@palantir/contracts';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../error-handler.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { buildPermissionActor } from '../rbac/permissions.js';
import { ServerOrchestrationError } from './errors.js';
import { createGameRegistry } from './game-registry.js';
import { type ServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type ServerOrchestrationService } from './service.js';
import { type WorldArchiveStore } from './world-import.js';

const UPLOAD: WorldArchiveUploadDto = {
  uploadId: '77777777-7777-4777-8777-777777777777',
  fileName: 'welt.zip',
  sizeBytes: 9,
  format: 'zip',
  expiresAt: '2026-09-01T12:00:00.000Z',
};

const actors: Record<string, PermissionActor> = {
  ersteller: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own', 'server.create'] }],
  }),
  // Darf eigene Server sehen, aber keine anlegen – prüft den Guard.
  zuschauer: buildPermissionActor({
    isOwner: false,
    roles: [{ grantedPermissions: ['server.view.own'] }],
  }),
};

interface Aufrufe {
  save: string[];
}

async function buildApp(options: { fehler?: ServerOrchestrationError } = {}): Promise<{
  app: FastifyInstance;
  aufrufe: Aufrufe;
}> {
  const aufrufe: Aufrufe = { save: [] };

  const worldArchives: WorldArchiveStore = {
    save: async (fileName, source) => {
      if (options.fehler) {
        // Wie im Betrieb: Der Strom wird gelesen, bevor die Ablehnung feststeht.
        for await (const _block of source) {
          void _block;
        }

        throw options.fehler;
      }

      let groesse = 0;

      for await (const block of source) {
        groesse += block.length;
      }

      aufrufe.save.push(fileName);

      return { ...UPLOAD, fileName, sizeBytes: groesse };
    },
    take: async () => null,
    sweep: async () => 0,
  };

  const service = {
    requireServer: async () => {
      throw new Error('nicht benutzt');
    },
    recentCrashCount: () => 0,
  } as unknown as ServerOrchestrationService;

  const app = Fastify({ logger: false });

  registerErrorHandler(app);

  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  app.decorateRequest('viewerUserId', null);
  app.addHook('onRequest', async (request) => {
    request.viewerUserId = '22222222-2222-4222-8222-222222222222';
    void request;
  });

  await app.register(multipart, { limits: { fileSize: 1_000, files: 1 } });

  registerServerRoutes(app, {
    service,
    repository: { listMembers: async () => [] } as unknown as ServerRepository,
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
    },
    worldArchives,
  });
  await app.ready();

  return { app, aufrufe };
}

/** Multipart-Rumpf mit genau einer Datei. */
function multipartBody(datei: { name: string; content: Buffer }): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const grenze = '----palantirwelt';
  const kopf = Buffer.from(
    `--${grenze}\r\nContent-Disposition: form-data; name="file"; filename="${datei.name}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );

  return {
    payload: Buffer.concat([kopf, datei.content, Buffer.from(`\r\n--${grenze}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${grenze}` },
  };
}

let offen: FastifyInstance | null = null;

afterEach(async () => {
  await offen?.close();
  offen = null;
});

describe('POST /api/uploads/world-archives', () => {
  it('nimmt ein Archiv an und antwortet mit dem Verweis', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;
    const koerper = multipartBody({ name: 'welt.zip', content: Buffer.from('PK-Archiv') });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads/world-archives',
      headers: { ...koerper.headers, 'x-test-actor': 'ersteller' },
      payload: koerper.payload,
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      uploadId: UPLOAD.uploadId,
      fileName: 'welt.zip',
      sizeBytes: 9,
      format: 'zip',
    });
    expect(aufrufe.save).toEqual(['welt.zip']);
  });

  it('weist ab, wer keine Server anlegen darf', async () => {
    const { app, aufrufe } = await buildApp();
    offen = app;
    const koerper = multipartBody({ name: 'welt.zip', content: Buffer.from('PK') });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads/world-archives',
      headers: { ...koerper.headers, 'x-test-actor': 'zuschauer' },
      payload: koerper.payload,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');
    expect(aufrufe.save).toEqual([]);
  });

  it('verlangt multipart/form-data', async () => {
    const { app } = await buildApp();
    offen = app;

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads/world-archives',
      headers: { 'x-test-actor': 'ersteller' },
      payload: { datei: 'welt.zip' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('gibt ein fremdes Format als benannten Code weiter', async () => {
    const { app } = await buildApp({
      fehler: new ServerOrchestrationError('WORLD_ARCHIVE_INVALID'),
    });
    offen = app;
    const koerper = multipartBody({ name: 'welt.exe', content: Buffer.from('MZ') });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads/world-archives',
      headers: { ...koerper.headers, 'x-test-actor': 'ersteller' },
      payload: koerper.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('WORLD_ARCHIVE_INVALID');
  });

  it('gibt ein zu großes Archiv als FILE_TOO_LARGE weiter', async () => {
    const { app } = await buildApp({ fehler: new ServerOrchestrationError('FILE_TOO_LARGE') });
    offen = app;
    const koerper = multipartBody({ name: 'welt.zip', content: Buffer.alloc(500) });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads/world-archives',
      headers: { ...koerper.headers, 'x-test-actor': 'ersteller' },
      payload: koerper.payload,
    });

    expect(response.json().error.code).toBe('FILE_TOO_LARGE');
  });
});
