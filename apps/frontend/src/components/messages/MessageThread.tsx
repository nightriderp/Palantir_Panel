'use client';

import { type ConversationDto, type MessageDto } from '@palantir/contracts';
import { useEffect, useRef } from 'react';
import { Button, Icon, IconButton, EmptyState } from '@/components/shared';
import { type ThreadState } from './conversationStore';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';

/**
 * Ansicht einer einzelnen Konversation mit Live-Verlauf (Arbeitspaket F5).
 *
 * Kopf mit Titel und Teilnehmer-Hinweis, darunter der scrollende Verlauf
 * (älteste oben, jüngste unten), unten die Eingabezeile. Beim Öffnen und bei
 * jeder neuen Nachricht springt die Ansicht ans untere Ende – außer der Nutzer
 * hat bewusst nach oben gescrollt, um Älteres zu lesen.
 */

export interface MessageThreadProps {
  conversation: ConversationDto;
  thread: ThreadState | undefined;
  viewerId: string | null;
  /** Verlauf wird gerade erstmalig geladen. */
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  sending: boolean;
  onSend: (content: string) => void;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onReport: (message: MessageDto) => void;
  onDelete: (message: MessageDto) => void;
  /** Zurück zur Liste – nur auf schmalen Bildschirmen sichtbar. */
  onBack: () => void;
}

function subtitleOf(conversation: ConversationDto): string {
  if (conversation.type === 'server_chat') {
    const count = conversation.participants.length;
    return count > 0 ? `Server-Chat · ${count} Teilnehmer` : 'Server-Chat';
  }

  return 'Direktnachricht';
}

export function MessageThread({
  conversation,
  thread,
  viewerId,
  loading,
  error,
  onRetry,
  sending,
  onSend,
  loadingOlder,
  onLoadOlder,
  onReport,
  onDelete,
  onBack,
}: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = thread?.messages ?? [];
  const lastId = messages.at(-1)?.id ?? null;
  const isServerChat = conversation.type === 'server_chat';

  // Ans untere Ende springen, wenn die Konversation gewechselt wird oder eine
  // neue jüngste Nachricht dazukommt. Beim Nachladen älterer Seiten (Länge
  // steigt, aber `lastId` bleibt) passiert das bewusst nicht.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [conversation.id, lastId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-3 sm:px-4">
        <IconButton
          icon="arrowLeft"
          label="Zurück zur Übersicht"
          variant="ghost"
          size="sm"
          className="md:hidden"
          onClick={onBack}
        />
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon name={isServerChat ? 'server' : 'user'} size={15} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{conversation.title}</p>
          <p className="truncate text-2xs text-ink-faint">{subtitleOf(conversation)}</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-faint">
            <Icon name="clock" size={16} />
            Verlauf wird geladen …
          </div>
        ) : error && messages.length === 0 ? (
          <EmptyState
            icon="warning"
            title="Verlauf konnte nicht geladen werden"
            description={error}
            action={
              <Button variant="secondary" onClick={onRetry}>
                Nochmal versuchen
              </Button>
            }
          />
        ) : messages.length === 0 ? (
          <EmptyState
            icon="chat"
            title="Noch keine Nachrichten"
            description={
              conversation.permissions.canSendMessage
                ? 'Schreib die erste Nachricht.'
                : 'Hier ist noch nichts geschrieben worden.'
            }
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {thread?.nextCursor ? (
              <div className="flex justify-center pb-1">
                <Button variant="ghost" size="sm" disabled={loadingOlder} onClick={onLoadOlder}>
                  {loadingOlder ? 'Wird geladen …' : 'Ältere Nachrichten laden'}
                </Button>
              </div>
            ) : null}

            {messages.map((message, index) => {
              const mine = message.senderId === viewerId;
              const previous = messages[index - 1];
              const showSender =
                isServerChat && !mine && (!previous || previous.senderId !== message.senderId);

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  mine={mine}
                  showSender={showSender}
                  onReport={onReport}
                  onDelete={onDelete}
                />
              );
            })}
          </div>
        )}
      </div>

      <Composer
        canSend={conversation.permissions.canSendMessage}
        sending={sending}
        onSend={onSend}
      />
    </div>
  );
}
