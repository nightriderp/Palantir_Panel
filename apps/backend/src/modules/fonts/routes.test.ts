/**
 * Routen der Schriftverwaltung (Arbeitspaket S-2).
 *
 * Schwerpunkt ist die Auslieferung: Sie ist der einzige Endpunkt des Panels,
 * der eine Kennung aus der URL in einen Dateipfad übersetzt – also genau die
 * Stelle, an der ein `../` gefährlich wäre. Geprüft wird deshalb, dass eine
 * solche Kennung schon an der Vertragsprüfung scheitert und nie bis zur Ablage
 * durchkommt.
 */

import multipart from '@fastify/multipart';
import { FONT_UPLOAD_MAX_SIZE_BYTES } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createAuditService } from '../admin/audit.js';
import { actorWith, createFakeAuditRepository, ownerActor } from '../admin/test-support.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import { BUNDLED_FONTS } from './bundled.js';
import { registerFontRoutes } from './routes.js';
import { createFontService } from './service.js';
import {
  UPLOADED_FONT_ID,
  createFakeFontFileStore,
  createFakeFontRepository,
  fixedSelection,
  fontBytes,
  uploadedFontRecord,
} from './test-support.js';
import { fontFileName } from './storage.js';

const MITGELIEFERT = BUNDLED_FONTS[0]!;

async function buildTestApp(gewaehlt: string[] = []): Promise<FastifyInstance> {
  const actors: Record<string, PermissionActor> = {
    owner: ownerActor(),
    nutzer: actorWith(),
    userAdmin: actorWith('user.manage'),
  };

  const app = Fastify({ logger: false });

  registerRbac(app, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];

      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });

  await app.register(multipart, {
    limits: { fileSize: FONT_UPLOAD_MAX_SIZE_BYTES * 2, files: 1 },
  });

  const record = uploadedFontRecord();

  await app.register(
    registerFontRoutes({
      service: createFontService({
        repository: createFakeFontRepository([record]),
        uploads: createFakeFontFileStore({
          [fontFileName(record.id, record.format)]: fontBytes('woff2', 64),
        }),
        bundled: createFakeFontFileStore({ [MITGELIEFERT.fileName]: fontBytes('woff2', 128) }),
        selection: fixedSelection(...gewaehlt),
        audit: createAuditService(createFakeAuditRepository()),
      }),
    }),
  );

  await app.ready();

  return app;
}

/** Baut einen Multipart-Rumpf mit Feldern und genau einer Datei. */
function multipartBody(
  felder: Record<string, string>,
  datei: { name: string; content: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const grenze = '----palantirSchriftTest';
  const teile = Object.entries(felder).map(([name, wert]) =>
    Buffer.from(
      `--${grenze}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${wert}\r\n`,
      'utf8',
    ),
  );

  const kopf = Buffer.from(
    `--${grenze}\r\nContent-Disposition: form-data; name="file"; filename="${datei.name}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
    'utf8',
  );

  return {
    payload: Buffer.concat([
      ...teile,
      kopf,
      datei.content,
      Buffer.from(`\r\n--${grenze}--\r\n`, 'utf8'),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${grenze}` },
  };
}

describe('GET /api/fonts', () => {
  it('antwortet im Envelope-Format mit mitgelieferten und hochgeladenen Schriften', async () => {
    const app = await buildTestApp();

    const antwort = await app.inject({
      method: 'GET',
      url: '/api/fonts',
      headers: { 'x-test-actor': 'nutzer' },
    });
    const body = antwort.json();

    expect(antwort.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data.map((font: { id: string }) => font.id)).toEqual([
      MITGELIEFERT.id,
      UPLOADED_FONT_ID,
    ]);
    // Vollständiges DTO samt Rechteblock (Pflichtenheft §5.2).
    expect(body.data[0].permissions).toEqual({ canDelete: false });

    await app.close();
  });

  it('verlangt eine Sitzung, aber keine Berechtigung', async () => {
    const app = await buildTestApp();

    const ohne = await app.inject({ method: 'GET', url: '/api/fonts' });

    expect(ohne.statusCode).toBe(401);
    expect(ohne.json().error.code).toBe('AUTH_REQUIRED');

    await app.close();
  });
});

