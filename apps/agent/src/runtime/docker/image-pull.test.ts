/**
 * Tests des Image-Zugs (Gefundener Punkt 111).
 *
 * Geprüft wird ohne Netz: Zerlegen der Referenz, die Frage, wohin
 * Zugangsdaten gehören, und das Lesen des Fortschritt-Streams – dort steckt der
 * Fehlschlag, nicht im HTTP-Status.
 */

import { describe, expect, it, vi } from 'vitest';
import { isContainerRuntimeError } from '../errors.js';
import {
  belongsToRegistry,
  pullErrorFrom,
  pullImage,
  registryAuthHeader,
  registryHinweis,
  splitImageReference,
} from './image-pull.js';

/**
 * Dekodiert so streng wie Go's `base64.URLEncoding` (moby,
 * `registry.DecodeAuthConfig`): nur das URL-Alphabet, Länge durch vier teilbar,
 * Padding mit `=` Pflicht. Node's eigener Dekoder ist nachsichtig und nähme
 * auch einen Kopf ohne Padding an – genau den, den die Engine wegwirft.
 */
function dekodiereWieGo(kopf: string): string {
  if (kopf.length % 4 !== 0 || !/^[A-Za-z0-9_-]+={0,2}$/u.test(kopf)) {
    throw new Error(`illegal base64 data: ${kopf}`);
  }

  return Buffer.from(kopf.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
}

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

describe('registryAuthHeader', () => {
  // Ein GHCR-Token: `ghp_` und 36 Zeichen. Mit ihm ist das JSON 106 Byte lang,
  // also nicht durch drei teilbar – der Fall, in dem Padding gebraucht wird.
  const token = `ghp_${'a'.repeat(36)}`;

  it('polstert den Kopf so, wie Go ihn dekodiert (Fundpunkt 182)', () => {
    const kopf = registryAuthHeader({
      server: 'ghcr.io',
      username: 'nightriderp',
      password: token,
    });

    // Ohne Padding bricht Go's Dekoder am letzten Block ab, die Engine wirft den
    // Kopf weg und zieht anonym – GHCR meldet dann `unauthorized`.
    expect(kopf.endsWith('==')).toBe(true);
    expect(JSON.parse(dekodiereWieGo(kopf))).toEqual({
      username: 'nightriderp',
      password: token,
      serveraddress: 'ghcr.io',
    });
  });

  it('bleibt beim URL-Alphabet, auch wo Standard-base64 + oder / schriebe', () => {
    // `>>>?` ergibt in Standard-base64 `Pj4+Pw==` – das `+` darf hier nicht
    // durchkommen, Go's URL-Dekoder kennt es nicht.
    const kopf = registryAuthHeader({ server: '>>>?', username: '???>', password: '>>>?>>>?' });

    expect(kopf).not.toMatch(/[+/]/u);
    expect(JSON.parse(dekodiereWieGo(kopf))).toEqual({
      username: '???>',
      password: '>>>?>>>?',
      serveraddress: '>>>?',
    });
  });
});

describe('registryHinweis', () => {
  it('erklärt „unauthorized“ mit Zugangsdaten als abgelehnte Anmeldung', () => {
    expect(registryHinweis('error from registry: unauthorized', true)).toContain(
      'AGENT_REGISTRY_TOKEN',
    );
  });

  it('erklärt „unauthorized“ ohne Zugangsdaten als fehlende Anmeldung', () => {
    expect(registryHinweis('unauthorized', false)).toContain('keine Zugangsdaten');
  });

  it('erklärt „denied“ als fehlendes Recht', () => {
    expect(registryHinweis('denied', true)).toContain('read:packages');
  });

  it('schweigt bei anderen Fehlern', () => {
    expect(registryHinweis('manifest unknown', true)).toBe('');
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
    // Streng wie die Engine, nicht mit Node's nachsichtigem Dekoder: Der nähme
    // auch einen Kopf ohne Padding an, den die Engine längst weggeworfen hat.
    expect(JSON.parse(dekodiereWieGo(kopf))).toEqual({
      username: 'wer',
      password: 'geheim',
      serveraddress: 'ghcr.io',
    });
  });

  it('nennt bei „unauthorized“ die Variablen, an denen es liegt', async () => {
    const c = client('{"error":"error from registry: unauthorized\\nunauthorized"}');

    const fehler = await pullImage(c as never, 'ghcr.io/nightriderp/spiel:v1', {
      credentials: { server: 'ghcr.io', username: 'wer', password: 'geheim' },
      timeoutMs: 1_000,
    }).catch((e: unknown) => e);

    expect((fehler as Error).message).toContain('unauthorized');
    expect((fehler as Error).message).toContain('AGENT_REGISTRY_TOKEN');
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
