/**
 * DTO-Aufbau für Nachrichten und Meldungen ohne bestehendes Konto
 * (Fundpunkt 141).
 *
 * Seit dem Löschen eines Kontos dessen Nachrichten und Meldungen stehen
 * bleiben, kommen `senderId` und `reportedById` als `null` hier an. Geprüft
 * wird, was der Vertrag daraus verlangt: eine leere Kennung, aber nie ein
 * leerer Anzeigename – und eine Herkunftsangabe der Löschung, die nicht aus
 * zwei `null` erschlossen wird.
 */

import { DELETED_ACCOUNT_DISPLAY_NAME } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { messageDtoSchema } from '@palantir/validation';
import { toMessageDto, toMessageReportDto } from './dto.js';
import { ALEX, BEA, MOD, actorWith, testId } from './test-doubles.js';
import type { ConversationRecord, MessageRecord, MessageReportRecord } from './types.js';

const ZEITPUNKT = new Date('2026-08-26T12:00:00.000Z');
const NACHRICHT_ID = testId('e1');
const KONVERSATION_ID = testId('c1');
const MELDUNG_ID = testId('f1');

function nachricht(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: NACHRICHT_ID,
    conversationId: KONVERSATION_ID,
    senderId: ALEX,
    content: 'Hallo',
    createdAt: ZEITPUNKT,
    deletedAt: null,
    deletedById: null,
    deletedByModerator: null,
    ...overrides,
  };
}

function meldung(overrides: Partial<MessageReportRecord> = {}): MessageReportRecord {
  return {
    id: MELDUNG_ID,
    messageId: NACHRICHT_ID,
    reportedById: BEA,
    reason: 'Beleidigung',
    reportedContent: 'Hallo',
    status: 'open',
    actionTaken: null,
    moderatorNote: null,
    resolvedById: null,
    resolvedAt: null,
    createdAt: ZEITPUNKT,
    ...overrides,
  };
}

const KONVERSATION: ConversationRecord = {
  id: KONVERSATION_ID,
  type: 'dm',
  serverId: null,
  dmKey: `${ALEX}:${BEA}`,
  createdAt: ZEITPUNKT,
};

const OHNE_NAMEN = new Map<string, string>();

describe('Nachricht ohne bestehendes Absender-Konto', () => {
  it('liefert eine leere Kennung, aber den festen Anzeigenamen', () => {
    const dto = toMessageDto(nachricht({ senderId: null }), {
      viewerId: BEA,
      displayNames: OHNE_NAMEN,
      reportedByViewer: new Set(),
    });

    expect(dto.senderId).toBeNull();
    expect(dto.senderDisplayName).toBe(DELETED_ACCOUNT_DISPLAY_NAME);

    /*
     * Gegen das Vertrags-Schema geprüft und nicht nur gegen die Erwartung
     * oben: `senderDisplayName` ist dort `z.string().min(1)`. Ein `null` oder
     * ein leerer Text käme über die Leitung an und ließe jede Ansicht selbst
     * entscheiden, was stattdessen dasteht.
     */
    expect(() => messageDtoSchema.parse(dto)).not.toThrow();
  });

  it('nennt die Löschung durch einen Moderator auch dann richtig, wenn beide Konten fehlen', () => {
    /*
     * Der Fall, an dem die alte Ableitung `deletedById !== senderId`
     * zerbricht: Beide Kennungen sind `null`, der Vergleich ergäbe `false` und
     * die Ansicht schriebe „Diese Nachricht wurde gelöscht" statt „nach einer
     * Meldung entfernt". Die Angabe wird deshalb geführt.
     */
    const dto = toMessageDto(
      nachricht({
        senderId: null,
        deletedAt: ZEITPUNKT,
        deletedById: null,
        deletedByModerator: true,
      }),
      { viewerId: BEA, displayNames: OHNE_NAMEN, reportedByViewer: new Set() },
    );

    expect(dto.deletedByModerator).toBe(true);
    expect(dto.content).toBe('');
  });

  it('bleibt bei der Rücknahme durch den Absender bei „selbst gelöscht"', () => {
    const dto = toMessageDto(
      nachricht({
        senderId: null,
        deletedAt: ZEITPUNKT,
        deletedById: null,
        deletedByModerator: false,
      }),
      { viewerId: BEA, displayNames: OHNE_NAMEN, reportedByViewer: new Set() },
    );

    expect(dto.deletedByModerator).toBe(false);
  });

  it('lässt die Angabe leer, solange die Nachricht steht', () => {
    const dto = toMessageDto(nachricht({ senderId: null }), {
      viewerId: BEA,
      displayNames: OHNE_NAMEN,
      reportedByViewer: new Set(),
    });

    expect(dto.deletedByModerator).toBeNull();
  });
});

describe('Meldung ohne bestehendes Melder-Konto', () => {
  it('bleibt vollständig und trägt den festen Anzeigenamen', () => {
    const dto = toMessageReportDto(meldung({ reportedById: null }), {
      actor: actorWith('message.moderate'),
      viewerId: MOD,
      displayNames: OHNE_NAMEN,
      message: nachricht({ senderId: null }),
      conversation: KONVERSATION,
    });

    expect(dto.reportedById).toBeNull();
    expect(dto.reportedByDisplayName).toBe(DELETED_ACCOUNT_DISPLAY_NAME);
    expect(dto.message.senderId).toBeNull();
    expect(dto.message.senderDisplayName).toBe(DELETED_ACCOUNT_DISPLAY_NAME);
    // Die Beweiskopie ist der Grund, warum die Meldung stehen bleibt.
    expect(dto.message.content).toBe('Hallo');
    expect(dto.permissions).toEqual({ canView: true, canResolve: true });
  });
});
