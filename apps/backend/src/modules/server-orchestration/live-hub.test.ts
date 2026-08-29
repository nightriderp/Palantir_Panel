import { describe, expect, it, vi } from 'vitest';
import { ServerLiveHub, createLiveFanoutSink } from './live-hub.js';

function collectingSocket() {
  const sent: string[] = [];
  return {
    socket: { send: (data: string) => sent.push(data) },
    frames: () => sent.map((raw) => JSON.parse(raw) as Record<string, unknown>),
  };
}

const FIXED_NOW = () => new Date('2026-08-29T00:00:00.000Z');

describe('ServerLiveHub – Abos und Zustellung', () => {
  it('liefert Ereignisse nur an Sockets, die den Server abonniert haben', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const a = collectingSocket();
    const b = collectingSocket();
    const regA = hub.register(a.socket);
    hub.register(b.socket);

    regA.subscribe('server-1');

    hub.publish('server.statusChanged', {
      serverId: 'server-1',
      status: 'running',
      statusMessage: null,
    });

    expect(a.frames()).toHaveLength(1);
    expect(a.frames()[0]).toMatchObject({
      kind: 'event',
      event: 'server.statusChanged',
      topic: { resource: 'server', id: 'server-1' },
      data: { serverId: 'server-1', status: 'running' },
      sentAt: '2026-08-29T00:00:00.000Z',
    });
    // b hat nicht abonniert -> nichts bekommen.
    expect(b.frames()).toHaveLength(0);
  });

  it('stellt nach unsubscribe nichts mehr zu', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const a = collectingSocket();
    const reg = hub.register(a.socket);

    reg.subscribe('server-1');
    reg.unsubscribe('server-1');

    hub.publish('server.statusChanged', {
      serverId: 'server-1',
      status: 'stopped',
      statusMessage: null,
    });

    expect(a.frames()).toHaveLength(0);
  });

  it('entfernt geschlossene Sockets aus dem Verteiler', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const a = collectingSocket();
    const reg = hub.register(a.socket);
    reg.subscribe('server-1');

    expect(hub.socketCount).toBe(1);
    reg.close();
    expect(hub.socketCount).toBe(0);

    hub.publish('server.statusChanged', {
      serverId: 'server-1',
      status: 'stopped',
      statusMessage: null,
    });
    expect(a.frames()).toHaveLength(0);
  });
});

describe('ServerLiveHub.ingest – Umformung der Roh-Ereignisse', () => {
  it('bildet das B3-Ereignis (to) auf den Live-Contract (status) ab', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const a = collectingSocket();
    const reg = hub.register(a.socket);
    reg.subscribe('server-1');

    // So emittiert B3 (from/to), nicht im Live-Contract-Format.
    hub.ingest('server.statusChanged', {
      serverId: 'server-1',
      from: 'starting',
      to: 'running',
      statusMessage: 'bereit',
    });

    expect(a.frames()[0]).toMatchObject({
      data: { serverId: 'server-1', status: 'running', statusMessage: 'bereit' },
    });
  });

  it('verwirft unbekannte Ereignisse und ungültige Zustände', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const a = collectingSocket();
    const reg = hub.register(a.socket);
    reg.subscribe('server-1');

    // Reines Notification-Ereignis (kein Live-Ereignis) -> ignoriert.
    hub.ingest('server.crashed', { serverId: 'server-1', exitCode: 1 });
    // Live-Ereignis, aber unsinniger Zielzustand -> verworfen statt kaputtem Frame.
    hub.ingest('server.statusChanged', { serverId: 'server-1', to: 'explodiert' });

    expect(a.frames()).toHaveLength(0);
  });

  it('reicht Messwerte unverändert durch', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const a = collectingSocket();
    const reg = hub.register(a.socket);
    reg.subscribe('server-1');

    const stats = { cpuPercent: 12, ramUsedMb: 512, playersOnline: 3 };
    hub.ingest('server.statsUpdated', { serverId: 'server-1', stats });

    expect(a.frames()[0]).toMatchObject({
      event: 'server.statsUpdated',
      data: { serverId: 'server-1', stats },
    });
  });
});

describe('createLiveFanoutSink', () => {
  it('reicht jedes Ereignis an Notifications UND den Live-Hub', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const ingest = vi.spyOn(hub, 'ingest');
    const notifications = { emit: vi.fn() };

    const sink = createLiveFanoutSink(notifications, hub);
    sink.emit('server.statusChanged', { serverId: 'server-1', to: 'running' });

    expect(notifications.emit).toHaveBeenCalledWith('server.statusChanged', {
      serverId: 'server-1',
      to: 'running',
    });
    expect(ingest).toHaveBeenCalledWith('server.statusChanged', {
      serverId: 'server-1',
      to: 'running',
    });
  });
});
