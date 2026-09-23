/**
 * Soll-Zustand der Discord-Kanäle und Abgleich mit dem Ist (Pflichtenheft §14a.4).
 *
 * Reine Funktionen ohne Discord und ohne Datenbank: Aus dem Stand im Panel
 * entsteht, welche Kategorien und Kanäle es geben soll und wer sie sehen darf;
 * aus dem Vergleich mit dem, was in Discord steht, entstehen die Schritte, die
 * der Abgleich ausführt. So lässt sich jede Regel – Kategorie je Besitzer,
 * Admin sieht alles, 50 Kanäle je Kategorie – ohne Discord testen.
 *
 * **Wer einen Kanal sieht** (§14a.3): Besitzer und Mitglieder des Servers
 * sowie jedes Konto mit `server.view.any` – jeweils nur, wenn es Discord
 * verknüpft hat, freigeschaltet und nicht gesperrt ist und dem Discord-Server
 * angehört. Diese Vorauswahl trifft der Aufrufer; hier kommen nur noch
 * Discord-Ids an.
 */

/** Discord-Rechte als Bitfeld (https://discord.com/developers/docs/topics/permissions). */
export const DiscordPermission = {
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  EmbedLinks: 1n << 14n,
  ReadMessageHistory: 1n << 16n,
} as const;

/** Discord erlaubt höchstens 50 Kanäle je Kategorie. */
export const MAX_CHANNELS_PER_CATEGORY = 50;

/**
 * Obergrenze, ab der der Bot keine Kanäle mehr anlegt. Discord erlaubt 500
 * einschließlich Kategorien; der Abstand lässt dem Betreiber Luft für eigene.
 */
export const GUILD_CHANNEL_SOFT_LIMIT = 480;

export const ChannelType = { Text: 0, Category: 4 } as const;
export const OverwriteType = { Role: 0, Member: 1 } as const;

export interface PermissionOverwrite {
  readonly id: string;
  readonly type: number;
  readonly allow: string;
  readonly deny: string;
}

export interface SyncServer {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly ownerName: string;
  /** Für eine stabile Reihenfolge, wenn ein Besitzer Folgekategorien braucht. */
  readonly createdAt: string;
}

export interface SyncInput {
  readonly guildId: string;
  readonly botUserId: string;
  readonly servers: readonly SyncServer[];
  /** Mitglieder je Server (jede Stufe). */
  readonly membersByServer: ReadonlyMap<string, readonly string[]>;
  /**
   * Discord-Id je Palantir-Konto – nur Konten, die verknüpft, freigeschaltet,
   * nicht gesperrt **und** Mitglied des Discord-Servers sind.
   */
  readonly discordIdByUser: ReadonlyMap<string, string>;
  /** Konten mit `server.view.any` (einschließlich Owner). */
  readonly adminUserIds: ReadonlySet<string>;
}

export interface DesiredCategory {
  /** `<ownerId>:<sequence>` – Schlüssel der Zuordnungstabelle. */
  readonly key: string;
  readonly ownerId: string;
  readonly sequence: number;
  readonly name: string;
  readonly overwrites: readonly PermissionOverwrite[];
}

export interface DesiredChannel {
  readonly serverId: string;
  readonly name: string;
  readonly categoryKey: string;
  readonly overwrites: readonly PermissionOverwrite[];
}

export interface DesiredState {
  readonly categories: readonly DesiredCategory[];
  readonly channels: readonly DesiredChannel[];
}

export function categoryKey(ownerId: string, sequence: number): string {
  return `${ownerId}:${String(sequence)}`;
}

/**
 * Name der Kategorie eines Besitzers: „Keyrims Server", bei einem Namen auf
 * s, ß, x oder z mit Apostroph („Klaus' Server"), ab der zweiten mit Nummer.
 */
export function categoryName(ownerName: string, sequence: number): string {
  const name = ownerName.trim() || 'Unbekannt';
  const genitiv = /[sßxz]$/i.test(name) ? `${name}'` : `${name}s`;
  const suffix = sequence > 1 ? ` ${String(sequence)}` : '';

  return `${genitiv} Server${suffix}`.slice(0, 100);
}

/**
 * Kanalname aus dem Servernamen. Discord schreibt Textkanäle ohnehin klein
 * und ohne Leerzeichen; hier geschieht dasselbe vorab, damit der Vergleich mit
 * dem Ist nicht bei jedem Lauf eine Umbenennung auslöst.
 */
export function channelName(serverName: string): string {
  const slug = serverName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return slug.length > 0 ? slug : 'server';
}

