/**
 * Live-Zustellung (Pflichtenheft §5.3).
 *
 * Der Verteiler adressiert je Konto. Dass er selbst keinen Teilnehmerkreis
 * auflöst, ist Absicht: Die Sichtbarkeitsregel steht in `visibility.ts` und
 * soll nicht an zwei Stellen leben.
 */

import { describe, expect, it } from 'vitest';
import { ChatLiveHub, conversationReadFrame, messageSentFrame } from './live.js';
import { ALEX, BEA } from './test-doubles.js';

function fakeSocket(): { sent: string[]; send: (data: string) => void } {
  const sent: string[] = [];

  return { sent, send: (data) => sent.push(data) };
}

const FRAME = messageSentFrame(
  {
    conversationId: 'c',
    message: {
      id: 'm',
      conversationId: 'c',
      senderId: ALEX,
      senderDisplayName: 'Alex',
      content: 'Hallo',
      createdAt: '2026-08-26T12:00:00.000Z',
      deletedAt: null,
      deletedByModerator: null,
      reportedByViewer: false,
      permissions: { canDelete: false, canReport: true },
    },
  },
  new Date('2026-08-26T12:00:01.000Z'),
);

describe('ChatLiveHub', () => {
  it('stellt nur dem adressierten Konto zu', () => {
    const hub = new ChatLiveHub();
    const alex = fakeSocket();
    const bea = fakeSocket();

    hub.register(ALEX, alex);
    hub.register(BEA, bea);
    hub.deliver(BEA, FRAME);

    expect(alex.sent).toHaveLength(0);
    expect(bea.sent).toHaveLength(1);
    expect(JSON.parse(bea.sent[0] ?? '{}')).toMatchObject({
      kind: 'event',
      event: 'message.sent',
    });
  });

  it('bedient alle Verbindungen eines Kontos – mehrere Geräte oder Tabs', () => {
    const hub = new ChatLiveHub();
    const handy = fakeSocket();
    const laptop = fakeSocket();

    hub.register(ALEX, handy);
    hub.register(ALEX, laptop);

    expect(hub.connectionCount(ALEX)).toBe(2);

    hub.deliver(ALEX, FRAME);

    expect(handy.sent).toHaveLength(1);
    expect(laptop.sent).toHaveLength(1);
  });

  it('meldet eine Verbindung ab, auch wenn close und error nacheinander kommen', () => {
    const hub = new ChatLiveHub();
    const socket = fakeSocket();
    const abmelden = hub.register(ALEX, socket);

    abmelden();
    abmelden();

    expect(hub.connectionCount(ALEX)).toBe(0);

    hub.deliver(ALEX, FRAME);

    expect(socket.sent).toHaveLength(0);
  });

  /** Ein halb geschlossener Socket darf die anderen nicht um ihre Nachricht bringen. */
  it('stellt weiter zu, wenn eine Verbindung beim Senden scheitert', () => {
    const hub = new ChatLiveHub();
    const kaputt = {
      send: () => {
        throw new Error('socket closed');
      },
    };
    const heil = fakeSocket();

    hub.register(ALEX, kaputt);
    hub.register(ALEX, heil);

    expect(() => {
      hub.deliver(ALEX, FRAME);
    }).not.toThrow();
    expect(heil.sent).toHaveLength(1);
  });

  it('verwirft eine Zustellung an ein Konto ohne offene Verbindung', () => {
    const hub = new ChatLiveHub();

    expect(() => {
      hub.deliver(ALEX, FRAME);
    }).not.toThrow();
  });
});

describe('conversationReadFrame', () => {
  it('baut ein conversation.read-Frame mit Lesestand und Zähler', () => {
    const frame = conversationReadFrame(
      { conversationId: 'c', lastReadAt: '2026-08-26T12:00:00.000Z', unreadCount: 0 },
      new Date('2026-08-26T12:00:01.000Z'),
    );

    expect(frame).toEqual({
      kind: 'event',
      event: 'conversation.read',
      data: { conversationId: 'c', lastReadAt: '2026-08-26T12:00:00.000Z', unreadCount: 0 },
      sentAt: '2026-08-26T12:00:01.000Z',
    });
  });
});
