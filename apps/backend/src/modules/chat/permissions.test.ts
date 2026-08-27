/**
 * `permissions`-Objekte des Chats (Pflichtenheft §5.2).
 *
 * Wichtigster Punkt: `message.moderate` erzeugt an einer Konversation und an
 * einer Nachricht **kein** Flag – die Permission wirkt ausschließlich auf
 * Meldungen.
 */

import { describe, expect, it } from 'vitest';
import {
  computeConversationPermissions,
  computeMessagePermissions,
  computeMessageReportPermissions,
} from './permissions.js';
import { ALEX, BEA, CHRIS, MOD, actorWith, ownerActor } from './test-doubles.js';
import type { ConversationAudience } from './visibility.js';

const AUDIENCE: ConversationAudience = {
  conversation: {
    id: 'c',
    type: 'dm',
    serverId: null,
    dmKey: `${ALEX}:${BEA}`,
    createdAt: new Date('2026-08-26T12:00:00.000Z'),
  },
  participantIds: [ALEX, BEA],
  server: null,
};

function nachricht(overrides: Partial<Parameters<typeof computeMessagePermissions>[0]> = {}) {
  return {
    id: 'm',
    conversationId: 'c',
    senderId: ALEX,
    content: 'Hallo',
    createdAt: new Date('2026-08-26T12:00:00.000Z'),
    deletedAt: null,
    deletedById: null,
    ...overrides,
  };
}

describe('Konversation', () => {
  it('erlaubt Teilnehmern Lesen und Schreiben', () => {
    expect(computeConversationPermissions(AUDIENCE, ALEX)).toEqual({
      canView: true,
      canSendMessage: true,
    });
  });

  it('gibt Unbeteiligten nichts – auch nicht dem Moderator oder Owner', () => {
    expect(computeConversationPermissions(AUDIENCE, MOD)).toEqual({
      canView: false,
      canSendMessage: false,
    });
    expect(computeConversationPermissions(AUDIENCE, CHRIS)).toEqual({
      canView: false,
      canSendMessage: false,
    });
  });
});

describe('Nachricht', () => {
  it('lässt den Absender die eigene Nachricht löschen, aber nicht melden', () => {
    expect(computeMessagePermissions(nachricht(), ALEX, false)).toEqual({
      canDelete: true,
      canReport: false,
    });
  });

  it('lässt Mitleser melden, aber nicht löschen', () => {
    expect(computeMessagePermissions(nachricht(), BEA, false)).toEqual({
      canDelete: false,
      canReport: true,
    });
  });

  it('bietet die Meldung nach der eigenen Meldung nicht erneut an', () => {
    expect(computeMessagePermissions(nachricht(), BEA, true).canReport).toBe(false);
  });

  it('bietet an einer gelöschten Nachricht weder Löschen noch Melden an', () => {
    const geloescht = nachricht({ deletedAt: new Date(), deletedById: ALEX });

    expect(computeMessagePermissions(geloescht, ALEX, false)).toEqual({
      canDelete: false,
      canReport: false,
    });
    expect(computeMessagePermissions(geloescht, BEA, false).canReport).toBe(false);
  });
});

describe('Meldung', () => {
  const offen = { reportedById: BEA, status: 'open' };

  it('lässt die Moderation sehen und entscheiden', () => {
    expect(computeMessageReportPermissions(actorWith('message.moderate'), MOD, offen)).toEqual({
      canView: true,
      canResolve: true,
    });
  });

  it('lässt den Melder die eigene Meldung sehen, aber nicht entscheiden', () => {
    expect(computeMessageReportPermissions(actorWith(), BEA, offen)).toEqual({
      canView: true,
      canResolve: false,
    });
  });

  it('zeigt Dritten nichts', () => {
    expect(computeMessageReportPermissions(actorWith(), CHRIS, offen)).toEqual({
      canView: false,
      canResolve: false,
    });
  });

  it('bietet an einer bereits entschiedenen Meldung kein zweites Entscheiden an', () => {
    expect(
      computeMessageReportPermissions(ownerActor(), MOD, { reportedById: BEA, status: 'resolved' })
        .canResolve,
    ).toBe(false);
  });
});
