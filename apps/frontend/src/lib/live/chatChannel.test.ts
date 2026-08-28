import { describe, expect, it } from 'vitest';
import { chatChannelUrl, parseChatFrame } from './chatChannel';

describe('chatChannelUrl', () => {
  it('hängt den Chat-Pfad an die konfigurierte Live-Adresse', () => {
    expect(chatChannelUrl('wss://api.example.tld/live', 'https://api.example.tld')).toBe(
      'wss://api.example.tld/live/chat',
    );
  });

  it('leitet die Adresse aus der API-Basis ab, wenn nichts konfiguriert ist', () => {
    expect(chatChannelUrl(undefined, 'https://api.example.tld')).toBe(
      'wss://api.example.tld/api/chat/live',
    );
  });

  it('macht aus http ein ws', () => {
    expect(chatChannelUrl(undefined, 'http://localhost:4000')).toBe(
      'ws://localhost:4000/api/chat/live',
    );
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
