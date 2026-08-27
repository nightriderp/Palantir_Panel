/**
 * Sichtbarkeitsregeln – der Kern des Datenschutz-Prinzips aus Pflichtenheft §15.
 *
 * Diese Tests sind laut Arbeitsauftrag zwingend: Sie halten fest, wer welche
 * Konversation lesen darf, und dass daran auch ein Owner oder ein Moderator
 * nichts ändert.
 */

import { describe, expect, it } from 'vitest';
import { ChatError } from './errors.js';
import {
  ALEX,
  BEA,
  CHRIS,
  MOD,
  SERVER_ID,
  fakeServerMembership,
  inMemoryChatRepository,
} from './test-doubles.js';
import {
  assertDirectRecipientAllowed,
  assertParticipant,
  canSendMessage,
  canViewConversation,
  dmKeyFor,
  recipientsOf,
  resolveAudience,
  titleFor,
} from './visibility.js';

const SERVER = { id: SERVER_ID, name: 'Minecraft-Welt', ownerId: ALEX };

function deps(servers = fakeServerMembership([SERVER], { [SERVER_ID]: [BEA] })) {
  const repository = inMemoryChatRepository();

  return {
    repository,
    servers,
    audience: {
      servers,
      listDirectParticipants: (conversationId: string) =>
        repository.listDirectParticipants(conversationId),
    },
  };
}

describe('Direktnachrichten', () => {
  it('lässt genau die beiden Beteiligten lesen und schreiben', async () => {
    const { repository, audience } = deps();
    const conversation = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: dmKeyFor(ALEX, BEA),
      participantIds: [ALEX, BEA],
    });

    const resolved = await resolveAudience(audience, conversation);

    expect(canViewConversation(resolved, ALEX)).toBe(true);
    expect(canViewConversation(resolved, BEA)).toBe(true);
    expect(canSendMessage(resolved, ALEX)).toBe(true);
  });

  /** Der eigentliche Punkt: Unbeteiligte sehen nichts – auch nicht mit Rechten. */
  it('sperrt Unbeteiligte aus, auch einen Moderator', async () => {
    const { repository, audience } = deps();
    const conversation = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: dmKeyFor(ALEX, BEA),
      participantIds: [ALEX, BEA],
    });

    const resolved = await resolveAudience(audience, conversation);

    expect(canViewConversation(resolved, CHRIS)).toBe(false);
    expect(canViewConversation(resolved, MOD)).toBe(false);
    expect(canViewConversation(resolved, null)).toBe(false);
    expect(canSendMessage(resolved, MOD)).toBe(false);
  });

  it('meldet den Ausschluss als CONVERSATION_NOT_FOUND, nicht als PERMISSION_DENIED', async () => {
    const { repository, audience } = deps();
    const conversation = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: dmKeyFor(ALEX, BEA),
      participantIds: [ALEX, BEA],
    });

    const resolved = await resolveAudience(audience, conversation);

    expect(() => {
      assertParticipant(resolved, CHRIS);
    }).toThrowError(new ChatError('CONVERSATION_NOT_FOUND'));
  });

  it('bildet denselben Schlüssel, egal in welcher Reihenfolge die Konten kommen', () => {
    expect(dmKeyFor(ALEX, BEA)).toBe(dmKeyFor(BEA, ALEX));
  });

  it('trägt als Titel den Namen des Gegenübers', async () => {
    const { repository, audience } = deps();
    const conversation = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: dmKeyFor(ALEX, BEA),
      participantIds: [ALEX, BEA],
    });

    const resolved = await resolveAudience(audience, conversation);
    const names = new Map([
      [ALEX, 'Alex'],
      [BEA, 'Bea'],
    ]);

    expect(titleFor(resolved, ALEX, names)).toBe('Bea');
    expect(titleFor(resolved, BEA, names)).toBe('Alex');
  });
});

