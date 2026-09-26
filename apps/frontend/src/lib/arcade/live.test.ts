import { describe, expect, it } from 'vitest';
import { arcadeChannelUrl, parseArcadeFrame } from './live';

describe('arcadeChannelUrl', () => {
  it('leitet ohne Vorgabe aus der API-Adresse ab', () => {
    expect(arcadeChannelUrl(undefined, 'https://beispiel.tld/api')).toBe(
      'wss://beispiel.tld/api/arcade/live',
    );
    expect(arcadeChannelUrl(undefined, 'http://localhost:4000/')).toBe(
      'ws://localhost:4000/arcade/live',
    );
  });

  it('legt den Kanal neben den Server-Kanal, nicht darunter', () => {
    expect(arcadeChannelUrl('wss://beispiel.tld/api/live', '')).toBe(
      'wss://beispiel.tld/api/arcade/live',
    );
    expect(arcadeChannelUrl('wss://beispiel.tld/api/arcade/live/', '')).toBe(
      'wss://beispiel.tld/api/arcade/live',
    );
  });
});

describe('parseArcadeFrame', () => {
  it('liest Raum-Ereignisse', () => {
    const frame = parseArcadeFrame(
      JSON.stringify({
        kind: 'event',
        event: 'arcadeRoom.updated',
        data: { roomId: 'r1', version: 3, status: 'running' },
        sentAt: '2026-09-26T00:00:00.000Z',
      }),
    );
    expect(frame?.data).toEqual({ roomId: 'r1', version: 3, status: 'running' });
  });

  it('verwirft pong, fremde Ereignisse und Unfug', () => {
    expect(parseArcadeFrame('{"kind":"pong"}')).toBeNull();
    expect(parseArcadeFrame('{"kind":"event","event":"server.started","data":{}}')).toBeNull();
    expect(
      parseArcadeFrame('{"kind":"event","event":"arcadeRoom.updated","data":{"roomId":1}}'),
    ).toBeNull();
    expect(parseArcadeFrame('kein json')).toBeNull();
  });
});
