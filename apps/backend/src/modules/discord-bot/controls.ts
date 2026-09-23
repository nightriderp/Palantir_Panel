/**
 * Klicks auf die Knöpfe der Kachel und das Konsolen-Modal (F4, F8, F10, F11;
 * Pflichtenheft §14a.5).
 *
 * Ablauf je Klick – bei **jedem** Klick, auch beim Bestätigen:
 * 1. Kennung lesen; eine fremde Form wird abgewiesen.
 * 2. Konto hinter dem Discord-Account: verknüpft, freigeschaltet, nicht gesperrt.
 * 3. Rate-Limit je Discord-Nutzer.
 * 4. Server laden und das Recht des Kontos daran prüfen – dieselbe Rechnung
 *    wie im Panel (`control.ts`). Wer den Server nicht sehen darf, bekommt
 *    dieselbe Antwort wie für einen Server, den es nicht gibt.
 * 5. Ausführen über die Service-Methoden der Orchestrierung.
 *
 * Alle Antworten sind flüchtig (nur für den Klickenden sichtbar).
 */

import { defaultMessageForErrorCode, type ErrorCode } from '@palantir/contracts';
import { isAppError } from '../../lib/app-error.js';
import {
  CONFIRMED_ACTIONS,
  CONSOLE_INPUT_ID,
  confirmationExpired,
  MAX_CONSOLE_COMMAND_LENGTH,
  parseCustomId,
  renderConfirmation,
  renderConsoleModal,
  type ServerAction,
} from './buttons.js';
import type { ServerControlPort, ServerControlView } from './control.js';
import { type DiscordIdentityResolver, ephemeral, escapeMarkdown } from './interactions.js';
import {
  type Interaction,
  type InteractionOutcome,
  InteractionResponseType,
  InteractionType,
  interactionUserId,
  MESSAGE_FLAG_EPHEMERAL,
} from './types.js';

/** Discord zeigt höchstens 2000 Zeichen; Rahmen und Hinweis brauchen Platz. */
const MAX_OUTPUT_CHARS = 1800;
const MAX_PLAYER_NAMES = 50;

export interface ControlsLogger {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface ControlsContext {
  readonly identity: DiscordIdentityResolver;
  readonly control: ServerControlPort;
  /** `false`, wenn der Discord-Nutzer sein Kontingent an Aktionen verbraucht hat. */
  readonly allowAction: (discordUserId: string) => boolean;
  readonly now: () => number;
  readonly log: ControlsLogger;
}

const nurFuerDich = (content: string): InteractionOutcome => ({ response: ephemeral(content) });
const fehler = (code: ErrorCode): InteractionOutcome =>
  nurFuerDich(defaultMessageForErrorCode(code));

/** Vorläufige Antwort „denkt nach …", nur für den Klickenden. */
const DEFERRED_EPHEMERAL = {
  type: InteractionResponseType.DeferredChannelMessageWithSource,
  data: { flags: MESSAGE_FLAG_EPHEMERAL },
};

export async function handleControlInteraction(
  interaction: Interaction,
  context: ControlsContext,
): Promise<InteractionOutcome> {
  const parsed = parseCustomId(interaction.data?.custom_id);

  if (!parsed) {
    return nurFuerDich('Diesen Knopf kenne ich nicht.');
  }

  if (interaction.type === InteractionType.ModalSubmit && parsed.kind !== 'consoleModal') {
    return nurFuerDich('Diesen Knopf kenne ich nicht.');
  }

  const discordUserId = interactionUserId(interaction);
  const account = discordUserId ? await context.identity.resolve(discordUserId) : null;

  if (!discordUserId || !account) return fehler('DISCORD_NOT_LINKED');
  if (account.banned) return fehler('AUTH_ACCOUNT_BANNED');
  if (!account.approved) return fehler('PERMISSION_DENIED');
  if (!context.allowAction(discordUserId)) return fehler('DISCORD_RATE_LIMITED');

  const server = await context.control.load(parsed.serverId, account.userId);

  if (!server || !server.permissions.canView) return fehler('SERVER_NOT_FOUND');

  const protokoll = { discordUserId, userId: account.userId, serverId: parsed.serverId };

  if (parsed.kind === 'consoleModal') {
    return consoleSubmit(interaction, server, parsed.serverId, context, protokoll);
  }

  if (parsed.kind === 'confirm') {
    if (confirmationExpired(parsed.issuedAt, context.now())) {
      return fehler('DISCORD_CONFIRMATION_EXPIRED');
    }

    if (!darf(server, parsed.action)) return fehler('PERMISSION_DENIED');

    // Die Rückfrage wird durch das Ergebnis ersetzt, ihre Knöpfe verschwinden.
    return {
      response: { type: InteractionResponseType.DeferredUpdateMessage },
      followUp: () =>
        ausfuehren(parsed.action, parsed.serverId, account.userId, context, protokoll),
    };
  }

  const action = parsed.action;

  if (!darf(server, action)) return fehler('PERMISSION_DENIED');

  if (CONFIRMED_ACTIONS.has(action)) {
    const jetzt = Math.floor(context.now() / 1000);
    const frage =
      action === 'stop'
        ? `**${escapeMarkdown(server.name)}** wirklich stoppen? Spieler werden getrennt.`
        : `**${escapeMarkdown(server.name)}** wirklich neu starten? Spieler werden kurz getrennt.`;

    return {
      response: {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: frage,
          flags: MESSAGE_FLAG_EPHEMERAL,
          allowed_mentions: { parse: [] },
          components: renderConfirmation(parsed.serverId, action, jetzt),
        },
      },
    };
  }