describe('Server-Chat', () => {
  it('umfasst Besitzer und Mitglieder des Servers', async () => {
    const { repository, audience } = deps();
    const conversation = await repository.createConversation({
      type: 'server_chat',
      serverId: SERVER_ID,
      dmKey: null,
      participantIds: [],
    });

    const resolved = await resolveAudience(audience, conversation);

    expect(canViewConversation(resolved, ALEX)).toBe(true);
    expect(canViewConversation(resolved, BEA)).toBe(true);
    expect(canViewConversation(resolved, CHRIS)).toBe(false);
  });

  /**
   * „Teilnehmerkreis folgt `ServerMember`" (Pflichtenheft §15): Wer aus dem
   * Server fliegt, ist im selben Moment aus dessen Chat draußen – ohne dass
   * jemand eine zweite Liste nachführen müsste.
   */
  it('folgt einer Mitgliederänderung sofort', async () => {
    const servers = fakeServerMembership([SERVER], { [SERVER_ID]: [BEA] });
    const { repository, audience } = deps(servers);
    const conversation = await repository.createConversation({
      type: 'server_chat',
      serverId: SERVER_ID,
      dmKey: null,
      participantIds: [],
    });

    expect(canViewConversation(await resolveAudience(audience, conversation), BEA)).toBe(true);

    servers.setMembers(SERVER_ID, []);

    expect(canViewConversation(await resolveAudience(audience, conversation), BEA)).toBe(false);
  });

  /** Ohne Server gibt es keinen Teilnehmerkreis – sicher ist hier „für niemanden". */
  it('ist ohne zugehörigen Server für niemanden lesbar', async () => {
    const { repository, audience } = deps(fakeServerMembership([], {}));
    const conversation = await repository.createConversation({
      type: 'server_chat',
      serverId: SERVER_ID,
      dmKey: null,
      participantIds: [],
    });

    const resolved = await resolveAudience(audience, conversation);

    expect(resolved.participantIds).toEqual([]);
    expect(canViewConversation(resolved, ALEX)).toBe(false);
  });

  it('führt den Besitzer nur einmal, auch wenn er zusätzlich Mitglied ist', async () => {
    const { repository, audience } = deps(
      fakeServerMembership([SERVER], { [SERVER_ID]: [ALEX, BEA] }),
    );
    const conversation = await repository.createConversation({
      type: 'server_chat',
      serverId: SERVER_ID,
      dmKey: null,
      participantIds: [],
    });

    const resolved = await resolveAudience(audience, conversation);

    expect(resolved.participantIds.filter((id) => id === ALEX)).toHaveLength(1);
  });

  it('trägt als Titel den Servernamen', async () => {
    const { repository, audience } = deps();
    const conversation = await repository.createConversation({
      type: 'server_chat',
      serverId: SERVER_ID,
      dmKey: null,
      participantIds: [],
    });

    const resolved = await resolveAudience(audience, conversation);

    expect(titleFor(resolved, BEA, new Map())).toBe('Minecraft-Welt');
  });
});

describe('Empfänger einer Zustellung', () => {
  it('liefert alle Teilnehmer, auf Wunsch ohne den Absender', async () => {
    const { repository, audience } = deps();
    const conversation = await repository.createConversation({
      type: 'dm',
      serverId: null,
      dmKey: dmKeyFor(ALEX, BEA),
      participantIds: [ALEX, BEA],
    });

    const resolved = await resolveAudience(audience, conversation);

    expect([...recipientsOf(resolved)].sort()).toEqual([ALEX, BEA].sort());
    expect(recipientsOf(resolved, ALEX)).toEqual([BEA]);
  });
});

describe('Freischaltung als Voraussetzung der Direktnachricht (Lastenheft §3.6)', () => {
  it('lässt freigeschaltete Konten zu', () => {
    expect(() => {
      assertDirectRecipientAllowed(ALEX, { id: BEA, banned: false, approved: true });
    }).not.toThrow();
  });

  it('lehnt das eigene Konto ab', () => {
    expect(() => {
      assertDirectRecipientAllowed(ALEX, { id: ALEX, banned: false, approved: true });
    }).toThrowError(ChatError);
  });

  it('lehnt wartende und gesperrte Konten ab', () => {
    expect(() => {
      assertDirectRecipientAllowed(ALEX, { id: BEA, banned: false, approved: false });
    }).toThrowError(new ChatError('CONVERSATION_RECIPIENT_NOT_ALLOWED'));

    expect(() => {
      assertDirectRecipientAllowed(ALEX, { id: BEA, banned: true, approved: true });
    }).toThrowError(new ChatError('CONVERSATION_RECIPIENT_NOT_ALLOWED'));
  });
});
