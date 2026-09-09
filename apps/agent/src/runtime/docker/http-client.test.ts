/**
 * Streams des Docker-Clients ueber `node:http` (Fundpunkt 189).
 *
 * Die Tests der Docker-Runtime injizieren `fetch` und pruefen die Logik
 * dahinter; hier geht es um den anderen Weg, den nur der Betrieb nimmt: ein
 * echter HTTP-Server auf einem freien Port, gegen den der Client ohne Stub
 * arbeitet. Dass ein Strom auch nach 300 s Stille nicht abreisst, laesst sich
 * hier nicht in vertretbarer Zeit zeigen - geprueft wird alles andere, was den
 * Weg vom fetch-Weg unterscheidet: Kopfzeilen und Koerper kommen an, die
 * Fehleruebersetzung ist dieselbe, `cancel()` schliesst die Verbindung und
 * meldet sich als `AbortError`.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ContainerRuntimeError } from '../errors.js';
import { DockerHttpClient } from './http-client.js';

interface Aufruf {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

const server: http.Server[] = [];

afterEach(async () => {
  for (const s of server.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/** Startet einen Server, der jeden Aufruf aufzeichnet und an `antworte` gibt. */
async function proxy(
  antworte: (aufruf: Aufruf, res: http.ServerResponse, req: http.IncomingMessage) => void,
): Promise<{ baseUrl: string; aufrufe: Aufruf[] }> {
  const aufrufe: Aufruf[] = [];
  const s = http.createServer((req, res) => {
    const teile: Buffer[] = [];
    req.on('data', (teil: Buffer) => teile.push(teil));
    req.on('end', () => {
      const aufruf: Aufruf = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(teile).toString('utf8'),
      };
      aufrufe.push(aufruf);
      antworte(aufruf, res, req);
    });
  });
  server.push(s);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
  const { port } = s.address() as AddressInfo;

  return { baseUrl: `http://127.0.0.1:${String(port)}`, aufrufe };
}

async function alles(body: AsyncIterable<Uint8Array>): Promise<string> {
  const teile: Buffer[] = [];
  for await (const teil of body) {
    teile.push(Buffer.from(teil));
  }

  return Buffer.concat(teile).toString('utf8');
}

