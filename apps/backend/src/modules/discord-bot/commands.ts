/**
 * Slash-Befehle des Bots (Pflichtenheft §14a.8).
 *
 * Registriert als **Guild**-Befehle: Die wirken sofort, globale Befehle
 * brauchen bis zu einer Stunde. `PUT` ersetzt den gesamten Bestand – der Aufruf
 * ist damit idempotent, und ein entfernter Befehl verschwindet beim nächsten
 * Start von selbst.
 *
 * `/palantir konto` (F1, DC-1) und `/palantir server` (F12, DC-2).
 */

import type { DiscordRestClient } from './rest.js';
import { type CommandDefinition, CommandOptionType } from './types.js';

export const ROOT_COMMAND = 'palantir';
export const SUBCOMMAND_ACCOUNT = 'konto';
export const SUBCOMMAND_SERVERS = 'server';

export const COMMANDS: readonly CommandDefinition[] = [
  {
    name: ROOT_COMMAND,
    description: 'Palantir-Panel',
    type: 1,
    contexts: [0],
    options: [
      {
        type: CommandOptionType.SubCommand,
        name: SUBCOMMAND_ACCOUNT,
        description: 'Zeigt, mit welchem Palantir-Konto dein Discord verknüpft ist',
      },
      {
        type: CommandOptionType.SubCommand,
        name: SUBCOMMAND_SERVERS,
        description: 'Listet deine Server mit Zustand und Kanal',
      },
    ],
  },
];

export async function registerGuildCommands(
  rest: DiscordRestClient,
  applicationId: string,
  guildId: string,
): Promise<void> {
  await rest.request('PUT', `/applications/${applicationId}/guilds/${guildId}/commands`, COMMANDS);
}
