import { and, eq } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { pushSubscriptions } from '../../db/schema/notifications.js';
import { type PushSubscriptionRecord, type PushSubscriptionStore } from './push.js';

/**
 * Ablage der Push-Abonnements.
 *
 * Eigene Datei und eigene Schnittstelle statt einer Erweiterung des grossen
 * `NotificationRepository`: Die Abonnements haengen an Konto und Geraet, nicht
 * an Regeln, Kanaelen oder der Inbox – und der Versand braucht nichts aus dem
 * Rest. Die schmale Schnittstelle laesst sich ausserdem in Tests ohne
 * Datenbank stellen.
 */
export function createDrizzlePushSubscriptionStore(db: DbConnection): PushSubscriptionStore {
  return {
    async save(input) {
      /*
       * Dieselbe Adresse bleibt eine Zeile: Ein Browser meldet sich nach jedem
       * Start neu an, und ohne diesen Konflikt-Zweig saehen wir nach einer
       * Woche zehn Abonnements desselben Geraetes – und jede Meldung kaeme
       * zehnmal.
       *
       * Das Konto wandert bewusst mit: Meldet sich an demselben Browser ein
       * anderes Konto an, gehoert das Abonnement ab dann diesem Konto. Sonst
       * bekaeme der Vorgaenger die Hinweise des Nachfolgers.
       */
      await db
        .insert(pushSubscriptions)
        .values({
          userId: input.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: input.userId,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent,
          },
        });
    },

    async remove(userId, endpoint) {
      // Konto **und** Adresse: Ein fremdes Abonnement laesst sich damit nicht
      // abmelden, auch wenn jemand die Adresse kennt.
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    },

    async removeByEndpoint(endpoint) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    },

    async listForUser(userId): Promise<readonly PushSubscriptionRecord[]> {
      const rows = await db
        .select({
          id: pushSubscriptions.id,
          userId: pushSubscriptions.userId,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));

      return rows;
    },

    async markUsed(endpoint, at) {
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: at })
        .where(eq(pushSubscriptions.endpoint, endpoint));
    },
  };
}
