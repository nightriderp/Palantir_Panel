import { type NotifiableEventName } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_RULE_EVENTS,
  type NotificationRuleSeedStore,
  OWNER_RULE_EVENTS,
  seedDefaultNotificationRules,
} from './seed.js';

const ADMIN_ROLE_ID = '11111111-1111-4111-8111-111111111111';

/** Regeln im Speicher – dieselbe Schnittstelle wie die Tabelle. */
function fakeStore(
  options: { adminRoleId?: string | null; vorhanden?: NotifiableEventName[] } = {},
) {
  const angelegt: {
    event: NotifiableEventName;
    recipientScope: string;
    recipientRoleId: string | null;
  }[] = [];
  const bestehend = new Set<NotifiableEventName>(options.vorhanden ?? []);

  const store: NotificationRuleSeedStore = {
    findAdminRoleId: () =>
      Promise.resolve(options.adminRoleId === undefined ? ADMIN_ROLE_ID : options.adminRoleId),
    hasRuleFor: (event) => Promise.resolve(bestehend.has(event)),
    createRule: (data) => {
      angelegt.push(data);
      bestehend.add(data.event);

      return Promise.resolve();
    },
  };

  return { store, angelegt };
}

describe('Standard-Benachrichtigungsregeln (Gefundener Punkt 82)', () => {
  it('legt Besitzer- und Admin-Regeln an', async () => {
    const { store, angelegt } = fakeStore();

    const ergebnis = await seedDefaultNotificationRules(store);

    expect(ergebnis.created).toEqual([...OWNER_RULE_EVENTS, ...ADMIN_RULE_EVENTS]);
    expect(ergebnis.adminRoleMissing).toBe(false);

    const besitzer = angelegt.filter((regel) => regel.recipientScope === 'resourceOwner');
    const admins = angelegt.filter((regel) => regel.recipientScope === 'role');

    expect(besitzer.map((regel) => regel.event)).toEqual([...OWNER_RULE_EVENTS]);
    expect(admins.every((regel) => regel.recipientRoleId === ADMIN_ROLE_ID)).toBe(true);
  });

  it('ist idempotent – ein zweiter Lauf legt nichts nach', async () => {
    const { store, angelegt } = fakeStore();

    await seedDefaultNotificationRules(store);
    const zweiter = await seedDefaultNotificationRules(store);

    expect(zweiter.created).toEqual([]);
    expect(zweiter.existing).toEqual([...OWNER_RULE_EVENTS, ...ADMIN_RULE_EVENTS]);
    expect(angelegt).toHaveLength(OWNER_RULE_EVENTS.length + ADMIN_RULE_EVENTS.length);
  });

  it('lässt eine vom Betreiber geänderte Regel in Ruhe', async () => {
    // Wer eine Vorgabe abgeschaltet oder umgebaut hat, soll sie nicht
    // zurückbekommen – deshalb zählt allein, ob es zum Ereignis eine Regel gibt.
    const { store, angelegt } = fakeStore({ vorhanden: ['server.crashed'] });

    const ergebnis = await seedDefaultNotificationRules(store);

    expect(ergebnis.existing).toContain('server.crashed');
    expect(angelegt.map((regel) => regel.event)).not.toContain('server.crashed');
  });

  it('lässt die Admin-Regeln aus, wenn die Rolle fehlt', async () => {
    const { store, angelegt } = fakeStore({ adminRoleId: null });

    const ergebnis = await seedDefaultNotificationRules(store);

    expect(ergebnis.adminRoleMissing).toBe(true);
    expect(ergebnis.created).toEqual([...OWNER_RULE_EVENTS]);
    expect(angelegt.every((regel) => regel.recipientScope === 'resourceOwner')).toBe(true);
  });
});
