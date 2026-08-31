/**
 * Tests des Image-Zugs (Gefundener Punkt 111).
 *
 * Geprüft wird ohne Netz: Zerlegen der Referenz, die Frage, wohin
 * Zugangsdaten gehören, und das Lesen des Fortschritt-Streams – dort steckt der
 * Fehlschlag, nicht im HTTP-Status.
 */

import { describe, expect, it, vi } from 'vitest';
import { isContainerRuntimeError } from '../errors.js';
import { belongsToRegistry, pullErrorFrom, pullImage, splitImageReference } from './image-pull.js';

describe('splitImageReference', () => {
  it('trennt Name und Fassung', () => {
    expect(splitImageReference('itzg/minecraft-server:java21')).toEqual({
      name: 'itzg/minecraft-server',
      tag: 'java21',
    });
  });

  it('nimmt ohne Fassung „latest“', () => {
    expect(splitImageReference('itzg/minecraft-server')).toEqual({
      name: 'itzg/minecraft-server',
      tag: 'latest',
    });
  });

  it('hält den Doppelpunkt einer Portangabe nicht für eine Fassung', () => {
    expect(splitImageReference('registry:5000/palantir/spiel')).toEqual({
      name: 'registry:5000/palantir/spiel',
      tag: 'latest',
    });
    expect(splitImageReference('registry:5000/palantir/spiel:v2')).toEqual({
      name: 'registry:5000/palantir/spiel',
      tag: 'v2',
    });
  });
});

describe('belongsToRegistry', () => {
  it('erkennt Images der eigenen Registry', () => {
    expect(belongsToRegistry('ghcr.io/nightriderp/spiel:v1', 'ghcr.io')).toBe(true);
  });

  it('schickt keine Zugangsdaten an eine fremde Registry', () => {
    // Ein Token für ghcr.io hat bei Docker Hub nichts verloren.
    expect(belongsToRegistry('itzg/minecraft-server:java21', 'ghcr.io')).toBe(false);
    expect(belongsToRegistry('ghcr.io.example.com/spiel', 'ghcr.io')).toBe(false);
  });
});

describe('pullErrorFrom', () => {
  it('findet den Fehler im Fortschritt-Stream', () => {
    const body = [
      '{"status":"Pulling from itzg/minecraft-server"}',
      '{"errorDetail":{"message":"unauthorized"},"error":"unauthorized"}',
    ].join('\n');

    expect(pullErrorFrom(body)).toBe('unauthorized');
  });

  it('meldet nichts, wenn der Zug durchlief', () => {
    expect(pullErrorFrom('{"status":"Download complete"}\n{"status":"Pull complete"}')).toBeNull();
  });

  it('lässt sich von unlesbaren Zeilen nicht beirren', () => {
    expect(pullErrorFrom('kein JSON\n\n{"status":"ok"}')).toBeNull();
  });
});

describe('pullImage', () => {
  function client(body: string) {
    return {
      requestRaw: vi.fn().mockResolvedValue({ text: () => Promise.resolve(body) }),
    };
  }

  it('holt Name und Fassung getrennt und ohne Zugangsdaten für öffentliche Images', async () => {
    const c = client('{"status":"Pull complete"}');

    await pullImage(c as never, 'itzg/minecraft-server:java21', {
      credentials: { server: 'ghcr.io', username: 'wer', password: 'geheim' },
      timeoutMs: 1_000,
    });

    const [, pfad, options] = c.requestRaw.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];

    expect(pfad).toBe('/images/create');
    expect(options['query']).toEqual({ fromImage: 'itzg/minecraft-server', tag: 'java21' });
    // Docker Hub bekommt das GHCR-Token nicht zu sehen.
    expect(options['headers']).toBeUndefined();
  });

  it('legt für die eigene Registry den Zugang bei', async () => {
    const c = client('{"status":"Pull complete"}');

    await pullImage(c as never, 'ghcr.io/nightriderp/spiel:v1', {
      credentials: { server: 'ghcr.io', username: 'wer', password: 'geheim' },
      timeoutMs: 1_000,
    });

    const options = c.requestRaw.mock.calls[0]?.[2] as { headers?: Record<string, string> };
    const kopf = options.headers?.['X-Registry-Auth'] ?? '';

    expect(kopf.length).toBeGreaterThan(0);
    expect(JSON.parse(Buffer.from(kopf, 'base64url').toString('utf8'))).toEqual({
      username: 'wer',
      password: 'geheim',
      serveraddress: 'ghcr.io',
    });
  });

  it('scheitert am Fehler im Stream, obwohl der Status Erfolg meldet', async () => {
    // `/images/create` antwortet mit HTTP 200 und meldet den Fehlschlag erst im
    // Körper – wer nur den Status prüft, hält den Zug für gelungen.
    const c = client('{"error":"manifest unknown"}');

    const fehler = await pullImage(c as never, 'ghcr.io/nightriderp/spiel:v1', {
      timeoutMs: 1_000,
    }).catch((e: unknown) => e);

    expect(isContainerRuntimeError(fehler)).toBe(true);
    expect((fehler as Error).message).toContain('manifest unknown');
  });
});
