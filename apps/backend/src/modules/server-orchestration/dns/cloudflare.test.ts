import { describe, expect, it } from 'vitest';
import { type ServerOrchestrationError } from '../errors.js';
import { buildServerDnsRecord, createCloudflareDnsProvider } from './cloudflare.js';
import { createNoopDnsProvider } from './types.js';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function fakeFetch(responses: { status: number; body: unknown }[]): {
  impl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;

  const impl = ((url: string, init: RequestInit = {}): Promise<Response> => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    });

    const response = responses[index++] ?? {
      status: 200,
      body: { success: true, errors: [], result: [] },
    };

    return Promise.resolve({
      ok: response.status < 400,
      status: response.status,
      json: () => Promise.resolve(response.body),
    } as Response);
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const ok = (result: unknown) => ({ status: 200, body: { success: true, errors: [], result } });

describe('buildServerDnsRecord() (Pflichtenheft §13)', () => {
  it('legt für Spiele ohne Hostname-Routing einen A-Eintrag auf die VPS-IP an', () => {
    expect(
      buildServerDnsRecord({
        hostname: 'meinserver.example.tld',
        supportsVirtualHostRouting: false,
        publicIpv4: '203.0.113.10',
        virtualHostProxyHostname: 'router.example.tld',
      }),
    ).toEqual({
      name: 'meinserver.example.tld',
      type: 'A',
      content: '203.0.113.10',
      proxied: false,
    });
  });

  it('legt für Hostname-Routing einen CNAME auf den Proxy an', () => {
    expect(
      buildServerDnsRecord({
        hostname: 'meinserver.example.tld',
        supportsVirtualHostRouting: true,
        publicIpv4: '203.0.113.10',
        virtualHostProxyHostname: 'router.example.tld',
      }),
    ).toMatchObject({ type: 'CNAME', content: 'router.example.tld' });
  });

  it('fällt ohne konfigurierten Proxy auf den A-Eintrag zurück', () => {
    expect(
      buildServerDnsRecord({
        hostname: 'meinserver.example.tld',
        supportsVirtualHostRouting: true,
        publicIpv4: '203.0.113.10',
        virtualHostProxyHostname: null,
      }),
    ).toMatchObject({ type: 'A' });
  });

  it('setzt niemals proxied – Cloudflare proxied kein rohes TCP/UDP', () => {
    for (const routing of [true, false]) {
      expect(
        buildServerDnsRecord({
          hostname: 'x.example.tld',
          supportsVirtualHostRouting: routing,
          publicIpv4: '203.0.113.10',
          virtualHostProxyHostname: 'router.example.tld',
        }).proxied,
      ).toBe(false);
    }
  });
});

