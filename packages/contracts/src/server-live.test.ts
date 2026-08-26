import { describe, expect, it } from 'vitest';
import { WEBSOCKET_EVENTS } from './events.js';
import { LIVE_SERVER_EVENTS, isLiveServerEventName } from './server-live.js';

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
