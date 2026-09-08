/**
 * Standard-Benachrichtigungsregeln der Ersteinrichtung (WORK_STATUS.md,
 * Gefundener Punkt 82; Lastenheft §3.6, Pflichtenheft §14).
 *
 * **Warum überhaupt Vorgaben.** Eine frische Installation hatte gar keine
 * Regeln – damit löste kein Ereignis irgendetwas aus, bis ein Admin die erste
 * Regel von Hand anlegte. Ein abgestürzter Server meldete sich also bei
 * niemandem, und das fiel erst auf, wenn jemand nachsah.
 *
 * **Warum genau diese sieben.** Sie decken die im Lastenheft §3.6 genannten
 * Fälle ab und niemanden darüber hinaus:
 *
 * - `server.crashed`, `server.failed`, `backup.failed`, `autoShutdown.triggered`
 *   gehen an den **Besitzer** der betroffenen Ressource – ihn betrifft es, und
 *   nur er kann etwas tun.
 * - `user.registered` geht an die **Admin-Rolle**: die Freischaltung neuer
 *   Konten ist eine Betreiberaufgabe.
 * - `resource.low` geht an **beide** (Fundpunkt 167). B4 rechnet die Warnung
 *   seit dem Anschluss der Server-Ebene eigens je Server aus und liefert dabei
 *   dessen `ownerId` mit – ohne Besitzer-Regel landete genau diese Warnung
 *   ausschließlich beim Administrator, und derjenige, dessen Kontingent
 *   volläuft, erfuhr nichts davon. Die Rollen-Regel bleibt daneben bestehen:
 *   Die Node-Warnung (`scope: 'node'`) hat keinen Besitzer und erreicht nur
 *   über sie jemanden.
 *
 * **Nur Inbox, kein externer Kanal.** Ein Discord-Kanal setzt eine Webhook-URL
 * voraus, die es bei der Ersteinrichtung noch nicht gibt. Die Inbox ist immer
 * da.
 *
 * **Idempotent und nicht bevormundend.** Angelegt wird eine Regel nur, wenn es
 * sie noch nicht gibt. Verglichen wird dabei die Kombination aus Ereignis **und
 * Empfängerkreis** – nicht mehr allein das Ereignis, denn seit `resource.low`
 * zwei Vorgaben hat, würde die erste die zweite verdecken. Bewusst *ohne* Rolle,
 * Kanal und `enabled` im Vergleich: Wer eine Vorgabe abschaltet, ihr einen
 * Discord-Kanal gibt oder sie auf eine andere Rolle umhängt, hat sich um diesen
 * Empfängerkreis gekümmert und bekommt die Vorgabe nicht danebengesetzt.
 */

import { type NotifiableEventName } from '@palantir/contracts';
import { and, eq } from 'drizzle-orm';
import { type Database } from '../../db/client.js';
import { notificationRules } from '../../db/schema/notifications.js';
import { roles } from '../../db/schema/rbac.js';

/** Name der Rolle, die die Betreiber-Meldungen bekommt (Seed-Rolle aus B2). */
const ADMIN_ROLE_NAME = 'Admin';

/**
 * Empfängerkreise, die als Vorgabe vorkommen.
 *
 * `serverMembers` und `allUsers` sind bewusst nicht dabei: Beide sind eine
 * Entscheidung des Betreibers, keine sinnvolle Voreinstellung.
 */
export type SeedRecipientScope = 'resourceOwner' | 'role';

/** Eine Vorgaberegel: Ereignis und Empfängerkreis – mehr unterscheidet sie nicht. */
export interface SeededNotificationRule {
  readonly event: NotifiableEventName;
  readonly recipientScope: SeedRecipientScope;
}

/** Ereignisse, die den Besitzer der betroffenen Ressource erreichen. */
export const OWNER_RULE_EVENTS: readonly NotifiableEventName[] = [
  'server.crashed',
  'server.failed',
  'backup.failed',
  'autoShutdown.triggered',
  // Die Server-Warnung aus B4 trägt den Besitzer in der Nutzlast (Fundpunkt 167).
  'resource.low',
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
  /**
   * Gibt es zu diesem Ereignis bereits eine Regel mit diesem Empfängerkreis?
   *
   * Der Empfängerkreis gehört zur Frage, seit `resource.low` zwei Vorgaben hat:
   * Die Frage allein nach dem Ereignis hätte die zweite nie angelegt.
   */
  hasRuleFor(event: NotifiableEventName, recipientScope: SeedRecipientScope): Promise<boolean>;
  createRule(data: {
    event: NotifiableEventName;
    recipientScope: SeedRecipientScope;
    recipientRoleId: string | null;
  }): Promise<void>;
}

export interface SeedNotificationRulesResult {
  /** Regeln, die angelegt wurden. */
  readonly created: SeededNotificationRule[];
  /** Regeln, für die bereits eine passende bestand. */
  readonly existing: SeededNotificationRule[];
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

    async hasRuleFor(event, recipientScope) {
      const vorhanden = await db
        .select({ id: notificationRules.id })
        .from(notificationRules)
        .where(
          and(
            eq(notificationRules.event, event),
            eq(notificationRules.recipientScope, recipientScope),
          ),
        )
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
  const created: SeededNotificationRule[] = [];
  const existing: SeededNotificationRule[] = [];

  async function anlegen(
    event: NotifiableEventName,
    recipientScope: SeedRecipientScope,
    recipientRoleId: string | null,
  ): Promise<void> {
    // Eine bestehende Regel auf dieselbe Kombination genuegt: Der Betreiber hat
    // sich dann bereits um diesen Empfaengerkreis gekuemmert.
    if (await store.hasRuleFor(event, recipientScope)) {
      existing.push({ event, recipientScope });

      return;
    }

    await store.createRule({ event, recipientScope, recipientRoleId });
    created.push({ event, recipientScope });
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
