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

import { defaultMessageForErrorCode } from '@palantir/contracts';
import { ROOT_COMMAND, SUBCOMMAND_ACCOUNT } from './commands.js';
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

export interface InteractionContext {
  readonly identity: DiscordIdentityResolver;
  /** Öffentliche Adresse des Panels, für Verweise in Antworten. */
  readonly webUrl: string;
}

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

  if (sub === SUBCOMMAND_ACCOUNT) {
    return accountStatus(interaction, context);
  }

  return UNKNOWN;
}

/** `/palantir konto` (F1). */
async function accountStatus(
  interaction: Interaction,
  context: InteractionContext,
): Promise<InteractionResponse> {
  const discordUserId = interactionUserId(interaction);

  if (!discordUserId) {
    return UNKNOWN;
  }

  const account = await context.identity.resolve(discordUserId);

  if (!account) {
    return ephemeral(
      `${defaultMessageForErrorCode('DISCORD_NOT_LINKED')}\n${context.webUrl}/profil`,
    );
  }

  if (account.banned) {
    return ephemeral(defaultMessageForErrorCode('AUTH_ACCOUNT_BANNED'));
  }

  if (!account.approved) {
    return ephemeral(
      `Verknüpft mit **${escapeMarkdown(account.displayName)}**, aber das Konto ist noch nicht ` +
        'freigeschaltet. Sobald ein Administrator es freigibt, stehen dir die Funktionen hier zur Verfügung.',
    );
  }

  return ephemeral(`Verknüpft mit **${escapeMarkdown(account.displayName)}**.`);
}

/**
 * Anzeigenamen sind frei wählbar. Ohne Maskierung setzte ein Name wie
 * `**x**` oder `` `x` `` eigene Formatierung in die Antwort.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>#[\]()-])/g, '\\$1');
}
