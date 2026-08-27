import { describe, expect, it, vi } from 'vitest';
import { buildDiscordPayload, createDiscordTransport, isRetryableStatus } from './discord.js';
import { isNotificationTransportError, type ResolvedChannelTarget } from './ports.js';

const WEBHOOK = 'https://discord.com/api/webhooks/123456/geheim';

const target: ResolvedChannelTarget = {
  type: 'discordWebhook',
  webhookUrl: WEBHOOK,
  username: null,
};

const message = {
  title: 'Server »Wüstensturm« ist abgestürzt',
  body: 'Der Server wurde unerwartet beendet.',
  severity: 'warning' as const,
  at: '2026-08-26T12:00:00.000Z',
};

function jsonResponse(status: number): Response {
  return new Response(null, { status });
}

describe('Discord-Nutzlast', () => {
  it('baut ein Embed mit Titel, Text, Farbe und Zeitstempel', () => {
    expect(buildDiscordPayload(target, message)).toEqual({
      embeds: [
        {
          title: 'Server »Wüstensturm« ist abgestürzt',
          description: 'Der Server wurde unerwartet beendet.',
          color: 0xf59e0b,
          timestamp: '2026-08-26T12:00:00.000Z',
          footer: { text: 'Palantir' },
        },
      ],
    });
  });

  it('setzt den Absendernamen nur, wenn einer gepflegt ist', () => {
    expect(buildDiscordPayload({ ...target, username: 'Palantir' }, message)).toMatchObject({
      username: 'Palantir',
    });
    expect(buildDiscordPayload(target, message)).not.toHaveProperty('username');
  });

  it('kürzt zu lange Texte auf das, was Discord annimmt', () => {
    const payload = buildDiscordPayload(target, { ...message, body: 'x'.repeat(5000) });
    const embed = (payload.embeds as { description: string }[])[0];

    expect(embed?.description).toHaveLength(4096);
    expect(embed?.description.endsWith('…')).toBe(true);
  });
});

describe('Wiederholbarkeit einer Antwort', () => {
  it('hält Rate-Limit und Serverfehler für vorübergehend', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  /** Eine falsche oder zurückgezogene Webhook-URL wird durch Wiederholen nicht richtig. */
  it('hält Ablehnungen des Clients für endgültig', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe('Versand', () => {
  it('schickt einen POST mit JSON an die Webhook-Adresse', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(204));
    const transport = createDiscordTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await transport.send(target, message);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('meldet eine Ablehnung als benannten Fehlercode', async () => {
    const transport = createDiscordTransport({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(404)) as unknown as typeof fetch,
    });

    await expect(transport.send(target, message)).rejects.toSatisfy(
      (error: unknown) =>
        isNotificationTransportError(error) &&
        error.code === 'NOTIFICATION_DELIVERY_FAILED' &&
        !error.retryable,
    );
  });

  it('hält einen Serverfehler für wiederholbar', async () => {
    const transport = createDiscordTransport({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(503)) as unknown as typeof fetch,
    });

    await expect(transport.send(target, message)).rejects.toSatisfy(
      (error: unknown) => isNotificationTransportError(error) && error.retryable,
    );
  });

  /** Die Webhook-URL ist ein Geheimnis – sie darf nicht ins Protokoll geraten. */
  it('nennt die Webhook-Adresse in keiner Fehlermeldung', async () => {
    const transport = createDiscordTransport({
      fetchImpl: vi
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED')) as unknown as typeof fetch,
    });

    await expect(transport.send(target, message)).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && !error.message.includes('geheim'),
    );
  });
});
