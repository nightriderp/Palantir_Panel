/**
 * Beantwortet Interactions (Pflichtenheft §14a.2, §14a.3, §14a.8).
 *
 * Reine Logik ohne HTTP: Die Route prüft die Signatur und reicht das geparste
 * Objekt hierher. So lässt sich jede Antwort ohne Fastify und ohne Discord
 * testen.
 *
 * **Keine zweite Rechtelogik.** Wer der Aufrufer ist, sagt allein die
 * Verknüpfung im Panel (`AuthMethod` vom Typ `discord`); ob er freigeschaltet
 * und nicht gesperrt ist, dieselben Regeln wie überall (`rbac`). Dieses Modul
 * fragt beides über {@link DiscordIdentityResolver} ab und entscheidet nichts
 * selbst.
 */

import { defaultMessageForErrorCode, type ServerStatus } from '@palantir/contracts';
import { ROOT_COMMAND, SUBCOMMAND_ACCOUNT, SUBCOMMAND_SERVERS } from './commands.js';
import {
  type Interaction,
  type InteractionResponse,
  InteractionResponseType,
  InteractionType,
  interactionUserId,
  MESSAGE_FLAG_EPHEMERAL,
} from './types.js';

/** Das Palantir-Konto hinter einem Discord-Account, so weit der Bot es braucht. */
export interface LinkedAccount {
  readonly userId: string;
  readonly displayName: string;
  readonly banned: boolean;
  /** Freigeschaltet im Sinne von Lastenheft §3.1 (Owner oder Rolle außer „Gast"). */
  readonly approved: boolean;
}

export interface DiscordIdentityResolver {
  /** `null`, wenn kein Konto diesen Discord-Account verknüpft hat. */
  resolve(discordUserId: string): Promise<LinkedAccount | null>;
}

/** Ein Server in der Übersicht von `/palantir server` (F12). */
export interface ServerListEntry {
  readonly name: string;
  readonly status: ServerStatus;
  /** Discord-Kanal des Servers; `null`, solange er nicht angelegt ist. */
  readonly channelId: string | null;
}

export interface InteractionContext {
  readonly identity: DiscordIdentityResolver;
  /** Öffentliche Adresse des Panels, für Verweise in Antworten. */
  readonly webUrl: string;
  /** Server, die ein Konto sehen darf – Besitz, Mitgliedschaft oder `server.manage.any`. */
  readonly listServers?: (userId: string) => Promise<readonly ServerListEntry[]>;
  /**
   * Wer einen Befehl in der Guild auslöst, ist nachweislich Mitglied. Der
   * Abgleich erfährt das sofort, statt es erst bei der nächsten Prüfung
   * herauszufinden.
   */
  readonly onGuildMember?: (discordUserId: string) => void;
}

/** Discord zeigt höchstens 2000 Zeichen je Nachricht, die Liste bleibt darunter. */
const MAX_LIST_ENTRIES = 25;

const STATUS_LABELS: Record<ServerStatus, string> = {
  creating: 'wird angelegt',
  stopped: 'gestoppt',
  starting: 'startet',
  running: 'läuft',
  stopping: 'stoppt',
  error: 'Fehler',
  crashed: 'abgestürzt',
};

/** Flüchtige Textantwort; niemand wird darin angepingt. */
export function ephemeral(content: string): InteractionResponse {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: MESSAGE_FLAG_EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}

const UNKNOWN = ephemeral('Diesen Befehl kenne ich nicht.');

export async function handleInteraction(
  interaction: Interaction,
  context: InteractionContext,
): Promise<InteractionResponse> {
  if (interaction.type === InteractionType.Ping) {
    return { type: InteractionResponseType.Pong };
  }

  if (interaction.type === InteractionType.ApplicationCommand) {
    return handleCommand(interaction, context);
  }

  return UNKNOWN;
}

async function handleCommand(
  interaction: Interaction,
  context: InteractionContext,
): Promise<InteractionResponse> {
  if (interaction.data?.name !== ROOT_COMMAND) {
    return UNKNOWN;
  }

  const sub = interaction.data.options?.[0]?.name;
  const discordUserId = interactionUserId(interaction);

  if (discordUserId && interaction.guild_id) {
    context.onGuildMember?.(discordUserId);
  }

  if (sub === SUBCOMMAND_ACCOUNT) {
    return accountStatus(interaction, context);
  }

  if (sub === SUBCOMMAND_SERVERS) {
    return serverList(interaction, context);
  }

  return UNKNOWN;
}

/**
 * Gemeinsame Vorprüfung aller Befehle, die ein Konto brauchen: verknüpft,
 * nicht gesperrt, freigeschaltet. Liefert die Antwort für den Fehlerfall
 * oder das Konto.
 */
async function requireAccount(
  interaction: Interaction,
  context: InteractionContext,
): Promise<{ account: LinkedAccount } | { response: InteractionResponse }> {
  const discordUserId = interactionUserId(interaction);

  if (!discordUserId) {
    return { response: UNKNOWN };
  }

  const account = await context.identity.resolve(discordUserId);

  if (!account) {
    return {
      response: ephemeral(
        `${defaultMessageForErrorCode('DISCORD_NOT_LINKED')}\n${context.webUrl}/profil`,
      ),
    };
  }

  if (account.banned) {
    return { response: ephemeral(defaultMessageForErrorCode('AUTH_ACCOUNT_BANNED')) };
  }

  if (!account.approved) {
    return {
      response: ephemeral(
        `Verknüpft mit **${escapeMarkdown(account.displayName)}**, aber das Konto ist noch nicht ` +
          'freigeschaltet. Sobald ein Administrator es freigibt, stehen dir die Funktionen hier zur Verfügung.',
      ),
    };
  }

  return { account };
}

/** `/palantir server` (F12). */
async function serverList(
  interaction: Interaction,
  context: InteractionContext,
): Promise<InteractionResponse> {
  const ergebnis = await requireAccount(interaction, context);

  if ('response' in ergebnis) {
    return ergebnis.response;
  }

  const servers = (await context.listServers?.(ergebnis.account.userId)) ?? [];

  if (servers.length === 0) {
    return ephemeral(
      `Du hast noch keinen Server. Anlegen kannst du ihn im Panel: ${context.webUrl}`,
    );
  }

  const zeilen = servers
    .slice(0, MAX_LIST_ENTRIES)
    .map(
      (s) =>
        `• **${escapeMarkdown(s.name)}** – ${STATUS_LABELS[s.status]}` +
        (s.channelId ? ` – <#${s.channelId}>` : ''),
    );

  if (servers.length > MAX_LIST_ENTRIES) {
    zeilen.push(`… und ${String(servers.length - MAX_LIST_ENTRIES)} weitere im Panel.`);
  }

  return ephemeral(zeilen.join('\n'));
}

/** `/palantir konto` (F1). */
async function accountStatus(
  interaction: Interaction,
  context: InteractionContext,
): Promise<InteractionResponse> {
  const ergebnis = await requireAccount(interaction, context);

  if ('response' in ergebnis) {
    return ergebnis.response;
  }

  return ephemeral(`Verknüpft mit **${escapeMarkdown(ergebnis.account.displayName)}**.`);
}

/**
 * Anzeigenamen sind frei wählbar. Ohne Maskierung setzte ein Name wie
 * `**x**` oder `` `x` `` eigene Formatierung in die Antwort.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>#[\]()-])/g, '\\$1');
}
