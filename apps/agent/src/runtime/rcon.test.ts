/**
 * Tests des RCON-Clients (P2-9) gegen einen kleinen RCON-Server im Test.
 *
 * Der Server im Test spricht das Protokoll so, wie Minecraft es tut: Auf die
 * Anmeldung antwortet er mit Typ 2 und derselben Id, bei falschem Passwort mit
 * Id -1; auf einen Befehl mit Typ 0. Lange Antworten teilt er in Pakete zu
 * 4096 Byte.
 */

import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RconError, rconCommand, rconPacket, rconPaketeLesen } from './rcon.js';

const PASSWORT = 'sehr-geheim';

interface Verhalten {
  /** Antwort auf einen Befehl; Vorgabe: „Antwort auf: <befehl>". */
  antwort?: (befehl: string) => string;
  /** Schweigt nach der Anmeldung – für die Frist. */
  schweigt?: boolean;
  /** Schickt vor der Anmelde-Antwort ein leeres Typ-0-Paket, wie Source es tut. */
  sourceStil?: boolean;
  /** Schließt nach der Antwort von sich aus. */
  schliesstNachAntwort?: boolean;
}

const server: net.Server[] = [];

afterEach(async () => {
  for (const s of server.splice(0)) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/** Startet den Test-Server auf einem freien Port und liefert den Port. */
async function rconServer(verhalten: Verhalten = {}): Promise<number> {
  const s = net.createServer((socket) => {
    let puffer: Buffer = Buffer.alloc(0);
    let angemeldet = false;

    socket.on('data', (chunk) => {
      const gelesen = rconPaketeLesen(Buffer.concat([puffer, chunk]));
      puffer = gelesen.rest;

      for (const paket of gelesen.pakete) {
        if (paket.typ === 3) {
          if (verhalten.sourceStil) {
            socket.write(rconPacket(paket.id, 0, ''));
          }

          if (paket.nutzlast === PASSWORT) {
            angemeldet = true;
            socket.write(rconPacket(paket.id, 2, ''));
          } else {
            socket.write(rconPacket(-1, 2, ''));
          }
        } else if (paket.typ === 2 && angemeldet) {
          if (verhalten.schweigt) {
            return;
          }

          const text = (verhalten.antwort ?? ((b) => `Antwort auf: ${b}`))(paket.nutzlast);
          const body = Buffer.from(text, 'utf8');

          for (let offset = 0; offset < body.length || offset === 0; offset += 4096) {
            socket.write(
              rconPacket(paket.id, 0, body.subarray(offset, offset + 4096).toString('utf8')),
            );

            if (body.length === 0) {
              break;
            }
          }

          if (verhalten.schliesstNachAntwort) {
            socket.end();
          }
        }
      }
    });
  });

  server.push(s);

  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
  const adresse = s.address();

  if (adresse === null || typeof adresse === 'string') {
    throw new Error('Kein Port');
  }

  return adresse.port;
}

describe('rconPacket / rconPaketeLesen', () => {
  it('schreibt und liest ein Paket in derselben Form', () => {
    const paket = rconPacket(7, 2, 'list');
    const { pakete, rest } = rconPaketeLesen(paket);

    // Länge ohne das Längenfeld: Id, Typ, 4 Byte Nutzlast, zwei Nullbytes.
    expect(paket.readInt32LE(0)).toBe(4 + 4 + 4 + 2);
    expect(pakete).toEqual([{ id: 7, typ: 2, nutzlast: 'list', nutzlastBytes: 4 }]);
    expect(rest).toHaveLength(0);
  });

  it('lässt ein angefangenes Paket im Rest, bis es vollständig ist', () => {
    const paket = rconPacket(1, 0, 'halb');
    const { pakete, rest } = rconPaketeLesen(paket.subarray(0, 6));

    expect(pakete).toEqual([]);
    expect(rest).toHaveLength(6);
  });

  it('lehnt eine unmögliche Paketlänge ab, statt zu warten', () => {
    const kaputt = Buffer.alloc(4);
    kaputt.writeInt32LE(999_999, 0);

    expect(() => rconPaketeLesen(kaputt)).toThrow(RconError);
  });
});

describe('rconCommand', () => {
  it('meldet sich an, schickt den Befehl und liefert die Antwort', async () => {
    const port = await rconServer();

    await expect(
      rconCommand({
        host: '127.0.0.1',
        port,
        password: PASSWORT,
        command: 'list',
        timeoutMs: 2_000,
      }),
    ).resolves.toBe('Antwort auf: list');
  });

  it('setzt eine lange Antwort aus mehreren Paketen zusammen', async () => {
    const lang = 'x'.repeat(4096 * 2 + 17);
    const port = await rconServer({ antwort: () => lang });

    await expect(
      rconCommand({
        host: '127.0.0.1',
        port,
        password: PASSWORT,
        command: 'help',
        timeoutMs: 3_000,
      }),
    ).resolves.toBe(lang);
  });

  it('versteht auch die Source-Variante mit leerem Paket vor der Anmelde-Antwort', async () => {
    const port = await rconServer({ sourceStil: true });

    await expect(
      rconCommand({
        host: '127.0.0.1',
        port,
        password: PASSWORT,
        command: 'list',
        timeoutMs: 2_000,
      }),
    ).resolves.toBe('Antwort auf: list');
  });

  it('liefert eine leere Antwort als leeren Text, nicht als Fehler', async () => {
    const port = await rconServer({ antwort: () => '' });

    await expect(
      rconCommand({
        host: '127.0.0.1',
        port,
        password: PASSWORT,
        command: 'save-all',
        timeoutMs: 2_000,
      }),
    ).resolves.toBe('');
  });

  it('nimmt die Antwort auch, wenn der Server danach von sich aus schließt', async () => {
    const port = await rconServer({ schliesstNachAntwort: true });

    await expect(
      rconCommand({
        host: '127.0.0.1',
        port,
        password: PASSWORT,
        command: 'list',
        timeoutMs: 2_000,
      }),
    ).resolves.toBe('Antwort auf: list');
  });

  it('meldet eine abgelehnte Anmeldung als AUTH_FAILED', async () => {
    const port = await rconServer();

    await expect(
      rconCommand({
        host: '127.0.0.1',
        port,
        password: 'falsch',
        command: 'list',
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('gibt nach der Frist auf, wenn der Server schweigt', async () => {
    const port = await rconServer({ schweigt: true });

    await expect(
      rconCommand({ host: '127.0.0.1', port, password: PASSWORT, command: 'list', timeoutMs: 300 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('meldet einen geschlossenen Port als CONNECTION', async () => {
    // Ein Port, an dem niemand lauscht: eben geöffnet und wieder geschlossen.
    const port = await rconServer();
    await new Promise<void>((resolve) => server.pop()?.close(() => resolve()));

    await expect(
      rconCommand({
        host: '127.0.0.1',
        port,
        password: PASSWORT,
        command: 'list',
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({ code: 'CONNECTION' });
  });
});
