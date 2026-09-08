import { type ChatServerEventFrame, type ConversationDto, ok } from '@palantir/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { conversation, message } from './testFixtures';
import { MessagesView } from './MessagesView';

/**
 * Ungelesen-Zähler und unbekannte Konversationen (Findings frontend-lib-06 und
 * event-flow-14).
 *
 * Geprüft wird genau das, was der Store allein nicht zeigen kann: dass die
 * Ansicht den Zähler aus `ConversationDto.unreadCount` anzeigt statt aus einem
 * eigenen Zähler, dass ein `conversation.read` von einem anderen Gerät ihn
 * fallen lässt, und dass eine Nachricht für eine unbekannte Konversation ein
 * Nachladen der Liste auslöst, statt still ins Leere zu zählen.
 */

const live = vi.hoisted(() => ({
  onFrame: null as ((frame: ChatServerEventFrame) => void) | null,
}));

const api = vi.hoisted(() => ({
  fetchConversations: vi.fn(),
  fetchMessages: vi.fn(),
  markConversationRead: vi.fn(),
}));

vi.mock('@/lib/live/useChatLive', () => ({
  useChatLive: (onFrame: (frame: ChatServerEventFrame) => void) => {
    live.onFrame = onFrame;

    return { connection: 'open' as const, unauthorized: false };
  },
}));

// `usePathname`/`useRouter` gebraucht nicht die Ansicht selbst, wohl aber die
// Seitenleiste aus dem Sammel-Export von `@/components/shared`.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/messages',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: { id: 'u1' }, loading: false, setUser: vi.fn() }),
}));

vi.mock('@/lib/api/chat', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchConversations: api.fetchConversations,
  fetchMessages: api.fetchMessages,
  markConversationRead: api.markConversationRead,
}));

const FEMI = conversation({ id: 'c1', title: 'Femi', unreadCount: 3 });

const SERVER_CHAT = conversation({
  id: 'c-neu',
  type: 'server_chat',
  serverId: 'srv-1',
  title: 'Welt',
  unreadCount: 1,
  createdAt: '2026-08-28T09:30:00.000Z',
});

/** `message.sent` von einem fremden Konto; `id` unterscheidet mehrere davon. */
function fremdeNachricht(conversationId: string, id = 'm-neu'): ChatServerEventFrame {
  return {
    kind: 'event',
    event: 'message.sent',
    sentAt: '2026-08-28T10:00:00.000Z',
    data: {
      conversationId,
      message: message({ id, conversationId, senderId: 'u2', content: 'Moin' }),
    },
  };
}

function gelesenAufAnderemGeraet(conversationId: string): ChatServerEventFrame {
  return {
    kind: 'event',
    event: 'conversation.read',
    sentAt: '2026-08-28T10:05:00.000Z',
    data: { conversationId, lastReadAt: '2026-08-28T10:05:00.000Z', unreadCount: 0 },
  };
}

async function sende(frame: ChatServerEventFrame): Promise<void> {
  const zustellen = live.onFrame;
  if (!zustellen) throw new Error('Der Live-Kanal wurde nicht angemeldet.');

  await act(async () => {
    zustellen(frame);
  });
}

function zeichne() {
  return render(
    <ToastProvider>
      <MessagesView />
    </ToastProvider>,
  );
}

/** Zähler-Abzeichen einer Konversation in der Liste; `null`, wenn keines steht. */
function abzeichen(titel: string): string | null {
  const zeile = screen.getByRole('button', { name: new RegExp(titel) });
  const treffer = [...zeile.querySelectorAll('span')].find((element) =>
    /^\d+\+?$/.test(element.textContent ?? ''),
  );

  return treffer?.textContent ?? null;
}

/** Öffnet eine Konversation über die Seitenleiste – wie ein Klick des Nutzers. */
async function waehle(titel: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(titel) }));
  });
}

