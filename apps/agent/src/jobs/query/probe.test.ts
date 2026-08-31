import { EventEmitter } from 'node:events';
import type net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createPortConnectProbe, createServerProbe, unreachable } from './probe.js';

/**
 * Socket-Attrappe: Sie verhält sich wie `net.Socket`, soweit die Sonde ihn
 * benutzt (`setTimeout`, `connect`, `destroy` und die drei Ereignisse).
 */
class FakeSocket extends EventEmitter {
  timeoutMs: number | null = null;
  zerstoert = false;
  verbindungen: { host: string; port: number }[] = [];

  setTimeout(ms: number): this {
    this.timeoutMs = ms;
    return this;
  }

  connect(options: { host: string; port: number }): this {
    this.verbindungen.push(options);
    return this;
  }

  destroy(): this {
    this.zerstoert = true;
    return this;
  }
}

function sondeMit(socket: FakeSocket, now?: () => number) {
  return createPortConnectProbe(() => socket as unknown as net.Socket, now);
}

describe('Port-Connect-Sonde (Pflichtenheft §9)', () => {
  it('meldet den Server als erreichbar, sobald die Verbindung steht', async () => {
    const socket = new FakeSocket();
    let uhr = 1_000;
    const laeuft = sondeMit(socket, () => uhr).check(
      { host: '127.0.0.1', port: 30_000, query: { kind: 'portConnect' } },
      3_000,
    );

    uhr = 1_042;
    socket.emit('connect');

    await expect(laeuft).resolves.toEqual({
      reachable: true,
      pingMs: 42,
      playersOnline: null,
      playersMax: null,
      players: [],
      reason: null,
    });
    expect(socket.verbindungen).toEqual([{ host: '127.0.0.1', port: 30_000 }]);
    expect(socket.zerstoert).toBe(true);
  });

  it('liefert keine Spielerzahl, sondern null', async () => {
    // Der Unterschied ist für den Auto-Shutdown wesentlich: 0 hieße
    // "nachweislich leer", null heißt "unbekannt" – nur das eine schaltet ab.
    const socket = new FakeSocket();
    const laeuft = sondeMit(socket).check(
      { host: '127.0.0.1', port: 30_000, query: { kind: 'portConnect' } },
      3_000,
    );
    socket.emit('connect');

    const ergebnis = await laeuft;
    expect(ergebnis.playersOnline).toBeNull();
    expect(ergebnis.playersMax).toBeNull();
  });

  it('sendet keine Daten an den Spielserver', async () => {
    const socket = new FakeSocket();
    const schreiben = vi.fn();
    Object.assign(socket, { write: schreiben });

    const laeuft = sondeMit(socket).check(
      { host: '127.0.0.1', port: 30_000, query: { kind: 'portConnect' } },
      3_000,
    );
    socket.emit('connect');
    await laeuft;

    expect(schreiben).not.toHaveBeenCalled();
  });

  it('meldet ein abgelaufenes Zeitlimit als nicht erreichbar', async () => {
    const socket = new FakeSocket();
    const laeuft = sondeMit(socket).check(
      { host: '127.0.0.1', port: 30_000, query: { kind: 'portConnect' } },
      2_500,
    );

    expect(socket.timeoutMs).toBe(2_500);
    socket.emit('timeout');

    const ergebnis = await laeuft;
    expect(ergebnis.reachable).toBe(false);
    expect(ergebnis.reason).toContain('Frist');
    expect(socket.zerstoert).toBe(true);
  });

  it('meldet einen Verbindungsfehler mit Grund', async () => {
    const socket = new FakeSocket();
    const laeuft = sondeMit(socket).check(
      { host: '127.0.0.1', port: 30_000, query: { kind: 'portConnect' } },
      3_000,
    );
    socket.emit('error', new Error('ECONNREFUSED'));

    const ergebnis = await laeuft;
    expect(ergebnis).toEqual(unreachable('Der Server war nicht erreichbar (ECONNREFUSED).'));
  });

  it('löst die Zusage nur einmal auf, auch bei mehreren Ereignissen', async () => {
    const socket = new FakeSocket();
    const laeuft = sondeMit(socket).check(
      { host: '127.0.0.1', port: 30_000, query: { kind: 'portConnect' } },
      3_000,
    );

    socket.emit('connect');
    socket.emit('error', new Error('zu spät'));

    await expect(laeuft).resolves.toMatchObject({ reachable: true });
  });
});

describe('Sondenauswahl nach Abfrageart', () => {
  it('nimmt für portConnect den Port-Connect-Test', async () => {
    const portConnect = { check: vi.fn().mockResolvedValue(unreachable('egal')) };
    const sonde = createServerProbe(portConnect);

    await sonde.check({ host: 'h', port: 1, query: { kind: 'portConnect' } }, 100);
    expect(portConnect.check).toHaveBeenCalledTimes(1);
  });

  it('meldet gamedig als noch nicht umgesetzt, statt auf Port-Connect auszuweichen', async () => {
    // Dieselbe Entscheidung wie im Backend (Gefundener Punkt 60): lieber ein
    // sichtbarer Fehlschlag als eine nie geprüfte Erreichbarkeit.
    const portConnect = { check: vi.fn() };
    const sonde = createServerProbe(portConnect);

    const ergebnis = await sonde.check(
      { host: 'h', port: 25_565, query: { kind: 'gamedig', protocol: 'minecraft' } },
      100,
    );

    expect(portConnect.check).not.toHaveBeenCalled();
    expect(ergebnis.reachable).toBe(false);
    expect(ergebnis.reason).toContain('gamedig');
    expect(ergebnis.reason).toContain('minecraft');
  });

  it('nutzt eine eingehängte gamedig-Sonde, sobald es sie gibt', async () => {
    const gamedig = {
      check: vi.fn().mockResolvedValue({
        reachable: true,
        pingMs: 12,
        playersOnline: 3,
        playersMax: 20,
        reason: null,
      }),
    };
    const sonde = createServerProbe({ check: vi.fn() }, gamedig);

    const ergebnis = await sonde.check(
      { host: 'h', port: 25_565, query: { kind: 'gamedig', protocol: 'minecraft' } },
      100,
    );

    expect(ergebnis.playersOnline).toBe(3);
  });
});
