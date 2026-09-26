import { describe, expect, it } from 'vitest';
import { actorWith, ownerActor } from '../admin/test-support.js';
import { createOverviewTileService, isOverviewTileError } from './index.js';
import { TILE_ID, createFakeOverviewTileRepository, tileRecord } from './test-support.js';

/**
 * Übersichts-Kacheln ohne Server: Der Dienst prüft nur, was die Eingabeprüfung
 * nicht wissen kann – ob es das Spiel gibt und ob es die Kachel gibt.
 */
function service(rows = [tileRecord()]) {
  const repository = createFakeOverviewTileRepository(rows);

  return {
    repository,
    service: createOverviewTileService({
      repository,
      kennt: (gameTypeId) => gameTypeId === 'cs2' || gameTypeId === 'minecraft-vanilla',
    }),
  };
}

describe('createOverviewTileService', () => {
  it('liefert jedem Betrachter dieselben Kacheln, nur die Rechte unterscheiden sich', async () => {
    const { service: dienst } = service();

    const [alsAdmin] = await dienst.list(actorWith('instance.manage'));
    const [alsNutzer] = await dienst.list(actorWith());

    expect(alsAdmin?.title).toBe('AirStrafingAddicts.com Surf');
    expect(alsAdmin?.permissions).toEqual({ canEdit: true, canDelete: true });
    expect(alsNutzer?.permissions).toEqual({ canEdit: false, canDelete: false });
    expect(alsNutzer?.linkUrl).toBe('https://discord.gg/asa');
  });

  it('sortiert nach Reihenfolge, dann Titel', async () => {
    const { service: dienst } = service([
      tileRecord({ id: 'a', title: 'Zeta', sortOrder: 1 }),
      tileRecord({ id: 'b', title: 'Beta', sortOrder: 1 }),
      tileRecord({ id: 'c', title: 'Omega', sortOrder: 0 }),
    ]);

    const titel = (await dienst.list(ownerActor())).map((tile) => tile.title);

    expect(titel).toEqual(['Omega', 'Beta', 'Zeta']);
  });

  it('legt eine Kachel an und merkt sich, wer es war', async () => {
    const { service: dienst, repository } = service([]);

    const tile = await dienst.create(ownerActor(), 'user-1', {
      title: 'BHOP',
      subtitle: null,
      gameTypeId: 'cs2',
      gameLabel: 'CS2 · Bhop',
      address: null,
      linkUrl: null,
      linkLabel: null,
      sortOrder: 2,
    });

    expect(tile.title).toBe('BHOP');
    expect(tile.permissions.canEdit).toBe(true);
    expect(repository.rows[0]?.createdById).toBe('user-1');
  });

  it('lehnt ein Spiel ab, das der Katalog nicht kennt', async () => {
    const { service: dienst } = service([]);

    await expect(
      dienst.create(ownerActor(), null, {
        title: 'x',
        subtitle: null,
        gameTypeId: 'gibt-es-nicht',
        gameLabel: null,
        address: null,
        linkUrl: null,
        linkLabel: null,
        sortOrder: 0,
      }),
    ).rejects.toSatisfy((error) => isOverviewTileError(error) && error.code === 'NOT_FOUND');
  });

  it('ändert nur die angegebenen Felder', async () => {
    const { service: dienst } = service();

    const tile = await dienst.update(ownerActor(), TILE_ID, {
      address: 'surf.example.org:27015',
    });

    expect(tile.address).toBe('surf.example.org:27015');
    expect(tile.title).toBe('AirStrafingAddicts.com Surf');
    expect(tile.updatedAt).toBe('2026-09-26T13:00:00.000Z');
  });

  it('meldet NOT_FOUND beim Ändern und Entfernen einer fremden Kennung', async () => {
    const { service: dienst } = service();

    await expect(
      dienst.update(ownerActor(), 'ffffffff-ffff-4fff-8fff-ffffffffffff', { title: 'x' }),
    ).rejects.toSatisfy((error) => isOverviewTileError(error) && error.code === 'NOT_FOUND');
    await expect(dienst.remove('ffffffff-ffff-4fff-8fff-ffffffffffff')).rejects.toSatisfy(
      (error) => isOverviewTileError(error) && error.code === 'NOT_FOUND',
    );
  });

  it('entfernt eine Kachel', async () => {
    const { service: dienst, repository } = service();

    await dienst.remove(TILE_ID);

    expect(repository.rows).toHaveLength(0);
  });
});
