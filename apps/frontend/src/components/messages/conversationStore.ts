import { type ConversationDto, type MessageDto, type MessagePageDto } from '@palantir/contracts';

/**
 * Reiner Zustand der Chat-Ansicht (Arbeitspaket F5, Lastenheft §3.6).
 *
 * Die gesamte Logik, die den Zustand aus REST-Antworten und Live-Ereignissen
 * fortschreibt, liegt hier – ohne React, ohne WebSocket, ohne DOM. Dadurch ist
 * sie für sich prüfbar (CLAUDE.md §4), analog zu `notificationView.ts` (F6). Die
 * React-Ansicht hält diesen Zustand in `useState` und ruft nur diese Funktionen
 * auf; sie treffen jede Entscheidung darüber, was oben steht, was als ungelesen
 * gilt und wie eine gelöschte Nachricht aussieht.
 *
 * **„Ungelesen" kommt vom Server.** Der Zähler steht als `unreadCount` an der
 * jeweiligen `ConversationDto` und wird vom Backend geführt (B7, Endpunkt
 * `POST …/read` und Ereignis `conversation.read`); er gilt damit über Geräte und
 * Tabs hinweg. Ein zweiter, lokaler Zähler existiert bewusst **nicht** mehr
 * (Findings frontend-lib-06 und event-flow-14): Er lief mit der Seitenleiste
 * auseinander, blieb nach dem Lesen auf einem anderen Gerät stehen und zählte
 * Nachrichten für Konversationen mit, die gar nicht in der Liste standen.
 *
 * Live eintreffende fremde Nachrichten erhöhen `unreadCount` der bekannten
 * Konversation vorläufig weiter – sonst stünde die Liste bis zum nächsten Laden
 * still. Jede Serverantwort (Liste, `POST …/read`, `conversation.read`)
 * überschreibt diesen Zwischenstand mit dem echten Wert.
 */

export interface ThreadState {
  /** Geladene Nachrichten, aufsteigend nach `createdAt` (wie der Vertrag liefert). */
  messages: MessageDto[];
  /** Cursor für die nächste, ältere Seite; `null`, wenn der Anfang erreicht ist. */
  nextCursor: string | null;
  /** Wurde die erste Seite mindestens einmal geladen? */
  loaded: boolean;
}

export interface ChatViewState {
  /** Konversationen, absteigend nach jüngster Aktivität. */
  conversations: ConversationDto[];
  /** Geladene Verläufe je Konversations-Id. */
  threads: Record<string, ThreadState>;
}

export function emptyChatState(): ChatViewState {
  return { conversations: [], threads: {} };
}

/**
 * Ungelesene Nachrichten einer Konversation.
 *
 * `unreadCount` ist im Vertrag additiv und optional; fehlt es, ist es wie „0"
 * zu behandeln (siehe `chat.ts` in `@palantir/contracts`).
 */
export function unreadOf(conversation: ConversationDto): number {
  return conversation.unreadCount ?? 0;
}

/** Steht die Konversation in der geladenen Übersicht? */
export function knowsConversation(state: ChatViewState, conversationId: string): boolean {
  return state.conversations.some((entry) => entry.id === conversationId);
}

/** Zeitstempel, nach dem eine Konversation einsortiert wird: jüngste Nachricht, sonst Entstehung. */
export function activityTimestamp(conversation: ConversationDto): string {
  return conversation.lastMessage?.createdAt ?? conversation.createdAt;
}

/** Jüngste Aktivität zuerst – wie in der Backend-Übersicht (`service.ts` in B7). */
export function sortConversations(list: readonly ConversationDto[]): ConversationDto[] {
  return [...list].sort((a, b) => activityTimestamp(b).localeCompare(activityTimestamp(a)));
}

