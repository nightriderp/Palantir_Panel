import { describe, expect, it } from 'vitest';
import {
  ChannelType,
  DiscordPermission,
  type GuildChannel,
  type PermissionOverwrite,
} from './plan.js';
import { DiscordApiError, type DiscordRestClient } from './rest.js';
import {
  createDiscordSync,
  type DiscordSyncSource,
  type DiscordSyncStore,
  type PanelState,
  type StoredServerChannel,
} from './sync.js';
import type { TileSnapshot } from './tile.js';

const GUILD = 'guild';
const BOT = 'bot';

/**
 * Ein nachgebautes Discord: Kanäle und Nachrichten im Speicher, dazu ein
 * Protokoll der schreibenden Aufrufe. Genug, um zu prüfen, dass der Abgleich
 * das Richtige tut – und nichts, wenn nichts zu tun ist.
 */
function fakeDiscord(guildMembers: Set<string>) {
  const channels = new Map<string, GuildChannel & { parent_id?: string | null }>();
  const messages = new Map<string, { channelId: string; body: unknown }>();
  const writes: string[] = [];
  let naechsteId = 1;

  const rest: DiscordRestClient = {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const teile = path.split('/').filter(Boolean);

      if (method !== 'GET') writes.push(`${method} ${path}`);

      if (method === 'GET' && path === '/users/@me') return { id: BOT } as T;

      if (method === 'GET' && teile[0] === 'guilds' && teile[2] === 'channels') {
        return [...channels.values()] as T;
      }

      if (method === 'GET' && teile[0] === 'guilds' && teile[2] === 'members') {
        if (guildMembers.has(teile[3] ?? '')) return {} as T;
        throw new DiscordApiError(404, 10007, 'Unknown Member');
      }

      if (method === 'POST' && teile[0] === 'guilds' && teile[2] === 'channels') {
        const id = `c${String(naechsteId++)}`;
        const b = body as {
          name: string;
          type: number;
          parent_id?: string;
          permission_overwrites: PermissionOverwrite[];
        };
        channels.set(id, {
          id,
          type: b.type,
          name: b.name,
          parent_id: b.parent_id ?? null,
          permission_overwrites: b.permission_overwrites,
        });
        return { id } as T;
      }

      if (teile[0] === 'channels' && teile.length === 2) {
        const id = teile[1] ?? '';
        const kanal = channels.get(id);

        if (!kanal) throw new DiscordApiError(404, 10003, 'Unknown Channel');

        if (method === 'PATCH') {
          channels.set(id, { ...kanal, ...(body as object) });
          return {} as T;
        }

        if (method === 'DELETE') {
          channels.delete(id);
          return {} as T;
        }
      }

      if (teile[0] === 'channels' && teile[2] === 'messages') {
        if (method === 'POST') {
          const id = `m${String(naechsteId++)}`;
          messages.set(id, { channelId: teile[1] ?? '', body });
          return { id } as T;
        }

        if (method === 'PATCH') {
          const id = teile[3] ?? '';
          if (!messages.has(id)) throw new DiscordApiError(404, 10008, 'Unknown Message');
          messages.set(id, { channelId: teile[1] ?? '', body });
          return {} as T;
        }
      }

      throw new Error(`nicht nachgebaut: ${method} ${path}`);
    },
  };

  return { rest, channels, messages, writes };
}

function memoryStore(): DiscordSyncStore & {
  kanaele: Map<string, StoredServerChannel>;
} {
  const kategorien = new Map<string, { ownerId: string; sequence: number; channelId: string }>();
  const kanaele = new Map<string, StoredServerChannel>();

  return {
    kanaele,
    listCategories: async () => [...kategorien.values()],
    saveCategory: async (ownerId, sequence, channelId) => {
      kategorien.set(`${ownerId}:${String(sequence)}`, { ownerId, sequence, channelId });
    },
    deleteCategory: async (ownerId, sequence) => {
      kategorien.delete(`${ownerId}:${String(sequence)}`);
    },
    listServerChannels: async () => [...kanaele.values()],
    saveServerChannel: async (serverId, channelId) => {
      kanaele.set(serverId, { serverId, channelId, statusMessageId: null, lastRenderedHash: null });
    },
    saveStatusMessage: async (serverId, messageId, hash) => {
      const vorher = kanaele.get(serverId);
      if (vorher) {
        kanaele.set(serverId, { ...vorher, statusMessageId: messageId, lastRenderedHash: hash });
      }
    },
    deleteServerChannel: async (serverId) => {
      kanaele.delete(serverId);
    },
  };
}

