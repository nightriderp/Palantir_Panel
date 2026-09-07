import { describe, expect, it } from 'vitest';
import {
  type ChatViewState,
  type ThreadState,
  applyConversationRead,
  applyMessageDeleted,
  applyMessageSent,
  conversationPreview,
  emptyChatState,
  knowsConversation,
  markConversationRead,
  markMessageReported,
  setConversations,
  setThreadPage,
  sortConversations,
  totalUnread,
  unreadOf,
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

/**
 * Ungelesen-Zähler einer Konversation, so wie ihn die Liste anzeigt.
 *
 * Bewusst über die Konversation selbst gelesen und nicht über ein zweites Feld
 * im Zustand: Genau diese eine Quelle ist der Gegenstand von frontend-lib-06.
 * Wirft, wenn die Konversation gar nicht in der Übersicht steht – ein Zähler
 * ohne zugehörige Zeile ist kein gültiges Ergebnis.
 */
function unreadIn(state: ChatViewState, id: string): number {
  const found = state.conversations.find((entry) => entry.id === id);
  if (!found) throw new Error(`Konversation ${id} steht nicht in der Übersicht`);
  return unreadOf(found);
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
    let state = stateWith(conversation({ id: 'c1', unreadCount: 0 }));

    state = applyMessageSent(state, 'c1', message({ id: 'm10', senderId: 'u2' }), {
      activeConversationId: null,
      viewerId: VIEWER,
    });

    expect(unreadIn(state, 'c1')).toBe(1);
    expect(totalUnread(state)).toBe(1);
  });

  /*
   * Der Zähler wächst auf dem Serverstand weiter, statt bei 1 neu anzufangen:
   * Wer auf einem anderen Gerät drei ungelesene Nachrichten liegen hat, sieht
   * nach der vierten „4" und nicht „1" (Finding frontend-lib-06).
   */
  it('rechnet auf dem serverseitigen Stand weiter, statt lokal bei null zu beginnen', () => {
    let state = stateWith(conversation({ id: 'c1', unreadCount: 3 }));

    state = applyMessageSent(state, 'c1', message({ id: 'm4', senderId: 'u2' }), {
      activeConversationId: null,
      viewerId: VIEWER,
    });

    expect(unreadIn(state, 'c1')).toBe(4);
  });

  it('zählt weder eigene Nachrichten noch solche in der offenen Konversation', () => {
    let state = stateWith(conversation({ id: 'c1', unreadCount: 0 }));

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

    expect(unreadIn(state, 'c1')).toBe(0);
  });

  it('zählt eine live nachgereichte Nachricht nicht doppelt', () => {
    let state = setThreadPage(
      stateWith(conversation({ id: 'c1', unreadCount: 0 })),
      'c1',
      page(),
      'replace',
    );
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
    expect(unreadIn(state, 'c1')).toBe(1);
  });

  /*
   * Unbekannte Konversation (Finding event-flow-14): Der Gruppen-Chat eines
   * gerade angelegten Servers steht noch nicht in der Übersicht, weil B7 dafür
   * kein `conversation.created` schickt. Früher wuchs hier `unread[id]` – ein
   * Zähler zu einer Zeile, die es nicht gibt, und damit für niemanden sichtbar.
   * Jetzt bleibt die Übersicht unberührt; die Ansicht erkennt den Fall über
   * `knowsConversation` und lädt die Liste nach.
   */
  it('erfindet für eine unbekannte Konversation weder Zeile noch Zähler', () => {
    const state = stateWith(conversation({ id: 'c1', unreadCount: 0 }));

    const next = applyMessageSent(
      state,
      'unbekannt',
      message({ id: 'm99', conversationId: 'unbekannt', senderId: 'u2' }),
      { activeConversationId: null, viewerId: VIEWER },
    );

    expect(knowsConversation(next, 'unbekannt')).toBe(false);
    expect(next.conversations).toHaveLength(1);
    expect(totalUnread(next)).toBe(0);
  });

  it('schreibt einen bereits geladenen Verlauf auch dann fort, wenn die Zeile fehlt', () => {
    // Kann vorkommen, wenn eine geöffnete Konversation aus der Liste gefallen
    // ist: Der offene Verlauf soll die Nachricht trotzdem zeigen.
    const state = setThreadPage(emptyChatState(), 'c9', page({ conversationId: 'c9' }), 'replace');

    const next = applyMessageSent(
      state,
      'c9',
      message({ id: 'm1', conversationId: 'c9', senderId: 'u2' }),
      { activeConversationId: 'c9', viewerId: VIEWER },
    );

    expect(threadOf(next, 'c9').messages.map((m) => m.id)).toEqual(['m1']);
    expect(next.conversations).toHaveLength(0);
  });
});