const bits = (...werte: bigint[]): string => werte.reduce((a, b) => a | b, 0n).toString();

function everyoneHidden(guildId: string): PermissionOverwrite {
  // Die Rolle @everyone trägt dieselbe Id wie die Guild.
  return {
    id: guildId,
    type: OverwriteType.Role,
    allow: '0',
    deny: bits(DiscordPermission.ViewChannel),
  };
}

function botAccess(botUserId: string): PermissionOverwrite {
  return {
    id: botUserId,
    type: OverwriteType.Member,
    allow: bits(
      DiscordPermission.ViewChannel,
      DiscordPermission.SendMessages,
      DiscordPermission.EmbedLinks,
      DiscordPermission.ReadMessageHistory,
    ),
    deny: '0',
  };
}

/** Lesen ja, schreiben nein: Der Kanal ist Anzeige und Bedienfeld (§14a.4). */
function viewerAccess(discordUserId: string): PermissionOverwrite {
  return {
    id: discordUserId,
    type: OverwriteType.Member,
    allow: bits(DiscordPermission.ViewChannel, DiscordPermission.ReadMessageHistory),
    deny: bits(DiscordPermission.SendMessages),
  };
}

export function computeDesiredState(input: SyncInput): DesiredState {
  const adminDiscordIds = [...input.adminUserIds]
    .map((userId) => input.discordIdByUser.get(userId))
    .filter((id): id is string => id !== undefined);

  const serversByOwner = new Map<string, SyncServer[]>();

  for (const server of input.servers) {
    const liste = serversByOwner.get(server.ownerId) ?? [];
    liste.push(server);
    serversByOwner.set(server.ownerId, liste);
  }

  const categories: DesiredCategory[] = [];
  const channels: DesiredChannel[] = [];

  for (const [ownerId, servers] of [...serversByOwner].sort(([a], [b]) => a.localeCompare(b))) {
    const sortiert = [...servers].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );

    for (let start = 0; start < sortiert.length; start += MAX_CHANNELS_PER_CATEGORY) {
      const sequence = start / MAX_CHANNELS_PER_CATEGORY + 1;
      const key = categoryKey(ownerId, sequence);
      const teil = sortiert.slice(start, start + MAX_CHANNELS_PER_CATEGORY);

      categories.push({
        key,
        ownerId,
        sequence,
        name: categoryName(teil[0]?.ownerName ?? '', sequence),
        overwrites: [everyoneHidden(input.guildId), botAccess(input.botUserId)],
      });

      for (const server of teil) {
        const berechtigte = [server.ownerId, ...(input.membersByServer.get(server.id) ?? [])]
          .map((userId) => input.discordIdByUser.get(userId))
          .filter((id): id is string => id !== undefined);
        const sichtbar = [...new Set([...berechtigte, ...adminDiscordIds])]
          .filter((id) => id !== input.botUserId)
          .sort();

        channels.push({
          serverId: server.id,
          name: channelName(server.name),
          categoryKey: key,
          overwrites: [
            everyoneHidden(input.guildId),
            botAccess(input.botUserId),
            ...sichtbar.map(viewerAccess),
          ],
        });
      }
    }
  }

  return { categories, channels };
}

// ---------------------------------------------------------------------------
// Abgleich mit dem Ist
// ---------------------------------------------------------------------------

/** Ein Kanal, wie `GET /guilds/{id}/channels` ihn liefert (Ausschnitt). */
export interface GuildChannel {
  readonly id: string;
  readonly type: number;
  readonly name: string;
  readonly parent_id?: string | null;
  readonly permission_overwrites?: readonly PermissionOverwrite[];
}

/** Vergleichsform: Reihenfolge und Zahlformat der Rechte spielen keine Rolle. */
export function overwritesEqual(
  a: readonly PermissionOverwrite[] | undefined,
  b: readonly PermissionOverwrite[] | undefined,
): boolean {
  const form = (liste: readonly PermissionOverwrite[] | undefined): string =>
    (liste ?? [])
      .map(
        (o) =>
          `${String(o.type)}:${o.id}:${BigInt(o.allow).toString()}:${BigInt(o.deny).toString()}`,
      )
      .sort()
      .join('|');

  return form(a) === form(b);
}

export type CategoryStep =
  | { readonly kind: 'create'; readonly desired: DesiredCategory }
  | {
      readonly kind: 'update';
      readonly channelId: string;
      readonly desired: DesiredCategory;
      readonly patch: { name?: string; permission_overwrites?: readonly PermissionOverwrite[] };
    }
  | { readonly kind: 'keep'; readonly channelId: string; readonly desired: DesiredCategory }
  | { readonly kind: 'delete'; readonly channelId: string | null; readonly key: string };

