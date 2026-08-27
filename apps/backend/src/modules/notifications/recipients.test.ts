import type { NotificationEvent } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { directRecipientsOf, resolveRecipients } from './recipients.js';
import { fakeDirectory, serverEvent } from './test-doubles.js';

const OWNER = 'owner-1';
const MEMBER_A = 'member-a';
const MEMBER_B = 'member-b';

const registration: NotificationEvent = {
  event: 'user.registered',
  payload: {
    at: '2026-08-26T12:00:00.000Z',
    actorId: null,
    userId: 'usr',
    displayName: 'Neuling',
    awaitingApproval: true,
  },
};

describe('Empfängerkreise aus der Nutzlast (Lastenheft §3.6)', () => {
  it('trifft beim Besitzer genau ihn', () => {
    const event = serverEvent('server.crashed', {
      ownerId: OWNER,
      memberUserIds: [MEMBER_A],
    });

    expect(directRecipientsOf(event, 'resourceOwner')).toEqual([OWNER]);
  });

  it('nimmt bei Servermitgliedern Besitzer und Mitverwalter', () => {
    const event = serverEvent('server.crashed', {
      ownerId: OWNER,
      memberUserIds: [MEMBER_A, MEMBER_B],
    });

    expect(directRecipientsOf(event, 'serverMembers')).toEqual([OWNER, MEMBER_A, MEMBER_B]);
  });

  /** „Niemand" und „weiß ich hier nicht" sind verschiedene Antworten. */
  it('meldet für Rolle und alle Nutzer, dass es das Verzeichnis braucht', () => {
    const event = serverEvent();

    expect(directRecipientsOf(event, 'role')).toBeNull();
    expect(directRecipientsOf(event, 'allUsers')).toBeNull();
  });

  it('trifft bei einer Registrierung keinen Besitzer – die gibt es dort nicht', () => {
    expect(directRecipientsOf(registration, 'resourceOwner')).toEqual([]);
  });

  it('trifft bei einer Node-Warnung keinen Besitzer', () => {
    const nodeWarning: NotificationEvent = {
      event: 'resource.low',
      payload: {
        at: '2026-08-26T12:00:00.000Z',
        actorId: null,
        scope: 'node',
        resource: 'disk',
        nodeId: 'node-1',
        serverId: null,
        ownerId: null,
        usedPercent: 90,
        thresholdPercent: 85,
      },
    };

    expect(directRecipientsOf(nodeWarning, 'resourceOwner')).toEqual([]);
  });
});

describe('Auflösung über das Verzeichnis', () => {
  it('holt bei „alle Nutzer" die freigeschalteten Konten', async () => {
    const directory = fakeDirectory({ activeUserIds: [OWNER, MEMBER_A] });

    await expect(resolveRecipients(registration, 'allUsers', null, directory)).resolves.toEqual([
      OWNER,
      MEMBER_A,
    ]);
  });

  it('holt bei „Rolle" die Träger der Rolle', async () => {
    const directory = fakeDirectory({ roleMembers: { 'role-1': [MEMBER_A, MEMBER_B] } });

    await expect(resolveRecipients(registration, 'role', 'role-1', directory)).resolves.toEqual([
      MEMBER_A,
      MEMBER_B,
    ]);
  });

  /**
   * Ein alter Datensatz ohne Rolle darf still niemanden treffen – ein Fehler
   * würde den auslösenden Vorgang gefährden.
   */
  it('trifft bei „Rolle" ohne Rolle niemanden, ohne zu scheitern', async () => {
    await expect(resolveRecipients(registration, 'role', null, fakeDirectory())).resolves.toEqual(
      [],
    );
  });

  it('stellt niemandem dieselbe Meldung zweimal zu', async () => {
    const event = serverEvent('server.crashed', {
      ownerId: OWNER,
      memberUserIds: [OWNER, MEMBER_A],
    });

    await expect(resolveRecipients(event, 'serverMembers', null, fakeDirectory())).resolves.toEqual(
      [OWNER, MEMBER_A],
    );
  });
});