interface Welt {
  servers: { id: string; name: string; ownerId: string; ownerName: string }[];
  members: Map<string, string[]>;
  linked: Map<string, string>;
  admins: Set<string>;
  status: Map<string, TileSnapshot['status']>;
}

function source(welt: Welt): DiscordSyncSource {
  return {
    async loadPanelState(): Promise<PanelState> {
      return {
        servers: welt.servers.map((s) => ({ ...s, createdAt: '2026-09-01T00:00:00.000Z' })),
        membersByServer: welt.members,
        adminUserIds: welt.admins,
        linkedDiscordIds: welt.linked,
      };
    },
    async loadSnapshots(ids) {
      return new Map(
        welt.servers
          .filter((s) => !ids || ids.includes(s.id))
          .map((s) => [
            s.id,
            {
              name: s.name,
              gameTypeName: 'Minecraft',
              status: welt.status.get(s.id) ?? 'stopped',
              address: null,
              players: null,
              runningSince: null,
              panelUrl: `https://panel/servers/${s.id}`,
            },
          ]),
      );
    },
  };
}

const stillerLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

function aufbau(welt: Welt, guildMembers = new Set(['d-keyrim', 'd-admin', 'd-freund'])) {
  const discord = fakeDiscord(guildMembers);
  const store = memoryStore();
  const sync = createDiscordSync({
    rest: discord.rest,
    guildId: GUILD,
    store,
    source: source(welt),
    log: stillerLog,
    setTimer: () => undefined,
  });

  return { discord, store, sync };
}

function welt(): Welt {
  return {
    servers: [{ id: 's1', name: 'Survival', ownerId: 'keyrim', ownerName: 'Keyrim' }],
    members: new Map(),
    linked: new Map([
      ['keyrim', 'd-keyrim'],
      ['admin', 'd-admin'],
      ['freund', 'd-freund'],
    ]),
    admins: new Set(['admin']),
    status: new Map(),
  };
}

function leser(kanal: GuildChannel | undefined): string[] {
  const view = DiscordPermission.ViewChannel;

  return (kanal?.permission_overwrites ?? [])
    .filter((o) => o.type === 1 && o.id !== BOT && (BigInt(o.allow) & view) === view)
    .map((o) => o.id)
    .sort();
}

function textKanal(discord: ReturnType<typeof fakeDiscord>): GuildChannel | undefined {
  return [...discord.channels.values()].find((c) => c.type === ChannelType.Text);
}

