import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CreateBackupCommandPayload } from '@palantir/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuiesceMarker } from '../jobs/backup/quiesce-marker.js';
import {
  mitSchreibstopp,
  offeneSchreibstoppsAufheben,
  type SchreibstoppUmgebung,
} from './schreibstopp.js';

/**
 * Schreibstopp beim Sichern (Arbeitspaket HM-10).
 *
 * Bis hierher hatte eine Sicherung zwei Zustände und keinen dritten: im
 * laufenden Betrieb packen, dann ist der Spielstand in sich widersprüchlich –
 * oder den Container anhalten, dann merkt es jeder Spieler. Geprüft wird hier
 * der dritte Weg: dem Spiel sagen, dass es kurz nicht schreiben soll.
 *
 * **Die interessanten Fälle sind nicht die gelungenen.** Es sind die, in denen
 * etwas schiefgeht, denn ein Server, der im Schreibstopp stehen bleibt, verliert
 * beim nächsten Absturz alles seit der Sicherung – und das ist schlimmer als
 * eine misslungene Sicherung.
 */

const SERVER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CONTAINER_ID = 'fake-container-1';

const QUIESCE = { commands: ['save-off', 'save-all'], resumeCommands: ['save-on'] };

const NUTZLAST: CreateBackupCommandPayload = {
  backupId: '11111111-2222-4333-8444-555555555555',
  serverId: SERVER_ID,
  sourcePath: `/srv/palantir/servers/${SERVER_ID}`,
  containerId: CONTAINER_ID,
};