/**
 * Schritte für die Kategorien. `mapped` ist die Zuordnungstabelle
 * (`<ownerId>:<sequence>` → Kanal-Id), `guild` der Ist-Zustand in Discord.
 * Eine zugeordnete, in Discord aber verschwundene Kategorie wird neu angelegt.
 */
export function planCategories(
  desired: readonly DesiredCategory[],
  mapped: ReadonlyMap<string, string>,
  guild: ReadonlyMap<string, GuildChannel>,
): CategoryStep[] {
  const schritte: CategoryStep[] = [];
  const gewollt = new Set(desired.map((c) => c.key));

  for (const kategorie of desired) {
    const channelId = mapped.get(kategorie.key);
    const ist = channelId ? guild.get(channelId) : undefined;

    if (!channelId || !ist || ist.type !== ChannelType.Category) {
      schritte.push({ kind: 'create', desired: kategorie });
      continue;
    }

    const patch: { name?: string; permission_overwrites?: readonly PermissionOverwrite[] } = {};

    if (ist.name !== kategorie.name) patch.name = kategorie.name;
    if (!overwritesEqual(ist.permission_overwrites, kategorie.overwrites)) {
      patch.permission_overwrites = kategorie.overwrites;
    }

    schritte.push(
      Object.keys(patch).length > 0
        ? { kind: 'update', channelId, desired: kategorie, patch }
        : { kind: 'keep', channelId, desired: kategorie },
    );
  }

  for (const [key, channelId] of mapped) {
    if (!gewollt.has(key)) {
      schritte.push({ kind: 'delete', channelId: guild.has(channelId) ? channelId : null, key });
    }
  }

  return schritte;
}

export type ChannelStep =
  | { readonly kind: 'create'; readonly desired: DesiredChannel; readonly parentId: string }
  | {
      readonly kind: 'update';
      readonly channelId: string;
      readonly desired: DesiredChannel;
      readonly patch: {
        name?: string;
        parent_id?: string;
        permission_overwrites?: readonly PermissionOverwrite[];
      };
    }
  | { readonly kind: 'keep'; readonly channelId: string; readonly desired: DesiredChannel }
  | { readonly kind: 'delete'; readonly channelId: string | null; readonly serverId: string };

/**
 * Schritte für die Server-Kanäle. `categoryIds` löst den Kategorie-Schlüssel
 * nach dem Kategorie-Schritt auf – eine Kategorie kann im selben Lauf erst
 * entstanden sein. Fehlt eine Kategorie (Anlegen gescheitert), bleibt der
 * Kanal für diesen Lauf aus; der nächste holt ihn nach.
 */
export function planChannels(
  desired: readonly DesiredChannel[],
  mapped: ReadonlyMap<string, string>,
  guild: ReadonlyMap<string, GuildChannel>,
  categoryIds: ReadonlyMap<string, string>,
): ChannelStep[] {
  const schritte: ChannelStep[] = [];
  const gewollt = new Set(desired.map((c) => c.serverId));

  for (const kanal of desired) {
    const parentId = categoryIds.get(kanal.categoryKey);

    if (!parentId) continue;

    const channelId = mapped.get(kanal.serverId);
    const ist = channelId ? guild.get(channelId) : undefined;

    if (!channelId || !ist || ist.type !== ChannelType.Text) {
      schritte.push({ kind: 'create', desired: kanal, parentId });
      continue;
    }

    const patch: {
      name?: string;
      parent_id?: string;
      permission_overwrites?: readonly PermissionOverwrite[];
    } = {};

    if (ist.name !== kanal.name) patch.name = kanal.name;
    if ((ist.parent_id ?? null) !== parentId) patch.parent_id = parentId;
    if (!overwritesEqual(ist.permission_overwrites, kanal.overwrites)) {
      patch.permission_overwrites = kanal.overwrites;
    }

    schritte.push(
      Object.keys(patch).length > 0
        ? { kind: 'update', channelId, desired: kanal, patch }
        : { kind: 'keep', channelId, desired: kanal },
    );
  }

  for (const [serverId, channelId] of mapped) {
    if (!gewollt.has(serverId)) {
      schritte.push({
        kind: 'delete',
        channelId: guild.has(channelId) ? channelId : null,
        serverId,
      });
    }
  }

  return schritte;
}
