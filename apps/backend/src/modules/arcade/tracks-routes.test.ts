/**
 * Musik-Uploads über die HTTP-Ebene: Rechte, Größe und Erkennung an den
 * ersten Bytes (der Typ vom Browser zählt nicht).
 */

import multipart from '@fastify/multipart';
import { ARCADE_TRACK_MAX_BYTES } from '@palantir/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { actorWith, ownerActor } from '../admin/test-support.js';
import { type PermissionActor, registerRbac } from '../rbac/index.js';
import {
  type ArcadeTrackRecord,
  type ArcadeTrackRepository,
  createArcadeTrackService,
  detectAudioMimeType,
} from './tracks.js';
import { registerArcadeTrackRoutes } from './tracks-routes.js';

const MP3_ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(64)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)]);
const WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WAVE'),
  Buffer.alloc(64),
]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

describe('Erkennung an den ersten Bytes', () => {
  it.each([
    ['MP3 mit ID3', MP3_ID3, 'audio/mpeg'],
    ['MP3 ohne ID3', MP3_FRAME, 'audio/mpeg'],
    ['OGG', OGG, 'audio/ogg'],
    ['WAV', WAV, 'audio/wav'],
    ['HTML', HTML, null],
    ['RIFF ohne WAVE', Buffer.from('RIFF0000AVI LIST'), null],
    ['leer', Buffer.alloc(0), null],
  ])('%s', (_name, data, erwartet) => {
    expect(detectAudioMimeType(data)).toBe(erwartet);
  });
});

function fakeTrackRepository(): ArcadeTrackRepository & {
  records: Map<string, ArcadeTrackRecord & { data: Buffer }>;
} {
  const records = new Map<string, ArcadeTrackRecord & { data: Buffer }>();
  let counter = 0;

  return {
    records,
    async list() {
      return [...records.values()];
    },
    async listActive() {
      return [...records.values()].filter((r) => r.isActive);
    },
    async audio(id) {
      const r = records.get(id);
      return r ? { id: r.id, mimeType: r.mimeType, data: r.data } : null;
    },
    async insert(input) {
      counter += 1;
      const id = `44444444-4444-4444-8444-${String(counter).padStart(12, '0')}`;
      const record = {
        id,
        gameId: input.gameId,
        title: input.title,
        mimeType: input.mimeType,
        sizeBytes: input.data.length,
        isActive: false,
        uploadedAt: new Date(0),
        uploadedByDisplayName: 'Ada',
        data: input.data,
      };
      records.set(id, record);
      return record;
    },
    async activate(id) {
      const r = records.get(id);
      if (!r) return false;
      for (const other of records.values()) if (other.gameId === r.gameId) other.isActive = false;
      r.isActive = true;
      return true;
    },
    async deactivate(id) {
      const r = records.get(id);
      if (!r) return false;
      r.isActive = false;
      return true;
    },
    async remove(id) {
      return records.delete(id);
    },
  };
}

let app: FastifyInstance | undefined;
let repository: ReturnType<typeof fakeTrackRepository>;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function buildApp(): Promise<FastifyInstance> {
  const actors: Record<string, PermissionActor> = {
    owner: ownerActor(),
    spieler: actorWith(),
    musik: actorWith('gametype.manage'),
  };

  repository = fakeTrackRepository();
  const instance = Fastify({ logger: false });
  app = instance;
  registerRbac(instance, {
    resolveActor: (request) => {
      const header = request.headers['x-test-actor'];
      return typeof header === 'string' ? (actors[header] ?? null) : null;
    },
  });
  await instance.register(multipart, {
    limits: { fileSize: ARCADE_TRACK_MAX_BYTES * 2, files: 1 },
  });
  await instance.register(
    registerArcadeTrackRoutes({
      tracks: createArcadeTrackService(repository),
      resolveUserId: () => '11111111-1111-4111-8111-000000000001',
    }),
  );
  await instance.ready();

  return instance;
}

