/**
 * Abgleich der Discord-Kanäle mit dem Panel (Pflichtenheft §14a.4, §14a.5).
 *
 * Ein Lauf: Stand aus dem Panel holen, Ist aus Discord holen (ein Aufruf
 * `GET /guilds/{id}/channels` liefert alle Kanäle samt Rechten), Schritte
 * planen (`plan.ts`), ausführen, danach die Kacheln auffrischen. Discord wird
 * nur angefasst, wo etwas abweicht – ein ruhiger Lauf kostet einen Lese-Aufruf
 * und die Mitgliedsprüfungen, deren Ergebnis zwischengespeichert ist.
 *
 * **Nie zwei Läufe gleichzeitig.** Wer während eines Laufs einen weiteren
 * anfordert, bekommt genau einen Folgelauf – sonst legten zwei Läufe denselben
 * Kanal doppelt an.
 *
 * **Fehler brechen den Lauf nicht ab.** Ein einzelner Kanal, den Discord
 * ablehnt, wird geloggt und beim nächsten Lauf erneut versucht; die übrigen
 * laufen weiter.
 */

import {
  categoryKey,
  type ChannelStep,
  computeDesiredState,
  GUILD_CHANNEL_SOFT_LIMIT,
  type GuildChannel,
  ChannelType,
  planCategories,
  planChannels,
  type SyncInput,
} from './plan.js';
import { DiscordApiError, type DiscordRestClient } from './rest.js';
import { renderTile, type TileSnapshot, tileHash } from './tile.js';

/** Discord-Fehlercode „Unknown Member". */
const UNKNOWN_MEMBER = 10007;
/** Discord-Fehlercode „Unknown Channel" / „Unknown Message". */
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MESSAGE = 10008;

/** Wie lange eine Mitgliedsprüfung gilt. Ein Beitritt wird spätestens danach bemerkt. */
export const MEMBERSHIP_CACHE_MS = 10 * 60_000;

/** Wartezeit, in der mehrere Anstöße zu einem Lauf zusammenfallen. */
export const SYNC_DEBOUNCE_MS = 3_000;

export interface StoredServerChannel {
  readonly serverId: string;
  readonly channelId: string;
  readonly statusMessageId: string | null;
  readonly lastRenderedHash: string | null;
}

export interface DiscordSyncStore {
  listCategories(): Promise<{ ownerId: string; sequence: number; channelId: string }[]>;
  saveCategory(ownerId: string, sequence: number, channelId: string): Promise<void>;
  deleteCategory(ownerId: string, sequence: number): Promise<void>;
  listServerChannels(): Promise<StoredServerChannel[]>;
  /** Legt an oder ersetzt; eine neue Kanal-Id setzt die Kachel zurück. */
  saveServerChannel(serverId: string, channelId: string): Promise<void>;
  saveStatusMessage(serverId: string, messageId: string, hash: string): Promise<void>;
  deleteServerChannel(serverId: string): Promise<void>;
}

/** Stand aus dem Panel, noch ohne Prüfung der Discord-Mitgliedschaft. */
export interface PanelState {
  readonly servers: SyncInput['servers'];
  readonly membersByServer: SyncInput['membersByServer'];
  readonly adminUserIds: SyncInput['adminUserIds'];
  /** Verknüpft, freigeschaltet und nicht gesperrt – Mitgliedschaft prüft der Abgleich. */
  readonly linkedDiscordIds: ReadonlyMap<string, string>;
}

export interface DiscordSyncSource {
  loadPanelState(): Promise<PanelState>;
  /** Schnappschüsse für die Kacheln; ohne Angabe alle Server. */
  loadSnapshots(serverIds?: readonly string[]): Promise<Map<string, TileSnapshot>>;
}

export interface SyncLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface DiscordSyncOptions {
  readonly rest: DiscordRestClient;
  readonly guildId: string;
  readonly store: DiscordSyncStore;
  readonly source: DiscordSyncSource;
  readonly log: SyncLogger;
  readonly now?: () => number;
  /** Austauschbar für Tests. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
}

export interface SyncReport {
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly failed: number;
  readonly skippedForLimit: number;
}

export interface DiscordSync {
  /** Führt einen Lauf aus (oder hängt sich an den laufenden an). */
  run(): Promise<SyncReport>;
  /** Stößt einen Lauf kurz verzögert an; mehrere Anstöße fallen zusammen. */
  request(): void;
  /** Frischt nur die Kacheln der genannten Server auf. */
  refreshTiles(serverIds: readonly string[]): Promise<void>;
  /** Für `/palantir …`: Wer den Befehl in der Guild auslöst, ist Mitglied. */
  noteMember(discordUserId: string): void;
  /** Kanal-Id eines Servers, sofern angelegt. */
  channelIdFor(serverId: string): Promise<string | null>;
}

const leer = (): {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
  skippedForLimit: number;
} => ({
  created: 0,
  updated: 0,
  deleted: 0,
  failed: 0,
  skippedForLimit: 0,
});

