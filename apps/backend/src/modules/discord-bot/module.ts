/**
 * Discord-Bot als Backend-Modul (Lastenheft §3.11, Pflichtenheft §14a).
 *
 * Stand DC-2: Interactions-Endpoint mit Signaturprüfung, Slash-Befehle
 * (`/palantir konto`, `/palantir server`), Kanäle je Server mit Kategorie je
 * Besitzer und die Status-Kachel. Knöpfe folgen in DC-3.
 *
 * **Kein Response-Envelope an dieser Route (bewusste Abweichung von
 * Pflichtenheft §5.1).** Discord erwartet auf eine gültige Interaction genau
 * sein eigenes Antwortformat (`{ type, data }`), sonst verwirft es die Antwort
 * und zeigt dem Nutzer „Die Anwendung hat nicht reagiert". Nur die Ablehnungen
 * vor der Verarbeitung – ungültige Signatur, Rate-Limit, unlesbarer Körper –
 * gehen im Envelope hinaus; Discord wertet dort ausschließlich den Status.
 *
 * **Ohne CSRF-Token (Pflichtenheft §14a.2).** Der Pfad steht in der
 * Ausnahmeliste des Auth-Moduls. Der Double-Submit schützt eine
 * Browser-Sitzung vor fremden Seiten; hier gibt es keine Sitzung und keinen
 * Browser, sondern eine Ed25519-Signatur, die nur Discord erzeugen kann.
 */

import { type AuditAction, fail, httpStatusForErrorCode } from '@palantir/contracts';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { fireAndForget } from '../../lib/fire-and-forget.js';
import { createRateLimiter } from '../auth/rate-limit.js';
import { registerGuildCommands } from './commands.js';
import type { DiscordBotConfig } from './config.js';
import {
  type DiscordIdentityResolver,
  handleInteraction,
  type InteractionContext,
  type ServerListEntry,
} from './interactions.js';
import { createDiscordRestClient, type DiscordRestClient } from './rest.js';
import { importDiscordPublicKey, verifyDiscordSignature } from './signature.js';
import {
  createDiscordSync,
  type DiscordSync,
  type DiscordSyncSource,
  type DiscordSyncStore,
} from './sync.js';
import type { Interaction } from './types.js';

export const INTERACTIONS_PATH = '/discord/interactions';

/** Discord schickt kleine Körper; 64 KiB lassen jedem Modal-Inhalt Luft. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Grenze je IP vor der Signaturprüfung. Discord selbst bleibt weit darunter;
 * sie bremst nur, wer den öffentlichen Endpoint mit Müll beschießt. Die
 * Prüfung einer Ed25519-Signatur ist billig, eine unbegrenzte Zahl davon nicht.
 */
const IP_LIMIT = { windowSeconds: 60, maxAttempts: 300 } as const;

export interface DiscordBotModuleOptions {
  readonly config: DiscordBotConfig;
  readonly identity: DiscordIdentityResolver;
  /** Austauschbar für Tests; Vorgabe ist ein Client gegen die echte API. */
  readonly rest?: DiscordRestClient;
  /** Uhr für die Signaturprüfung; austauschbar für Tests. */
  readonly now?: () => number;
  /** Kanäle und Kacheln (DC-2). Ohne Angabe bleibt es bei den Befehlen. */
  readonly channels?: {
    readonly store: DiscordSyncStore;
    readonly source: DiscordSyncSource;
  };
}

export interface DiscordBotModule {
  readonly rest: DiscordRestClient;
  /** `null` ohne {@link DiscordBotModuleOptions.channels}. */
  readonly sync: DiscordSync | null;
  /** Ereignis aus der Server-Orchestrierung; frischt Kacheln auf oder stößt den Abgleich an. */
  observeEvent(event: string, payload: Record<string, unknown>): void;
  /** Audit-Eintrag; Rechte- und Mitgliedsänderungen stoßen den Abgleich an. */
  observeAudit(action: string): void;
  /** Verweis auf den Kanal eines Servers für „In Discord öffnen"; `null` ohne Kanal. */
  channelUrl(serverId: string): Promise<string | null>;
}

/**
 * Die Zuordnung Server → Kanal wird für die Server-DTOs gebraucht, bei einer
 * Liste für jeden Server. Kurz zwischengespeichert, damit das keine Abfrage je
 * Server kostet; ein neu angelegter Kanal erscheint spätestens danach.
 */
