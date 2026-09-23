import { describe, expect, it, vi } from 'vitest';
import type { DiscordSync } from './sync.js';
import { discordSyncTask } from './sync-task.js';

describe('discordSyncTask', () => {
  const log = { debug: () => undefined, warn: () => undefined, error: vi.fn() };

  function syncMit(run: DiscordSync['run']): DiscordSync {
    return {
      run,
      request: () => undefined,
      refreshTiles: async () => undefined,
      noteMember: () => undefined,
      channelIdFor: async () => null,
    };
  }

  it('läuft erst nach Ablauf des eigenen Takts, nicht bei jedem Tick', async () => {
    let jetzt = 0;
    const run = vi.fn(async () => ({
      created: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      skippedForLimit: 0,
    }));
    const aufgabe = discordSyncTask(syncMit(run), 1000, log, () => jetzt);

    await aufgabe.run();
    expect(run).not.toHaveBeenCalled();

    jetzt = 1000;
    await aufgabe.run();
    expect(run).toHaveBeenCalledTimes(1);

    jetzt = 1500;
    await aufgabe.run();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('wirft nicht, wenn der Abgleich scheitert', async () => {
    const aufgabe = discordSyncTask(
      syncMit(async () => {
        throw new Error('Discord weg');
      }),
      0,
      log,
      () => 1,
    );

    await expect(aufgabe.run()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});