describe('DockerHttpClient.openStream ueber node:http (Fundpunkt 189)', () => {
  it('liefert den Strom stueckweise und endet, wenn der Server schliesst', async () => {
    const { baseUrl, aufrufe } = await proxy((_aufruf, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"status":"start"}\n');
      setTimeout(() => res.write('{"status":"die"}\n'), 20);
      setTimeout(() => res.end('{"status":"destroy"}\n'), 40);
    });
    const client = new DockerHttpClient({ baseUrl });

    const strom = await client.openStream('GET', '/events', {
      query: { filters: '{"type":["container"]}' },
    });

    await expect(alles(strom.body)).resolves.toBe(
      '{"status":"start"}\n{"status":"die"}\n{"status":"destroy"}\n',
    );
    expect(aufrufe[0]?.method).toBe('GET');
    expect(aufrufe[0]?.url).toBe('/events?filters=%7B%22type%22%3A%5B%22container%22%5D%7D');
    expect(aufrufe[0]?.headers.accept).toBe('application/json');
  });

  it('schickt Koerper und Kopfzeilen mit - wie beim Start eines Exec', async () => {
    const { baseUrl, aufrufe } = await proxy((_aufruf, res) => {
      res.writeHead(200);
      res.end('ausgabe');
    });
    const client = new DockerHttpClient({ baseUrl });

    const strom = await client.openStream('POST', '/exec/abc/start', {
      body: { Detach: false, Tty: false },
      headers: { 'X-Registry-Auth': 'geheim' },
    });

    await expect(alles(strom.body)).resolves.toBe('ausgabe');
    expect(aufrufe[0]?.method).toBe('POST');
    expect(aufrufe[0]?.headers['content-type']).toBe('application/json');
    expect(aufrufe[0]?.headers['x-registry-auth']).toBe('geheim');
    expect(JSON.parse(aufrufe[0]?.body ?? '')).toEqual({ Detach: false, Tty: false });
  });

  it('uebersetzt eine Fehlerantwort in den Katalog - wie der fetch-Weg', async () => {
    const { baseUrl } = await proxy((_aufruf, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"message":"No such container: abc"}');
    });
    const client = new DockerHttpClient({ baseUrl });

    const fehler = await client.openStream('GET', '/containers/abc/logs').catch((f: unknown) => f);

    expect(fehler).toBeInstanceOf(ContainerRuntimeError);
    expect((fehler as ContainerRuntimeError).code).toBe('CONTAINER_NOT_FOUND');
    expect((fehler as ContainerRuntimeError).message).toBe('No such container: abc');
  });

  it('nimmt den abweichenden 404-Code und geduldete Status an', async () => {
    let status = 404;
    const { baseUrl } = await proxy((_aufruf, res) => {
      res.writeHead(status);
      res.end('{"message":"weg"}');
    });
    const client = new DockerHttpClient({ baseUrl });

    await expect(
      client.openStream('GET', '/images/x', { notFoundCode: 'IMAGE_NOT_FOUND' }),
    ).rejects.toMatchObject({ code: 'IMAGE_NOT_FOUND' });

    // 409 statt 304: Ein 304 traegt laut HTTP keinen Koerper, den wuerde der
    // Client verwerfen - geprueft werden soll aber, dass der Strom durchkommt.
    status = 409;
    const strom = await client.openStream('GET', '/x', { tolerateStatus: [409] });
    await expect(alles(strom.body)).resolves.toBe('{"message":"weg"}');
  });

  it('cancel() beendet den Strom als AbortError und schliesst die Verbindung', async () => {
    let geschlossen = false;
    const { baseUrl } = await proxy((_aufruf, res, req) => {
      req.on('close', () => {
        geschlossen = true;
      });
      res.writeHead(200);
      res.write('erster Teil\n');
      // ... und dann Stille, wie /events sie stundenlang halten darf.
    });
    const client = new DockerHttpClient({ baseUrl });

    const strom = await client.openStream('GET', '/events');
    const leser = strom.body[Symbol.asyncIterator]();
    const erstes = await leser.next();
    expect(Buffer.from(erstes.value as Uint8Array).toString('utf8')).toBe('erster Teil\n');

    strom.cancel();

    const ende = await leser.next().catch((f: unknown) => f);
    expect(ende).toMatchObject({ name: 'AbortError' });
    // Der Server sieht das Ende der Verbindung - nichts bleibt haengen.
    for (let i = 0; i < 50 && !geschlossen; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(geschlossen).toBe(true);
  });

  it('meldet einen nicht erreichbaren Proxy als RUNTIME_UNAVAILABLE', async () => {
    // Port eben geoeffnet und wieder geschlossen: dort lauscht niemand.
    const { baseUrl } = await proxy(() => undefined);
    const s = server.pop();
    await new Promise<void>((resolve) => s?.close(() => resolve()));
    const client = new DockerHttpClient({ baseUrl });

    await expect(client.openStream('GET', '/events')).rejects.toMatchObject({
      code: 'RUNTIME_UNAVAILABLE',
    });
  });

  it('laeuft mit injiziertem fetch weiterhin ueber diesen (Tests der Runtime)', async () => {
    const aufrufe: string[] = [];
    const client = new DockerHttpClient({
      baseUrl: 'http://proxy.test',
      fetchImpl: (input) => {
        aufrufe.push(input);

        return Promise.resolve(new Response('per fetch', { status: 200 }));
      },
    });

    const strom = await client.openStream('GET', '/events');

    await expect(alles(strom.body)).resolves.toBe('per fetch');
    expect(aufrufe).toEqual(['http://proxy.test/events']);
  });
});
