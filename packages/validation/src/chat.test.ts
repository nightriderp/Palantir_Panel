import {
  DELETED_ACCOUNT_DISPLAY_NAME,
  MESSAGE_MAX_LENGTH,
  type MessageDto,
  type MessageReportDto,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  createDirectConversationInputSchema,
  messageContentSchema,
  messageDtoSchema,
  messagePageQuerySchema,
  messageReportDtoSchema,
  messageReportQuerySchema,
  messageReportReasonSchema,
  reportMessageInputSchema,
  reportedMessageDtoSchema,
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

const KONTO = '11111111-1111-4111-8111-111111111111';
const KONVERSATION = '22222222-2222-4222-8222-222222222222';
const NACHRICHT = '33333333-3333-4333-8333-333333333333';
const MELDUNG = '44444444-4444-4444-8444-444444444444';

function nachricht(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: NACHRICHT,
    conversationId: KONVERSATION,
    senderId: KONTO,
    senderDisplayName: 'Femi',
    content: 'Moin',
    createdAt: '2026-09-08T10:00:00.000Z',
    deletedAt: null,
    deletedByModerator: null,
    reportedByViewer: false,
    permissions: { canDelete: false, canReport: true },
    ...overrides,
  };
}

function meldung(overrides: Partial<MessageReportDto> = {}): MessageReportDto {
  return {
    id: MELDUNG,
    messageId: NACHRICHT,
    conversationId: KONVERSATION,
    conversationType: 'server_chat',
    serverId: null,
    reportedById: KONTO,
    reportedByDisplayName: 'Bea',
    reason: 'Beleidigung',
    status: 'open',
    actionTaken: null,
    moderatorNote: null,
    resolvedById: null,
    resolvedByDisplayName: null,
    resolvedAt: null,
    createdAt: '2026-09-08T10:05:00.000Z',
    message: {
      id: NACHRICHT,
      senderId: KONTO,
      senderDisplayName: 'Femi',
      content: 'Moin',
      createdAt: '2026-09-08T10:00:00.000Z',
      deletedAt: null,
    },
    permissions: { canView: true, canResolve: true },
    ...overrides,
  };
}

/** Erzeugt eine Kopie ohne das genannte Feld – „fehlt" statt „ist null". */
function ohne(datensatz: object, feld: string): Record<string, unknown> {
  const kopie: Record<string, unknown> = { ...datensatz };

  delete kopie[feld];

  return kopie;
}

/**
 * Gelöschte Konten (Fundpunkt 141).
 *
 * Der Unterschied zwischen `null` und „Feld fehlt" trägt die ganze Änderung:
 * `null` ist die Aussage „das Konto gibt es nicht mehr", ein fehlendes Feld ist
 * ein Fehler des Absenders der Antwort. Nur der erste Fall wird angenommen.
 */
describe('Ausgabe-Schemas des Chats bei gelöschten Konten (Fundpunkt 141)', () => {
  it('nimmt eine Nachricht ohne Absender an', () => {
    const ergebnis = messageDtoSchema.safeParse(
      nachricht({ senderId: null, senderDisplayName: DELETED_ACCOUNT_DISPLAY_NAME }),
    );

    expect(ergebnis.success).toBe(true);
    // Zod entfernt unbekannte Schlüssel – der Wert muss den Weg durchs Schema
    // wirklich überstehen und nicht nur „nicht scheitern".
    expect(ergebnis.success && ergebnis.data.senderId).toBeNull();
    expect(ergebnis.success && ergebnis.data.senderDisplayName).toBe('Unbekanntes Konto');
  });

  it('lehnt eine Nachricht ohne das Feld `senderId` weiterhin ab', () => {
    expect(messageDtoSchema.safeParse(ohne(nachricht(), 'senderId')).success).toBe(false);
  });

  it('lehnt einen fehlenden oder leeren Anzeigenamen des Absenders ab', () => {
    expect(messageDtoSchema.safeParse(ohne(nachricht(), 'senderDisplayName')).success).toBe(false);
    expect(messageDtoSchema.safeParse({ ...nachricht(), senderDisplayName: null }).success).toBe(
      false,
    );
    expect(messageDtoSchema.safeParse(nachricht({ senderDisplayName: '' })).success).toBe(false);
  });

  it('nimmt die gemeldete Nachricht ohne Absender an, verlangt das Feld aber', () => {
    const gemeldet = meldung().message;

    expect(
      reportedMessageDtoSchema.safeParse({
        ...gemeldet,
        senderId: null,
        senderDisplayName: DELETED_ACCOUNT_DISPLAY_NAME,
      }).success,
    ).toBe(true);
    expect(reportedMessageDtoSchema.safeParse(ohne(gemeldet, 'senderId')).success).toBe(false);
    expect(reportedMessageDtoSchema.safeParse(ohne(gemeldet, 'senderDisplayName')).success).toBe(
      false,
    );
  });

  it('nimmt eine Meldung ohne meldende Person an', () => {
    const ergebnis = messageReportDtoSchema.safeParse(
      meldung({ reportedById: null, reportedByDisplayName: DELETED_ACCOUNT_DISPLAY_NAME }),
    );

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.reportedById).toBeNull();
  });

  it('lehnt eine Meldung ohne das Feld `reportedById` weiterhin ab', () => {
    expect(messageReportDtoSchema.safeParse(ohne(meldung(), 'reportedById')).success).toBe(false);
  });

  it('lehnt einen leeren Anzeigenamen der meldenden Person ab', () => {
    expect(
      messageReportDtoSchema.safeParse({ ...meldung(), reportedByDisplayName: null }).success,
    ).toBe(false);
    expect(messageReportDtoSchema.safeParse(meldung({ reportedByDisplayName: '' })).success).toBe(
      false,
    );
  });

  it('bleibt bei einer Meldung, deren Nachricht und Melder beide gelöscht sind, gültig', () => {
    // Der Fall, den Fundpunkt 141 zuvor gar nicht erst entstehen ließ: Beide
    // Konten weg, die Beweiskopie steht trotzdem noch.
    const ergebnis = messageReportDtoSchema.safeParse(
      meldung({
        reportedById: null,
        reportedByDisplayName: DELETED_ACCOUNT_DISPLAY_NAME,
        message: {
          ...meldung().message,
          senderId: null,
          senderDisplayName: DELETED_ACCOUNT_DISPLAY_NAME,
        },
      }),
    );

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.message.content).toBe('Moin');
  });
});