const CHANNEL_URL_CACHE_MS = 30_000;

/**
 * Ereignisse, nach denen sich Kanäle ändern können: ein Server kommt, geht
 * oder wechselt den Besitzer.
 */
const SYNC_EVENTS = new Set([
  'server.created',
  'server.cloned',
  'server.deleted',
  'server.ownerTransferred',
]);

/**
 * Audit-Aktionen, nach denen sich ändert, wer welchen Kanal sieht
 * (Pflichtenheft §14a.4, „Entzug geht vor"). Das Audit-Log ist die eine
 * Stelle, an der all diese Vorgänge ohnehin vorbeikommen – Mitglieder,
 * Freischaltung, Sperre, Rollen, Trennen der Discord-Anmeldung, Umbenennen.
 * Was dort nicht steht (Verknüpfen, neuer Anzeigename), holt der Taktlauf nach.
 */
const SYNC_AUDIT_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  'server.memberAdded',
  'server.memberRemoved',
  'server.settingsChanged',
  'server.ownerTransferred',
  'auth.methodUnlinked',
  'user.approved',
  'user.banned',
  'user.unbanned',
  'user.roleAssigned',
  'user.roleRemoved',
  'user.deleted',
  'role.updated',
  'role.deleted',
]);

/** Messwerte kommen alle paar Sekunden; die Kachel fragt höchstens einmal je Minute nach. */
const STATS_TILE_INTERVAL_MS = 60_000;

export async function registerDiscordBotModule(
  app: FastifyInstance,
  options: DiscordBotModuleOptions,
): Promise<DiscordBotModule> {
  const { config, identity } = options;
  // Wirft beim Start, nicht bei der ersten Anfrage, wenn der Schlüssel unbrauchbar ist.
  const publicKey = importDiscordPublicKey(config.publicKey);
  const rest = options.rest ?? createDiscordRestClient({ botToken: config.botToken });
  const now = options.now ?? Date.now;
  const ipLimiter = createRateLimiter(IP_LIMIT);
  const sync = options.channels
    ? createDiscordSync({
        rest,
        guildId: config.guildId,
        store: options.channels.store,
        source: options.channels.source,
        log: app.log,
      })
    : null;
  const channels = options.channels;
  const context: InteractionContext = {
    identity,
    webUrl: config.webUrl,
    ...(sync ? { onGuildMember: (id: string) => sync.noteMember(id) } : {}),
    ...(channels ? { listServers: (userId: string) => listServersFor(userId, channels) } : {}),
  };

  await app.register(async (scope) => {
    // Die Signatur gilt dem Rohkörper, Byte für Byte. Der JSON-Parser von
    // Fastify darf ihn deshalb in diesem Geltungsbereich nicht anfassen.
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: MAX_BODY_BYTES },
      (_request, body, done) => {
        done(null, body);
      },
    );

    scope.post(INTERACTIONS_PATH, { bodyLimit: MAX_BODY_BYTES }, async (request, reply) => {
      if (!ipLimiter.consume(request.ip).allowed) {
        return reply.status(httpStatusForErrorCode('RATE_LIMITED')).send(fail('RATE_LIMITED'));
      }

      const rawBody = typeof request.body === 'string' ? request.body : '';
      const signatureHex = request.headers['x-signature-ed25519'];
      const timestamp = request.headers['x-signature-timestamp'];
      const valid = verifyDiscordSignature(
        publicKey,
        {
          signatureHex: typeof signatureHex === 'string' ? signatureHex : undefined,
          timestamp: typeof timestamp === 'string' ? timestamp : undefined,
          rawBody,
        },
        now(),
      );

      if (!valid) {
        return reply
          .status(httpStatusForErrorCode('DISCORD_INTERACTION_INVALID'))
          .send(fail('DISCORD_INTERACTION_INVALID'));
      }

      let interaction: Interaction;

      try {
        interaction = JSON.parse(rawBody) as Interaction;
      } catch {
        return reply
          .status(httpStatusForErrorCode('VALIDATION_FAILED'))
          .send(fail('VALIDATION_FAILED'));
      }

      const response = await handleInteraction(interaction, context);

      return reply.status(200).send(response);
    });
  });

  // Erst beim Lauschen, nicht beim Aufbau: Tests bauen den Server, ohne dass
  // dabei ein Aufruf an Discord hinausgehen darf. Nicht abgewartet – ein
  // langsames Discord soll das Panel nicht am Annehmen von Anfragen hindern.
  app.addHook('onListen', async (): Promise<void> => {
    fireAndForget(registerCommandsSafely(rest, config, app.log), app.log, {
      vorgang: 'Discord-Befehle registrieren',
    });

    if (sync) {
      fireAndForget(sync.run(), app.log, { vorgang: 'Discord-Kanäle abgleichen (Start)' });
    }
  });

  const letzteStatsKachel = new Map<string, number>();
  let kanalCache: { at: number; urls: Map<string, string> } | null = null;

  async function channelUrl(serverId: string): Promise<string | null> {
    if (!channels) return null;

    if (!kanalCache || now() - kanalCache.at > CHANNEL_URL_CACHE_MS) {
      const zuordnung = await channels.store.listServerChannels();
      kanalCache = {
        at: now(),
        urls: new Map(
          zuordnung.map((z) => [
            z.serverId,
            `https://discord.com/channels/${config.guildId}/${z.channelId}`,
          ]),
        ),
      };
    }

    return kanalCache.urls.get(serverId) ?? null;
  }

  function tileRefresh(serverId: string): void {
    if (!sync) return;

    fireAndForget(sync.refreshTiles([serverId]), app.log, {
      vorgang: 'Discord-Kachel auffrischen',
      serverId,
    });
  }

  return {
    rest,
    sync,
    observeEvent(event, payload) {
      if (!sync) return;

      const serverId = typeof payload.serverId === 'string' ? payload.serverId : null;

      if (SYNC_EVENTS.has(event)) {
        sync.request();
      } else if (event === 'server.statusChanged' && serverId) {
        tileRefresh(serverId);
      } else if (event === 'server.statsUpdated' && serverId) {
        const jetzt = now();

        if (jetzt - (letzteStatsKachel.get(serverId) ?? 0) >= STATS_TILE_INTERVAL_MS) {
          letzteStatsKachel.set(serverId, jetzt);
          tileRefresh(serverId);
        }
      }
    },
    channelUrl,
    observeAudit(action) {
      if (sync && SYNC_AUDIT_ACTIONS.has(action)) {
        sync.request();
      }
    },
  };
}