function formular(felder: Record<string, string>, datei: Buffer, typ = 'audio/mpeg') {
  const grenze = '----palantirMusikTest';
  const teile = Object.entries(felder).map(([name, wert]) =>
    Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${wert}\r\n`),
  );
  const kopf = Buffer.from(
    `--${grenze}\r\nContent-Disposition: form-data; name="file"; filename="stueck.mp3"\r\n` +
      `Content-Type: ${typ}\r\n\r\n`,
  );

  return {
    payload: Buffer.concat([...teile, kopf, datei, Buffer.from(`\r\n--${grenze}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${grenze}` },
  };
}

async function hochladen(
  actor: string,
  datei: Buffer,
  felder = { gameId: 'kriechpfad', title: 'Titel' },
) {
  const { payload, headers } = formular(felder, datei);

  return app!.inject({
    method: 'POST',
    url: '/arcade/tracks',
    headers: { ...headers, 'x-test-actor': actor },
    payload,
  });
}

describe('POST /arcade/tracks', () => {
  it('nimmt MP3 an und bestimmt den Typ selbst', async () => {
    await buildApp();

    const antwort = await hochladen('musik', OGG);

    expect(antwort.statusCode).toBe(200);
    // Der Browser sagte `audio/mpeg`, die Bytes sagen OGG.
    expect(antwort.json().data).toMatchObject({
      mimeType: 'audio/ogg',
      gameId: 'kriechpfad',
      isActive: false,
    });
  });

  it('lehnt Nicht-Audio ab', async () => {
    await buildApp();

    const antwort = await hochladen('musik', HTML);

    expect(antwort.statusCode).toBe(422);
    expect(antwort.json().error.code).toBe('ARCADE_TRACK_INVALID');
  });

  it('lehnt zu große Dateien ab', async () => {
    await buildApp();

    const antwort = await hochladen(
      'musik',
      Buffer.concat([Buffer.from('ID3'), Buffer.alloc(ARCADE_TRACK_MAX_BYTES)]),
    );

    expect(antwort.statusCode).toBe(413);
    expect(antwort.json().error.code).toBe('ARCADE_TRACK_TOO_LARGE');
  });

  it('verlangt `gametype.manage`', async () => {
    await buildApp();

    const antwort = await hochladen('spieler', MP3_ID3);

    expect(antwort.statusCode).toBe(403);
    expect(repository.records.size).toBe(0);
  });

  it('prüft Spiel und Titel', async () => {
    await buildApp();

    const antwort = await hochladen('musik', MP3_ID3, { gameId: 'gibtsnicht', title: 'x' });

    expect(antwort.statusCode).toBe(400);
  });
});

describe('Abspielen und Aktivieren', () => {
  it('liefert das aktive Stück mit Kopfzeilen und ETag an jedes freigeschaltete Konto', async () => {
    await buildApp();
    const id = (await hochladen('musik', MP3_ID3)).json().data.id as string;

    expect(
      (
        await app!.inject({
          method: 'POST',
          url: `/arcade/tracks/${id}/activate`,
          headers: { 'x-test-actor': 'spieler' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app!.inject({
          method: 'POST',
          url: `/arcade/tracks/${id}/activate`,
          headers: { 'x-test-actor': 'musik' },
        })
      ).statusCode,
    ).toBe(200);

    const aktiv = await app!.inject({
      method: 'GET',
      url: '/arcade/tracks/active',
      headers: { 'x-test-actor': 'spieler' },
    });
    expect(aktiv.json().data.tracks.kriechpfad).toMatchObject({ id, mimeType: 'audio/mpeg' });

    const audio = await app!.inject({
      method: 'GET',
      url: `/arcade/tracks/${id}/audio`,
      headers: { 'x-test-actor': 'spieler' },
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/mpeg');
    expect(audio.headers['x-content-type-options']).toBe('nosniff');
    expect(audio.headers['cache-control']).toBe('private, max-age=604800, immutable');
    expect(audio.rawPayload.equals(MP3_ID3)).toBe(true);

    const erneut = await app!.inject({
      method: 'GET',
      url: `/arcade/tracks/${id}/audio`,
      headers: { 'x-test-actor': 'spieler', 'if-none-match': String(audio.headers.etag) },
    });
    expect(erneut.statusCode).toBe(304);
  });

  it('meldet unbekannte Stücke mit ARCADE_TRACK_NOT_FOUND', async () => {
    await buildApp();

    const antwort = await app!.inject({
      method: 'DELETE',
      url: '/arcade/tracks/44444444-4444-4444-8444-999999999999',
      headers: { 'x-test-actor': 'musik' },
    });

    expect(antwort.statusCode).toBe(404);
    expect(antwort.json().error.code).toBe('ARCADE_TRACK_NOT_FOUND');
  });

  it('zeigt die Verwaltungsliste nur mit Recht', async () => {
    await buildApp();

    expect(
      (
        await app!.inject({
          method: 'GET',
          url: '/arcade/tracks',
          headers: { 'x-test-actor': 'spieler' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app!.inject({
          method: 'GET',
          url: '/arcade/tracks',
          headers: { 'x-test-actor': 'owner' },
        })
      ).json().data,
    ).toEqual({ tracks: [], permissions: { canManage: true } });
  });
});
