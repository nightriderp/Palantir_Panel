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

  it('reicht den Stand einer Sicherung an die Abonnenten (Gefundener Punkt 51)', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const a = collectingSocket();
    const reg = hub.register(a.socket);
    reg.subscribe('server-1');

    hub.ingest('backup.progressed', {
      serverId: 'server-1',
      backup: {
        backupId: 'backup-1',
        status: 'completed',
        isExport: true,
        sizeBytes: 4_096,
        completedAt: '2026-08-31T12:00:00.000Z',
        failureMessage: null,
      },
    });

    expect(a.frames()[0]).toMatchObject({
      event: 'backup.progressed',
      data: { serverId: 'server-1', backup: { backupId: 'backup-1', status: 'completed' } },
    });
  });

  it('verwirft eine Sicherungsmeldung ohne brauchbare Nutzlast', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const a = collectingSocket();
    const reg = hub.register(a.socket);
    reg.subscribe('server-1');

    hub.ingest('backup.progressed', { serverId: 'server-1', backup: null });

    expect(a.frames()).toHaveLength(0);
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

/**
 * Audit W2-5, `orchestration-core-09`: Der Server-Live-Kanal blieb als
 * einziger offen, wenn eine Sitzung entzogen oder ein Konto gesperrt wurde –
 * Chat und Inbox konnten das über `closeAll()` längst.
 */
describe('ServerLiveHub – Rauswurf eines Kontos', () => {
  function schliessbarerSocket() {
    const geschlossen: { code: number; reason?: string }[] = [];
    const sent: string[] = [];

    return {
      geschlossen,
      socket: {
        send: (data: string) => sent.push(data),
        close: (code: number, reason?: string) => geschlossen.push({ code, reason }),
      },
      frames: () => sent.map((raw) => JSON.parse(raw) as Record<string, unknown>),
    };
  }

  it('schließt alle Verbindungen des Kontos und lässt fremde stehen', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const handy = schliessbarerSocket();
    const laptop = schliessbarerSocket();
    const fremd = schliessbarerSocket();

    const regHandy = hub.register(handy.socket, 'user-1');
    hub.register(laptop.socket, 'user-1');
    const regFremd = hub.register(fremd.socket, 'user-2');
    regHandy.subscribe('server-1');
    regFremd.subscribe('server-1');

    expect(hub.closeAll('user-1', 4401, 'Sitzung beendet.')).toBe(2);

    expect(handy.geschlossen).toEqual([{ code: 4401, reason: 'Sitzung beendet.' }]);
    expect(laptop.geschlossen).toEqual([{ code: 4401, reason: 'Sitzung beendet.' }]);
    expect(fremd.geschlossen).toHaveLength(0);
    expect(hub.socketCount).toBe(1);

    hub.publish('server.statusChanged', {
      serverId: 'server-1',
      status: 'running',
      statusMessage: null,
    });

    expect(handy.frames()).toHaveLength(0);
    expect(fremd.frames()).toHaveLength(1);
  });

  it('rührt Verbindungen ohne bekanntes Konto nicht an', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const ohneKonto = schliessbarerSocket();

    hub.register(ohneKonto.socket);

    expect(hub.closeAll('user-1', 4401)).toBe(0);
    expect(hub.socketCount).toBe(1);
  });

  it('nennt die abonnierten Server für die wiederkehrende Prüfung', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const registrierung = hub.register(schliessbarerSocket().socket, 'user-1');

    registrierung.subscribe('server-1');
    registrierung.subscribe('server-2');
    registrierung.unsubscribe('server-1');

    expect(registrierung.subscribedServerIds()).toEqual(['server-2']);
  });
});

/**
 * Listen-Thema (Fundpunkt 173): Angelegt, geklont, gelöscht kommen auf der
 * Liste des Aufrufers an – und nur bei denen, die den Server sehen dürfen.
 */
describe('ServerLiveHub – Listen-Thema (Fundpunkt 173)', () => {
  const BESITZER = 'konto-besitzer';
  const MITGLIED = 'konto-mitglied';
  const FREMD = 'konto-fremd';
  const ADMIN = 'konto-admin';

  const ERWARTET = {
    kind: 'event',
    event: 'server.created',
    topic: { resource: 'serverList', id: 'all' },
    data: { serverId: 'server-1' },
    sentAt: '2026-08-29T00:00:00.000Z',
  };

  it('liefert „angelegt" an Besitzer, Mitglieder und wer alles sehen darf – nicht an Fremde', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const besitzer = collectingSocket();
    const mitglied = collectingSocket();
    const fremd = collectingSocket();
    const admin = collectingSocket();
    const ohneAbo = collectingSocket();
    hub.register(besitzer.socket, BESITZER).subscribeList({ seesAll: false });
    hub.register(mitglied.socket, MITGLIED).subscribeList({ seesAll: false });
    hub.register(fremd.socket, FREMD).subscribeList({ seesAll: false });
    hub.register(admin.socket, ADMIN).subscribeList({ seesAll: true });
    // Nur den Server abonniert, nicht die Liste: Das Ereignis gehört nicht dorthin.
    hub.register(ohneAbo.socket, BESITZER).subscribe('server-1');

    hub.ingest('server.created', {
      serverId: 'server-1',
      serverName: 'Neu',
      ownerId: BESITZER,
      memberUserIds: [MITGLIED],
      detail: null,
    });

    // Nur die Id – Name und Rechte holt der Browser über REST.
    expect(besitzer.frames()).toEqual([ERWARTET]);
    expect(mitglied.frames()).toEqual([ERWARTET]);
    expect(admin.frames()).toEqual([ERWARTET]);
    expect(fremd.frames()).toEqual([]);
    expect(ohneAbo.frames()).toEqual([]);
  });

  it('verwirft ein Listen-Ereignis ohne Besitzer in der Nutzlast', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const admin = collectingSocket();
    hub.register(admin.socket, ADMIN).subscribeList({ seesAll: true });

    hub.ingest('server.deleted', { serverId: 'server-1' });

    expect(admin.frames()).toEqual([]);
  });

  it('stellt nach unsubscribeList nichts mehr zu', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const besitzer = collectingSocket();
    const reg = hub.register(besitzer.socket, BESITZER);
    reg.subscribeList({ seesAll: false });
    expect(reg.isListSubscribed()).toBe(true);

    reg.unsubscribeList();
    hub.ingest('server.deleted', {
      serverId: 'server-1',
      serverName: 'Weg',
      ownerId: BESITZER,
      memberUserIds: [],
      detail: null,
    });

    expect(reg.isListSubscribed()).toBe(false);
    expect(besitzer.frames()).toEqual([]);
  });

  it('gibt einem Socket ohne Konto nur mit seesAll etwas', () => {
    const hub = new ServerLiveHub(FIXED_NOW);
    const anonym = collectingSocket();
    hub.register(anonym.socket).subscribeList({ seesAll: false });

    hub.ingest('server.cloned', {
      serverId: 'server-1',
      serverName: 'Klon',
      ownerId: BESITZER,
      memberUserIds: [],
      detail: null,
    });

    expect(anonym.frames()).toEqual([]);
  });
});
