import { NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { CLOSE_CODE_UNAUTHORIZED, chatChannelUrl, parseChatFrame } from './chatChannel';

/*
 * Die erwartete Adresse ist keine freie Wahl: Das Backend registriert den
 * Chat-Kanal ausschließlich unter `/api/chat/live`
 * (`apps/backend/src/modules/chat/routes.ts`). Zuvor wurde bei gesetztem
 * `NEXT_PUBLIC_LIVE_WS_URL` `…/live/chat` angesteuert – ein Pfad, den es nie gab
 * (Finding contract-drift-02). Der Handshake scheiterte still, der Hook versuchte
 * es endlos erneut, und die Ansicht blieb bei „Wird verbunden".
 */
const BACKEND_PFAD = '/api/chat/live';

describe('chatChannelUrl', () => {
  it('trifft die Backend-Route, wenn NEXT_PUBLIC_LIVE_WS_URL gesetzt ist', () => {
    // Der konfigurierte Wert ist die Adresse des Server-Kanals (`…/live`), nicht
    // nur der Ursprung – siehe .env.example.
    expect(chatChannelUrl('wss://api.example.tld/live', 'https://api.example.tld')).toBe(
      `wss://api.example.tld${BACKEND_PFAD}`,
    );
  });

  it('behält ws, wenn der konfigurierte Kanal unverschlüsselt läuft', () => {
    expect(chatChannelUrl('ws://localhost:4000/live', 'http://localhost:4000')).toBe(
      `ws://localhost:4000${BACKEND_PFAD}`,
    );
  });

  it('verträgt abschließende Schrägstriche im konfigurierten Wert', () => {
    expect(chatChannelUrl('wss://api.example.tld/live//', 'https://api.example.tld')).toBe(
      `wss://api.example.tld${BACKEND_PFAD}`,
    );
  });

  it('kommt auch mit einem konfigurierten Ursprung ohne /live zurecht', () => {
    expect(chatChannelUrl('wss://live.example.tld', 'https://api.example.tld')).toBe(
      `wss://live.example.tld${BACKEND_PFAD}`,
    );
  });

  it('hängt den Pfad nicht doppelt an einen bereits vollständigen Wert', () => {
    expect(chatChannelUrl(`wss://api.example.tld${BACKEND_PFAD}`, 'https://api.example.tld')).toBe(
      `wss://api.example.tld${BACKEND_PFAD}`,
    );
  });

  it('leitet die Adresse aus der API-Basis ab, wenn nichts konfiguriert ist – https wird wss', () => {
    expect(chatChannelUrl(undefined, 'https://api.example.tld')).toBe(
      `wss://api.example.tld${BACKEND_PFAD}`,
    );
  });

  it('macht aus http ein ws', () => {
    expect(chatChannelUrl(undefined, 'http://localhost:4000')).toBe(
      `ws://localhost:4000${BACKEND_PFAD}`,
    );
  });

  it('liefert in beiden Zweigen denselben Pfad', () => {
    const konfiguriert = new URL(chatChannelUrl('wss://api.example.tld/live', 'https://egal.tld'));
    const abgeleitet = new URL(chatChannelUrl(undefined, 'https://api.example.tld'));

    expect(konfiguriert.pathname).toBe(BACKEND_PFAD);
    expect(abgeleitet.pathname).toBe(BACKEND_PFAD);
  });
});

/*
 * Provisorium, solange `@palantir/contracts` keine Konstante für den Chat-Kanal
 * führt (Finding frontend-lib-10): Backend (`chat/live.ts`,
 * `CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED`) und Frontend halten die Zahl je lokal.
 * Dieser Test hält sie an die einzige Stelle, an der sie im Vertrag steht –
 * läuft eine der beiden weg, fällt es hier auf statt erst im Browser.
 */
describe('CLOSE_CODE_UNAUTHORIZED', () => {
  it('ist dieselbe Zahl wie im Vertrag für den Inbox-Kanal', () => {
    expect(CLOSE_CODE_UNAUTHORIZED).toBe(NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED);
  });

  it('liegt im privaten Bereich, damit er nicht mit einem Protokoll-Code kollidiert', () => {
    expect(CLOSE_CODE_UNAUTHORIZED).toBeGreaterThanOrEqual(4000);
    expect(CLOSE_CODE_UNAUTHORIZED).toBeLessThanOrEqual(4999);
  });
});

describe('parseChatFrame', () => {
  it('liest ein gültiges Ereignis-Frame', () => {
    const raw = JSON.stringify({
      kind: 'event',
      event: 'message.sent',
      data: { conversationId: 'c1', message: { id: 'm1' } },
      sentAt: '2026-08-28T10:00:00.000Z',
    });

    const frame = parseChatFrame(raw);
    expect(frame?.event).toBe('message.sent');
  });

  it('liest auch das Lesestand-Ereignis – es steuert den Ungelesen-Zähler', () => {
    const raw = JSON.stringify({
      kind: 'event',
      event: 'conversation.read',
      data: { conversationId: 'c1', lastReadAt: '2026-08-28T10:00:00.000Z', unreadCount: 0 },
      sentAt: '2026-08-28T10:00:00.000Z',
    });

    expect(parseChatFrame(raw)?.event).toBe('conversation.read');
  });

  it('verwirft beschädigtes JSON', () => {
    expect(parseChatFrame('{nope')).toBeNull();
  });

  it('verwirft unbekannte Ereignisnamen', () => {
    const raw = JSON.stringify({ kind: 'event', event: 'server.started', data: {} });
    expect(parseChatFrame(raw)).toBeNull();
  });

  it('verwirft Frames ohne Datenobjekt', () => {
    const raw = JSON.stringify({ kind: 'event', event: 'message.deleted', data: null });
    expect(parseChatFrame(raw)).toBeNull();
  });

  it('verwirft Frames, die keine Ereignisse sind', () => {
    expect(parseChatFrame(JSON.stringify({ kind: 'pong' }))).toBeNull();
  });
});
