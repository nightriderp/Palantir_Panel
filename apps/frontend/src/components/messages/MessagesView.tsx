'use client';

import { type ChatServerEventFrame, type MessageDto } from '@palantir/contracts';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, EmptyState, Icon, PageHeader, cn, useToast } from '@/components/shared';
import { errorText, isAborted } from '@/lib/api/client';
import {
  deleteMessage,
  fetchConversations,
  fetchMessages,
  markConversationRead as markConversationReadOnServer,
  openDirectConversation,
  openServerConversation,
  reportMessage,
  sendMessage,
} from '@/lib/api/chat';
import { useChatLive } from '@/lib/live/useChatLive';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';
import { NewConversationDialog } from './NewConversationDialog';
import { ReportMessageDialog } from './ReportMessageDialog';
import {
  type ChatViewState,
  applyConversationRead,
  applyMessageDeleted,
  applyMessageSent,
  emptyChatState,
  knowsConversation,
  markConversationRead,
  markMessageReported,
  setConversations,
  setThreadPage,
  upsertConversation,
} from './conversationStore';

/**
 * Nachrichten/Chat (Arbeitspaket F5, Lastenheft §3.6).
 *
 * Übersicht der Konversationen (DMs und Server-Chats), Verlauf einer einzelnen
 * Konversation mit Live-Aktualisierung über den WebSocket-Kanal aus B7 (kein
 * Polling, Pflichtenheft §5.3) sowie das Melden einzelner Nachrichten. Die
 * Moderationsansicht gehört **nicht** hierher, sondern in den Admin-Bereich
 * (F10) – von hier führt kein Weg in fremde Konversationen (Pflichtenheft §15).
 *
 * Mobile-First (Lastenheft §4): Auf schmalen Bildschirmen ist entweder die Liste
 * **oder** der Verlauf zu sehen; die Auswahl einer Konversation wechselt in den
 * Verlauf, der Zurück-Knopf führt in die Liste. Ab `md` stehen beide nebeneinander.
 *
 * Der gesamte Zustand liegt in `conversationStore.ts` und wird dort geprüft; hier
 * bleibt nur das Verdrahten von REST, Live-Kanal und Oberfläche.
 */

const PAGE_LIMIT = 50;

/**
 * Sammelfenster für das Nachziehen des Lesestands (Fundpunkt 144).
 *
 * Trifft eine fremde Nachricht ein, während die Konversation offen und das
 * Fenster sichtbar ist, hat der Nutzer sie faktisch gelesen – der Server weiß
 * das aber nicht: Sein `unreadCount` wächst, und die Seitenleiste zeigt ihn beim
 * nächsten Laden der Übersicht mit. Ein Aufruf **je** Nachricht wäre die naive
 * Antwort; in einem lebhaften Server-Chat sind das Dutzende in einer Minute.
 * Deshalb werden eintreffende Nachrichten gesammelt und der Lesestand danach
 * **einmal** nachgezogen.
 *
 * Zwei Sekunden sind lang genug, um einen Redeschwall zu einem Aufruf zu bündeln,
 * und kurz genug, dass der Zähler nicht spürbar hinterherhinkt – gesehen hat man
 * die Nachricht ohnehin schon, der Aufruf korrigiert nur den Serverstand.
 */
const READ_SYNC_THROTTLE_MS = 2_000;

/**
 * Darf dieses Fenster gerade etwas als gelesen melden? (Fundpunkt 144)
 *
 * Nur ein sichtbarer Tab. Ein Hintergrund-Tab hat die Konversation zwar
 * technisch „offen", gelesen hat dort aber niemand etwas – er dürfte den Zähler
 * also nicht zurücksetzen, und zwar auch nicht für die anderen Geräte desselben
 * Kontos, an die das Backend `conversation.read` weiterreicht.
 */
