/**
 * Der Ordner-Download holt seine Blöcke im Voraus (Leistungsbericht
 * 19.09.2026, Punkt 1.2).
 *
 * Geprüft wird nicht die Geschwindigkeit – die hängt an der Leitung –, sondern
 * das Verhalten, das sie ausmacht: Während ein Block noch ausgeliefert wird,
 * ist der nächste schon angefragt. Dazu der Fall, der beim Vorausladen neu
 * entsteht: Bricht der Browser ab, darf die offene Anfrage niemanden mehr
 * stören.
 */

import { type FileArchiveBlockCommandResult } from '@palantir/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AgentSession } from './agent-gateway.js';
import { ServerFileService } from './file-service.js';
import { TEST_GAME_TYPE, createGameRegistry } from './game-registry.js';
import { type ServerRecord } from './repository.js';

const SERVER_ID = '44444444-4444-4444-8444-444444444444';

function block(
  offset: number,
  bytes: number,
  eof: boolean,
  totalBytes: number,
): FileArchiveBlockCommandResult {
  return {
    transferId: 'f1e2d3c4-b5a6-4f7e-8d9c-0a1b2c3d4e5f',
    offset,
    contentBase64: Buffer.alloc(bytes, 7).toString('base64'),
    bytesRead: bytes,
    totalBytes,
    eof,
  };
}

/**
 * Sitzung, die jeden Blockabruf offen lässt, bis der Test ihn auflöst.
 *
 * Nur so wird sichtbar, ob überhaupt vorausgeladen wird: Bei einer Sitzung,
 * die sofort antwortet, sähe die alte Schleife genauso aus wie die neue.
 */
function sitzungMitHandSteuerung() {
  const offene: ((ergebnis: FileArchiveBlockCommandResult) => void)[] = [];
  const abgelehnt: ((fehler: Error) => void)[] = [];
  const befehle: string[] = [];

  const session = {
    sendCommand: vi.fn(async (command: string) => {
      befehle.push(command);

      if (command === 'FILE_ARCHIVE') {
        return {
          transferId: 'f1e2d3c4-b5a6-4f7e-8d9c-0a1b2c3d4e5f',
          fileName: 'welt.tar.gz',
          sizeBytes: 0,
          pending: true,
        };
      }

      return new Promise((aufloesen, ablehnen) => {
        offene.push(aufloesen as (ergebnis: FileArchiveBlockCommandResult) => void);
        abgelehnt.push(ablehnen as (fehler: Error) => void);
      });
    }),
  } as unknown as AgentSession;

  return { session, offene, abgelehnt, befehle };
}

function dienst(session: AgentSession): ServerFileService {
  return new ServerFileService({
    registry: createGameRegistry(3, [TEST_GAME_TYPE]),
    config: {
      fileListTimeoutMs: 1000,
      directoryArchiveTimeoutMs: 1000,
      // Kein echtes Warten zwischen zwei Anlaeufen.
      directoryArchiveRetryMs: 0,
      maxUploadBytes: 1024,
    },
    requireLiveTarget: async () => ({
      server: { id: SERVER_ID, gameType: TEST_GAME_TYPE.id } as unknown as ServerRecord,
      session,
      containerId: 'container-1',
    }),
  });
}

/** Wartet, bis die Ereignisschleife die angestoßenen Anfragen abgesetzt hat. */
async function durchatmen(): Promise<void> {
  await new Promise((weiter) => setImmediate(weiter));
}