describe('Cloudflare-Client', () => {
  const record = {
    name: 'meinserver.example.tld',
    type: 'A' as const,
    content: '203.0.113.10',
    proxied: false,
  };

  it('legt einen neuen Eintrag an, wenn keiner existiert', async () => {
    const { impl, calls } = fakeFetch([ok([]), ok({ id: 'rec-1' })]);
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    await expect(provider.upsertRecord(record)).resolves.toBe('rec-1');
    expect(calls[1]?.method).toBe('POST');
  });

  it('aktualisiert einen vorhandenen Eintrag, statt einen zweiten anzulegen', async () => {
    const { impl, calls } = fakeFetch([ok([{ id: 'rec-1' }]), ok({ id: 'rec-1' })]);
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    await provider.upsertRecord(record);

    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toContain('/dns_records/rec-1');
  });

  it('löscht einen vorhandenen Eintrag', async () => {
    const { impl, calls } = fakeFetch([ok([{ id: 'rec-1' }]), ok({ id: 'rec-1' })]);
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    await provider.deleteRecord('meinserver.example.tld');

    expect(calls[1]?.method).toBe('DELETE');
  });

  it('behandelt einen bereits fehlenden Eintrag beim Löschen nicht als Fehler', async () => {
    // Beim Löschen eines Servers soll ein von Hand entfernter DNS-Eintrag den
    // Vorgang nicht blockieren.
    const { impl, calls } = fakeFetch([ok([])]);
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    await expect(provider.deleteRecord('weg.example.tld')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('meldet einen abgelehnten Aufruf als DNS_UPDATE_FAILED', async () => {
    const { impl } = fakeFetch([
      {
        status: 403,
        body: { success: false, errors: [{ code: 9109, message: 'verboten' }], result: null },
      },
    ]);
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    try {
      await provider.upsertRecord(record);
      expect.unreachable('Der Aufruf hätte scheitern müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('DNS_UPDATE_FAILED');
      expect((error as ServerOrchestrationError).message).toContain('verboten');
    }
  });

  it('meldet einen Netzwerkfehler ebenfalls als DNS_UPDATE_FAILED', async () => {
    const impl = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    try {
      await provider.upsertRecord(record);
      expect.unreachable('Der Aufruf hätte scheitern müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('DNS_UPDATE_FAILED');
    }
  });

  it('schickt das Token im Authorization-Header', async () => {
    let header: string | undefined;
    const impl = ((_url: string, init: RequestInit = {}): Promise<Response> => {
      header = (init.headers as Record<string, string> | undefined)?.Authorization;

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, errors: [], result: [] }),
      } as Response);
    }) as unknown as typeof fetch;

    await createCloudflareDnsProvider({
      apiToken: 'geheim',
      zoneId: 'z',
      fetchImpl: impl,
    }).deleteRecord('x.example.tld');

    expect(header).toBe('Bearer geheim');
  });
});

/**
 * Wiederholungen (2026-09-11).
 *
 * Ein einziger Aussetzer auf dem Weg zu Cloudflare - eine Zeitueberschreitung
 * nach zehn Sekunden - hat das Anlegen eines Servers scheitern lassen und ihn
 * auf `error` stehen lassen. Cloudflare antwortete in derselben Minute wieder
 * in 430 Millisekunden.
 */
describe('Cloudflare-Client: Wiederholungen', () => {
  const record = {
    name: 'meinserver.example.tld',
    type: 'A' as const,
    content: '203.0.113.10',
    proxied: false,
  };

  /** Ein `fetch`, das die ersten `fehlschlaege` Aufrufe abbrechen laesst. */
  function mitAussetzern(fehlschlaege: number, danach: { status: number; body: unknown }[]) {
    const aufrufe: string[] = [];
    let index = 0;

    const impl = ((url: string, init: RequestInit = {}): Promise<Response> => {
      aufrufe.push(init.method ?? 'GET');

      if (index++ < fehlschlaege) {
        const fehler = new Error('This operation was aborted');
        fehler.name = 'AbortError';

        return Promise.reject(fehler);
      }

      const antwort = danach[index - 1 - fehlschlaege] ?? {
        status: 200,
        body: { success: true, errors: [], result: [] },
      };

      return Promise.resolve({
        ok: antwort.status < 400,
        status: antwort.status,
        json: () => Promise.resolve(antwort.body),
      } as Response);
    }) as unknown as typeof fetch;

    return { impl, aufrufe };
  }

  it('uebersteht einen Aussetzer und legt den Eintrag doch noch an', async () => {
    const { impl, aufrufe } = mitAussetzern(1, [ok([]), ok({ id: 'rec-1' })]);
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    await expect(provider.upsertRecord(record)).resolves.toBe('rec-1');
    // Erster Anlauf abgebrochen, zweiter gesucht, dritter angelegt.
    expect(aufrufe).toEqual(['GET', 'GET', 'POST']);
  });

  it('gibt nach drei Anlaeufen auf und nennt den echten Grund', async () => {
    const { impl, aufrufe } = mitAussetzern(9, []);
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    await expect(provider.upsertRecord(record)).rejects.toMatchObject({
      code: 'DNS_UPDATE_FAILED',
      message: expect.stringContaining('This operation was aborted'),
    });
    expect(aufrufe).toHaveLength(3);
  });

  it('wiederholt auch bei 429 und 5xx', async () => {
    for (const status of [429, 503]) {
      const { impl, aufrufe } = mitAussetzern(0, [
        { status, body: { success: false, errors: [], result: null } },
        ok([]),
        ok({ id: 'rec-1' }),
      ]);
      const provider = createCloudflareDnsProvider({
        apiToken: 't',
        zoneId: 'z',
        fetchImpl: impl,
      });

      await expect(provider.upsertRecord(record)).resolves.toBe('rec-1');
      expect(aufrufe, String(status)).toEqual(['GET', 'GET', 'POST']);
    }
  });

  it('wiederholt nicht, wenn Cloudflare die Anfrage wirklich ablehnt', async () => {
    // Ein falscher Token wird beim zweiten Anlauf nicht richtiger - und drei
    // Anlaeufe verzoegerten nur die Meldung an den Nutzer.
    const { impl, aufrufe } = mitAussetzern(0, [
      {
        status: 403,
        body: {
          success: false,
          errors: [{ code: 9109, message: 'Invalid access token' }],
          result: null,
        },
      },
    ]);
    const provider = createCloudflareDnsProvider({
      apiToken: 't',
      zoneId: 'z',
      fetchImpl: impl,
    });

    await expect(provider.upsertRecord(record)).rejects.toMatchObject({
      code: 'DNS_UPDATE_FAILED',
      message: expect.stringContaining('Invalid access token'),
    });
    expect(aufrufe).toHaveLength(1);
  });
});

describe('DNS-Anbieter ohne Cloudflare-Zugang', () => {
  it('protokolliert jeden übersprungenen Vorgang, statt ihn zu verschweigen', async () => {
    const messages: string[] = [];
    const provider = createNoopDnsProvider((message) => {
      messages.push(message);
    });

    await provider.upsertRecord({
      name: 'x.example.tld',
      type: 'A',
      content: '1.2.3.4',
      proxied: false,
    });
    await provider.deleteRecord('x.example.tld');

    expect(messages).toHaveLength(2);
  });
});