  if (action === 'players') {
    return nurFuerDich(spielerText(context.control.players(parsed.serverId)));
  }

  if (action === 'console') {
    if (!server.supportsConsole) return fehler('CONSOLE_NOT_SUPPORTED');
    if (!server.consoleEnabled) return fehler('DISCORD_CONSOLE_DISABLED');

    return {
      response: {
        type: InteractionResponseType.Modal,
        data: renderConsoleModal(parsed.serverId, server.name),
      },
    };
  }

  return {
    response: DEFERRED_EPHEMERAL,
    followUp: () => ausfuehren(action, parsed.serverId, account.userId, context, protokoll),
  };
}

/** Recht je Aktion – die Flags, die auch die REST-Routen verlangen. */
function darf(server: ServerControlView, action: ServerAction): boolean {
  const p = server.permissions;

  switch (action) {
    case 'start':
      return p.canStart;
    case 'stop':
      return p.canStop;
    case 'restart':
      return p.canRestart;
    case 'backup':
      return p.canManageBackups;
    case 'players':
      return p.canView;
    case 'console':
      return p.canUseConsole;
  }
}

const ERGEBNIS: Partial<Record<ServerAction, string>> = {
  start: 'Server wird gestartet. Den Stand zeigt die Kachel im Kanal.',
  stop: 'Server wird gestoppt.',
  restart: 'Server wird neu gestartet.',
  backup: 'Sicherung ist angestoßen. Sie erscheint im Panel unter „Sicherungen".',
};

async function ausfuehren(
  action: ServerAction,
  serverId: string,
  userId: string,
  context: ControlsContext,
  protokoll: Record<string, unknown>,
): Promise<{ content: string; components: [] }> {
  try {
    if (action === 'start') await context.control.start(serverId, userId);
    else if (action === 'stop') await context.control.stop(serverId);
    else if (action === 'restart') await context.control.restart(serverId, userId);
    else if (action === 'backup') await context.control.backup(serverId, userId);

    context.log.info({ ...protokoll, aktion: action }, 'Discord-Bot: Aktion ausgeführt');

    return { content: ERGEBNIS[action] ?? 'Erledigt.', components: [] };
  } catch (error: unknown) {
    return { content: fehlerText(error, action, context, protokoll), components: [] };
  }
}

