import { MESSAGE_MAX_LENGTH } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  createDirectConversationInputSchema,
  messageContentSchema,
  messagePageQuerySchema,
  messageReportQuerySchema,
  messageReportReasonSchema,
  reportMessageInputSchema,
  resolveMessageReportInputSchema,
  sendMessageInputSchema,
} from './chat.js';

describe('Chat-Schemas (Lastenheft §3.6)', () => {
  it('beschneidet den Nachrichtentext und lehnt leere Nachrichten ab', () => {
    expect(messageContentSchema.parse('  Hallo  ')).toBe('Hallo');
    expect(messageContentSchema.safeParse('   ').success).toBe(false);
    expect(messageContentSchema.safeParse('').success).toBe(false);
  });

  it('begrenzt die Nachrichtenlänge auf den Wert aus dem Vertrag', () => {
    expect(messageContentSchema.safeParse('x'.repeat(MESSAGE_MAX_LENGTH)).success).toBe(true);
    expect(messageContentSchema.safeParse('x'.repeat(MESSAGE_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('verlangt eine Begründung bei der Meldung', () => {
    expect(reportMessageInputSchema.safeParse({ reason: 'Beleidigung' }).success).toBe(true);
    expect(reportMessageInputSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(messageReportReasonSchema.safeParse('x'.repeat(501)).success).toBe(false);
  });

  it('verlangt eine UUID als Empfänger einer Direktnachricht', () => {
    expect(
      createDirectConversationInputSchema.safeParse({
        recipientId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);
    expect(createDirectConversationInputSchema.safeParse({ recipientId: 'spieler' }).success).toBe(
      false,
    );
  });

  it('lässt als Moderationsentscheidung nur die benannten Aktionen zu', () => {
    expect(resolveMessageReportInputSchema.safeParse({ action: 'dismiss' }).success).toBe(true);
    expect(
      resolveMessageReportInputSchema.safeParse({ action: 'deleteMessage', note: 'Spam' }).success,
    ).toBe(true);
    expect(resolveMessageReportInputSchema.safeParse({ action: 'banUser' }).success).toBe(false);
  });

  it('setzt Vorgaben beim Blättern im Verlauf', () => {
    const query = messagePageQuerySchema.parse({});

    expect(query.limit).toBe(50);
    expect(query.before).toBeUndefined();
    expect(messagePageQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('zeigt in der Moderationsübersicht ohne Filter die offenen Meldungen', () => {
    expect(messageReportQuerySchema.parse({}).status).toBe('open');
  });

  it('nimmt eine Nachricht nur mit Inhalt entgegen', () => {
    expect(sendMessageInputSchema.safeParse({ content: 'Hi' }).success).toBe(true);
    expect(sendMessageInputSchema.safeParse({}).success).toBe(false);
  });
});
