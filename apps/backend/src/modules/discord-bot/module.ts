/**
 * Discord-Bot als Backend-Modul (Lastenheft §3.11, Pflichtenheft §14a).
 *
 * Stand DC-1: Interactions-Endpoint mit Signaturprüfung, Registrierung der
 * Slash-Befehle und `/palantir konto`. Kanäle, Kachel und Knöpfe folgen in
 * DC-2 und DC-3.
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

import { fail, httpStatusForErrorCode } from '@palantir/contracts';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { fireAndForget } from '../../lib/fire-and-forget.js';
import { createRateLimiter } from '../auth/rate-limit.js';
import { registerGuildCommands } from './commands.js';
import type { DiscordBotConfig } from './config.js';
import { type DiscordIdentityResolver, handleInteraction } from './interactions.js';
import { createDiscordRestClient, type DiscordRestClient } from './rest.js';
import { importDiscordPublicKey, verifyDiscordSignature } from './signature.js';
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
}

export interface DiscordBotModule {
  readonly rest: DiscordRestClient;
}

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

      const response = await handleInteraction(interaction, { identity, webUrl: config.webUrl });

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
  });

  return { rest };
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
