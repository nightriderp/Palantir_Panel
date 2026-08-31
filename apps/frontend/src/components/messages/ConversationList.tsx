'use client';

import { type ConversationDto } from '@palantir/contracts';
import { Button, Icon, cn, serverInitials } from '@/components/shared';
import { conversationPreview } from './conversationStore';

/**
 * Liste der Konversationen (Arbeitspaket F5, Lastenheft §3.6).
 *
 * Zeigt DMs und Server-Chats gemeinsam, jüngste Aktivität oben. Ungelesene
 * Konversationen tragen einen Zähler; er ist lokal (siehe `conversationStore.ts`).
 * Server-Chats sind an ihrem Symbol erkennbar, DMs am Namenskürzel des
 * Gegenübers.
 *
 * Den Zustand der Live-Verbindung zeigt die Liste **nicht** mehr: Er steht in
 * der Kopfleiste, auf jeder Seite und mit Erklärung, was er für die Bedienung
 * bedeutet. Zwei Anzeigen für dieselbe Verbindung waren einmal zu viel
 * (Mockup-Abgleich 6.2).
 */

export interface ConversationListProps {
  conversations: ConversationDto[];
  activeId: string | null;
  unread: Record<string, number>;
  onSelect: (conversation: ConversationDto) => void;
  onNew: () => void;
}

export function ConversationList({
  conversations,
  activeId,
  unread,
  onSelect,
  onNew,
}: ConversationListProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      <Button variant="primary" size="sm" iconLeft="plus" fullWidth onClick={onNew}>
        Neue Konversation
      </Button>

      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        {conversations.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-ink-faint">
            Noch keine Unterhaltungen. Beginne eine neue Konversation.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {conversations.map((conversation) => {
              const count = unread[conversation.id] ?? 0;
              const active = conversation.id === activeId;
              const isServer = conversation.type === 'server_chat';

              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation)}
                    aria-current={active}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
                      active ? 'bg-brand-soft' : 'hover:bg-fill',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-2xs font-bold',
                        isServer ? 'bg-fill-strong text-brand' : 'bg-brand-soft text-brand',
                      )}
                    >
                      {isServer ? (
                        <Icon name="server" size={16} />
                      ) : (
                        serverInitials(conversation.title)
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'truncate text-sm',
                            count > 0 ? 'font-semibold text-ink' : 'font-medium text-ink',
                          )}
                        >
                          {conversation.title}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-faint">
                        {conversationPreview(conversation)}
                      </span>
                    </span>

                    {count > 0 ? (
                      <span className="flex h-5 min-w-[1.25rem] flex-shrink-0 items-center justify-center rounded-full bg-brand-gradient px-1.5 text-2xs font-semibold text-white">
                        {count > 99 ? '99+' : count}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