describe('Schreibstopp beim Sichern (HM-10)', () => {
  let wurzel: string;
  let marker: QuiesceMarker;
  /** Jede Zeile, die an der Konsole ankam – in ihrer Reihenfolge. */
  let konsole: string[];
  /** Zeilen, die die Konsole ablehnt. */
  let abgelehnt: Set<string>;
  let warnungen: string[];
  let umgebung: SchreibstoppUmgebung;

  beforeEach(async () => {
    wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-schreibstopp-'));
    marker = new QuiesceMarker(path.join(wurzel, '.schreibstopp'));
    konsole = [];
    abgelehnt = new Set();
    warnungen = [];
    umgebung = {
      konsole: (_containerId, _serverId, zeile) => {
        konsole.push(zeile);

        return Promise.resolve(!abgelehnt.has(zeile));
      },
      marker,
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: (nachricht: string) => {
          warnungen.push(nachricht);
        },
        error: () => undefined,
      },
    };
  });

  afterEach(async () => {
    await fs.rm(wurzel, { recursive: true, force: true });
  });

  it('stellt still, packt und hebt wieder auf - in dieser Reihenfolge', async () => {
    // Die Reihenfolge ist der Kern: `save-all` nach `save-off` legt den Stand
    // ab, an dem der Server danach nicht mehr weiterschreibt. Andersherum
    // packte das Archiv einen Stand, der sich noch bewegt.
    const gepackt: string[] = [];

    await mitSchreibstopp({ ...NUTZLAST, quiesce: QUIESCE }, umgebung, () => {
      gepackt.push('gepackt');

      return Promise.resolve('fertig');
    });

    expect(konsole).toEqual(['save-off', 'save-all', 'save-on']);
    expect(gepackt).toEqual(['gepackt']);
  });

  it('reicht das Ergebnis des Packens durch', async () => {
    const ergebnis = await mitSchreibstopp({ ...NUTZLAST, quiesce: QUIESCE }, umgebung, () =>
      Promise.resolve({ storagePath: '/srv/palantir/backups/a.tar.gz' }),
    );

    expect(ergebnis).toEqual({ storagePath: '/srv/palantir/backups/a.tar.gz' });
  });

  it('packt ohne Angabe wie bisher', async () => {
    await mitSchreibstopp(NUTZLAST, umgebung, () => Promise.resolve(null));

    expect(konsole).toEqual([]);
    expect(await marker.offene()).toEqual([]);
  });

  it('stellt nichts still, wenn es keinen Container gibt', async () => {
    // Ohne Container laeuft nichts, was schreiben koennte.
    const ohneContainer = { ...NUTZLAST, quiesce: QUIESCE };
    delete (ohneContainer as { containerId?: string }).containerId;

    await mitSchreibstopp(ohneContainer, umgebung, () => Promise.resolve(null));

    expect(konsole).toEqual([]);
  });

  it('hebt den Schreibstopp auch dann auf, wenn das Packen scheitert', async () => {
    // Der wichtigste Fall. Ein Server, der wegen einer misslungenen Sicherung
    // nicht mehr schreibt, ist der schlimmere Ausgang.
    await expect(
      mitSchreibstopp({ ...NUTZLAST, quiesce: QUIESCE }, umgebung, () =>
        Promise.reject(new Error('Platte voll')),
      ),
    ).rejects.toThrow('Platte voll');

    expect(konsole).toEqual(['save-off', 'save-all', 'save-on']);
    expect(await marker.offene()).toEqual([]);
  });

  it('bricht das Stillstellen ab, wenn der erste Befehl nicht durchkommt', async () => {
    // Kam `save-off` nicht an, schriebe `save-all` in einen Server, der
    // weiterschreibt - das Archiv waere so widerspruechlich wie ohne
    // Schreibstopp, der Aufruf saehe aber aus, als haette er gewirkt.
    abgelehnt.add('save-off');

    await mitSchreibstopp({ ...NUTZLAST, quiesce: QUIESCE }, umgebung, () => Promise.resolve(null));

    expect(konsole).toEqual(['save-off']);
    expect(await marker.offene()).toEqual([]);
  });

  it('packt trotzdem, wenn die Konsole gar nichts annimmt', async () => {
    // Eine Sicherung im laufenden Betrieb ist der bisherige Normalfall und
    // besser als keine.
    abgelehnt.add('save-off');
    let gepackt = false;

    await mitSchreibstopp({ ...NUTZLAST, quiesce: QUIESCE }, umgebung, () => {
      gepackt = true;

      return Promise.resolve(null);
    });

    expect(gepackt).toBe(true);
  });

  it('legt waehrend des Packens einen Merkzettel ab und raeumt ihn danach weg', async () => {
    let waehrendDesPackens: unknown[] = [];

    await mitSchreibstopp({ ...NUTZLAST, quiesce: QUIESCE }, umgebung, async () => {
      // In diesem Moment steht der Server im Schreibstopp. Genau hier muss der
      // Merkzettel liegen - stirbt der Agent jetzt, ist er das Einzige, was den
      // Server je wieder schreiben laesst.
      waehrendDesPackens = await marker.offene();

      return null;
    });

    expect(waehrendDesPackens).toHaveLength(1);
    expect(await marker.offene()).toEqual([]);
  });

  it('laesst den Merkzettel liegen, wenn das Aufheben nicht durchkommt', async () => {
    abgelehnt.add('save-on');

    await mitSchreibstopp({ ...NUTZLAST, quiesce: QUIESCE }, umgebung, () => Promise.resolve(null));

    // Beim naechsten Start wird es erneut versucht - besser ein Merkzettel zu
    // viel als ein Server, der stumm bleibt.
    expect((await marker.offene()).map((eintrag) => eintrag.serverId)).toEqual([SERVER_ID]);
    expect(warnungen.some((zeile) => zeile.includes('Merkzettel bleibt liegen'))).toBe(true);
  });

  it('versucht jeden Gegenbefehl, auch wenn der davor abgelehnt wurde', async () => {
    abgelehnt.add('save-on');

    await mitSchreibstopp(
      {
        ...NUTZLAST,
        quiesce: { commands: ['save-off'], resumeCommands: ['save-on', 'save-all'] },
      },
      umgebung,
      () => Promise.resolve(null),
    );

    expect(konsole).toEqual(['save-off', 'save-on', 'save-all']);
  });

  it('stellt auch ohne Merkzettel still - es fehlt nur das zweite Netz', async () => {
    const ohneMarker: SchreibstoppUmgebung = { konsole: umgebung.konsole, log: umgebung.log };

    await mitSchreibstopp({ ...NUTZLAST, quiesce: QUIESCE }, ohneMarker, () =>
      Promise.resolve(null),
    );

    expect(konsole).toEqual(['save-off', 'save-all', 'save-on']);
  });

  it('hebt beim Start jeden offenen Schreibstopp auf', async () => {
    await marker.merken({
      serverId: SERVER_ID,
      containerId: CONTAINER_ID,
      resumeCommands: ['save-on'],
      seit: '2026-09-13T18:00:00.000Z',
    });

    expect(await offeneSchreibstoppsAufheben(umgebung)).toBe(1);

    expect(konsole).toEqual(['save-on']);
    expect(await marker.offene()).toEqual([]);
  });

  it('hat beim Start nichts zu tun, wenn nichts offen ist', async () => {
    expect(await offeneSchreibstoppsAufheben(umgebung)).toBe(0);
    expect(konsole).toEqual([]);
  });
});
