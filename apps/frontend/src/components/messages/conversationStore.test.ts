import { describe, expect, it } from 'vitest';
import {
  type ChatViewState,
  type ThreadState,
  applyMessageDeleted,
  applyMessageSent,
  conversationPreview,
  emptyChatState,
  markConversationRead,
  markMessageReported,
  setConversations,
  setThreadPage,
  sortConversations,
  totalUnread,
  upsertConversation,
} from './conversationStore';
import { conversation, message, page } from './testFixtures';

const VIEWER = 'u1';

function stateWith(...list: Parameters<typeof setConversations>[1]): ChatViewState {
  return setConversations(emptyChatState(), list);
}

/** Verlauf einer Konversation – wirft, wenn keiner geladen ist (Testkomfort bei `noUncheckedIndexedAccess`). */
function threadOf(state: ChatViewState, id = 'c1'): ThreadState {
  const thread = state.threads[id];
  if (!thread) throw new Error(`kein Verlauf für ${id}`);
  return thread;
}

/** Erste Konversation der Übersicht – wirft, wenn die Liste leer ist. */
function firstConversation(state: ChatViewState) {
  const [first] = state.conversations;
  if (!first) throw new Error('keine Konversation');
  return first;
}

describe('sortConversations', () => {
  it('setzt die jüngste Aktivität nach oben – Nachricht schlägt Entstehung', () => {
    const older = conversation({
      id: 'a',
      createdAt: '2026-08-28T08:00:00.000Z',
      lastMessage: message({ id: 'm-a', createdAt: '2026-08-28T08:30:00.000Z' }),
    });
    const newer = conversation({
      id: 'b',
      createdAt: '2026-08-28T07:00:00.000Z',
      lastMessage: message({ id: 'm-b', createdAt: '2026-08-28T12:00:00.000Z' }),
    });
    const empty = conversation({
      id: 'c',
      createdAt: '2026-08-28T09:00:00.000Z',
      lastMessage: null,
    });

    const sorted = sortConversations([older, newer, empty]);

    expect(sorted.map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('setThreadPage', () => {
  it('lädt einen Verlauf und merkt sich den Cursor', () => {
    const next = setThreadPage(
      stateWith(conversation()),
      'c1',
      page({ messages: [message({ id: 'm1' }), message({ id: 'm2' })], nextCursor: 'm1' }),
      'replace',
    );

    expect(threadOf(next).messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(threadOf(next).nextCursor).toBe('m1');
    expect(threadOf(next).loaded).toBe(true);
  });

  it('hängt ältere Seiten vorn an und entdoppelt nach Id', () => {
    let state = setThreadPage(
      stateWith(conversation()),
      'c1',
      page({ messages: [message({ id: 'm3', createdAt: '2026-08-28T10:02:00.000Z' })] }),
      'replace',
    );

    state = setThreadPage(
      state,
      'c1',
      page({
        messages: [
          message({ id: 'm1', createdAt: '2026-08-28T10:00:00.000Z' }),
          // dieselbe Nachricht, die schon geladen ist – darf nicht doppelt landen
          message({ id: 'm3', createdAt: '2026-08-28T10:02:00.000Z' }),
        ],
        nextCursor: null,
      }),
      'older',
    );

    expect(threadOf(state).messages.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(threadOf(state).nextCursor).toBeNull();
  });
});

describe('applyMessageSent', () => {
  it('aktualisiert Vorschau und Reihenfolge der Übersicht', () => {
    const a = conversation({ id: 'a', lastMessage: null, createdAt: '2026-08-28T08:00:00.000Z' });
    const b = conversation({ id: 'b', lastMessage: null, createdAt: '2026-08-28T09:00:00.000Z' });
    let state = stateWith(a, b);
    // Anfangs steht b oben (jünger entstanden).
    expect(firstConversation(state).id).toBe('b');

    state = applyMessageSent(
      state,
      'a',
      message({ id: 'x', conversationId: 'a', createdAt: '2026-08-28T10:00:00.000Z' }),
      { activeConversationId: null, viewerId: VIEWER },
    );

    expect(firstConversation(state).id).toBe('a');
    expect(conversationPreview(firstConversation(state))).toBe('Hallo!');
  });

  it('zählt fremde Nachrichten in nicht offenen Konversationen als ungelesen', () => {
    let state = stateWith(conversation({ id: 'c1' }));

    state = applyMessageSent(state, 'c1', message({ id: 'm10', senderId: 'u2' }), {
      activeConversationId: null,
      viewerId: VIEWER,
    });

    expect(state.unread.c1).toBe(1);
    expect(totalUnread(state)).toBe(1);
  });

  it('zählt weder eigene Nachrichten noch solche in der offenen Konversation', () => {
    let state = stateWith(conversation({ id: 'c1' }));

    // eigene Nachricht
    state = applyMessageSent(state, 'c1', message({ id: 'own', senderId: VIEWER }), {
      activeConversationId: null,
      viewerId: VIEWER,
    });
    // fremde, aber Konversation ist offen
    state = applyMessageSent(state, 'c1', message({ id: 'seen', senderId: 'u2' }), {
      activeConversationId: 'c1',
      viewerId: VIEWER,
    });

    expect(state.unread.c1 ?? 0).toBe(0);
  });

  it('zählt eine live nachgereichte Nachricht nicht doppelt', () => {
    let state = setThreadPage(stateWith(conversation({ id: 'c1' })), 'c1', page(), 'replace');
    const incoming = message({ id: 'dup', senderId: 'u2' });

    state = applyMessageSent(state, 'c1', incoming, {
      activeConversationId: null,
      viewerId: VIEWER,
    });
    state = applyMessageSent(state, 'c1', incoming, {
      activeConversationId: null,
      viewerId: VIEWER,
    });

    expect(threadOf(state).messages).toHaveLength(1);
    expect(state.unread.c1).toBe(1);
  });
});

describe('markConversationRead', () => {
  it('setzt den Zähler einer Konversation zurück', () => {
    let state = stateWith(conversation({ id: 'c1' }));
    state = applyMessageSent(state, 'c1', message({ senderId: 'u2' }), {
      activeConversationId: null,
      viewerId: VIEWER,
    });
    expect(state.unread.c1).toBe(1);

    state = markConversationRead(state, 'c1');
    expect(state.unread.c1).toBe(0);
  });
});

describe('applyMessageDeleted', () => {
  it('leert den Inhalt im Verlauf und in der Vorschau, ohne die Nachricht zu entfernen', () => {
    let state = setThreadPage(
      stateWith(conversation({ id: 'c1' })),
      'c1',
      page({ messages: [message({ id: 'm1', content: 'Geheim' })] }),
      'replace',
    );
    state = applyMessageSent(state, 'c1', message({ id: 'm1', content: 'Geheim' }), {
      activeConversationId: 'c1',
      viewerId: VIEWER,
    });

    state = applyMessageDeleted(state, 'c1', 'm1', '2026-08-28T11:00:00.000Z', true);

    const stored = threadOf(state).messages.find((m) => m.id === 'm1');
    expect(stored?.content).toBe('');
    expect(stored?.deletedAt).toBe('2026-08-28T11:00:00.000Z');
    expect(stored?.deletedByModerator).toBe(true);
    expect(conversationPreview(firstConversation(state))).toBe('Nachricht gelöscht');
  });
});

describe('upsertConversation', () => {
  it('ersetzt eine bestehende Konversation, statt sie zu doppeln', () => {
    let state = stateWith(conversation({ id: 'c1', title: 'Alt' }));
    state = upsertConversation(state, conversation({ id: 'c1', title: 'Neu' }));

    expect(state.conversations).toHaveLength(1);
    expect(firstConversation(state).title).toBe('Neu');
  });
});

describe('markMessageReported', () => {
  it('setzt reportedByViewer im Verlauf, damit die Melde-Schaltfläche verschwindet', () => {
    let state = setThreadPage(
      stateWith(conversation({ id: 'c1' })),
      'c1',
      page({ messages: [message({ id: 'm1', reportedByViewer: false })] }),
      'replace',
    );

    state = markMessageReported(state, 'c1', 'm1');

    const stored = threadOf(state).messages.find((m) => m.id === 'm1');
    expect(stored?.reportedByViewer).toBe(true);
  });
});

describe('conversationPreview', () => {
  it('nennt leere Chats beim Namen', () => {
    expect(conversationPreview(conversation({ lastMessage: null }))).toBe('Noch keine Nachrichten');
  });
});
