import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANSTOSS_DATEI, UpdateAnstoss } from './update-anstoss.js';

describe('UpdateAnstoss (Gefundener Punkt 342)', () => {
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';
  let ordner: string;

  beforeEach(async () => {
    ordner = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-anstoss-'));
  });

  afterEach(async () => {
    await fs.rm(ordner, { recursive: true, force: true });
  });

  it('ersetzt eine schon liegende Markierung', async () => {
    const anstoss = new UpdateAnstoss(ordner);

    await anstoss.ablegen('f'.repeat(40));
    await anstoss.ablegen(COMMIT);

    expect(await fs.readdir(ordner)).toEqual([ANSTOSS_DATEI]);
    expect(await fs.readFile(path.join(ordner, ANSTOSS_DATEI), 'utf8')).toBe(`${COMMIT}\n`);
  });

  it.each(['', 'abc', `${COMMIT}\nrm -rf /`, COMMIT.toUpperCase()])(
    'lehnt "%s" ab, ohne etwas zu schreiben',
    async (commit) => {
      await expect(new UpdateAnstoss(ordner).ablegen(commit)).rejects.toThrow();
      expect(await fs.readdir(ordner)).toEqual([]);
    },
  );

  it('legt keinen fehlenden Ordner an', async () => {
    // Der Ordner ist ein Bind-Mount vom Host. Fehlt er, ist die Einrichtung
    // unvollstaendig - das soll als Fehler auffallen, nicht still irgendwo
    // im Container landen, wo die Pfad-Unit nie hinsieht.
    const fehlt = path.join(ordner, 'gibt-es-nicht');

    await expect(new UpdateAnstoss(fehlt).ablegen(COMMIT)).rejects.toThrow();
    await expect(fs.stat(fehlt)).rejects.toThrow();
  });
});
