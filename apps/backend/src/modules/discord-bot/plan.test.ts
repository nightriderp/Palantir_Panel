import { describe, expect, it } from 'vitest';
import {
  categoryKey,
  categoryName,
  ChannelType,
  channelName,
  computeDesiredState,
  type DesiredChannel,
  DiscordPermission,
  type GuildChannel,
  MAX_CHANNELS_PER_CATEGORY,
  overwritesEqual,
  planCategories,
  planChannels,
  type SyncInput,
  type SyncServer,
} from './plan.js';

const GUILD = 'g1';
const BOT = 'bot';

function server(id: string, ownerId: string, overrides: Partial<SyncServer> = {}): SyncServer {
  return {
    id,
    name: `Server ${id}`,
    ownerId,
    ownerName: ownerId === 'keyrim' ? 'Keyrim' : 'Hici',
    createdAt: `2026-09-01T00:00:${id.padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

function input(overrides: Partial<SyncInput> = {}): SyncInput {
  return {
    guildId: GUILD,
    botUserId: BOT,
    servers: [server('1', 'keyrim'), server('2', 'hici')],
    membersByServer: new Map(),
    discordIdByUser: new Map([
      ['keyrim', 'd-keyrim'],
      ['hici', 'd-hici'],
      ['admin', 'd-admin'],
      ['freund', 'd-freund'],
    ]),
    adminUserIds: new Set(['admin']),
    ...overrides,
  };
}

function sichtbarFuer(kanal: DesiredChannel | undefined): string[] {
  const view = DiscordPermission.ViewChannel;

  return (kanal?.overwrites ?? [])
    .filter((o) => o.type === 1 && o.id !== BOT && (BigInt(o.allow) & view) === view)
    .map((o) => o.id)
    .sort();
}

/**
 * Wer welchen Kanal sieht, ist die sicherheitsrelevante Hälfte des Bots
 * (Lastenheft §3.11, Pflichtenheft §14a.3/§14a.4).
 */
describe('computeDesiredState', () => {
  it('legt je Besitzer eine Kategorie „<Name>s Server" an', () => {
    const soll = computeDesiredState(input());

    expect(soll.categories.map((c) => c.name).sort()).toEqual(['Hicis Server', 'Keyrims Server']);
  });

  it('zeigt einen Kanal dem Besitzer und den Admins, sonst niemandem', () => {
    const soll = computeDesiredState(input());
    const kanal = soll.channels.find((c) => c.serverId === '1');

    expect(sichtbarFuer(kanal)).toEqual(['d-admin', 'd-keyrim']);
  });

  it('zeigt einen Kanal zusätzlich den Mitgliedern des Servers', () => {
    const soll = computeDesiredState(input({ membersByServer: new Map([['1', ['freund']]]) }));

    expect(sichtbarFuer(soll.channels.find((c) => c.serverId === '1'))).toEqual([
      'd-admin',
      'd-freund',
      'd-keyrim',
    ]);
    expect(sichtbarFuer(soll.channels.find((c) => c.serverId === '2'))).toEqual([
      'd-admin',
      'd-hici',
    ]);
  });

  it('lässt Konten ohne vorausgewählte Discord-Id aus', () => {
    // Nicht verknüpft, gesperrt, wartend oder nicht auf dem Discord-Server:
    // Diese Vorauswahl trifft der Aufrufer – hier steht nur, wer übrig bleibt.
    const soll = computeDesiredState(
      input({
        membersByServer: new Map([['1', ['ohne-discord']]]),
        discordIdByUser: new Map([['keyrim', 'd-keyrim']]),
      }),
    );

    expect(sichtbarFuer(soll.channels.find((c) => c.serverId === '1'))).toEqual(['d-keyrim']);
  });

  it('verbirgt jeden Kanal vor @everyone und erlaubt Lesen, aber nicht Schreiben', () => {
    const kanal = computeDesiredState(input()).channels[0];
    const everyone = kanal?.overwrites.find((o) => o.id === GUILD);
    const leser = kanal?.overwrites.find((o) => o.id === 'd-admin');

    expect(everyone).toMatchObject({ type: 0, allow: '0' });
    expect(BigInt(everyone?.deny ?? '0') & DiscordPermission.ViewChannel).toBe(
      DiscordPermission.ViewChannel,
    );
    expect(BigInt(leser?.deny ?? '0') & DiscordPermission.SendMessages).toBe(
      DiscordPermission.SendMessages,
    );
  });

  it('gibt dem Bot selbst Zugang, damit er die Kachel schreiben kann', () => {
    const kanal = computeDesiredState(input()).channels[0];
    const bot = kanal?.overwrites.find((o) => o.id === BOT);

    expect(BigInt(bot?.allow ?? '0') & DiscordPermission.SendMessages).toBe(
      DiscordPermission.SendMessages,
    );
  });

  it('teilt ab dem 51. Server eines Besitzers auf eine Folgekategorie auf', () => {
    const viele = Array.from({ length: MAX_CHANNELS_PER_CATEGORY + 1 }, (_, i) =>
      server(String(i + 1), 'keyrim'),
    );
    const soll = computeDesiredState(input({ servers: viele }));

    expect(soll.categories.map((c) => c.name)).toEqual(['Keyrims Server', 'Keyrims Server 2']);
    expect(soll.channels.filter((c) => c.categoryKey === categoryKey('keyrim', 2))).toHaveLength(1);
  });
});

describe('Namen', () => {
  it('bildet den Genitiv wie im Deutschen', () => {
    expect(categoryName('Keyrim', 1)).toBe('Keyrims Server');
    expect(categoryName('Klaus', 1)).toBe("Klaus' Server");
    expect(categoryName('Max', 1)).toBe("Max' Server");
  });

  it('formt den Kanalnamen so, wie Discord ihn speichert', () => {
    expect(channelName('Mein  Minecraft Server!')).toBe('mein-minecraft-server');
    expect(channelName('Über Welt')).toBe('über-welt');
    expect(channelName('!!!')).toBe('server');
  });
});

describe('overwritesEqual', () => {
  it('ignoriert Reihenfolge und Zahlformat', () => {
    expect(
      overwritesEqual(
        [
          { id: 'a', type: 1, allow: '1024', deny: '0' },
          { id: 'b', type: 0, allow: '0', deny: '1024' },
        ],
        [
          { id: 'b', type: 0, allow: '0', deny: '01024' },
          { id: 'a', type: 1, allow: '1024', deny: '0' },
        ],
      ),
    ).toBe(true);
  });

  it('bemerkt einen hinzugekommenen Leser', () => {
    expect(overwritesEqual([], [{ id: 'a', type: 1, allow: '1024', deny: '0' }])).toBe(false);
  });
});

describe('planCategories / planChannels', () => {
  const soll = computeDesiredState(input());
  const kategorieKeyrim = soll.categories.find((c) => c.ownerId === 'keyrim');
  const kanal1 = soll.channels.find((c) => c.serverId === '1');

  it('legt alles an, wenn noch nichts zugeordnet ist', () => {
    const kategorien = planCategories(soll.categories, new Map(), new Map());

    expect(kategorien.every((s) => s.kind === 'create')).toBe(true);
  });

  it('lässt einen unveränderten Stand unberührt', () => {
    if (!kategorieKeyrim || !kanal1) throw new Error('Testaufbau');

    const guild = new Map<string, GuildChannel>([
      [
        'kat',
        {
          id: 'kat',
          type: ChannelType.Category,
          name: kategorieKeyrim.name,
          permission_overwrites: kategorieKeyrim.overwrites,
        },
      ],
      [
        'k1',
        {
          id: 'k1',
          type: ChannelType.Text,
          name: kanal1.name,
          parent_id: 'kat',
          permission_overwrites: kanal1.overwrites,
        },
      ],
    ]);

    expect(
      planCategories([kategorieKeyrim], new Map([[kategorieKeyrim.key, 'kat']]), guild),
    ).toEqual([{ kind: 'keep', channelId: 'kat', desired: kategorieKeyrim }]);
    expect(
      planChannels(
        [kanal1],
        new Map([['1', 'k1']]),
        guild,
        new Map([[kategorieKeyrim.key, 'kat']]),
      ),
    ).toEqual([{ kind: 'keep', channelId: 'k1', desired: kanal1 }]);
  });

  it('ändert nur, was abweicht', () => {
    if (!kategorieKeyrim || !kanal1) throw new Error('Testaufbau');

    const guild = new Map<string, GuildChannel>([
      [
        'k1',
        {
          id: 'k1',
          type: ChannelType.Text,
          name: 'alter-name',
          parent_id: 'kat',
          permission_overwrites: kanal1.overwrites,
        },
      ],
    ]);
    const [schritt] = planChannels(
      [kanal1],
      new Map([['1', 'k1']]),
      guild,
      new Map([[kategorieKeyrim.key, 'kat']]),
    );

    expect(schritt).toMatchObject({ kind: 'update', patch: { name: kanal1.name } });
    expect(schritt?.kind === 'update' && schritt.patch.permission_overwrites).toBeFalsy();
  });

  it('nimmt einem entfernten Mitglied den Zugang', () => {
    if (!kategorieKeyrim) throw new Error('Testaufbau');

    const mitFreund = computeDesiredState(
      input({ membersByServer: new Map([['1', ['freund']]]) }),
    ).channels.find((c) => c.serverId === '1');
    const ohneFreund = kanal1;

    if (!mitFreund || !ohneFreund) throw new Error('Testaufbau');

    const guild = new Map<string, GuildChannel>([
      [
        'k1',
        {
          id: 'k1',
          type: ChannelType.Text,
          name: ohneFreund.name,
          parent_id: 'kat',
          permission_overwrites: mitFreund.overwrites,
        },
      ],
    ]);
    const [schritt] = planChannels(
      [ohneFreund],
      new Map([['1', 'k1']]),
      guild,
      new Map([[kategorieKeyrim.key, 'kat']]),
    );

    expect(schritt).toMatchObject({
      kind: 'update',
      patch: { permission_overwrites: ohneFreund.overwrites },
    });
  });

  it('legt einen in Discord gelöschten Kanal neu an', () => {
    if (!kategorieKeyrim || !kanal1) throw new Error('Testaufbau');

    const [schritt] = planChannels(
      [kanal1],
      new Map([['1', 'weg']]),
      new Map(),
      new Map([[kategorieKeyrim.key, 'kat']]),
    );

    expect(schritt).toMatchObject({ kind: 'create', parentId: 'kat' });
  });

  it('räumt den Kanal eines gelöschten Servers ab', () => {
    const guild = new Map<string, GuildChannel>([
      ['k9', { id: 'k9', type: ChannelType.Text, name: 'weg' }],
    ]);

    expect(planChannels([], new Map([['9', 'k9']]), guild, new Map())).toEqual([
      { kind: 'delete', channelId: 'k9', serverId: '9' },
    ]);
  });

  it('vergisst eine Zuordnung, deren Kanal in Discord schon fehlt', () => {
    expect(planChannels([], new Map([['9', 'k9']]), new Map(), new Map())).toEqual([
      { kind: 'delete', channelId: null, serverId: '9' },
    ]);
  });

  it('wartet mit einem Kanal, dessen Kategorie noch fehlt', () => {
    if (!kanal1) throw new Error('Testaufbau');

    expect(planChannels([kanal1], new Map(), new Map(), new Map())).toEqual([]);
  });
});