describe('Ordner-Download', () => {
  const unbehandelte: unknown[] = [];
  const merker = (grund: unknown): void => {
    unbehandelte.push(grund);
  };

  afterEach(() => {
    process.off('unhandledRejection', merker);
    unbehandelte.length = 0;
  });

  it('fragt den nächsten Block an, bevor der vorige ausgeliefert ist', async () => {
    const { session, offene, befehle } = sitzungMitHandSteuerung();
    const download = await dienst(session).openDirectoryDownload(SERVER_ID, 'welt');
    const bloecke = download.chunks();

    const erster = bloecke.next();

    await durchatmen();
    offene[0]?.(block(0, 4, false, 12));
    await erster;
    await durchatmen();

    // Zwei Blockabrufe, obwohl der Aufrufer erst einen Block in der Hand hält.
    expect(befehle.filter((name) => name === 'FILE_ARCHIVE_BLOCK')).toHaveLength(2);
  });

  it('liefert die Blöcke trotzdem lückenlos und in der richtigen Reihenfolge', async () => {
    const { session, offene } = sitzungMitHandSteuerung();
    const download = await dienst(session).openDirectoryDownload(SERVER_ID, 'welt');

    const gesammelt: Promise<Buffer[]> = (async () => {
      const teile: Buffer[] = [];

      for await (const teil of download.chunks()) {
        teile.push(teil);
      }

      return teile;
    })();

    for (const [index, angaben] of [
      { offset: 0, bytes: 4, eof: false },
      { offset: 4, bytes: 4, eof: false },
      { offset: 8, bytes: 4, eof: true },
    ].entries()) {
      await durchatmen();
      offene[index]?.(block(angaben.offset, angaben.bytes, angaben.eof, 12));
    }

    const teile = await gesammelt;

    expect(teile.map((teil) => teil.length)).toEqual([4, 4, 4]);
    expect(Buffer.concat(teile)).toEqual(Buffer.alloc(12, 7));
  });

  it('meldet keine Gesamtgröße, solange der Agent noch packt', async () => {
    const { session } = sitzungMitHandSteuerung();
    const download = await dienst(session).openDirectoryDownload(SERVER_ID, 'welt');

    // Ohne Endgröße kündigt die Route keine Länge an: Der Download beginnt
    // dafür sofort statt nach dem vollständigen Packen.
    expect(download.totalBytes).toBeNull();
    expect(download.fileName).toBe('welt.tar.gz');
  });

  it('wartet auf einen Block, der noch nicht geschrieben ist, statt abzubrechen', async () => {
    const { session, offene, befehle } = sitzungMitHandSteuerung();
    const download = await dienst(session).openDirectoryDownload(SERVER_ID, 'welt');
    const bloecke = download.chunks();

    const erster = bloecke.next();

    await durchatmen();
    // Der Agent packt noch und hat an dieser Stelle nichts.
    offene[0]?.({
      transferId: 'f1e2d3c4-b5a6-4f7e-8d9c-0a1b2c3d4e5f',
      offset: 0,
      contentBase64: '',
      bytesRead: 0,
      totalBytes: 0,
      eof: false,
      pending: true,
    });

    // Die Wiederholung haengt an einem Zeitgeber, nicht nur an der
    // Ereignisschleife - deshalb hier echtes Warten statt setImmediate.
    await new Promise((weiter) => setTimeout(weiter, 5));

    // Dieselbe Stelle wird erneut abgefragt, nicht als Fehler gewertet.
    expect(befehle.filter((name) => name === 'FILE_ARCHIVE_BLOCK').length).toBeGreaterThanOrEqual(
      2,
    );

    offene[1]?.(block(0, 4, true, 4));

    const ergebnis = await erster;

    expect(ergebnis.done).toBe(false);
    expect(ergebnis.value).toEqual(Buffer.alloc(4, 7));
  });

  it('lässt die vorausgeschickte Anfrage nicht unbehandelt liegen, wenn der Download abbricht', async () => {
    process.on('unhandledRejection', merker);

    const { session, offene, abgelehnt } = sitzungMitHandSteuerung();
    const download = await dienst(session).openDirectoryDownload(SERVER_ID, 'welt');
    const bloecke = download.chunks();

    const erster = bloecke.next();

    await durchatmen();
    offene[0]?.(block(0, 4, false, 12));
    await erster;
    await durchatmen();

    // Der Browser trennt: Der Aufrufer beendet den Generator, die zweite
    // Anfrage ist aber noch unterwegs und scheitert danach.
    await bloecke.return(undefined);
    abgelehnt[1]?.(new Error('Verbindung zum Agenten verloren'));

    await durchatmen();
    await durchatmen();

    expect(unbehandelte).toEqual([]);
  });
});
