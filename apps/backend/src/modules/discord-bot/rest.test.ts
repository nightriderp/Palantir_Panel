import { describe, expect, it, vi } from 'vitest';
import {
  createDiscordRestClient,
  DISCORD_API_BASE,
  DiscordApiError,
  MAX_RETRIES,
  routeKey,
} from './rest.js';

function antwort(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

describe('Discord-REST-Client', () => {
  it('schickt Token, User-Agent und JSON-Körper', async () => {
    const fetchMock = vi.fn(async () => antwort(200, { ok: true }));
    const rest = createDiscordRestClient({ botToken: 'geheim', fetch: fetchMock });

    await expect(rest.request('PUT', '/applications/1/guilds/2/commands', [])).resolves.toEqual({
      ok: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(`${DISCORD_API_BASE}/applications/1/guilds/2/commands`);
    expect(init.method).toBe('PUT');
    expect(headers.Authorization).toBe('Bot geheim');
    expect(headers['User-Agent']).toMatch(/^DiscordBot \(/);
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('[]');
  });

  it('wartet bei 429 und wiederholt', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(antwort(429, { retry_after: 1.5 }))
      .mockResolvedValueOnce(antwort(200, { id: '1' }));
    const rest = createDiscordRestClient({ botToken: 't', fetch: fetchMock, sleep });

    await expect(rest.request('GET', '/channels/1')).resolves.toEqual({ id: '1' });
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gibt nach der letzten Wiederholung auf', async () => {
    const fetchMock = vi.fn(async () => antwort(429, { retry_after: 0.01, message: 'langsam' }));
    const rest = createDiscordRestClient({
      botToken: 't',
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    await expect(rest.request('GET', '/channels/1')).rejects.toBeInstanceOf(DiscordApiError);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('meldet Discords eigenen Fehlercode', async () => {
    const fetchMock = vi.fn(async () =>
      antwort(403, { code: 50007, message: 'Cannot send messages to this user' }),
    );
    const rest = createDiscordRestClient({ botToken: 't', fetch: fetchMock });

    await expect(rest.request('POST', '/channels/1/messages', {})).rejects.toMatchObject({
      status: 403,
      discordCode: 50007,
    });
  });

  it('wartet vor dem nächsten Aufruf derselben Route, wenn der Bucket leer ist', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        antwort(200, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '2' }),
      )
      .mockResolvedValueOnce(antwort(200, {}));
    const rest = createDiscordRestClient({ botToken: 't', fetch: fetchMock, sleep });

    await rest.request('PATCH', '/channels/1/messages/5', {});
    await rest.request('PATCH', '/channels/1/messages/6', {});

    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('lässt verschiedene Kanäle nicht aufeinander warten', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        antwort(200, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '2' }),
      )
      .mockResolvedValueOnce(antwort(200, {}));
    const rest = createDiscordRestClient({ botToken: 't', fetch: fetchMock, sleep });

    await rest.request('PATCH', '/channels/1/messages/5', {});
    await rest.request('PATCH', '/channels/2/messages/5', {});

    expect(sleep).not.toHaveBeenCalled();
  });

  it('hält die Schlange nach einem Fehler nicht an', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(antwort(500, { message: 'kaputt' }))
      .mockResolvedValueOnce(antwort(200, { weiter: true }));
    const rest = createDiscordRestClient({ botToken: 't', fetch: fetchMock });

    const erster = rest.request('GET', '/channels/1');
    const zweiter = rest.request('GET', '/channels/1');

    await expect(erster).rejects.toBeInstanceOf(DiscordApiError);
    await expect(zweiter).resolves.toEqual({ weiter: true });
  });
});

describe('routeKey', () => {
  it('trennt nach Kanal, aber nicht nach Nachricht', () => {
    expect(routeKey('patch', '/channels/1/messages/5')).toBe('PATCH /channels/1/messages/:id');
    expect(routeKey('PATCH', '/channels/1/messages/6')).toBe(
      routeKey('PATCH', '/channels/1/messages/5'),
    );
    expect(routeKey('PATCH', '/channels/2/messages/5')).not.toBe(
      routeKey('PATCH', '/channels/1/messages/5'),
    );
  });
});
