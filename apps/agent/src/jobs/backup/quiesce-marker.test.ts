import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QuiesceMarker } from './quiesce-marker.js';

/**
 * Merkzettel offener Schreibstopps (Arbeitspaket HM-10).
 *
 * Der Merkzettel ist das zweite Netz: Das `finally` im Adapter deckt jeden
 * Ausgang ab, den der Prozess noch erlebt - nicht aber seinen eigenen Tod. Was
 * hier geprüft wird, ist deshalb genau die Frage „was liegt nach einem Neustart
 * noch da".
 */

const ordner: string[] = [];

async function neuerOrdner(): Promise<string> {
  const pfad = await mkdtemp(path.join(tmpdir(), 'palantir-quiesce-'));
  ordner.push(pfad);

  return pfad;
}

afterEach(async () => {
  for (const pfad of ordner.splice(0)) {
    await rm(pfad, { recursive: true, force: true });
  }
});

const EINTRAG = {
  serverId: 'a7d3f0b1-5c2e-4a89-b6d4-1e9f2c3a5b70',
  containerId: 'abc123',
  resumeCommands: ['save-on'],
  seit: '2026-09-13T18:00:00.000Z',
};

describe('Merkzettel offener Schreibstopps (HM-10)', () => {
  it('findet nichts, solange es nichts gab', async () => {
    const marker = new QuiesceMarker(path.join(await neuerOrdner(), 'nie-angelegt'));

    expect(await marker.offene()).toEqual([]);
  });

  it('haelt einen Schreibstopp fest und gibt ihn unveraendert zurueck', async () => {
    const marker = new QuiesceMarker(await neuerOrdner());

    await marker.merken(EINTRAG);

    expect(await marker.offene()).toEqual([EINTRAG]);
  });

  it('vergisst ihn wieder', async () => {
    const marker = new QuiesceMarker(await neuerOrdner());

    await marker.merken(EINTRAG);
    await marker.vergessen(EINTRAG.serverId);

    expect(await marker.offene()).toEqual([]);
  });

  it('nimmt es hin, wenn nichts zu vergessen ist', async () => {
    // Der Aufrufer ruft das im `finally` - und dort landet er auch dann, wenn
    // das Merken selbst gescheitert ist.
    const marker = new QuiesceMarker(await neuerOrdner());

    await expect(marker.vergessen(EINTRAG.serverId)).resolves.toBeUndefined();
  });

  it('ueberschreibt einen bestehenden Eintrag desselben Servers', async () => {
    const marker = new QuiesceMarker(await neuerOrdner());

    await marker.merken(EINTRAG);
    await marker.merken({ ...EINTRAG, containerId: 'neu456' });

    const offene = await marker.offene();

    expect(offene).toHaveLength(1);
    expect(offene[0]?.containerId).toBe('neu456');
  });

  it('haelt mehrere Server auseinander', async () => {
    const marker = new QuiesceMarker(await neuerOrdner());

    await marker.merken(EINTRAG);
    await marker.merken({ ...EINTRAG, serverId: 'b8e4a1c2-6d3f-4b9a-c7e5-2f0a3d4b6c81' });

    expect((await marker.offene()).map((eintrag) => eintrag.serverId).sort()).toEqual(
      [EINTRAG.serverId, 'b8e4a1c2-6d3f-4b9a-c7e5-2f0a3d4b6c81'].sort(),
    );
  });

  it('raeumt einen unlesbaren Merkzettel weg, statt ihn ewig zu melden', async () => {
    const pfad = await neuerOrdner();
    const marker = new QuiesceMarker(pfad);

    await marker.merken(EINTRAG);
    await writeFile(path.join(pfad, 'kaputt.json'), '{ das ist kein JSON', 'utf8');
    await writeFile(path.join(pfad, 'halb.json'), '{"serverId":"x"}', 'utf8');

    expect((await marker.offene()).map((eintrag) => eintrag.serverId)).toEqual([EINTRAG.serverId]);
    // Und beim naechsten Start meldet sich nur noch der eine.
    expect((await readdir(pfad)).sort()).toEqual([`${EINTRAG.serverId}.json`]);
  });

  it('uebergeht alles, was nicht nach Merkzettel aussieht', async () => {
    const pfad = await neuerOrdner();
    const marker = new QuiesceMarker(pfad);

    await marker.merken(EINTRAG);
    await writeFile(path.join(pfad, 'liesmich.txt'), 'nur ein Hinweis', 'utf8');

    expect(await marker.offene()).toEqual([EINTRAG]);
    // Die fremde Datei bleibt liegen - sie gehoert nicht diesem Ordner-Besitzer.
    expect((await readdir(pfad)).sort()).toEqual([`${EINTRAG.serverId}.json`, 'liesmich.txt']);
  });

  it('macht aus einer Server-Id mit Schraegstrich keinen Pfad', async () => {
    const pfad = await neuerOrdner();
    const marker = new QuiesceMarker(pfad);

    await marker.merken({ ...EINTRAG, serverId: '../ausbruch' });

    expect((await readdir(pfad)).sort()).toEqual(['ausbruch.json']);
  });
});
