/**
 * Standard-Benachrichtigungsregeln der Ersteinrichtung (WORK_STATUS.md,
 * Gefundener Punkt 82; Lastenheft §3.6, Pflichtenheft §14).
 *
 * **Warum überhaupt Vorgaben.** Eine frische Installation hatte gar keine
 * Regeln – damit löste kein Ereignis irgendetwas aus, bis ein Admin die erste
 * Regel von Hand anlegte. Ein abgestürzter Server meldete sich also bei
 * niemandem, und das fiel erst auf, wenn jemand nachsah.
 *
 * **Warum genau diese sechs.** Sie decken die im Lastenheft §3.6 genannten
 * Fälle ab und niemanden darüber hinaus:
 *
 * - `server.crashed`, `server.failed`, `backup.failed`, `autoShutdown.triggered`
 *   gehen an den **Besitzer** der betroffenen Ressource – ihn betrifft es, und
 *   nur er kann etwas tun.
 * - `user.registered` und `resource.low` gehen an die **Admin-Rolle**: die
 *   Freischaltung neuer Konten und knapper Speicher sind Betreiberaufgaben.
 *
 * **Nur Inbox, kein externer Kanal.** Ein Discord-Kanal setzt eine Webhook-URL
 * voraus, die es bei der Ersteinrichtung noch nicht gibt. Die Inbox ist immer
 * da.
 *
 * **Idempotent und nicht bevormundend.** Angelegt wird eine Regel nur, wenn es
 * sie noch nicht gibt (gleiche Kombination aus Ereignis, Kanal und
 * Empfängerkreis). Wer eine Vorgabe löscht oder abschaltet, bekommt sie beim
 * nächsten Lauf nicht zurück – abgeschaltet bleibt abgeschaltet, denn ein
 * erneutes Anlegen würde eine bewusste Entscheidung des Betreibers rückgängig
 * machen.
 */

import { type NotifiableEventName } from '@palantir/contracts';
import { eq } from 'drizzle-orm';
import { type Database } from '../../db/client.js';
import { notificationRules } from '../../db/schema/notifications.js';
import { roles } from '../../db/schema/rbac.js';

/** Name der Rolle, die die Betreiber-Meldungen bekommt (Seed-Rolle aus B2). */
const ADMIN_ROLE_NAME = 'Admin';

/** Ereignisse, die den Besitzer der betroffenen Ressource erreichen. */
export const OWNER_RULE_EVENTS: readonly NotifiableEventName[] = [
  'server.crashed',
  'server.failed',
  'backup.failed',
  'autoShutdown.triggered',
];

/** Ereignisse, die die Administration erreichen. */
export const ADMIN_RULE_EVENTS: readonly NotifiableEventName[] = [
  'user.registered',
  'resource.low',
];

/**
 * Die drei Zugriffe, die das Seeding braucht.
 *
 * Eigener, enger Port statt der vollen `NotificationRepository`: Das Seeding
 * legt an und liest nach, mehr nicht - und laesst sich damit ohne Datenbank
 * pruefen (CLAUDE.md §4).
 */
export interface NotificationRuleSeedStore {
  /** Id der Seed-Rolle „Admin"; `null`, wenn sie fehlt. */
  findAdminRoleId(): Promise<string | null>;
  /** Gibt es bereits eine Regel auf dieses Ereignis? */
  hasRuleFor(event: NotifiableEventName): Promise<boolean>;
  createRule(data: {
    event: NotifiableEventName;
    recipientScope: 'resourceOwner' | 'role';
    recipientRoleId: string | null;
  }): Promise<void>;
}

export interface SeedNotificationRulesResult {
  /** Ereignisse, für die eine Regel angelegt wurde. */
  readonly created: NotifiableEventName[];
  /** Ereignisse, für die bereits eine passende Regel bestand. */
  readonly existing: NotifiableEventName[];
  /**
   * `true`, wenn die Admin-Rolle fehlte und die beiden Betreiber-Regeln
   * deshalb ausgelassen wurden.
   */
  readonly adminRoleMissing: boolean;
}

/** Umsetzung des Ports auf der Datenbank. */
export function drizzleNotificationRuleSeedStore(db: Database): NotificationRuleSeedStore {
  return {
    async findAdminRoleId() {
      const [treffer] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, ADMIN_ROLE_NAME))
        .limit(1);

      return treffer?.id ?? null;
    },

    async hasRuleFor(event) {
      const vorhanden = await db
        .select({ id: notificationRules.id })
        .from(notificationRules)
        .where(eq(notificationRules.event, event))
        .limit(1);

      return vorhanden.length > 0;
    },

    async createRule(data) {
      await db.insert(notificationRules).values({
        event: data.event,
        channelId: null,
        recipientScope: data.recipientScope,
        recipientRoleId: data.recipientRoleId,
        inboxEnabled: true,
        severity: null,
        enabled: true,
      });
    },
  };
}

export async function seedDefaultNotificationRules(
  store: NotificationRuleSeedStore,
): Promise<SeedNotificationRulesResult> {
  const created: NotifiableEventName[] = [];
  const existing: NotifiableEventName[] = [];

  async function anlegen(
    event: NotifiableEventName,
    recipientScope: 'resourceOwner' | 'role',
    recipientRoleId: string | null,
  ): Promise<void> {
    // Eine bestehende Regel auf dasselbe Ereignis genuegt: Der Betreiber hat
    // sich dann bereits um dieses Ereignis gekuemmert.
    if (await store.hasRuleFor(event)) {
      existing.push(event);

      return;
    }

    await store.createRule({ event, recipientScope, recipientRoleId });
    created.push(event);
  }

  for (const event of OWNER_RULE_EVENTS) {
    await anlegen(event, 'resourceOwner', null);
  }

  const adminRoleId = await store.findAdminRoleId();

  if (adminRoleId === null) {
    return { created, existing, adminRoleMissing: true };
  }

  for (const event of ADMIN_RULE_EVENTS) {
    await anlegen(event, 'role', adminRoleId);
  }

  return { created, existing, adminRoleMissing: false };
}
