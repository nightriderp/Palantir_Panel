import { type NotifiableEventName } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_RULE_EVENTS,
  type NotificationRuleSeedStore,
  OWNER_RULE_EVENTS,
  type SeedRecipientScope,
  type SeededNotificationRule,
  seedDefaultNotificationRules,
} from './seed.js';

const ADMIN_ROLE_ID = '11111111-1111-4111-8111-111111111111';

/** Erwartete Vorgaben in der Reihenfolge, in der der Lauf sie anlegt. */
const BESITZER_REGELN: SeededNotificationRule[] = OWNER_RULE_EVENTS.map((event) => ({
  event,
  recipientScope: 'resourceOwner',
}));
const ROLLEN_REGELN: SeededNotificationRule[] = ADMIN_RULE_EVENTS.map((event) => ({
  event,
  recipientScope: 'role',
}));

/** Regeln im Speicher – dieselbe Schnittstelle wie die Tabelle. */
function fakeStore(
  options: { adminRoleId?: string | null; vorhanden?: SeededNotificationRule[] } = {},
) {
  const angelegt: {
    event: NotifiableEventName;
    recipientScope: string;
    recipientRoleId: string | null;
  }[] = [];
  const schluessel = (event: NotifiableEventName, scope: SeedRecipientScope): string =>
    `${event}/${scope}`;
  const bestehend = new Set<string>(
    (options.vorhanden ?? []).map((regel) => schluessel(regel.event, regel.recipientScope)),
  );

  const store: NotificationRuleSeedStore = {
    findAdminRoleId: () =>
      Promise.resolve(options.adminRoleId === undefined ? ADMIN_ROLE_ID : options.adminRoleId),
    hasRuleFor: (event, recipientScope) =>
      Promise.resolve(bestehend.has(schluessel(event, recipientScope))),
    createRule: (data) => {
      angelegt.push(data);
      bestehend.add(schluessel(data.event, data.recipientScope));

      return Promise.resolve();
    },
  };

  return { store, angelegt };
}

describe('Standard-Benachrichtigungsregeln (Gefundener Punkt 82)', () => {
  it('legt Besitzer- und Admin-Regeln an', async () => {
    const { store, angelegt } = fakeStore();

    const ergebnis = await seedDefaultNotificationRules(store);

    expect(ergebnis.created).toEqual([...BESITZER_REGELN, ...ROLLEN_REGELN]);
    expect(ergebnis.adminRoleMissing).toBe(false);

    const besitzer = angelegt.filter((regel) => regel.recipientScope === 'resourceOwner');
    const admins = angelegt.filter((regel) => regel.recipientScope === 'role');

    expect(besitzer.map((regel) => regel.event)).toEqual([...OWNER_RULE_EVENTS]);
    expect(admins.every((regel) => regel.recipientRoleId === ADMIN_ROLE_ID)).toBe(true);
    // Nur die Rollen-Regeln tragen eine Rolle; eine Besitzer-Regel braucht keine.
    expect(besitzer.every((regel) => regel.recipientRoleId === null)).toBe(true);
  });

  /**
   * Fundpunkt 167: Die Warnung wird seit dem Anschluss der Server-Ebene (B4)
   * eigens je Server gerechnet und trägt dessen Besitzer mit. Ohne die zweite
   * Vorgabe erreichte sie ausschließlich die Admin-Rolle – derjenige, dessen
   * Kontingent volläuft, erfuhr nichts davon.
   */
  it('meldet knappe Ressourcen dem Besitzer und der Administration', async () => {
    const { store, angelegt } = fakeStore();

    await seedDefaultNotificationRules(store);

    const knapp = angelegt.filter((regel) => regel.event === 'resource.low');

    expect(knapp).toHaveLength(2);
    expect(knapp.map((regel) => regel.recipientScope).sort()).toEqual(['resourceOwner', 'role']);
  });

  it('ist idempotent – ein zweiter Lauf legt nichts nach', async () => {
    const { store, angelegt } = fakeStore();

    await seedDefaultNotificationRules(store);
    const zweiter = await seedDefaultNotificationRules(store);

    expect(zweiter.created).toEqual([]);
    expect(zweiter.existing).toEqual([...BESITZER_REGELN, ...ROLLEN_REGELN]);
    expect(angelegt).toHaveLength(OWNER_RULE_EVENTS.length + ADMIN_RULE_EVENTS.length);
  });

  /**
   * Eine Installation, die vor Fundpunkt 167 eingerichtet wurde, hat die
   * Rollen-Regel bereits. Der nächste Lauf soll ihr die fehlende
   * Besitzer-Regel nachreichen, ohne die bestehende zu verdoppeln.
   */
  it('reicht einer Bestandsinstallation die fehlende Besitzer-Regel nach', async () => {
    const { store, angelegt } = fakeStore({
      vorhanden: [
        ...BESITZER_REGELN.filter((regel) => regel.event !== 'resource.low'),
        ...ROLLEN_REGELN,
      ],
    });

    const ergebnis = await seedDefaultNotificationRules(store);

    expect(ergebnis.created).toEqual([{ event: 'resource.low', recipientScope: 'resourceOwner' }]);
    expect(angelegt).toHaveLength(1);
  });

  it('lässt eine vom Betreiber geänderte Regel in Ruhe', async () => {
    // Wer eine Vorgabe abgeschaltet oder umgebaut hat, soll sie nicht
    // zurückbekommen – deshalb zählt allein, ob es zu Ereignis und
    // Empfängerkreis eine Regel gibt.
    const { store, angelegt } = fakeStore({
      vorhanden: [{ event: 'server.crashed', recipientScope: 'resourceOwner' }],
    });

    const ergebnis = await seedDefaultNotificationRules(store);

    expect(ergebnis.existing).toEqual([
      { event: 'server.crashed', recipientScope: 'resourceOwner' },
    ]);
    expect(angelegt.map((regel) => regel.event)).not.toContain('server.crashed');
  });

  it('lässt die Admin-Regeln aus, wenn die Rolle fehlt', async () => {
    const { store, angelegt } = fakeStore({ adminRoleId: null });

    const ergebnis = await seedDefaultNotificationRules(store);

    expect(ergebnis.adminRoleMissing).toBe(true);
    expect(ergebnis.created).toEqual([...BESITZER_REGELN]);
    expect(angelegt.every((regel) => regel.recipientScope === 'resourceOwner')).toBe(true);
    // Die Besitzer-Warnung für knappe Ressourcen braucht die Rolle nicht.
    expect(angelegt.map((regel) => regel.event)).toContain('resource.low');
  });
});