describe('GET /api/fonts/:id/file', () => {
  it('liefert die Datei mit MIME-Typ, ETag und Schutz gegen Ausführung', async () => {
    const app = await buildTestApp();

    const antwort = await app.inject({ method: 'GET', url: `/api/fonts/${MITGELIEFERT.id}/file` });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.headers['content-type']).toBe('font/woff2');
    expect(antwort.headers['x-content-type-options']).toBe('nosniff');
    expect(String(antwort.headers['content-disposition'])).toContain('attachment;');
    expect(antwort.headers.etag).toBeDefined();
    expect(antwort.rawPayload.length).toBe(132);

    await app.close();
  });

  it('ist ohne Sitzung erreichbar – der Browser holt Schriften anonym', async () => {
    const app = await buildTestApp();

    const antwort = await app.inject({ method: 'GET', url: `/api/fonts/${UPLOADED_FONT_ID}/file` });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    await app.close();
  });

  it('verspricht bei mitgelieferten Kennungen keine Unveränderlichkeit', async () => {
    const app = await buildTestApp();

    const antwort = await app.inject({ method: 'GET', url: `/api/fonts/${MITGELIEFERT.id}/file` });

    expect(antwort.headers['cache-control']).toBe('public, max-age=86400, must-revalidate');

    await app.close();
  });

  it('antwortet auf ein passendes If-None-Match mit 304', async () => {
    const app = await buildTestApp();
    const erste = await app.inject({ method: 'GET', url: `/api/fonts/${MITGELIEFERT.id}/file` });

    const zweite = await app.inject({
      method: 'GET',
      url: `/api/fonts/${MITGELIEFERT.id}/file`,
      headers: { 'if-none-match': String(erste.headers.etag) },
    });

    expect(zweite.statusCode).toBe(304);

    await app.close();
  });

  it('lässt keine Kennung in das Verzeichnis ausbrechen (Pfad-Traversal)', async () => {
    const app = await buildTestApp();

    const versuche = [
      '..%2F..%2F..%2Fetc%2Fpasswd',
      '..%5C..%5Cwindows%5Cwin.ini',
      '%2Fetc%2Fpasswd',
      'bundled-..%2F..%2Fsecret',
      `${UPLOADED_FONT_ID}%2F..%2F..%2F.env`,
    ];

    for (const versuch of versuche) {
      const antwort = await app.inject({ method: 'GET', url: `/api/fonts/${versuch}/file` });

      // Keiner dieser Versuche darf 200 werden – und keiner darf als
      // Serverfehler enden, sonst hätte ihn erst das Dateisystem abgefangen.
      expect(antwort.statusCode).toBe(400);
      expect(antwort.json().error.code).toBe('VALIDATION_FAILED');
    }

    await app.close();
  });

  it('meldet eine unbekannte Kennung als FONT_NOT_FOUND', async () => {
    const app = await buildTestApp();

    const antwort = await app.inject({
      method: 'GET',
      url: '/api/fonts/99999999-9999-4999-8999-999999999999/file',
    });

    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('FONT_NOT_FOUND');

    await app.close();
  });
});