/** Nachrichten stabil aufsteigend nach `createdAt`, bei Gleichstand nach Id. */
function sortMessages(list: readonly MessageDto[]): MessageDto[] {
  return [...list].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

/** Doppelte Nachrichten (gleiche Id) verwerfen – die letzte gewinnt. */
function dedupeById(list: readonly MessageDto[]): MessageDto[] {
  const byId = new Map<string, MessageDto>();
  for (const message of list) byId.set(message.id, message);
  return [...byId.values()];
}

/**
 * Erstladung der Übersicht. Bestehende Verläufe bleiben erhalten – ein erneutes
 * Laden der Liste soll den offenen Verlauf nicht verwerfen. Die Ungelesen-Zähler
 * kommen mit den Konversationen selbst und sind damit auf dem Stand des Servers.
 */
export function setConversations(
  state: ChatViewState,
  list: readonly ConversationDto[],
): ChatViewState {
  return { ...state, conversations: sortConversations(list) };
}

/** Eine Konversation einfügen oder ersetzen und neu einsortieren. */
export function upsertConversation(
  state: ChatViewState,
  conversation: ConversationDto,
): ChatViewState {
  const others = state.conversations.filter((existing) => existing.id !== conversation.id);
  return { ...state, conversations: sortConversations([conversation, ...others]) };
}

/**
 * Eine geladene Nachrichtenseite einarbeiten.
 *
 * `mode: 'replace'` ist die Erstladung eines Verlaufs; `mode: 'older'` hängt
 * eine ältere Seite vorn an (Blättern nach oben). In beiden Fällen wird nach Id
 * entdoppelt, damit eine Nachricht, die zwischenzeitlich live eintraf, nicht
 * doppelt erscheint.
 */
export function setThreadPage(
  state: ChatViewState,
  conversationId: string,
  page: MessagePageDto,
  mode: 'replace' | 'older',
): ChatViewState {
  const current = state.threads[conversationId];
  const combined =
    mode === 'replace' || !current ? page.messages : [...page.messages, ...current.messages];

  const thread: ThreadState = {
    messages: sortMessages(dedupeById(combined)),
    nextCursor: page.nextCursor,
    loaded: true,
  };

  return { ...state, threads: { ...state.threads, [conversationId]: thread } };
}

export interface ApplyMessageOptions {
  /** Aktuell geöffnete Konversation; in ihr zählt nichts als ungelesen. */
  activeConversationId: string | null;
  /** Eigene Konto-Id; eigene Nachrichten zählen nie als ungelesen. */
  viewerId: string | null;
}

/**
 * Eine gesendete Nachricht einarbeiten – aus dem Live-Kanal **oder** als Antwort
 * auf das eigene Senden. Beide Wege laufen hier zusammen; die Entdopplung nach
 * Id sorgt dafür, dass die eigene Nachricht nicht zweimal erscheint, wenn sie
 * zusätzlich live zurückkommt.
 *
 * Steht die Konversation **nicht** in der Übersicht (etwa der Gruppen-Chat eines
 * gerade angelegten Servers, für den B7 kein `conversation.created` schickt),
 * bleibt die Übersicht unberührt – es wird kein Platzhalter erfunden und kein
 * Zähler hochgezählt: Beides wäre ohne zugehörige Zeile für niemanden sichtbar
 * (Finding event-flow-14). Ein bereits geladener Verlauf wird trotzdem
 * fortgeschrieben, damit eine geöffnete Konversation nichts verliert, falls sie
 * nur aus der Liste gefallen ist. Die Ansicht erkennt den Fall über
 * {@link knowsConversation} und lädt die Liste nach; sie kommt dann samt
 * serverseitigem `unreadCount` zurück, in dem diese Nachricht bereits steckt.
 */
export function applyMessageSent(
  state: ChatViewState,
  conversationId: string,
  message: MessageDto,
  options: ApplyMessageOptions,
): ChatViewState {
  const current = state.threads[conversationId];
  const alreadyKnown = current?.messages.some((existing) => existing.id === message.id) === true;

  let next = state;

  // Verlauf fortschreiben, wenn er geladen ist.
  if (current) {
    const thread: ThreadState = {
      ...current,
      messages: sortMessages(dedupeById([...current.messages, message])),
    };
    next = { ...next, threads: { ...next.threads, [conversationId]: thread } };
  }

  const conversation = next.conversations.find((entry) => entry.id === conversationId);
  if (!conversation) return next;

  // Ungelesen zählen: nur fremde Nachrichten in nicht offenen Konversationen,
  // und jede höchstens einmal. Vorläufiger Zwischenstand bis zur nächsten
  // Serverantwort – der maßgebliche Wert kommt von dort.
  const countsAsUnread =
    !alreadyKnown &&
    conversationId !== options.activeConversationId &&
    message.senderId !== options.viewerId;

  // Vorschau/Sortierung der Übersicht aktualisieren.
  return upsertConversation(next, {
    ...conversation,
    lastMessage: message,
    unreadCount: unreadOf(conversation) + (countsAsUnread ? 1 : 0),
  });
}

/** Maskiert eine Nachricht als gelöscht (leerer Inhalt, wie im Vertrag beschrieben). */
function markDeleted(message: MessageDto, deletedAt: string, byModerator: boolean): MessageDto {
  return { ...message, content: '', deletedAt, deletedByModerator: byModerator };
}

/**
 * Eine gelöschte Nachricht einarbeiten.
 *
 * Die Nachricht bleibt im Verlauf stehen (der Vertrag entfernt sie nicht,
 * sondern leert ihren Inhalt), damit der Verlauf nicht lückenhaft wird und eine
 * laufende Meldung ihren Bezug behält.
 */
export function applyMessageDeleted(
  state: ChatViewState,
  conversationId: string,
  messageId: string,
  deletedAt: string,
  byModerator: boolean,
): ChatViewState {
  let next = state;

  const current = next.threads[conversationId];
  if (current) {
    const thread: ThreadState = {
      ...current,
      messages: current.messages.map((message) =>
        message.id === messageId ? markDeleted(message, deletedAt, byModerator) : message,
      ),
    };
    next = { ...next, threads: { ...next.threads, [conversationId]: thread } };
  }

  const conversation = next.conversations.find((entry) => entry.id === conversationId);
  if (conversation?.lastMessage && conversation.lastMessage.id === messageId) {
    next = upsertConversation(next, {
      ...conversation,
      lastMessage: markDeleted(conversation.lastMessage, deletedAt, byModerator),
    });
  }

  return next;
}

/**
 * Merkt eine Nachricht als vom Betrachter gemeldet.
 *
 * Verhindert im Frontend die zweite Meldung derselben Nachricht durch dieselbe
 * Person – das Backend lehnt sie ohnehin ab (`MESSAGE_REPORT_DUPLICATE`), aber
 * die Schaltfläche soll gar nicht erst erneut erscheinen (wie `reportedByViewer`
 * im Vertrag).
 */
export function markMessageReported(
  state: ChatViewState,
  conversationId: string,
  messageId: string,
): ChatViewState {
  const current = state.threads[conversationId];
  if (!current) return state;

  const thread: ThreadState = {
    ...current,
    messages: current.messages.map((message) =>
      message.id === messageId ? { ...message, reportedByViewer: true } : message,
    ),
  };

  return { ...state, threads: { ...state.threads, [conversationId]: thread } };
}

/**
 * Öffnen einer Konversation setzt ihren Ungelesen-Zähler zurück.
 *
 * Nur die Anzeige – der maßgebliche Lesestand entsteht mit `POST …/read` im
 * Backend. Dessen Antwort (und das Ereignis `conversation.read` an die weiteren
 * Geräte desselben Kontos) überschreibt diesen Zwischenstand.
 */
export function markConversationRead(state: ChatViewState, conversationId: string): ChatViewState {
  const conversation = state.conversations.find((entry) => entry.id === conversationId);
  if (!conversation || unreadOf(conversation) === 0) return state;

  return upsertConversation(state, { ...conversation, unreadCount: 0 });
}

/**
 * Das Ereignis `conversation.read` einarbeiten (B7).
 *
 * Es kommt an **alle** Verbindungen desselben Kontos: Wer auf dem Handy liest,
 * dessen Zähler fällt auch im offenen Browser-Tab – ohne Nachladen. Zuvor wurde
 * das Ereignis im Frontend verworfen (Finding frontend-lib-06).
 */
export function applyConversationRead(
  state: ChatViewState,
  conversationId: string,
  lastReadAt: string,
  unreadCount: number,
): ChatViewState {
  const conversation = state.conversations.find((entry) => entry.id === conversationId);
  if (!conversation) return state;

  return upsertConversation(state, { ...conversation, lastReadAt, unreadCount });
}

/** Summe aller ungelesenen Nachrichten – für einen etwaigen Zähler in der Ansicht. */
export function totalUnread(state: ChatViewState): number {
  return state.conversations.reduce((sum, conversation) => sum + unreadOf(conversation), 0);
}

/**
 * Vorschautext einer Konversation für die Liste.
 *
 * Leerer Chat → Hinweis; gelöschte jüngste Nachricht → neutraler Platzhalter
 * statt leerer Zeile; sonst der Inhalt.
 */
export function conversationPreview(conversation: ConversationDto): string {
  const last = conversation.lastMessage;
  if (!last) return 'Noch keine Nachrichten';
  if (last.deletedAt !== null) return 'Nachricht gelöscht';
  return last.content;
}