describe('unreadOf', () => {
  it('behandelt ein fehlendes unreadCount wie null – das Feld ist im Vertrag optional', () => {
    expect(unreadOf(conversation({ id: 'c1' }))).toBe(0);
  });

  it('liefert den Wert aus dem DTO', () => {
    expect(unreadOf(conversation({ id: 'c1', unreadCount: 7 }))).toBe(7);
  });
});

describe('setConversations', () => {
  /*
   * Kern von frontend-lib-06: Der Zähler kommt mit der Liste vom Server. Zuvor
   * lag er in einem lokalen `state.unread`, das nach dem Laden leer war – die
   * Seitenleiste zeigte „3", die Konversationsliste nichts.
   */
  it('übernimmt die Zähler aus den geladenen DTOs', () => {
    const state = stateWith(
      conversation({ id: 'a', unreadCount: 3, createdAt: '2026-08-28T09:00:00.000Z' }),
      conversation({ id: 'b', unreadCount: 0, createdAt: '2026-08-28T08:00:00.000Z' }),
    );

    expect(unreadIn(state, 'a')).toBe(3);
    expect(unreadIn(state, 'b')).toBe(0);
    expect(totalUnread(state)).toBe(3);
  });

  it('überschreibt einen vorläufig hochgezählten Stand mit dem Serverwert', () => {
    let state = stateWith(conversation({ id: 'c1', unreadCount: 0 }));
    state = applyMessageSent(state, 'c1', message({ id: 'm1', senderId: 'u2' }), {
      activeConversationId: null,
      viewerId: VIEWER,
    });
    expect(unreadIn(state, 'c1')).toBe(1);

    // Erneutes Laden der Liste – der Server hat den Lesestand inzwischen anders.
    state = setConversations(state, [conversation({ id: 'c1', unreadCount: 0 })]);

    expect(unreadIn(state, 'c1')).toBe(0);
  });
});

describe('markConversationRead', () => {
  it('setzt den Zähler einer Konversation zurück', () => {
    let state = stateWith(conversation({ id: 'c1', unreadCount: 0 }));
    state = applyMessageSent(state, 'c1', message({ senderId: 'u2' }), {
      activeConversationId: null,
      viewerId: VIEWER,
    });
    expect(unreadIn(state, 'c1')).toBe(1);

    state = markConversationRead(state, 'c1');
    expect(unreadIn(state, 'c1')).toBe(0);
  });

  it('setzt auch den vom Server geladenen Zähler zurück', () => {
    const state = markConversationRead(stateWith(conversation({ id: 'c1', unreadCount: 5 })), 'c1');

    expect(unreadIn(state, 'c1')).toBe(0);
    expect(totalUnread(state)).toBe(0);
  });

  it('lässt den Zustand unverändert, wenn nichts ungelesen ist', () => {
    const state = stateWith(conversation({ id: 'c1', unreadCount: 0 }));

    expect(markConversationRead(state, 'c1')).toBe(state);
    expect(markConversationRead(state, 'unbekannt')).toBe(state);
  });
});

/*
 * `conversation.read` kommt an alle Verbindungen desselben Kontos: Wer auf dem
 * Handy liest, dessen Zähler fällt auch im offenen Browser-Tab. Zuvor wurde das
 * Ereignis in `MessagesView` verworfen und der lokale Zähler blieb stehen
 * (Finding frontend-lib-06).
 */
describe('applyConversationRead', () => {
  it('übernimmt Zähler und Lesezeitpunkt aus dem Ereignis', () => {
    const state = applyConversationRead(
      stateWith(conversation({ id: 'c1', unreadCount: 4 })),
      'c1',
      '2026-08-28T12:00:00.000Z',
      0,
    );

    expect(unreadIn(state, 'c1')).toBe(0);
    expect(firstConversation(state).lastReadAt).toBe('2026-08-28T12:00:00.000Z');
  });

  it('übernimmt auch einen Rest, wenn zwischenzeitlich etwas eintraf', () => {
    const state = applyConversationRead(
      stateWith(conversation({ id: 'c1', unreadCount: 4 })),
      'c1',
      '2026-08-28T12:00:00.000Z',
      2,
    );

    expect(unreadIn(state, 'c1')).toBe(2);
  });

  it('ignoriert ein Ereignis zu einer unbekannten Konversation', () => {
    const state = stateWith(conversation({ id: 'c1', unreadCount: 4 }));

    expect(applyConversationRead(state, 'fremd', '2026-08-28T12:00:00.000Z', 0)).toBe(state);
  });
});

describe('knowsConversation', () => {
  it('unterscheidet geladene von unbekannten Konversationen', () => {
    const state = stateWith(conversation({ id: 'c1' }));

    expect(knowsConversation(state, 'c1')).toBe(true);
    expect(knowsConversation(state, 'c2')).toBe(false);
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
