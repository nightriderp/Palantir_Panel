import { describe, expect, it } from 'vitest';
import { WEBSOCKET_EVENTS, isWebSocketEventName } from './events.js';

describe('WebSocket-Event-Namen (Pflichtenheft §14)', () => {
  it('enthält die im Pflichtenheft genannten Events', () => {
    expect([...WEBSOCKET_EVENTS]).toEqual(
      expect.arrayContaining([
        'server.started',
        'server.stopped',
        'server.crashed',
        'server.statusChanged',
        'server.statsUpdated',
        'server.consoleLineAppended',
        'serverClone.progressed',
        'backup.failed',
        'autoShutdown.triggered',
        'resource.low',
        'user.registered',
        'message.reported',
      ]),
    );
  });

  it('enthält die Ereignisse der Server-Orchestrierung (B3, Pflichtenheft §9)', () => {
    expect([...WEBSOCKET_EVENTS]).toEqual(
      expect.arrayContaining([
        'server.created',
        'server.deleted',
        'server.restarted',
        'server.failed',
        'server.cloned',
      ]),
    );
  });

  it('führt jeden Namen nur einmal', () => {
    expect(new Set(WEBSOCKET_EVENTS).size).toBe(WEBSOCKET_EVENTS.length);
  });

  it('hält das Benennungsschema <domäne>.<vorgang> in lowerCamelCase ein', () => {
    for (const name of WEBSOCKET_EVENTS) {
      expect(name).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });

  it('isWebSocketEventName() erkennt unbekannte Namen', () => {
    expect(isWebSocketEventName('server.started')).toBe(true);
    expect(isWebSocketEventName('server.exploded')).toBe(false);
  });
});