async function consoleSubmit(
  interaction: Interaction,
  server: ServerControlView,
  serverId: string,
  context: ControlsContext,
  protokoll: Record<string, unknown>,
): Promise<InteractionOutcome> {
  if (!server.permissions.canUseConsole) return fehler('PERMISSION_DENIED');
  if (!server.supportsConsole) return fehler('CONSOLE_NOT_SUPPORTED');
  if (!server.consoleEnabled) return fehler('DISCORD_CONSOLE_DISABLED');

  const befehl = (
    interaction.data?.components
      ?.flatMap((zeile) => zeile.components ?? [])
      .find((feld) => feld.custom_id === CONSOLE_INPUT_ID)?.value ?? ''
  ).trim();

  // Dieselben Grenzen wie `consoleCommandSchema`: nicht leer, keine Zeilenumbrüche.
  if (befehl.length === 0 || befehl.length > MAX_CONSOLE_COMMAND_LENGTH || /[\r\n]/.test(befehl)) {
    return fehler('VALIDATION_FAILED');
  }

  return {
    response: DEFERRED_EPHEMERAL,
    followUp: async () => {
      try {
        const ergebnis = await context.control.console(serverId, befehl);

        context.log.info(
          { ...protokoll, aktion: 'console', laenge: befehl.length },
          'Discord-Bot: Konsolenbefehl ausgeführt',
        );

        return { content: konsolenText(befehl, ergebnis) };
      } catch (error: unknown) {
        return { content: fehlerText(error, 'console', context, protokoll) };
      }
    },
  };
}

function fehlerText(
  error: unknown,
  action: string,
  context: ControlsContext,
  protokoll: Record<string, unknown>,
): string {
  if (isAppError(error)) {
    // Die Meldungen der Fachfehler sind für Nutzer geschrieben (Pflichtenheft §5.1).
    return error.message;
  }

  context.log.error(
    {
      ...protokoll,
      aktion: action,
      fehler: error instanceof Error ? error.message : String(error),
    },
    'Discord-Bot: Aktion fehlgeschlagen',
  );

  return 'Das hat nicht geklappt. Bitte im Panel nachsehen oder später erneut versuchen.';
}

/** Codeblock ohne die Möglichkeit, ihn aus der Ausgabe heraus zu schließen. */
function codeblock(text: string): string {
  const sauber = text.replace(/```/g, 'ʼʼʼ');
  const gekuerzt =
    sauber.length > MAX_OUTPUT_CHARS ? `${sauber.slice(0, MAX_OUTPUT_CHARS)}\n…` : sauber;

  return `\`\`\`\n${gekuerzt}\n\`\`\``;
}

export function konsolenText(befehl: string, ergebnis: { stdout: string; stderr: string }): string {
  const ausgabe = [ergebnis.stdout, ergebnis.stderr]
    .map((teil) => teil.trim())
    .filter(Boolean)
    .join('\n');
  const kopf = `Befehl \`${befehl.replace(/`/g, 'ʼ')}\` gesendet.`;

  return ausgabe.length === 0 ? `${kopf} Keine Ausgabe.` : `${kopf}\n${codeblock(ausgabe)}`;
}

export function spielerText(stand: ReturnType<ServerControlPort['players']>): string {
  const { names, count } = stand;

  if (names.length > 0) {
    const liste = names.slice(0, MAX_PLAYER_NAMES).map((n) => `• ${escapeMarkdown(n)}`);

    if (names.length > MAX_PLAYER_NAMES) {
      liste.push(`… und ${String(names.length - MAX_PLAYER_NAMES)} weitere`);
    }

    return `**Verbunden (${String(count?.online ?? names.length)}):**\n${liste.join('\n')}`;
  }

  if (count) {
    return count.online === 0
      ? 'Gerade ist niemand verbunden.'
      : `${String(count.online)} Spieler verbunden. Namen meldet dieses Spiel nicht.`;
  }

  return 'Dieses Spiel meldet keine Spieler, oder der Server antwortet gerade nicht auf die Abfrage.';
}
