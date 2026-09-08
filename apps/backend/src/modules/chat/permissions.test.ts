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
    deletedByModerator: null,
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

  it('macht die Nachricht eines gelöschten Kontos für niemanden zum eigenen Beitrag', () => {
    /*
     * Fundpunkt 141: `senderId` ist `null`, sobald das Konto des Absenders
     * gelöscht wurde. Der kritische Fall ist der Betrachter **ohne** Konto –
     * ohne ausdrückliche `null`-Prüfung träfen sich zwei `null`, `isOwn` wäre
     * wahr und die fremde Nachricht käme mit `canDelete: true` zurück.
     */
    const verwaist = nachricht({ senderId: null });

    expect(computeMessagePermissions(verwaist, null, false)).toEqual({
      canDelete: false,
      canReport: false,
    });
    expect(computeMessagePermissions(verwaist, ALEX, false)).toEqual({
      canDelete: false,
      // Melden bleibt möglich: Der Text steht weiter im Verlauf, und die
      // Entscheidung eines Moderators richtet sich gegen die Nachricht, nicht
      // gegen ein Konto.
      canReport: true,
    });
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

  it('zeigt die Meldung eines gelöschten Melder-Kontos nur noch der Moderation', () => {
    /*
     * `canView` hängt daran, ob der Betrachter selbst der Melder ist. Ist das
     * Melder-Konto gelöscht (`reportedById: null`), darf dieser Vergleich
     * niemanden treffen – erst recht nicht einen Betrachter ohne Konto
     * (Fundpunkt 141). Die Meldung selbst bleibt bestehen und entscheidbar.
     */
    const verwaist = { reportedById: null, status: 'open' };

    expect(computeMessageReportPermissions(actorWith(), null, verwaist).canView).toBe(false);
    expect(computeMessageReportPermissions(actorWith(), CHRIS, verwaist).canView).toBe(false);
    expect(computeMessageReportPermissions(actorWith('message.moderate'), MOD, verwaist)).toEqual({
      canView: true,
      canResolve: true,
    });
  });

  it('bietet an einer bereits entschiedenen Meldung kein zweites Entscheiden an', () => {
    expect(
      computeMessageReportPermissions(ownerActor(), MOD, { reportedById: BEA, status: 'resolved' })
        .canResolve,
    ).toBe(false);
  });
});