/**
 * Server, die ein Konto sehen darf – dieselbe Regel wie für die Kanäle
 * (§14a.3): Besitz, Mitgliedschaft oder `server.view.any`.
 */
async function listServersFor(
  userId: string,
  channels: NonNullable<DiscordBotModuleOptions['channels']>,
): Promise<ServerListEntry[]> {
  const [stand, zuordnung] = await Promise.all([
    channels.source.loadPanelState(),
    channels.store.listServerChannels(),
  ]);
  const snapshots = await channels.source.loadSnapshots(stand.servers.map((s) => s.id));
  const kanalJeServer = new Map(zuordnung.map((z) => [z.serverId, z.channelId]));
  const admin = stand.adminUserIds.has(userId);

  return stand.servers
    .filter(
      (server) =>
        admin ||
        server.ownerId === userId ||
        (stand.membersByServer.get(server.id) ?? []).includes(userId),
    )
    .map((server) => ({
      name: server.name,
      status: snapshots.get(server.id)?.status ?? 'stopped',
      channelId: kanalJeServer.get(server.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Registriert die Befehle und schluckt einen Fehlschlag mit Log-Zeile.
 * Ein Discord, das gerade nicht antwortet, darf den Start des Panels nicht
 * aufhalten; die bereits registrierten Befehle bleiben bei Discord bestehen.
 */
export async function registerCommandsSafely(
  rest: DiscordRestClient,
  config: DiscordBotConfig,
  log: Pick<FastifyBaseLogger, 'info' | 'error'>,
): Promise<void> {
  try {
    await registerGuildCommands(rest, config.applicationId, config.guildId);
    log.info({ guildId: config.guildId }, 'Discord-Bot: Befehle registriert');
  } catch (error: unknown) {
    log.error(
      { guildId: config.guildId, error: error instanceof Error ? error.message : String(error) },
      'Discord-Bot: Befehle konnten nicht registriert werden',
    );
  }
}
