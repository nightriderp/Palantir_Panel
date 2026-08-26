/**
 * Chat-Dienst: Konversationen, Nachrichten und Live-Zustellung.
 *
 * Der Schwerpunkt liegt auf der Schranke: Jeder Vorgang muss an derselben
 * Teilnahmeprüfung scheitern, auch der eines Owners.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ChatError } from './errors.js';
import { type ChatService, createChatService } from './service.js';
import {
  ALEX,
  BEA,
  CHRIS,
  MOD,
  SERVER_ID,
  type InMemoryChatRepository,
  type RecordingDelivery,
  actorWith,
  ctxFor,
  fakeServerMembership,
  fakeUserDirectory,
  inMemoryChatRepository,
  ownerActor,
  recordingDelivery,
  steppingClock,
} from './test-doubles.js';

const SERVER = { id: SERVER_ID, name: 'Minecraft-Welt', ownerId: ALEX };

const NAMEN = {
  [ALEX]: { displayName: 'Alex' },
  [BEA]: { displayName: 'Bea' },
  [CHRIS]: { displayName: 'Chris' },
  [MOD]: { displayName: 'Mod' },
};

let repository: InMemoryChatRepository;
let delivery: RecordingDelivery;
let chat: ChatService;

beforeEach(() => {
  const clock = steppingClock();

  repository = inMemoryChatRepository(clock);
  delivery = recordingDelivery();
  chat = createChatService({
    repository,
    users: fakeUserDirectory(NAMEN),
    servers: fakeServerMembership([SERVER], { [SERVER_ID]: [BEA] }),
    delivery,
    clock,
  });
});

async function dmZwischenAlexUndBea(): Promise<string> {
  const conversation = await chat.openDirectConversation(ctxFor(ALEX), BEA);

  return conversation.id;
}

describe('Direktnachrichten öffnen', () => {
  it('legt die Unterhaltung beim ersten Mal an und findet sie danach wieder', async () => {
    const erste = await chat.openDirectConversation(ctxFor(ALEX), BEA);
    const zweite = await chat.openDirectConversation(ctxFor(BEA), ALEX);

    expect(zweite.id).toBe(erste.id);
    expect(repository.conversations).toHaveLength(1);
  });

  it('meldet dem Gegenüber die neue Unterhaltung aus dessen Sicht', async () => {
    await chat.openDirectConversation(ctxFor(ALEX), BEA);

    const zustellung = delivery.delivered.find((entry) => entry.userId === BEA);

    expect(zustellung?.frame.event).toBe('conversation.created');
    expect((zustellung?.frame.data as { conversation: { title: string } }).conversation.title).toBe(
      'Alex',
    );
  });

  it('lehnt ein unbekanntes Konto mit USER_NOT_FOUND ab', async () => {
    await expect(
      chat.openDirectConversation(ctxFor(ALEX), CHRIS.replace('c3', 'ff')),
    ).rejects.toThrowError(new ChatError('USER_NOT_FOUND'));
  });

  it('lehnt ein noch nicht freigeschaltetes Konto ab', async () => {
    const dienst = createChatService({
      repository,
      users: fakeUserDirectory({ ...NAMEN, [CHRIS]: { displayName: 'Chris', approved: false } }),
      servers: fakeServerMembership([SERVER]),
    });

    await expect(dienst.openDirectConversation(ctxFor(ALEX), CHRIS)).rejects.toThrowError(
      new ChatError('CONVERSATION_RECIPIENT_NOT_ALLOWED'),
    );
  });
});

describe('Nachrichten lesen und schreiben', () => {
  it('stellt eine Nachricht an alle Teilnehmer zu, den Absender eingeschlossen', async () => {
    const conversationId = await dmZwischenAlexUndBea();

    await chat.sendMessage(ctxFor(ALEX), conversationId, { content: 'Hallo Bea' });

    expect(delivery.eventsFor(BEA)).toContain('message.sent');
    expect(delivery.eventsFor(ALEX)).toContain('message.sent');
  });

  it('liefert den Verlauf aufsteigend nach Zeit', async () => {
    const conversationId = await dmZwischenAlexUndBea();

    await chat.sendMessage(ctxFor(ALEX), conversationId, { content: 'eins' });
    await chat.sendMessage(ctxFor(BEA), conversationId, { content: 'zwei' });

    const seite = await chat.listMessages(ctxFor(ALEX), conversationId, { limit: 50 });

    expect(seite.messages.map((message) => message.content)).toEqual(['eins', 'zwei']);
    expect(seite.nextCursor).toBeNull();
  });

  it('setzt einen Cursor, solange es ältere Nachrichten gibt', async () => {
    const conversationId = await dmZwischenAlexUndBea();

    for (const text of ['eins', 'zwei', 'drei']) {
      await chat.sendMessage(ctxFor(ALEX), conversationId, { content: text });
    }

    const seite = await chat.listMessages(ctxFor(ALEX), conversationId, { limit: 2 });

    expect(seite.messages.map((message) => message.content)).toEqual(['zwei', 'drei']);
    expect(seite.nextCursor).toBe(seite.messages[0]?.id);
  });

  /** Die Kernaussage: Ein Unbeteiligter kommt an keinen Verlauf, egal mit welchen Rechten. */
  it('verweigert Unbeteiligten den Verlauf – auch dem Owner und einem Moderator', async () => {
    const conversationId = await dmZwischenAlexUndBea();

    for (const ctx of [
      ctxFor(CHRIS),
      ctxFor(MOD, actorWith('message.moderate')),
      ctxFor(CHRIS, ownerActor()),
    ]) {
      await expect(chat.listMessages(ctx, conversationId, { limit: 50 })).rejects.toThrowError(
        new ChatError('CONVERSATION_NOT_FOUND'),
      );
      await expect(chat.getConversation(ctx, conversationId)).rejects.toThrowError(
        new ChatError('CONVERSATION_NOT_FOUND'),
      );
      await expect(
        chat.sendMessage(ctx, conversationId, { content: 'hallo' }),
      ).rejects.toThrowError(new ChatError('CONVERSATION_NOT_FOUND'));
    }
  });

  it('verlangt für jeden Vorgang ein angemeldetes Konto', async () => {
    const conversationId = await dmZwischenAlexUndBea();
    const anonym = ctxFor('', actorWith());

    await expect(
      chat.listMessages({ ...anonym, userId: null }, conversationId, { limit: 50 }),
    ).rejects.toThrowError(new ChatError('AUTH_REQUIRED'));
  });
});

