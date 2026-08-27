/**
 * Discord-Webhook als externer Kanal (Lastenheft §3.6, Pflichtenheft §14).
 *
 * Die Webhook-URL kommt **ausschließlich** aus der zentralen `.env`
 * (`DISCORD_WEBHOOK_URL`) oder aus dem Kanal-Datensatz, den ein Admin gepflegt
 * hat – niemals aus dem Code (CLAUDE.md §2).
 *
 * Keine neue Abhängigkeit: Der Versand läuft über das in Node 22 eingebaute
 * `fetch`. Eine HTTP-Bibliothek für einen einzigen POST wäre nicht zu
 * rechtfertigen (CLAUDE.md §1).
 */

import type { ErrorCode } from '@palantir/contracts';
import {
  type NotificationTransport,
  type OutboundMessage,
  type ResolvedChannelTarget,
  NotificationTransportError,
} from './ports.js';

/**
 * Farbe des Embeds je Dringlichkeit.
 *
 * Discord erwartet die Farbe als Ganzzahl. Die drei Werte entsprechen den
 * üblichen Ampelfarben und sind bewusst hier festgelegt statt konfigurierbar –
 * eine Instanz, die andere Farben will, hätte an einer Benachrichtigung das
 * kleinste Problem.
 */
const EMBED_COLORS = {
  info: 0x3b82f6,
  warning: 0xf59e0b,
  error: 0xef4444,
} as const;

/** Discord kappt Embed-Beschreibungen bei 4096 Zeichen, Titel bei 256. */
const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 4096;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Baut den Nachrichtenkörper für Discord.
 *
 * Bewusst als eigene, exportierte Funktion: So lässt sich das Format prüfen,
 * ohne einen HTTP-Aufruf zu machen.
 */
export function buildDiscordPayload(
  target: ResolvedChannelTarget,
  message: OutboundMessage,
): Record<string, unknown> {
  return {
    ...(target.username === null ? {} : { username: target.username }),
    embeds: [
      {
        title: truncate(message.title, MAX_TITLE_LENGTH),
        description: truncate(message.body, MAX_BODY_LENGTH),
        color: EMBED_COLORS[message.severity],
        timestamp: message.at,
        footer: { text: 'Palantir' },
      },
    ],
  };
}

export interface DiscordTransportOptions {
  /**
   * Frist für einen einzelnen Versuch.
   *
   * Ohne Frist bliebe ein hängender Webhook-Aufruf beliebig lange offen; der
   * Hintergrundlauf wäre dann zwar für den auslösenden Vorgang unschädlich,
   * würde aber Verbindungen und Speicher halten.
   */
  readonly timeoutMs?: number;
  /** Nur für Tests: eigener `fetch`-Ersatz. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Ordnet die Antwort von Discord einem benannten Fehlercode zu.
 *
 * `429` (Rate-Limit) und `5xx` sind vorübergehend und rechtfertigen einen
 * weiteren Versuch; `4xx` sonst nicht – eine falsche oder zurückgezogene
 * Webhook-URL wird durch Wiederholen nicht richtig.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createDiscordTransport(
  options: DiscordTransportOptions = {},
): NotificationTransport {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(target: ResolvedChannelTarget, message: OutboundMessage): Promise<void> {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      let response: Response;

      try {
        response = await fetchImpl(target.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildDiscordPayload(target, message)),
          signal: controller.signal,
        });
      } catch (error) {
        /*
         * Netzfehler und abgelaufene Frist landen beide hier. Die Meldung trägt
         * bewusst **nicht** die URL – sie ist ein Geheimnis und würde sonst im
         * Zustellungsprotokoll und im Log stehen.
         */
        throw new NotificationTransportError(
          'NOTIFICATION_DELIVERY_FAILED',
          error instanceof Error && error.name === 'AbortError'
            ? `Der Kanal hat nicht innerhalb von ${String(timeoutMs)} ms geantwortet.`
            : 'Der Kanal war nicht erreichbar.',
          // Netzfehler und Fristablauf sind vorübergehend.
          true,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const code: ErrorCode = 'NOTIFICATION_DELIVERY_FAILED';

        throw new NotificationTransportError(
          code,
          `Der Kanal hat die Nachricht mit Status ${String(response.status)} abgelehnt.`,
          isRetryableStatus(response.status),
        );
      }
    },
  };
}