describe('createDiscordSync', () => {
  it('legt beim ersten Lauf Kategorie, Kanal und Kachel an', async () => {
    const { discord, sync } = aufbau(welt());

    const bericht = await sync.run();

    const kategorie = [...discord.channels.values()].find((c) => c.type === ChannelType.Category);
    const kanal = textKanal(discord);

    expect(bericht).toMatchObject({ created: 2, failed: 0 });
    expect(kategorie?.name).toBe('Keyrims Server');
    expect(kanal).toMatchObject({ name: 'survival', parent_id: kategorie?.id });
    expect(leser(kanal)).toEqual(['d-admin', 'd-keyrim']);
    expect(discord.messages.size).toBe(1);
  });

  it('schreibt beim zweiten Lauf nichts, wenn sich nichts geändert hat', async () => {
    const { discord, sync } = aufbau(welt());

    await sync.run();
    discord.writes.length = 0;
    await sync.run();

    expect(discord.writes).toEqual([]);
  });

  it('gibt einem neuen Mitglied Zugang und nimmt ihn wieder', async () => {
    const w = welt();
    const { discord, sync } = aufbau(w);

    await sync.run();
    w.members.set('s1', ['freund']);
    await sync.run();
    expect(leser(textKanal(discord))).toEqual(['d-admin', 'd-freund', 'd-keyrim']);

    w.members.set('s1', []);
    await sync.run();
    expect(leser(textKanal(discord))).toEqual(['d-admin', 'd-keyrim']);
  });

  it('lässt ein Konto aus, das nicht auf dem Discord-Server ist', async () => {
    const w = welt();
    w.members.set('s1', ['freund']);
    const { discord, sync } = aufbau(w, new Set(['d-keyrim', 'd-admin']));

    await sync.run();

    expect(leser(textKanal(discord))).toEqual(['d-admin', 'd-keyrim']);
  });

  it('bemerkt einen Beitritt sofort, wenn der Nutzer einen Befehl auslöst', async () => {
    const w = welt();
    w.members.set('s1', ['freund']);
    const { discord, sync } = aufbau(w, new Set(['d-keyrim', 'd-admin']));

    await sync.run();
    sync.noteMember('d-freund');
    await sync.run();

    expect(leser(textKanal(discord))).toEqual(['d-admin', 'd-freund', 'd-keyrim']);
  });

  it('räumt Kanal und leere Kategorie eines gelöschten Servers ab', async () => {
    const w = welt();
    const { discord, store, sync } = aufbau(w);

    await sync.run();
    w.servers = [];
    const bericht = await sync.run();

    expect(bericht.deleted).toBe(2);
    expect(discord.channels.size).toBe(0);
    expect(store.kanaele.size).toBe(0);
  });

  it('verschiebt den Kanal bei einem Besitzwechsel in die Kategorie des neuen Besitzers', async () => {
    const w = welt();
    w.linked.set('hici', 'd-hici');
    const { discord, sync } = aufbau(w, new Set(['d-keyrim', 'd-admin', 'd-hici']));

    await sync.run();
    w.servers = [{ id: 's1', name: 'Survival', ownerId: 'hici', ownerName: 'Hici' }];
    await sync.run();

    const kategorien = [...discord.channels.values()].filter(
      (c) => c.type === ChannelType.Category,
    );
    const kanal = textKanal(discord);

    expect(kategorien.map((k) => k.name)).toEqual(['Hicis Server']);
    expect(kanal?.parent_id).toBe(kategorien[0]?.id);
    expect(leser(kanal)).toEqual(['d-admin', 'd-hici']);
  });

  it('legt einen von Hand gelöschten Kanal wieder an', async () => {
    const { discord, sync } = aufbau(welt());

    await sync.run();
    const alt = textKanal(discord);
    if (alt) discord.channels.delete(alt.id);
    await sync.run();

    expect(textKanal(discord)).toBeDefined();
    expect(textKanal(discord)?.id).not.toBe(alt?.id);
  });

  it('bearbeitet die Kachel nur, wenn sich ihr Inhalt ändert', async () => {
    const w = welt();
    const { discord, sync } = aufbau(w);

    await sync.run();
    discord.writes.length = 0;

    await sync.refreshTiles(['s1']);
    expect(discord.writes).toEqual([]);

    w.status.set('s1', 'running');
    await sync.refreshTiles(['s1']);
    expect(discord.writes).toHaveLength(1);
    expect(discord.writes[0]).toMatch(/^PATCH \/channels\/.+\/messages\//);
  });

  it('schreibt eine von Hand gelöschte Kachel neu', async () => {
    const w = welt();
    const { discord, sync } = aufbau(w);

    await sync.run();
    discord.messages.clear();
    w.status.set('s1', 'running');
    await sync.refreshTiles(['s1']);

    expect(discord.messages.size).toBe(1);
  });

  it('führt nie zwei Läufe gleichzeitig aus', async () => {
    const { discord, sync } = aufbau(welt());

    await Promise.all([sync.run(), sync.run()]);

    expect([...discord.channels.values()].filter((c) => c.type === ChannelType.Text)).toHaveLength(
      1,
    );
  });
});
