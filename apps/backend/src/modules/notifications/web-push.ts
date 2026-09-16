import webpush from 'web-push';
import {
  type PushMessage,
  type PushOutcome,
  type PushSender,
  type PushSubscriptionRecord,
} from './push.js';

/**
 * Versand über die Zustelldienste der Browserhersteller (Web-Push, RFC 8030).
 *
 * **Neue Abhängigkeit `web-push` (Entwicklungsregeln §1).** Eine Push-Nachricht ist nicht
 * einfach ein HTTP-Aufruf: Sie wird mit ECDH und HKDF für genau ein Gerät
 * verschlüsselt (RFC 8291) und mit einem signierten VAPID-Token abgesendet
 * (RFC 8292). Das ist Kryptografie mit festgelegten Kurven, Zählweisen und
 * Kopfzeilen – nichts, was man für ein Panel selbst schreibt. `web-push` ist
 * die Umsetzung, auf die sich das Ökosystem geeinigt hat.
 *
 * Der Server sieht die Nutzlast im Klartext (er verschlüsselt sie ja selbst),
 * der Zustelldienst dazwischen nicht – das ist der Sinn der Übung.
 */

export interface WebPushOptions {
  readonly publicKey: string;
  readonly privateKey: string;
  /**
   * Kontaktadresse des Betreibers (`mailto:` oder `https:`), die im
   * VAPID-Token steht. Die Zustelldienste verlangen sie, um bei Auffälligkeiten
   * jemanden erreichen zu können.
   */
  readonly subject: string;
  readonly log?: { warn(details: Record<string, unknown>, message: string): void };
}

/**
 * Antworten, nach denen ein Abonnement endgültig weg ist.
 *
 * 404 und 410 heissen beim Zustelldienst dasselbe: Dieses Abonnement gibt es
 * nicht mehr, weil der Browser es verworfen hat (Neuinstallation, gelöschte
 * Website-Daten, abgelehnte Erlaubnis). Weitere Versuche wären vergeblich.
 */
const ENDGUELTIG = new Set([404, 410]);

export function createWebPushSender(options: WebPushOptions): PushSender {
  webpush.setVapidDetails(options.subject, options.publicKey, options.privateKey);

  return {
    async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushOutcome> {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(message),
          {
            // Vier Stunden: Ein Hinweis, der länger unterwegs war, hilft
            // niemandem mehr – der Zustand steht dann ohnehin im Panel.
            TTL: 4 * 60 * 60,
          },
        );

        return 'sent';
      } catch (error: unknown) {
        const status =
          typeof error === 'object' && error !== null && 'statusCode' in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : null;

        if (status !== null && ENDGUELTIG.has(status)) {
          return 'gone';
        }

        options.log?.warn(
          {
            status,
            fehler: error instanceof Error ? error.message : String(error),
          },
          'Push-Zustellung fehlgeschlagen',
        );

        return 'failed';
      }
    },
  };
}