function fensterIstSichtbar(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

export function MessagesView() {
  const { user } = useSession();
  const viewerId = user?.id ?? null;
  const toast = useToast();
  const searchParams = useSearchParams();

  const [state, setState] = useState<ChatViewState>(emptyChatState);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [reportTarget, setReportTarget] = useState<MessageDto | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageDto | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Aktuellen Stand für die Live-Rückrufe und Handler ohne veraltete Closure.
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // -- Erstladung der Übersicht ---------------------------------------------

  const reloadConversations = useCallback(async (signal?: AbortSignal) => {
    setListLoading(true);
    setListError(null);
    const result = await fetchConversations(signal);
    if (result.success) {
      setState((current) => setConversations(current, result.data));
    } else if (!isAborted(result)) {
      setListError(errorText(result));
    }
    setListLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reloadConversations(controller.signal);
    return () => controller.abort();
  }, [reloadConversations]);

  // -- Verlauf laden ---------------------------------------------------------

  const loadThread = useCallback(async (conversationId: string) => {
    setThreadLoading(true);
    setThreadError(null);
    const result = await fetchMessages(conversationId, { limit: PAGE_LIMIT });
    if (result.success) {
      setState((current) => setThreadPage(current, conversationId, result.data, 'replace'));
    } else if (!isAborted(result)) {
      setThreadError(errorText(result));
    }
    setThreadLoading(false);
  }, []);

  /*
   * Den Lesestand serverseitig setzen, sonst gilt er nur auf diesem Geraet und
   * der Zaehler in der Seitenleiste bliebe stehen. Ein Fehlschlag bleibt still:
   * gelesen ist die Konversation fuer den Nutzer trotzdem, und eine
   * Fehlermeldung dafuer waere nur im Weg.
   *
   * Zwei Wege führen hierher: das Auswählen einer Konversation und das
   * gedrosselte Nachziehen bei eintreffenden Nachrichten (Fundpunkt 144).
   */
  const pushReadState = useCallback((conversationId: string) => {
    void markConversationReadOnServer(conversationId).then((result) => {
      if (result.success) {
        setState((current) => upsertConversation(current, result.data));
      }
    });
  }, []);

  // -- Lesestand nachziehen (Fundpunkt 144) ----------------------------------

  /** Laufendes Sammelfenster; `null`, wenn gerade keines offen ist. */
  const readSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Konversation, deren Lesestand noch nachzuziehen ist; `null` = nichts offen. */
  const readSyncPendingRef = useRef<string | null>(null);

  /**
   * Ende des Sammelfensters: einmal nachziehen – aber nur, wenn die Konversation
   * immer noch die offene und das Fenster immer noch sichtbar ist. Trifft eines
   * von beidem nicht mehr zu, bleibt die Konversation vorgemerkt; der nächste
   * Wechsel auf „sichtbar" holt es nach.
   */
  const flushReadSync = useCallback(() => {
    readSyncTimerRef.current = null;

    const wanted = readSyncPendingRef.current;
    if (wanted === null) return;
    if (wanted !== activeIdRef.current || !fensterIstSichtbar()) return;

    readSyncPendingRef.current = null;
    pushReadState(wanted);
  }, [pushReadState]);

  /**
   * Merkt eine Konversation zum Nachziehen vor und öffnet höchstens **ein**
   * Sammelfenster: Ein Redeschwall erzeugt damit einen Aufruf, nicht einen je
   * Nachricht.
   */
  const scheduleReadSync = useCallback(
    (conversationId: string) => {
      readSyncPendingRef.current = conversationId;

      // Ein Hintergrund-Tab merkt sich den Bedarf, meldet aber nichts als
      // gelesen – dort hat niemand etwas gelesen.
      if (!fensterIstSichtbar()) return;
      if (readSyncTimerRef.current !== null) return;

      readSyncTimerRef.current = setTimeout(flushReadSync, READ_SYNC_THROTTLE_MS);
    },
    [flushReadSync],
  );

  useEffect(() => {
    // Wird der Tab wieder sichtbar, gilt das Vorgemerkte – jetzt schaut jemand hin.
    const beiSichtbarkeit = (): void => {
      const wanted = readSyncPendingRef.current;
      if (wanted !== null) scheduleReadSync(wanted);
    };

    document.addEventListener('visibilitychange', beiSichtbarkeit);

    return () => {
      document.removeEventListener('visibilitychange', beiSichtbarkeit);

      if (readSyncTimerRef.current !== null) {
        clearTimeout(readSyncTimerRef.current);
        readSyncTimerRef.current = null;
      }
    };
  }, [scheduleReadSync]);

  const selectConversation = useCallback(
    (conversationId: string) => {
      setActiveId(conversationId);
      setState((current) => markConversationRead(current, conversationId));
      if (!stateRef.current.threads[conversationId]?.loaded) {
        void loadThread(conversationId);
      }

      // Das Auswählen setzt den Lesestand sofort; ein vorgemerktes Nachziehen
      // wäre danach gegenstandslos.
      readSyncPendingRef.current = null;
      pushReadState(conversationId);
    },
    [loadThread, pushReadState],
  );

  /*
   * Sprungziel aus der Adresszeile (`/messages?c=<id>`). Genutzt vom Knopf
   * „Nachricht" auf der Karte eines fremden Servers: dort wird die Unterhaltung
   * mit dem Besitzer geöffnet und ihre Id hierher übergeben. Der Sprung greift
   * nur einmal – sonst würde ein späteres Umschalten in der Liste sofort wieder
   * zurückspringen.
   */
  const jumpedRef = useRef(false);
  useEffect(() => {
    const wanted = searchParams.get('c');
    if (!wanted || jumpedRef.current) return;
    if (!state.conversations.some((entry) => entry.id === wanted)) return;

    jumpedRef.current = true;
    selectConversation(wanted);
  }, [searchParams, state.conversations, selectConversation]);

  async function loadOlder() {
    const id = activeIdRef.current;
    if (!id || loadingOlder) return;
    const cursor = stateRef.current.threads[id]?.nextCursor;
    if (!cursor) return;

    setLoadingOlder(true);
    const result = await fetchMessages(id, { limit: PAGE_LIMIT, before: cursor });
    if (result.success) {
      setState((current) => setThreadPage(current, id, result.data, 'older'));
    } else if (!isAborted(result)) {
      toast.error(errorText(result));
    }
    setLoadingOlder(false);
  }

  // -- Live-Kanal ------------------------------------------------------------

  /*
   * Konversationen, für die wegen eines unbekannten Frames bereits nachgeladen
   * wurde. Ohne diese Merkliste würde jede weitere Nachricht derselben
   * unbekannten Konversation ein weiteres Laden auslösen.
   */
  const reloadedForRef = useRef<Set<string>>(new Set());

  const onFrame = useCallback(
    (frame: ChatServerEventFrame) => {
      if (frame.event === 'message.sent') {
        const { conversationId } = frame.data;

        /*
         * Nachricht für eine Konversation, die nicht in der Übersicht steht –
         * etwa der Gruppen-Chat eines gerade angelegten Servers, dessen
         * Entstehung B7 nicht meldet (Finding event-flow-14). Früher wuchs dafür
         * ein unsichtbarer Zähler; jetzt wird die Liste einmal nachgeladen, dann
         * ist die Konversation samt serverseitigem `unreadCount` da.
         */
        if (
          !knowsConversation(stateRef.current, conversationId) &&
          !reloadedForRef.current.has(conversationId)
        ) {
          reloadedForRef.current.add(conversationId);
          void reloadConversations();
        }

        /*
         * Fremde Nachricht in der gerade offenen Konversation: Der Zähler in
         * der Seitenleiste steigt hier zwar nicht (das entscheidet
         * `applyMessageSent`), der **Serverstand** schon – und beim nächsten
         * Laden der Übersicht käme er samt dieser Nachricht zurück. Deshalb den
         * Lesestand nachziehen, gesammelt und nur aus einem sichtbaren Fenster
         * (Fundpunkt 144).
         */
        if (conversationId === activeIdRef.current && frame.data.message.senderId !== viewerId) {
          scheduleReadSync(conversationId);
        }

        setState((current) =>
          applyMessageSent(current, conversationId, frame.data.message, {
            activeConversationId: activeIdRef.current,
            viewerId,
          }),
        );
      } else if (frame.event === 'conversation.read') {
        // Gelesen auf einem anderen Gerät desselben Kontos: Zähler nachziehen.
        setState((current) =>
          applyConversationRead(
            current,
            frame.data.conversationId,
            frame.data.lastReadAt,
            frame.data.unreadCount,
          ),
        );
      } else if (frame.event === 'message.deleted') {
        setState((current) =>
          applyMessageDeleted(
            current,
            frame.data.conversationId,
            frame.data.messageId,
            frame.data.deletedAt,
            frame.data.byModerator,
          ),
        );
      } else if (frame.event === 'conversation.created') {
        setState((current) => upsertConversation(current, frame.data.conversation));
      }
    },
    [viewerId, reloadConversations, scheduleReadSync],
  );

  /*
   * Der Rueckgabewert wird nicht mehr gebraucht: Den Zustand der Verbindung
   * zeigt die Kopfleiste (Abgleich 6.2). Der Aufruf bleibt - er haelt die
   * Verbindung und liefert die Nachrichten.
   */
  useChatLive(onFrame);

  // -- Senden / Löschen / Melden --------------------------------------------

  async function send(content: string) {
    const id = activeIdRef.current;
    if (!id) return;
    setSending(true);
    const result = await sendMessage(id, { content });
    setSending(false);
    if (result.success) {
      // Der Live-Kanal stellt dieselbe Nachricht zusätzlich zu; die Entdopplung
      // nach Id im Store fängt das ab.
      setState((current) =>
        applyMessageSent(current, id, result.data, {
          activeConversationId: id,
          viewerId,
        }),
      );
    } else {
      toast.error(errorText(result));
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteBusy(true);
    const result = await deleteMessage(target.id);
    setDeleteBusy(false);
    if (result.success) {
      setState((current) =>
        applyMessageDeleted(
          current,
          target.conversationId,
          target.id,
          new Date().toISOString(),
          false,
        ),
      );
      setDeleteTarget(null);
    } else {
      toast.error(errorText(result));
    }
  }

  async function submitReport(reason: string) {
    const target = reportTarget;
    if (!target) return;
    setReportBusy(true);
    setReportError(null);
    const result = await reportMessage(target.id, { reason });
    setReportBusy(false);
    if (result.success) {
      setState((current) => markMessageReported(current, target.conversationId, target.id));
      setReportTarget(null);
      toast.success('Danke – die Meldung liegt bei der Moderation.');
    } else {
      setReportError(errorText(result));
    }
  }

  // -- Neue Konversation -----------------------------------------------------

  async function openDirect(recipientId: string) {
    setOpening(true);
    const result = await openDirectConversation(recipientId);
    setOpening(false);
    if (result.success) {
      setState((current) => upsertConversation(current, result.data));
      setNewOpen(false);
      selectConversation(result.data.id);
    } else {
      toast.error(errorText(result));
    }
  }

  async function openServerChat(serverId: string) {
    setOpening(true);
    const result = await openServerConversation(serverId);
    setOpening(false);
    if (result.success) {
      setState((current) => upsertConversation(current, result.data));
      setNewOpen(false);
      selectConversation(result.data.id);
    } else {
      toast.error(errorText(result));
    }
  }

  const activeConversation = state.conversations.find((entry) => entry.id === activeId) ?? null;

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="Nachrichten"
        subtitle="Direktnachrichten und Server-Chats"
        className="-mx-5 -mt-5 px-5"
      />

      {listError && state.conversations.length === 0 ? (
        <EmptyState
          icon="warning"
          title="Konversationen konnten nicht geladen werden"
          description={listError}
          action={
            <button
              type="button"
              className="text-sm text-brand hover:text-brand-bright"
              onClick={() => void reloadConversations()}
            >
              Nochmal versuchen
            </button>
          }
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
          <aside
            className={cn(
              'min-h-0 rounded-2xl border border-line bg-surface p-3',
              activeId ? 'hidden md:block' : 'block',
            )}
          >
            {listLoading && state.conversations.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-faint">
                <Icon name="clock" size={16} />
                Wird geladen …
              </div>
            ) : (
              <ConversationList
                conversations={state.conversations}
                activeId={activeId}
                onSelect={(conversation) => selectConversation(conversation.id)}
                onNew={() => setNewOpen(true)}
              />
            )}
          </aside>

          <section
            className={cn(
              'min-h-0 overflow-hidden rounded-2xl border border-line bg-surface',
              activeId ? 'block' : 'hidden md:block',
            )}
          >
            {activeConversation ? (
              <MessageThread
                conversation={activeConversation}
                thread={state.threads[activeConversation.id]}
                viewerId={viewerId}
                loading={threadLoading}
                error={threadError}
                onRetry={() => void loadThread(activeConversation.id)}
                sending={sending}
                onSend={(content) => void send(content)}
                loadingOlder={loadingOlder}
                onLoadOlder={() => void loadOlder()}
                onReport={(message) => setReportTarget(message)}
                onDelete={(message) => setDeleteTarget(message)}
                onBack={() => setActiveId(null)}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <EmptyState
                  icon="chat"
                  title="Keine Konversation ausgewählt"
                  description="Wähle links eine Unterhaltung oder beginne eine neue."
                />
              </div>
            )}
          </section>
        </div>
      )}

      <NewConversationDialog
        open={newOpen}
        busy={opening}
        onClose={() => setNewOpen(false)}
        onOpenDirect={(userId) => void openDirect(userId)}
        onOpenServerChat={(serverId) => void openServerChat(serverId)}
      />

      <ReportMessageDialog
        open={reportTarget !== null}
        message={reportTarget}
        busy={reportBusy}
        error={reportError}
        onClose={() => {
          setReportTarget(null);
          setReportError(null);
        }}
        onSubmit={(reason) => void submitReport(reason)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Nachricht löschen"
        message="Die Nachricht bleibt im Verlauf sichtbar, ihr Inhalt wird aber entfernt. Das lässt sich nicht rückgängig machen."
        confirmLabel="Löschen"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