function istUnbekannt(error: unknown): boolean {
  return (
    error instanceof DiscordApiError &&
    (error.status === 404 ||
      error.discordCode === UNKNOWN_CHANNEL ||
      error.discordCode === UNKNOWN_MESSAGE)
  );
}

export function createDiscordSync(options: DiscordSyncOptions): DiscordSync {
  const { rest, guildId, store, source, log } = options;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const membership = new Map<string, { member: boolean; at: number }>();
  let botUserId: string | null = null;
  let laufend: Promise<SyncReport> | null = null;
  let nochEinmal = false;
  let angestossen = false;

  async function botId(): Promise<string> {
    if (!botUserId) {
      const ich = await rest.request<{ id: string }>('GET', '/users/@me');
      botUserId = ich.id;
    }

    return botUserId;
  }

  async function istMitglied(discordUserId: string): Promise<boolean> {
    const gemerkt = membership.get(discordUserId);

    if (gemerkt && now() - gemerkt.at < MEMBERSHIP_CACHE_MS) {
      return gemerkt.member;
    }

    let member: boolean;

    try {
      await rest.request('GET', `/guilds/${guildId}/members/${discordUserId}`);
      member = true;
    } catch (error: unknown) {
      if (
        error instanceof DiscordApiError &&
        (error.discordCode === UNKNOWN_MEMBER || error.status === 404)
      ) {
        member = false;
      } else {
        // Unklar – lieber den bisherigen Stand behalten als Zugang zu entziehen.
        return gemerkt?.member ?? false;
      }
    }

    membership.set(discordUserId, { member, at: now() });

    return member;
  }

  async function einLauf(): Promise<SyncReport> {
    const bericht = leer();
    const [panel, bot] = await Promise.all([source.loadPanelState(), botId()]);

    const discordIdByUser = new Map<string, string>();

    for (const [userId, discordUserId] of panel.linkedDiscordIds) {
      if (await istMitglied(discordUserId)) {
        discordIdByUser.set(userId, discordUserId);
      }
    }

    const soll = computeDesiredState({
      guildId,
      botUserId: bot,
      servers: panel.servers,
      membersByServer: panel.membersByServer,
      discordIdByUser,
      adminUserIds: panel.adminUserIds,
    });

    const [guildListe, kategorienGespeichert, kanaeleGespeichert] = await Promise.all([
      rest.request<GuildChannel[]>('GET', `/guilds/${guildId}/channels`),
      store.listCategories(),
      store.listServerChannels(),
    ]);
    const guild = new Map(guildListe.map((kanal) => [kanal.id, kanal]));
    let belegt = guildListe.length;

    // -- Kategorien ----------------------------------------------------------
    const kategorieIds = new Map<string, string>();
    const kategorieSchritte = planCategories(
      soll.categories,
      new Map(kategorienGespeichert.map((k) => [categoryKey(k.ownerId, k.sequence), k.channelId])),
      guild,
    );

    for (const schritt of kategorieSchritte) {
      try {
        if (schritt.kind === 'keep') {
          kategorieIds.set(schritt.desired.key, schritt.channelId);
        } else if (schritt.kind === 'update') {
          await rest.request('PATCH', `/channels/${schritt.channelId}`, schritt.patch);
          kategorieIds.set(schritt.desired.key, schritt.channelId);
          bericht.updated += 1;
        } else if (schritt.kind === 'create') {
          if (belegt >= GUILD_CHANNEL_SOFT_LIMIT) {
            bericht.skippedForLimit += 1;
            continue;
          }

          const neu = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
            name: schritt.desired.name,
            type: ChannelType.Category,
            permission_overwrites: schritt.desired.overwrites,
          });
          belegt += 1;
          await store.saveCategory(schritt.desired.ownerId, schritt.desired.sequence, neu.id);
          kategorieIds.set(schritt.desired.key, neu.id);
          bericht.created += 1;
        }
        // Löschen erst nach den Kanälen: Eine Kategorie mit Kanälen darin
        // löschte Discord zwar, die Kanäle aber stünden danach ohne Kategorie.
      } catch (error: unknown) {
        bericht.failed += 1;
        log.error(
          { schritt: schritt.kind, fehler: error instanceof Error ? error.message : String(error) },
          'Discord-Bot: Kategorie konnte nicht abgeglichen werden',
        );
      }
    }

    // -- Server-Kanäle -------------------------------------------------------
    const kanalSchritte: ChannelStep[] = planChannels(
      soll.channels,
      new Map(kanaeleGespeichert.map((k) => [k.serverId, k.channelId])),
      guild,
      kategorieIds,
    );

    for (const schritt of kanalSchritte) {
      try {
        if (schritt.kind === 'update') {
          await rest.request('PATCH', `/channels/${schritt.channelId}`, schritt.patch);
          bericht.updated += 1;
        } else if (schritt.kind === 'create') {
          if (belegt >= GUILD_CHANNEL_SOFT_LIMIT) {
            bericht.skippedForLimit += 1;
            continue;
          }

          const neu = await rest.request<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
            name: schritt.desired.name,
            type: ChannelType.Text,
            parent_id: schritt.parentId,
            permission_overwrites: schritt.desired.overwrites,
          });
          belegt += 1;
          await store.saveServerChannel(schritt.desired.serverId, neu.id);
          bericht.created += 1;
        } else if (schritt.kind === 'delete') {
          if (schritt.channelId) {
            await loeschen(schritt.channelId);
          }
          await store.deleteServerChannel(schritt.serverId);
          bericht.deleted += 1;
        }
      } catch (error: unknown) {
        bericht.failed += 1;
        log.error(
          { schritt: schritt.kind, fehler: error instanceof Error ? error.message : String(error) },
          'Discord-Bot: Kanal konnte nicht abgeglichen werden',
        );
      }
    }

    for (const schritt of kategorieSchritte) {
      if (schritt.kind !== 'delete') continue;

      try {
        if (schritt.channelId) {
          await loeschen(schritt.channelId);
        }
        const [ownerId, sequence] = schritt.key.split(':');
        await store.deleteCategory(ownerId ?? '', Number(sequence));
        bericht.deleted += 1;
      } catch (error: unknown) {
        bericht.failed += 1;
        log.error(
          { fehler: error instanceof Error ? error.message : String(error) },
          'Discord-Bot: Kategorie konnte nicht entfernt werden',
        );
      }
    }

    if (bericht.skippedForLimit > 0) {
      log.warn(
        { belegt, grenze: GUILD_CHANNEL_SOFT_LIMIT, ausgelassen: bericht.skippedForLimit },
        'Discord-Bot: Kanalgrenze des Discord-Servers erreicht, weitere Kanäle werden nicht angelegt',
      );
    }

    await refreshTiles();

    if (bericht.created + bericht.updated + bericht.deleted + bericht.failed > 0) {
      log.info({ ...bericht }, 'Discord-Bot: Abgleich abgeschlossen');
    }

    return bericht;
  }

  async function loeschen(channelId: string): Promise<void> {
    try {
      await rest.request('DELETE', `/channels/${channelId}`);
    } catch (error: unknown) {
      if (!istUnbekannt(error)) throw error;
    }
  }

  async function refreshTiles(serverIds?: readonly string[]): Promise<void> {
    const gespeichert = (await store.listServerChannels()).filter(
      (k) => !serverIds || serverIds.includes(k.serverId),
    );

    if (gespeichert.length === 0) return;

    const snapshots = await source.loadSnapshots(gespeichert.map((k) => k.serverId));

    for (const kanal of gespeichert) {
      const snapshot = snapshots.get(kanal.serverId);

      if (!snapshot) continue;

      const nachricht = renderTile(snapshot);
      const hash = tileHash(nachricht);

      if (kanal.statusMessageId && kanal.lastRenderedHash === hash) continue;

      try {
        if (kanal.statusMessageId) {
          try {
            await rest.request(
              'PATCH',
              `/channels/${kanal.channelId}/messages/${kanal.statusMessageId}`,
              nachricht,
            );
            await store.saveStatusMessage(kanal.serverId, kanal.statusMessageId, hash);
            continue;
          } catch (error: unknown) {
            // Nachricht von Hand gelöscht: neu anlegen statt aufgeben.
            if (!istUnbekannt(error)) throw error;
          }
        }

        const neu = await rest.request<{ id: string }>(
          'POST',
          `/channels/${kanal.channelId}/messages`,
          nachricht,
        );
        await store.saveStatusMessage(kanal.serverId, neu.id, hash);
      } catch (error: unknown) {
        log.error(
          {
            serverId: kanal.serverId,
            fehler: error instanceof Error ? error.message : String(error),
          },
          'Discord-Bot: Kachel konnte nicht aktualisiert werden',
        );
      }
    }
  }

  function run(): Promise<SyncReport> {
    if (laufend) {
      nochEinmal = true;
      return laufend;
    }

    laufend = einLauf().finally(() => {
      laufend = null;

      if (nochEinmal) {
        nochEinmal = false;
        request();
      }
    });

    return laufend;
  }

  function request(): void {
    if (angestossen) return;

    angestossen = true;
    setTimer(() => {
      angestossen = false;
      run().catch((error: unknown) => {
        log.error(
          { fehler: error instanceof Error ? error.message : String(error) },
          'Discord-Bot: Abgleich fehlgeschlagen',
        );
      });
    }, SYNC_DEBOUNCE_MS);
  }

  return {
    run,
    request,
    refreshTiles: (serverIds) => refreshTiles(serverIds),
    noteMember(discordUserId) {
      const vorher = membership.get(discordUserId);
      membership.set(discordUserId, { member: true, at: now() });

      if (!vorher?.member) request();
    },
    async channelIdFor(serverId) {
      const kanal = (await store.listServerChannels()).find((k) => k.serverId === serverId);

      return kanal?.channelId ?? null;
    },
  };
}