describe('Eigene Nachricht löschen', () => {
  it('markiert sie als gelöscht und meldet das den Teilnehmern', async () => {
    const conversationId = await dmZwischenAlexUndBea();
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversationId, { content: 'Ups' });

    await chat.deleteOwnMessage(ctxFor(ALEX), nachricht.id);

    const seite = await chat.listMessages(ctxFor(BEA), conversationId, { limit: 50 });

    expect(seite.messages[0]?.deletedAt).not.toBeNull();
    expect(seite.messages[0]?.content).toBe('');
    expect(seite.messages[0]?.deletedByModerator).toBe(false);
    expect(delivery.eventsFor(BEA)).toContain('message.deleted');
  });

  it('lässt fremde Nachrichten nicht löschen – auch nicht mit message.moderate', async () => {
    const conversationId = await dmZwischenAlexUndBea();
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversationId, { content: 'Hallo' });

    await expect(chat.deleteOwnMessage(ctxFor(BEA), nachricht.id)).rejects.toThrowError(
      new ChatError('MESSAGE_NOT_FOUND'),
    );

    await expect(
      chat.deleteOwnMessage(ctxFor(MOD, actorWith('message.moderate')), nachricht.id),
    ).rejects.toThrowError(new ChatError('CONVERSATION_NOT_FOUND'));
  });

  it('lehnt das zweite Löschen mit MESSAGE_ALREADY_DELETED ab', async () => {
    const conversationId = await dmZwischenAlexUndBea();
    const nachricht = await chat.sendMessage(ctxFor(ALEX), conversationId, { content: 'Hallo' });

    await chat.deleteOwnMessage(ctxFor(ALEX), nachricht.id);

    await expect(chat.deleteOwnMessage(ctxFor(ALEX), nachricht.id)).rejects.toThrowError(
      new ChatError('MESSAGE_ALREADY_DELETED'),
    );
  });
});

describe('Server-Chat', () => {
  it('entsteht beim ersten Zugriff und trägt den Servernamen', async () => {
    const conversation = await chat.openServerConversation(ctxFor(BEA), SERVER_ID);

    expect(conversation.type).toBe('server_chat');
    expect(conversation.title).toBe('Minecraft-Welt');
    expect(conversation.serverId).toBe(SERVER_ID);
  });

  it('entsteht nur einmal je Server', async () => {
    const erste = await chat.openServerConversation(ctxFor(ALEX), SERVER_ID);
    const zweite = await chat.openServerConversation(ctxFor(BEA), SERVER_ID);

    expect(zweite.id).toBe(erste.id);
  });

  it('bleibt für Nichtmitglieder verschlossen, auch nachdem er entstanden ist', async () => {
    await chat.openServerConversation(ctxFor(ALEX), SERVER_ID);

    await expect(chat.openServerConversation(ctxFor(CHRIS), SERVER_ID)).rejects.toThrowError(
      new ChatError('CONVERSATION_NOT_FOUND'),
    );
  });

  it('meldet einen unbekannten Server als SERVER_NOT_FOUND', async () => {
    await expect(
      chat.openServerConversation(ctxFor(ALEX), SERVER_ID.replace('5e', 'ee')),
    ).rejects.toThrowError(new ChatError('SERVER_NOT_FOUND'));
  });
});

describe('Übersicht der Konversationen', () => {
  it('zeigt nur, woran der Aufrufer teilnimmt', async () => {
    await chat.openDirectConversation(ctxFor(ALEX), BEA);
    await chat.openServerConversation(ctxFor(ALEX), SERVER_ID);

    const vonChris = await chat.listConversations(ctxFor(CHRIS));
    const vonBea = await chat.listConversations(ctxFor(BEA));

    expect(vonChris).toEqual([]);
    expect(vonBea).toHaveLength(2);
  });

  it('sortiert die jüngste Aktivität nach oben', async () => {
    const dmId = await dmZwischenAlexUndBea();

    await chat.openServerConversation(ctxFor(ALEX), SERVER_ID);
    await chat.sendMessage(ctxFor(ALEX), dmId, { content: 'zuletzt hier' });

    const liste = await chat.listConversations(ctxFor(ALEX));

    expect(liste[0]?.id).toBe(dmId);
    expect(liste[0]?.lastMessage?.content).toBe('zuletzt hier');
  });
});
