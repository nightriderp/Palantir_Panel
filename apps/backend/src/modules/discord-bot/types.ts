/**
 * Die Ausschnitte der Discord-Typen, die der Bot braucht (Pflichtenheft §14a.1).
 *
 * Bewusst hier und nicht in `packages/contracts`: Sie sind keine Schnittstelle
 * zwischen Backend, Frontend und Agent, sondern Discords Wire-Format. Geführt
 * wird nur, was gelesen oder geschrieben wird – alles andere am Objekt bleibt
 * `unknown` und wird nicht angefasst.
 */

/** https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object-interaction-type */
export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const;

/** https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object-interaction-callback-type */
export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  Modal: 9,
} as const;

/** Nachricht nur für den Aufrufer sichtbar. */
export const MESSAGE_FLAG_EPHEMERAL = 1 << 6;

/** https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-type */
export const CommandOptionType = {
  SubCommand: 1,
} as const;

export interface DiscordUser {
  readonly id: string;
  readonly username?: string;
}

export interface CommandOption {
  readonly name: string;
  readonly type: number;
  readonly options?: readonly CommandOption[];
}

export interface Interaction {
  readonly id: string;
  readonly type: number;
  readonly token?: string;
  readonly guild_id?: string;
  /** In einer Guild: das Mitglied samt Benutzer. */
  readonly member?: { readonly user?: DiscordUser };
  /** In einer Direktnachricht: der Benutzer. */
  readonly user?: DiscordUser;
  readonly data?: {
    readonly name?: string;
    readonly custom_id?: string;
    readonly options?: readonly CommandOption[];
  };
}

export interface InteractionResponse {
  readonly type: number;
  readonly data?: {
    readonly content?: string;
    readonly flags?: number;
    /** Keine Erwähnung soll aus einer Bot-Antwort heraus jemanden anpingen. */
    readonly allowed_mentions?: { readonly parse: readonly string[] };
  };
}

/** Definition eines Slash-Befehls für die Registrierung. */
export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly type: 1;
  /** 0 = nur in Guilds, nicht in Direktnachrichten. */
  readonly contexts: readonly number[];
  readonly options?: readonly {
    readonly type: number;
    readonly name: string;
    readonly description: string;
  }[];
}

/** Die Discord-Id des Aufrufers, gleich ob in einer Guild oder einer DM. */
export function interactionUserId(interaction: Interaction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}
