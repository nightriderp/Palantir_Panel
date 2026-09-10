import { describe, expect, it } from 'vitest';
import { ERROR_CATALOG } from './errors.js';
import { WEBSOCKET_EVENTS } from './events.js';
import {
  LIVE_SERVER_EVENTS,
  LIVE_SERVER_LIST_EVENTS,
  LIVE_SERVER_LIST_TOPIC,
  SERVER_LIVE_CLOSE_CODE_FORBIDDEN,
  SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED,
  type LiveClientFrame,
  type ServerLiveErrorFrame,
  type ServerLiveExtraFrame,
  type ServerLivePongFrame,
  type ServerLiveResyncFrame,
  isLiveServerEventName,
  isLiveServerListEventName,
} from './server-live.js';

describe('LIVE_SERVER_EVENTS', () => {
  it('steht vollständig im Katalog WEBSOCKET_EVENTS', () => {
    for (const event of LIVE_SERVER_EVENTS) {
      expect(WEBSOCKET_EVENTS).toContain(event);
    }
  });

  it('folgt dem Benennungsschema <domäne>.<vorgang> (Pflichtenheft §14)', () => {
    for (const event of LIVE_SERVER_EVENTS) {
      expect(event).toMatch(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
    }
  });

  it('enthält keinen Namen doppelt', () => {
    expect(new Set(LIVE_SERVER_EVENTS).size).toBe(LIVE_SERVER_EVENTS.length);
  });

  it('erkennt eigene Namen und weist fremde ab', () => {
    expect(isLiveServerEventName('server.statsUpdated')).toBe(true);
    // Ein Katalog-Ereignis, das über die Notification-Engine läuft, nicht hier.
    expect(isLiveServerEventName('backup.failed')).toBe(false);
    expect(isLiveServerEventName('server.irgendwas')).toBe(false);
  });
});

/**
 * Listen-Thema (Fundpunkt 173): Angelegt, geklont, gelöscht kommen nicht auf
 * einem Server an – den gibt es beim Anlegen noch nicht und beim Löschen nicht
 * mehr –, sondern auf der Liste des Aufrufers.
 */
describe('Listen-Thema und Listen-Ereignisse (Fundpunkt 173)', () => {
  it('führt die Listen-Ereignisse auch unter den Live-Ereignissen', () => {
    for (const event of LIVE_SERVER_LIST_EVENTS) {
      expect(LIVE_SERVER_EVENTS).toContain(event);
      expect(isLiveServerEventName(event)).toBe(true);
    }
  });

  it('unterscheidet Listen-Ereignisse von denen eines einzelnen Servers', () => {
    expect(isLiveServerListEventName('server.created')).toBe(true);
    expect(isLiveServerListEventName('server.deleted')).toBe(true);
    expect(isLiveServerListEventName('server.cloned')).toBe(true);
    expect(isLiveServerListEventName('server.statusChanged')).toBe(false);
    expect(isLiveServerListEventName('backup.progressed')).toBe(false);
  });

  it('hat genau ein Listen-Thema mit fester Id', () => {
    // `id` bleibt, damit der Abo-Schlüssel `resource:id` auf beiden Seiten
    // derselbe ist wie bei einem Server-Thema.
    expect(LIVE_SERVER_LIST_TOPIC).toEqual({ resource: 'serverList', id: 'all' });
  });
});

/**
 * Frames und Close-Codes des Server-Live-Kanals (Audit W2-5, Contracts-Nachzug
 * W2-C2).
 *
 * Bis zu diesem Vertrag lagen beide doppelt im Backend (`live-frames.ts`) und
 * im Frontend (`serverChannel.ts`). Die Tests halten hier fest, was die beiden
 * Seiten voneinander erwarten dürfen.
 */
describe('Close-Codes des Server-Live-Kanals', () => {
  it('liegen im privaten Bereich, damit sie nicht mit Protokoll-Codes kollidieren', () => {
    for (const code of [SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED, SERVER_LIVE_CLOSE_CODE_FORBIDDEN]) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
  });

  it('unterscheidet „nicht angemeldet" von „nicht freigeschaltet"', () => {
    // Der Browser verbindet nach beiden nicht neu – die Zahl sagt ihm aber,
    // was er dem Nutzer anzeigen soll.
    expect(SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED).not.toBe(SERVER_LIVE_CLOSE_CODE_FORBIDDEN);
  });
});

describe('Frames des Server-Live-Kanals', () => {
  it('kennt das Lebenszeichen als Client-Frame ohne Thema', () => {
    // Ohne `topic`: Das Lebenszeichen gilt der Verbindung, nicht einem Abo.
    // Der Typ-Test genügt hier – ein `topic` am `ping` wäre ein Übersetzfehler.
    const ping: LiveClientFrame = { kind: 'ping' };

    expect(ping.kind).toBe('ping');
  });

  it('führt pong, resync und error als Antwort-Frames des Backends', () => {
    const pong: ServerLivePongFrame = { kind: 'pong', sentAt: '2026-09-06T10:00:00.000Z' };
    const resync: ServerLiveResyncFrame = {
      kind: 'resync',
      topic: { resource: 'server', id: 'srv-1' },
      data: { status: 'running', statusMessage: null },
      sentAt: '2026-09-06T10:00:00.000Z',
    };
    const fehler: ServerLiveErrorFrame = {
      kind: 'error',
      topic: null,
      code: 'VALIDATION_FAILED',
      message: 'Der Befehl ist zu lang.',
      sentAt: '2026-09-06T10:00:00.000Z',
    };
    const alle: ServerLiveExtraFrame[] = [pong, resync, fehler];

    expect(alle.map((frame) => frame.kind)).toEqual(['pong', 'resync', 'error']);
  });

  it('lässt im error-Frame nur Codes zu, die im Katalog stehen', () => {
    // Der Typ ist auf drei Codes eingeschränkt; der Test hält fest, dass alle
    // tatsächlich im Katalog geführt werden – ein Tippfehler im Vertrag fiele
    // sonst erst im Browser auf. `RATE_LIMITED` kam mit Fundpunkt 202 dazu.
    const codes: ServerLiveErrorFrame['code'][] = [
      'VALIDATION_FAILED',
      'PERMISSION_DENIED',
      'RATE_LIMITED',
    ];

    for (const code of codes) {
      expect(ERROR_CATALOG[code]).toBeDefined();
    }
  });
});
