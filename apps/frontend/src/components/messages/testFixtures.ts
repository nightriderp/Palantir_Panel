import { type ConversationDto, type MessageDto, type MessagePageDto } from '@palantir/contracts';

/**
 * Testdaten für die Chat-Ansicht (Arbeitspaket F5).
 *
 * Kleine Baukästen mit sinnvollen Vorgaben – jeder Test überschreibt nur, was er
 * prüft. Kein Zufall, keine Uhr: Zeitstempel werden explizit gesetzt, damit die
 * Sortierung deterministisch bleibt.
 */

export function message(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'u2',
    senderDisplayName: 'Femi',
    content: 'Hallo!',
    createdAt: '2026-08-28T10:00:00.000Z',
    deletedAt: null,
    deletedByModerator: null,
    reportedByViewer: false,
    permissions: { canDelete: false, canReport: true },
    ...overrides,
  };
}

export function conversation(overrides: Partial<ConversationDto> = {}): ConversationDto {
  return {
    id: 'c1',
    type: 'dm',
    serverId: null,
    title: 'Femi',
    participants: [
      { userId: 'u1', displayName: 'Alex' },
      { userId: 'u2', displayName: 'Femi' },
    ],
    lastMessage: null,
    createdAt: '2026-08-28T09:00:00.000Z',
    permissions: { canView: true, canSendMessage: true },
    ...overrides,
  };
}

export function page(overrides: Partial<MessagePageDto> = {}): MessagePageDto {
  return {
    conversationId: 'c1',
    messages: [],
    nextCursor: null,
    limit: 50,
    ...overrides,
  };
}
