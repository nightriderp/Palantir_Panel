import { describe, expect, it } from 'vitest';
import {
  CHAT_EVENTS,
  CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED,
  CONVERSATION_TYPES,
  MESSAGE_MODERATION_ACTIONS,
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
  MESSAGE_REPORT_STATUSES,
  isChatEventName,
  isConversationType,
  isMessageModerationAction,
  isMessageReportStatus,
} from './chat.js';
import { ERROR_CATALOG } from './errors.js';
import { WEBSOCKET_EVENTS } from './events.js';
import { PERMISSION_CATALOG } from './permissions.js';

describe('Chat-Vertrag (Pflichtenheft §15)', () => {
  it('kennt genau die beiden Konversationstypen aus Pflichtenheft §6', () => {
    expect([...CONVERSATION_TYPES]).toEqual(['dm', 'server_chat']);
    expect(isConversationType('dm')).toBe(true);
    expect(isConversationType('group')).toBe(false);
  });

  it('kennt die Bearbeitungsstände einer Meldung', () => {
    expect([...MESSAGE_REPORT_STATUSES]).toEqual(['open', 'resolved', 'dismissed']);
    expect(isMessageReportStatus('open')).toBe(true);
    expect(isMessageReportStatus('erledigt')).toBe(false);
  });

  /**
   * Eine Kontosperre ist Nutzerverwaltung (`user.manage`, B8) und keine
   * Chat-Moderation – sie darf hier nicht als Aktion auftauchen, sonst käme
   * `message.moderate` an das Rechtekonzept aus Pflichtenheft §8 heran.
   */
  it('bietet als Moderationsentscheidung nur „verwerfen" und „Nachricht löschen"', () => {
    expect([...MESSAGE_MODERATION_ACTIONS]).toEqual(['dismiss', 'deleteMessage']);
    expect(isMessageModerationAction('banUser')).toBe(false);
  });

  it('hält alle Chat-Ereignisse im Katalog aus Pflichtenheft §14', () => {
    for (const event of CHAT_EVENTS) {
      expect(WEBSOCKET_EVENTS).toContain(event);
    }

    expect(isChatEventName('message.sent')).toBe(true);
    expect(isChatEventName('server.started')).toBe(false);
  });

  it('bringt für jeden Fehlerfall des Chats einen benannten Code mit (§5.1)', () => {
    for (const code of [
      'CONVERSATION_NOT_FOUND',
      'CONVERSATION_RECIPIENT_INVALID',
      'CONVERSATION_RECIPIENT_NOT_ALLOWED',
      'MESSAGE_NOT_FOUND',
      'MESSAGE_ALREADY_DELETED',
      'MESSAGE_REPORT_NOT_FOUND',
      'MESSAGE_REPORT_DUPLICATE',
      'MESSAGE_REPORT_NOT_ALLOWED',
      'MESSAGE_REPORT_ALREADY_RESOLVED',
    ] as const) {
      expect(ERROR_CATALOG[code]).toBeDefined();
    }
  });

  /**
   * Die Existenz einer fremden Unterhaltung ist selbst schon eine Information
   * (Pflichtenheft §15) – deshalb 404 statt 403.
   */
  it('meldet eine nicht sichtbare Konversation als „nicht gefunden"', () => {
    expect(ERROR_CATALOG.CONVERSATION_NOT_FOUND.httpStatus).toBe(404);
    expect(ERROR_CATALOG.MESSAGE_NOT_FOUND.httpStatus).toBe(404);
  });

  it('führt die Moderation über die Permission aus B2', () => {
    expect(PERMISSION_CATALOG['message.moderate']).toBeDefined();
  });

  it('hält die Seitengrenzen des Verlaufs plausibel', () => {
    expect(MESSAGE_PAGE_DEFAULT_LIMIT).toBeLessThanOrEqual(MESSAGE_PAGE_MAX_LIMIT);
  });
});

/**
 * Close-Codes des Chat-Live-Kanals (Audit W2-2/W2-3/W2-19, Contracts-Nachzug
 * W2-C2).
 *
 * Vorher lagen sie backend-lokal, das Frontend führte eine Kopie und ein Test
 * hielt sie gegen die Konstante des Inbox-Kanals.
 */
describe('Close-Codes des Chat-Live-Kanals', () => {
  it('liegen im privaten Bereich (4000-4999)', () => {
    for (const code of [
      CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED,
      CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS,
    ]) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
  });

  it('unterscheidet den endgültigen vom wiederholbaren Fall', () => {
    // Nach 4401 verbindet der Browser nicht neu, nach 4029 schon – nur eben
    // nicht sofort und nicht hundertfach.
    expect(CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED).not.toBe(CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS);
  });
});
