import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS } from './commands.js';
import type { DiscordBotConfig } from './config.js';
import type { LinkedAccount } from './interactions.js';
import { INTERACTIONS_PATH, registerDiscordBotModule } from './module.js';
import type { DiscordRestClient } from './rest.js';
import { createTestKeyPair } from './test-keys.js';

const NOW_MS = 1_800_000_000_000;
const TIMESTAMP = String(NOW_MS / 1000);

const keys = createTestKeyPair();

const CONFIG: DiscordBotConfig = {
  botToken: 'token',
  publicKey: keys.publicKeyHex,
  applicationId: '100000000000000001',
  guildId: '100000000000000000',
  webUrl: 'https://panel.example',
};

let app: FastifyInstance | null = null;

/** Die generische Signatur von `request` lässt sich mit `vi.fn` nicht direkt treffen. */
function alsRest(request: ReturnType<typeof vi.fn>): DiscordRestClient {
  return { request: request as unknown as DiscordRestClient['request'] };
}

async function aufbauen(
  rest: DiscordRestClient = alsRest(vi.fn(async () => undefined)),
  konten: Record<string, LinkedAccount> = {},
): Promise<FastifyInstance> {
  app = Fastify();
  await registerDiscordBotModule(app, {
    config: CONFIG,
    identity: { resolve: async (id) => konten[id] ?? null },
    rest,
    now: () => NOW_MS,
  });
  return app;
}

function signiert(body: string, signature = keys.signBody(TIMESTAMP, body)) {
  return {
    method: 'POST' as const,
    url: INTERACTIONS_PATH,
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': signature,
      'x-signature-timestamp': TIMESTAMP,
    },
    payload: body,
  };
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('Interactions-Endpoint (Pflichtenheft §14a.2)', () => {
  it('beantwortet einen signierten PING mit PONG im Discord-Format', async () => {
    const server = await aufbauen();
    const antwort = await server.inject(signiert('{"type":1}'));

    expect(antwort.statusCode).toBe(200);
    // Kein Envelope: Discord verwirft alles außer seinem eigenen Format.
    expect(antwort.json()).toEqual({ type: 1 });
  });

  it('lehnt eine fehlende Signatur mit 401 ab, wie Discord es beim Einrichten prüft', async () => {
    const server = await aufbauen();
    const antwort = await server.inject({
      method: 'POST',
      url: INTERACTIONS_PATH,
      headers: { 'content-type': 'application/json' },
      payload: '{"type":1}',
    });

    expect(antwort.statusCode).toBe(401);
    expect(antwort.json()).toMatchObject({
      success: false,
      error: { code: 'DISCORD_INTERACTION_INVALID' },
    });
  });

  it('prüft den Rohkörper, nicht eine neu serialisierte Fassung', async () => {
    // Signiert ist die Fassung mit Leerzeichen. Würde Fastify erst parsen und
    // die Route neu serialisieren, passte die Signatur nicht mehr.
    const server = await aufbauen();
    const body = '{ "type" : 1 }';
    const antwort = await server.inject(signiert(body));

    expect(antwort.statusCode).toBe(200);
  });

  it('lehnt einen nach dem Signieren veränderten Körper ab', async () => {
    const server = await aufbauen();
    const antwort = await server.inject(
      signiert('{"type":2}', keys.signBody(TIMESTAMP, '{"type":1}')),
    );

    expect(antwort.statusCode).toBe(401);
  });

  it('beantwortet /palantir konto für ein verknüpftes Konto', async () => {
    const server = await aufbauen(undefined, {
      d1: { userId: 'u1', displayName: 'Keyrim', banned: false, approved: true },
    });
    const body = JSON.stringify({
      id: 'i',
      type: 2,
      member: { user: { id: 'd1' } },
      data: { name: 'palantir', options: [{ name: 'konto', type: 1 }] },
    });
    const antwort = await server.inject(signiert(body));

    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toMatchObject({ type: 4, data: { flags: 64 } });
    expect(antwort.json().data.content).toContain('Keyrim');
  });
});

describe('Befehlsregistrierung', () => {
  it('schickt beim Aufbau nichts an Discord', async () => {
    const request = vi.fn(async () => undefined);

    await (await aufbauen(alsRest(request))).ready();

    expect(request).not.toHaveBeenCalled();
  });

  it('registriert die Guild-Befehle, sobald der Server lauscht', async () => {
    const request = vi.fn(async () => undefined);
    const server = await aufbauen(alsRest(request));

    await server.listen({ port: 0, host: '127.0.0.1' });

    expect(request).toHaveBeenCalledWith(
      'PUT',
      `/applications/${CONFIG.applicationId}/guilds/${CONFIG.guildId}/commands`,
      COMMANDS,
    );
  });

  it('lässt den Start nicht scheitern, wenn Discord nicht antwortet', async () => {
    const request = vi.fn(async () => {
      throw new Error('Discord nicht erreichbar');
    });
    const server = await aufbauen(alsRest(request));

    await expect(server.listen({ port: 0, host: '127.0.0.1' })).resolves.toBeTypeOf('string');
  });
});

describe('Knöpfe (DC-3)', () => {
  it('antwortet sofort und reicht das Ergebnis über den Webhook der Interaction nach', async () => {
    const request = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    app = Fastify();
    await registerDiscordBotModule(app, {
      config: CONFIG,
      identity: {
        resolve: async () => ({ userId: 'u1', displayName: 'K', banned: false, approved: true }),
      },
      rest: alsRest(request),
      now: () => NOW_MS,
      control: {
        load: async () => ({
          name: 'S',
          status: 'stopped',
          permissions: {
            canView: true,
            canViewAddress: true,
            canStart: true,
            canStop: true,
            canRestart: true,
            canManageSettings: false,
            canDelete: false,
            canClone: false,
            canManageMembers: false,
            canManageBackups: false,
            canManageFiles: false,
            canManageSchedules: false,
            canUseConsole: false,
            canTransferOwnership: false,
            canUpdate: false,
          },
          consoleEnabled: false,
          supportsConsole: false,
        }),
        start,
        stop: async () => undefined,
        restart: async () => undefined,
        backup: async () => undefined,
        players: () => ({ names: [], count: null }),
        console: async () => ({ stdout: '', stderr: '' }),
      },
    });

    const body = JSON.stringify({
      id: 'i',
      type: 3,
      token: 'interaktions-token',
      member: { user: { id: 'd1' } },
      data: { custom_id: 'srv:3f2504e0-4f89-41d3-9a0c-0305e82c3301:start' },
    });
    const antwort = await app.inject(signiert(body));

    expect(antwort.json()).toEqual({ type: 5, data: { flags: 64 } });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        'PATCH',
        `/webhooks/${CONFIG.applicationId}/interaktions-token/messages/@original`,
        expect.objectContaining({ allowed_mentions: { parse: [] } }),
      );
    });
    expect(start).toHaveBeenCalledWith('3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'u1');
  });
});
