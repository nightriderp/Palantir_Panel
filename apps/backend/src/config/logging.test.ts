/**
 * Schwärzung der Log-Zeilen (Audit W3-9; security-matrix-09, backend-auth-08).
 *
 * Geprüft wird gegen einen echten Fastify-Logger, der in einen Speicher-Strom
 * schreibt – nicht nur gegen den Serializer: Erst die Kombination aus
 * Serializer und `redact` ergibt die Zeile, die im Container-Log landet.
 */

import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_CENSOR, buildLoggerOptions, serializeRequestForLog } from './logging.js';

/** Sammelt die geschriebenen Log-Zeilen als Text. */
function createLogSink(): { stream: Writable; zeilen: () => string } {
  const teile: string[] = [];

  return {
    stream: new Writable({
      write(chunk: Buffer | string, _encoding, callback): void {
        teile.push(chunk.toString());
        callback();
      },
    }),
    zeilen: () => teile.join(''),
  };
}

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('Serializer für Requests im Log', () => {
  it('schneidet die Query aus der URL und behält nur die Namen', () => {
    const serialized = serializeRequestForLog({
      method: 'GET',
      url: '/auth/discord/callback?code=geheimer-code&state=geheimer-state',
      host: 'panel.example',
      ip: '203.0.113.10',
      headers: {},
    });

    expect(serialized.url).toBe('/auth/discord/callback');
    expect(serialized.queryKeys).toEqual(['code', 'state']);
    expect(JSON.stringify(serialized)).not.toContain('geheim');
  });

  it('kommt mit einem rohen Node-Request ohne `ip` zurecht', () => {
    const serialized = serializeRequestForLog({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'panel.example', 'accept-version': '1' },
      socket: { remotePort: 51234 },
    });

    expect(serialized).toMatchObject({
      method: 'POST',
      url: '/auth/login',
      host: 'panel.example',
      version: '1',
      remotePort: 51234,
    });
    // Ohne Query bleibt das Feld weg, statt als leere Liste dazustehen.
    expect(serialized.queryKeys).toBeUndefined();
  });

  it('bleibt still, wenn gar kein Request kommt', () => {
    expect(serializeRequestForLog(undefined)).toMatchObject({ url: undefined });
  });
});

describe('Fastify-Log ohne Zugangsdaten (Pflichtenheft §7, §18)', () => {
  it('schreibt weder Query-Werte noch das Bearer-Token des Aufrufs', async () => {
    const sink = createLogSink();

    app = Fastify({ logger: { ...buildLoggerOptions('info'), stream: sink.stream } });
    app.get('/auth/:provider/callback', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/auth/steam/callback?code=geheimer-code&state=geheimer-state&openid.sig=geheime-signatur',
      headers: { authorization: 'Bearer geheimes-token', cookie: 'palantir_access=geheim-cookie' },
    });

    expect(response.statusCode).toBe(200);

    const log = sink.zeilen();

    // Die Zeile ist da – nur eben ohne die Werte.
    expect(log).toContain('incoming request');
    expect(log).toContain('/auth/steam/callback');
    expect(log).not.toContain('geheimer-code');
    expect(log).not.toContain('geheimer-state');
    expect(log).not.toContain('geheime-signatur');
    expect(log).not.toContain('geheimes-token');
    expect(log).not.toContain('geheim-cookie');
    // Die Namen der Parameter bleiben – sie sagen, in welcher Form der
    // Rücklauf ankam, ohne den Inhalt festzuhalten.
    expect(log).toContain('openid.sig');
  });

  it('schwärzt Header und Query auch in selbst geschriebenen Zeilen', async () => {
    const sink = createLogSink();

    app = Fastify({ logger: { ...buildLoggerOptions('info'), stream: sink.stream } });
    await app.ready();

    app.log.info(
      {
        headers: { authorization: 'Bearer geheimes-token', cookie: 'sitzung=geheim-cookie' },
        query: { key: 'geheimer-steam-key' },
      },
      'Aufruf an die Steam-Web-API',
    );

    const log = sink.zeilen();

    expect(log).toContain('Aufruf an die Steam-Web-API');
    expect(log).toContain(LOG_CENSOR);
    expect(log).not.toContain('geheimes-token');
    expect(log).not.toContain('geheim-cookie');
    expect(log).not.toContain('geheimer-steam-key');
  });
});
