/**
 * Tests der `gamedig`-Sonde (Gefundener Punkt 76).
 *
 * Geprüft wird die Zuordnung „Antwort von gamedig → {@link ServerProbeResult}" –
 * ohne Netz und ohne laufenden Spielserver: Die Abfrage-Funktion wird
 * hereingereicht (CLAUDE.md §4).
 */

import { describe, expect, it, vi } from 'vitest';
import { createGamedigProbe, type GamedigQuery } from './gamedig-probe.js';
import { type ServerProbeTarget } from './probe.js';

const ZIEL: ServerProbeTarget = {
  host: '127.0.0.1',
  port: 25_565,
  query: { kind: 'gamedig', protocol: 'minecraft' },
};

/** Antwort, wie `gamedig` sie liefert – nur die Felder, die die Sonde liest. */
function antwort(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Ein Palantir-Server',
    map: 'world',
    password: false,
    numplayers: 3,
    maxplayers: 20,
    players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    bots: [],
    connect: '127.0.0.1:25565',
    ping: 12,
    queryPort: 25_565,
    version: '1.21.1',
    ...overrides,
  } as Awaited<ReturnType<GamedigQuery>>;
}

describe('gamedig-Sonde', () => {
  it('übernimmt Spielerzahl, Höchstzahl und Antwortzeit', async () => {
    const abfragen = vi.fn<GamedigQuery>().mockResolvedValue(antwort());
    const sonde = createGamedigProbe(abfragen);

    const ergebnis = await sonde.check(ZIEL, 3_000);

    expect(ergebnis).toEqual({
      reachable: true,
      pingMs: 12,
      playersOnline: 3,
      playersMax: 20,
      reason: null,
    });
  });

  it('fragt mit Protokoll, Ziel und Frist ab und wiederholt nicht selbst', async () => {
    const abfragen = vi.fn<GamedigQuery>().mockResolvedValue(antwort());

    await createGamedigProbe(abfragen).check(ZIEL, 3_000);

    expect(abfragen).toHaveBeenCalledWith({
      type: 'minecraft',
      host: '127.0.0.1',
      port: 25_565,
      socketTimeout: 3_000,
      attemptTimeout: 3_000,
      // Die Abfrage läuft periodisch; ein Wiederholen darunter würde die Frist
      // vervielfachen.
      maxRetries: 0,
    });
  });

  it('nimmt die Länge der Spielerliste, wenn die Zahl fehlt', async () => {
    const abfragen = vi
      .fn<GamedigQuery>()
      .mockResolvedValue(antwort({ numplayers: undefined, players: [{ name: 'a' }] }));

    expect((await createGamedigProbe(abfragen).check(ZIEL, 3_000)).playersOnline).toBe(1);
  });

  it('meldet unbrauchbare Werte als „keine Angabe“, statt zu raten', async () => {
    const abfragen = vi
      .fn<GamedigQuery>()
      .mockResolvedValue(antwort({ ping: -1, maxplayers: undefined }));

    const ergebnis = await createGamedigProbe(abfragen).check(ZIEL, 3_000);

    expect(ergebnis.pingMs).toBeNull();
    expect(ergebnis.playersMax).toBeNull();
    // Erreichbar bleibt der Server trotzdem – er hat ja geantwortet.
    expect(ergebnis.reachable).toBe(true);
  });

  it('meldet einen Fehlschlag als „nicht erreichbar“ mit Grund', async () => {
    const abfragen = vi
      .fn<GamedigQuery>()
      .mockRejectedValue(new Error('Server nicht erreichbar (Timeout)'));

    const ergebnis = await createGamedigProbe(abfragen).check(ZIEL, 3_000);

    expect(ergebnis.reachable).toBe(false);
    expect(ergebnis.playersOnline).toBeNull();
    expect(ergebnis.reason).toContain('Timeout');
  });

  it('lehnt ein Ziel ab, das gar keine gamedig-Abfrage ist', async () => {
    const abfragen = vi.fn<GamedigQuery>();

    const ergebnis = await createGamedigProbe(abfragen).check(
      { ...ZIEL, query: { kind: 'portConnect' } },
      3_000,
    );

    expect(ergebnis.reachable).toBe(false);
    expect(abfragen).not.toHaveBeenCalled();
  });
});