/** Sichtbarkeit des Tabs setzen; jsdom liefert `visibilityState` sonst fest als „visible". */
function setzeSichtbarkeit(zustand: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: zustand, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Sammelfenster aus `MessagesView` (`READ_SYNC_THROTTLE_MS`) plus Reserve. */
const SAMMELFENSTER_MS = 2_000;

beforeEach(() => {
  live.onFrame = null;
  api.fetchConversations.mockReset().mockResolvedValue(ok<ConversationDto[]>([FEMI]));
  api.fetchMessages
    .mockReset()
    .mockResolvedValue(ok({ conversationId: 'c1', messages: [], nextCursor: null, limit: 50 }));
  api.markConversationRead.mockReset().mockResolvedValue(ok({ ...FEMI, unreadCount: 0 }));
});

afterEach(() => {
  vi.useRealTimers();
  setzeSichtbarkeit('visible');
});

describe('MessagesView – Ungelesen-Zähler (Finding frontend-lib-06)', () => {
  it('zeigt den Zähler aus dem DTO, nicht einen erst lokal aufgebauten', async () => {
    zeichne();

    // Ohne einen einzigen Live-Frame: der Wert kommt allein aus der Antwort des
    // Servers. Zuvor war der lokale Zähler nach dem Laden leer, während die
    // Seitenleiste bereits „3" zeigte.
    await waitFor(() => {
      expect(abzeichen('Femi')).toBe('3');
    });
  });

  it('lässt den Zähler fallen, wenn auf einem anderen Gerät gelesen wurde', async () => {
    zeichne();
    await waitFor(() => {
      expect(abzeichen('Femi')).toBe('3');
    });

    await sende(gelesenAufAnderemGeraet('c1'));

    expect(abzeichen('Femi')).toBeNull();
  });

  it('zählt eine eintreffende fremde Nachricht auf dem Serverstand weiter', async () => {
    zeichne();
    await waitFor(() => {
      expect(abzeichen('Femi')).toBe('3');
    });

    await sende(fremdeNachricht('c1'));

    expect(abzeichen('Femi')).toBe('4');
  });
});

describe('MessagesView – Nachricht für eine unbekannte Konversation (event-flow-14)', () => {
  it('lädt die Liste nach, statt einen unsichtbaren Zähler hochzuzählen', async () => {
    api.fetchConversations
      .mockResolvedValueOnce(ok<ConversationDto[]>([FEMI]))
      .mockResolvedValue(ok<ConversationDto[]>([FEMI, SERVER_CHAT]));

    zeichne();
    await waitFor(() => {
      expect(screen.getByText('Femi')).toBeDefined();
    });
    expect(api.fetchConversations).toHaveBeenCalledTimes(1);

    // Der Gruppen-Chat eines gerade angelegten Servers: B7 meldet seine
    // Entstehung nicht, die erste Nachricht ist der einzige Hinweis.
    await sende(fremdeNachricht('c-neu'));

    await waitFor(() => {
      expect(api.fetchConversations).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText('Welt')).toBeDefined();
    });
    // Der Zähler stammt aus der nachgeladenen Konversation, nicht aus einem
    // lokalen Hochzählen.
    expect(abzeichen('Welt')).toBe('1');
  });

  it('lädt für dieselbe unbekannte Konversation nur einmal nach', async () => {
    zeichne();
    await waitFor(() => {
      expect(api.fetchConversations).toHaveBeenCalledTimes(1);
    });

    // Die Liste bleibt in diesem Test ohne `c-neu`; ohne Merkliste würde jede
    // weitere Nachricht ein weiteres Laden auslösen.
    await sende(fremdeNachricht('c-neu'));
    await sende(fremdeNachricht('c-neu'));
    await sende(fremdeNachricht('c-neu'));

    await waitFor(() => {
      expect(api.fetchConversations).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * Lesestand bei eintreffenden Nachrichten (Fundpunkt 144).
 *
 * Der Zähler kommt seit W2-19 aus dem DTO. Traf eine fremde Nachricht ein,
 * während der Nutzer die Konversation offen hatte, wuchs der **Serverstand**
 * weiter – die Seitenleiste zählte sie beim nächsten Laden der Übersicht mit,
 * obwohl der Nutzer sie längst gelesen hatte.
 *
 * Gewählt wurde das gedrosselte Nachziehen im Frontend statt eines
 * Lesestand-Frames vom Backend: Nur der Browser weiß, ob jemand hinsieht. Für
 * das Backend sieht ein Hintergrund-Tab genauso aus wie ein offenes Fenster –
 * es müsste raten und würde Ungelesenes als gelesen markieren.
 */
describe('MessagesView – Lesestand nachziehen (Fundpunkt 144)', () => {
  it('lässt den Zähler der Seitenleiste in der offenen Konversation nicht steigen', async () => {
    zeichne();
    await waitFor(() => {
      expect(abzeichen('Femi')).toBe('3');
    });

    await waehle('Femi');

    // Das Auswählen setzt den Lesestand: ein Aufruf, Zähler weg.
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);
    expect(abzeichen('Femi')).toBeNull();

    await sende(fremdeNachricht('c1', 'm-a'));

    expect(abzeichen('Femi')).toBeNull();
  });

  it('zieht den Lesestand einmal nach, auch bei mehreren Nachrichten kurz hintereinander', async () => {
    zeichne();
    await waitFor(() => {
      expect(abzeichen('Femi')).toBe('3');
    });

    await waehle('Femi');
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();

    await sende(fremdeNachricht('c1', 'm-a'));
    await sende(fremdeNachricht('c1', 'm-b'));
    await sende(fremdeNachricht('c1', 'm-c'));

    // Noch nichts: Die drei Nachrichten laufen in dasselbe Sammelfenster.
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(SAMMELFENSTER_MS);
    });

    // Genau ein weiterer Aufruf für alle drei – nicht drei.
    expect(api.markConversationRead).toHaveBeenCalledTimes(2);
    expect(api.markConversationRead).toHaveBeenLastCalledWith('c1');
  });

  it('zählt in einer nicht geöffneten Konversation weiter und meldet nichts als gelesen', async () => {
    zeichne();
    await waitFor(() => {
      expect(abzeichen('Femi')).toBe('3');
    });

    vi.useFakeTimers();

    // Keine Konversation ausgewählt: Die Nachricht ist ungelesen und bleibt es.
    await sende(fremdeNachricht('c1', 'm-a'));

    await act(async () => {
      vi.advanceTimersByTime(SAMMELFENSTER_MS * 2);
    });

    expect(abzeichen('Femi')).toBe('4');
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });

  /** Ein Hintergrund-Tab hat die Konversation offen, gelesen hat dort aber niemand. */
  it('meldet aus einem nicht sichtbaren Tab nichts als gelesen – und holt es beim Zurückkommen nach', async () => {
    zeichne();
    await waitFor(() => {
      expect(abzeichen('Femi')).toBe('3');
    });

    await waehle('Femi');
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);

    setzeSichtbarkeit('hidden');
    vi.useFakeTimers();

    await sende(fremdeNachricht('c1', 'm-a'));

    await act(async () => {
      vi.advanceTimersByTime(SAMMELFENSTER_MS * 3);
    });

    expect(api.markConversationRead).toHaveBeenCalledTimes(1);

    // Zurück im Vordergrund: Jetzt schaut jemand hin, der Lesestand gilt.
    await act(async () => {
      setzeSichtbarkeit('visible');
    });
    await act(async () => {
      vi.advanceTimersByTime(SAMMELFENSTER_MS);
    });

    expect(api.markConversationRead).toHaveBeenCalledTimes(2);
  });

  it('zieht nichts für eine eigene Nachricht nach', async () => {
    zeichne();
    await waitFor(() => {
      expect(abzeichen('Femi')).toBe('3');
    });

    await waehle('Femi');
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();

    await sende({
      kind: 'event',
      event: 'message.sent',
      sentAt: '2026-08-28T10:00:00.000Z',
      data: {
        conversationId: 'c1',
        message: message({ id: 'm-eigen', conversationId: 'c1', senderId: 'u1' }),
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(SAMMELFENSTER_MS * 2);
    });

    // Die eigene Nachricht ändert am Lesestand nichts – sie war nie ungelesen.
    expect(api.markConversationRead).toHaveBeenCalledTimes(1);
  });
});
