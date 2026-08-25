import { describe, expect, it } from 'vitest';
import { WEBSOCKET_EVENTS, isWebSocketEventName } from './events.js';

describe('WebSocket-Event-Namen (Pflichtenheft §14)', () => {
  it('enthält genau die im Pflichtenheft genannten Events', () => {
    expect([...WEBSOCKET_EVENTS]).toEqual([
      'server.started',
      'server.stopped',
      'server.crashed',
      'backup.failed',
      'autoShutdown.triggered',
      'resource.low',
      'user.registered',
      'message.reported',
    ]);
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