describe('POST /api/admin/fonts', () => {
  it('nimmt einen Upload als multipart/form-data entgegen', async () => {
    const app = await buildTestApp();
    const { payload, headers } = multipartBody(
      {
        label: 'Inter (variabel)',
        family: 'Inter',
        variable: 'true',
        weightMin: '100',
        weightMax: '900',
      },
      { name: 'inter.woff2', content: fontBytes('woff2', 32) },
    );

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/admin/fonts',
      headers: { ...headers, 'x-test-actor': 'userAdmin' },
      payload,
    });
    const body = antwort.json();

    expect(antwort.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.family).toBe('Inter');
    expect(body.data.variable).toBe(true);
    expect(body.data.weightRange).toEqual({ min: 100, max: 900 });
    // Ohne Angabe gilt „proportional" – die Vorgabe setzt das Backend, nicht
    // das Schema.
    expect(body.data.monospace).toBe(false);

    await app.close();
  });

  /*
   * Ein Multipart-Formular kennt nur Zeichenketten. Das Umwandeln gehört in
   * die Route: Das Vertragsschema lehnt die Zeichenkette `"true"` ausdrücklich
   * ab, damit nicht aus jedem beliebigen Text stillschweigend „wahr" wird.
   */
  it('übernimmt „dicktengleich" als Zeichenkette aus dem Formular', async () => {
    const app = await buildTestApp();

    const wahr = multipartBody(
      { label: 'Konsole', family: 'Konsole', monospace: 'true' },
      { name: 'konsole.woff2', content: fontBytes('woff2', 32) },
    );
    const wahrAntwort = await app.inject({
      method: 'POST',
      url: '/api/admin/fonts',
      headers: { ...wahr.headers, 'x-test-actor': 'userAdmin' },
      payload: wahr.payload,
    });

    expect(wahrAntwort.statusCode).toBe(200);
    expect(wahrAntwort.json().data.monospace).toBe(true);

    const falsch = multipartBody(
      // Nur ASCII: `fontFamilyNameSchema` lässt im Familiennamen weder Umlaute
      // noch ß zu, weil er in der erzeugten @font-face-Regel landet.
      { label: 'Fließtext', family: 'Fliesstext', monospace: 'false' },
      { name: 'fliesstext.woff2', content: fontBytes('woff2', 32) },
    );
    const falschAntwort = await app.inject({
      method: 'POST',
      url: '/api/admin/fonts',
      headers: { ...falsch.headers, 'x-test-actor': 'userAdmin' },
      payload: falsch.payload,
    });

    expect(falschAntwort.statusCode).toBe(200);
    expect(falschAntwort.json().data.monospace).toBe(false);

    await app.close();
  });

  it('beantwortet einen belegten Familiennamen mit FONT_FAMILY_TAKEN', async () => {
    const app = await buildTestApp();
    const { payload, headers } = multipartBody(
      // Denselben Namen trägt bereits die hochgeladene Schrift des Aufbaus.
      { label: 'Zweite', family: uploadedFontRecord().family },
      { name: 'zweite.woff2', content: fontBytes('woff2', 32) },
    );

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/admin/fonts',
      headers: { ...headers, 'x-test-actor': 'userAdmin' },
      payload,
    });

    // 409, nicht 400: Der Eingabe steht der Bestand entgegen, sie ist nicht
    // fehlerhaft.
    expect(antwort.statusCode).toBe(409);
    expect(antwort.json().error.code).toBe('FONT_FAMILY_TAKEN');

    await app.close();
  });

  it('weist ein Konto ohne user.manage ab', async () => {
    const app = await buildTestApp();
    const { payload, headers } = multipartBody(
      { label: 'Inter', family: 'Inter' },
      { name: 'inter.woff2', content: fontBytes('woff2') },
    );

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/admin/fonts',
      headers: { ...headers, 'x-test-actor': 'nutzer' },
      payload,
    });

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json().error.code).toBe('PERMISSION_DENIED');

    await app.close();
  });

  it('gibt der lügenden Endung den Code aus dem Schriften-Katalog', async () => {
    const app = await buildTestApp();
    const { payload, headers } = multipartBody(
      { label: 'Kein Font', family: 'Kein Font' },
      { name: 'inter.woff2', content: fontBytes('zip') },
    );

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/admin/fonts',
      headers: { ...headers, 'x-test-actor': 'userAdmin' },
      payload,
    });

    expect(antwort.statusCode).toBe(422);
    expect(antwort.json().error.code).toBe('FONT_FILE_INVALID');

    await app.close();
  });

  it('prüft den Familiennamen gegen das Vertragsschema', async () => {
    const app = await buildTestApp();
    const { payload, headers } = multipartBody(
      {
        label: 'Einschleusung',
        family: 'Inter"; } body { display: none } @font-face { font-family: "x',
      },
      { name: 'inter.woff2', content: fontBytes('woff2') },
    );

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/admin/fonts',
      headers: { ...headers, 'x-test-actor': 'userAdmin' },
      payload,
    });

    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.code).toBe('VALIDATION_FAILED');

    await app.close();
  });

  it('lehnt eine angekündigte Nutzlast über der Obergrenze ab, ohne sie zu lesen', async () => {
    const app = await buildTestApp();
    const { payload, headers } = multipartBody(
      { label: 'Riesig', family: 'Riesig' },
      { name: 'gross.ttf', content: fontBytes('ttf', FONT_UPLOAD_MAX_SIZE_BYTES) },
    );

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/admin/fonts',
      headers: { ...headers, 'x-test-actor': 'userAdmin' },
      payload,
    });

    expect(antwort.statusCode).toBe(413);
    expect(antwort.json().error.code).toBe('FONT_FILE_TOO_LARGE');

    await app.close();
  });
});

describe('DELETE /api/admin/fonts/:id', () => {
  it('schützt mitgelieferte Schriften', async () => {
    const app = await buildTestApp();

    const antwort = await app.inject({
      method: 'DELETE',
      url: `/api/admin/fonts/${MITGELIEFERT.id}`,
      headers: { 'x-test-actor': 'userAdmin' },
    });

    expect(antwort.statusCode).toBe(403);
    expect(antwort.json().error.code).toBe('FONT_BUNDLED_PROTECTED');

    await app.close();
  });

  it('schützt eine gewählte Schrift', async () => {
    const app = await buildTestApp([UPLOADED_FONT_ID]);

    const antwort = await app.inject({
      method: 'DELETE',
      url: `/api/admin/fonts/${UPLOADED_FONT_ID}`,
      headers: { 'x-test-actor': 'userAdmin' },
    });

    expect(antwort.statusCode).toBe(409);
    expect(antwort.json().error.code).toBe('FONT_IN_USE');

    await app.close();
  });

  it('löscht eine ungewählte Schrift und antwortet im Envelope', async () => {
    const app = await buildTestApp();

    const antwort = await app.inject({
      method: 'DELETE',
      url: `/api/admin/fonts/${UPLOADED_FONT_ID}`,
      headers: { 'x-test-actor': 'userAdmin' },
    });

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ success: true, data: null, error: null });

    await app.close();
  });
});
