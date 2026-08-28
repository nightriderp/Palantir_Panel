import { promises as fs } from 'node:fs';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readNodeStats } from './node-stats.js';

describe('readNodeStats (Pflichtenheft §11)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rechnet OS- und statfs-Werte in MB um', async () => {
    vi.spyOn(os, 'cpus').mockReturnValue(new Array(8).fill({}) as ReturnType<typeof os.cpus>);
    vi.spyOn(os, 'loadavg').mockReturnValue([0.5, 0.4, 0.3]);
    vi.spyOn(os, 'totalmem').mockReturnValue(30_064_771_072); // 28 672 MB
    vi.spyOn(os, 'freemem').mockReturnValue(20_971_520_000);
    // 1 500 000 MB gesamt, 1 400 000 MB verfügbar (bsize 4096).
    vi.spyOn(fs, 'statfs').mockResolvedValue({
      bsize: 4096,
      blocks: 384_000_000,
      bavail: 358_400_000,
    } as Awaited<ReturnType<typeof fs.statfs>>);

    const stats = await readNodeStats('/srv/palantir/servers');

    expect(stats).toEqual({
      cpuCores: 8,
      cpuLoad1m: process.platform === 'win32' ? null : 0.5,
      ramTotalMb: 28_672,
      ramAvailableMb: 20_000,
      diskTotalMb: 1_500_000,
      diskAvailableMb: 1_400_000,
      observedAt: expect.any(String),
    });
  });

  it('nutzt bavail, nicht bfree – die root-reservierten Blöcke zählen nicht als frei', async () => {
    vi.spyOn(os, 'cpus').mockReturnValue([{}] as ReturnType<typeof os.cpus>);
    vi.spyOn(os, 'totalmem').mockReturnValue(1024 * 1024);
    vi.spyOn(os, 'freemem').mockReturnValue(1024 * 1024);
    const statfs = vi.spyOn(fs, 'statfs').mockResolvedValue({
      bsize: 1024,
      blocks: 1_000_000,
      bavail: 500_000,
      bfree: 900_000,
    } as Awaited<ReturnType<typeof fs.statfs>>);

    const stats = await readNodeStats('/data');

    expect(statfs).toHaveBeenCalledWith('/data');
    // 500 000 Blöcke * 1024 / (1024*1024) = 488 MB, nicht 879 (bfree).
    expect(stats?.diskAvailableMb).toBe(488);
  });

  it('liefert null, wenn statfs scheitert – Bericht geht dann ohne nodeStats', async () => {
    vi.spyOn(fs, 'statfs').mockRejectedValue(new Error('ENOENT'));

    expect(await readNodeStats('/gibt-es-nicht')).toBeNull();
  });
});
