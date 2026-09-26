import { USER_PRESET_LIMIT } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { CS2_GAME_TYPE } from '../server-orchestration/game-registry.js';
import {
  type UserPresetRecord,
  type UserPresetRepository,
  createUserPresetService,
  isUserPresetError,
} from './index.js';

const ICH = '11111111-1111-4111-8111-111111111111';
const ANDERE = '22222222-2222-4222-8222-222222222222';

/** Repository im Speicher – mit derselben Eindeutigkeit wie die Tabelle. */
function speicher(): UserPresetRepository {
  const zeilen = new Map<string, UserPresetRecord>();
  let naechste = 1;

  function eindeutig(userId: string, gameType: string, name: string, ausser?: string) {
    for (const zeile of zeilen.values()) {
      if (
        zeile.id !== ausser &&
        zeile.userId === userId &&
        zeile.gameType === gameType &&
        zeile.name === name
      ) {
        throw Object.assign(new Error('unique'), { code: '23505' });
      }
    }
  }

  return {
    async listByUser(userId, gameType) {
      return [...zeilen.values()]
        .filter((z) => z.userId === userId && z.gameType === gameType)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async countByUser(userId, gameType) {
      return [...zeilen.values()].filter((z) => z.userId === userId && z.gameType === gameType)
        .length;
    },
    async findById(id) {
      return zeilen.get(id) ?? null;
    },
    async create(input) {
      eindeutig(input.userId, input.gameType, input.name);
      const id = `00000000-0000-4000-8000-${String(naechste++).padStart(12, '0')}`;
      const zeile = { ...input, id, createdAt: new Date(0), updatedAt: new Date(0) };
      zeilen.set(id, zeile);

      return zeile;
    },
    async update(id, changes) {
      const alt = zeilen.get(id);
      if (!alt) return null;
      if (changes.name !== undefined) eindeutig(alt.userId, alt.gameType, changes.name, id);
      const neu = { ...alt, ...changes };
      zeilen.set(id, neu);

      return neu;
    },
    async delete(id) {
      return zeilen.delete(id);
    },
  };
}

function dienst() {
  return createUserPresetService({
    repository: speicher(),
    findGameType: (id) => (id === 'cs2' ? CS2_GAME_TYPE : null),
    now: () => new Date('2026-09-26T12:00:00Z'),
  });
}

async function fehlercode(arbeit: Promise<unknown>): Promise<string | null> {
  try {
    await arbeit;

    return null;
  } catch (error) {
    return isUserPresetError(error) ? error.code : 'FREMD';
  }
}

describe('eigene Profile', () => {
  it('speichert Werte der Steuerung und listet nur eigene', async () => {
    const d = dienst();
    await d.create(ICH, {
      gameType: 'cs2',
      name: 'Smokes',
      values: { gameMode: 'custom', bots: 0 },
    });
    await d.create(ANDERE, { gameType: 'cs2', name: 'Fremd', values: { bots: 2 } });

    const liste = await d.listOwn(ICH, { gameType: 'cs2' });

    expect(liste.map((p) => p.name)).toEqual(['Smokes']);
    expect(liste[0]?.values).toEqual({ gameMode: 'custom', bots: 0 });
    expect(liste[0]?.permissions).toEqual({ canEdit: true, canDelete: true });
  });

  it('nimmt nur, was die Steuerung auch nimmt', async () => {
    const d = dienst();

    // Kein Feld der Steuerung (Servername), unzulässiger Wert, unbekanntes Spiel.
    expect(
      await fehlercode(d.create(ICH, { gameType: 'cs2', name: 'A', values: { serverName: 'x' } })),
    ).toBe('VALIDATION_FAILED');
    expect(
      await fehlercode(d.create(ICH, { gameType: 'cs2', name: 'A', values: { bots: 99 } })),
    ).toBe('VALIDATION_FAILED');
    expect(
      await fehlercode(d.create(ICH, { gameType: 'nichts', name: 'A', values: { bots: 1 } })),
    ).toBe('VALIDATION_FAILED');
  });

  it('meldet doppelte Namen und die Obergrenze', async () => {
    const d = dienst();
    await d.create(ICH, { gameType: 'cs2', name: 'A', values: { bots: 1 } });

    expect(
      await fehlercode(d.create(ICH, { gameType: 'cs2', name: 'A', values: { bots: 2 } })),
    ).toBe('USER_PRESET_NAME_TAKEN');

    for (let i = 1; i < USER_PRESET_LIMIT; i++) {
      await d.create(ICH, { gameType: 'cs2', name: `P${String(i)}`, values: { bots: 1 } });
    }
    expect(
      await fehlercode(d.create(ICH, { gameType: 'cs2', name: 'Zuviel', values: { bots: 1 } })),
    ).toBe('USER_PRESET_LIMIT_REACHED');
  });

  it('behandelt fremde Profile wie fehlende – ändern und löschen', async () => {
    const d = dienst();
    const fremd = await d.create(ANDERE, { gameType: 'cs2', name: 'X', values: { bots: 1 } });

    expect(await fehlercode(d.update(ICH, fremd.id, { name: 'Meins' }))).toBe(
      'USER_PRESET_NOT_FOUND',
    );
    expect(await fehlercode(d.remove(ICH, fremd.id))).toBe('USER_PRESET_NOT_FOUND');
  });

  it('überschreibt Werte, benennt um und löscht das eigene', async () => {
    const d = dienst();
    const profil = await d.create(ICH, { gameType: 'cs2', name: 'A', values: { bots: 1 } });

    const neu = await d.update(ICH, profil.id, { name: 'B', values: { bots: 3 } });
    expect(neu).toMatchObject({ name: 'B', values: { bots: 3 } });
    expect(neu.updatedAt).toBe('2026-09-26T12:00:00.000Z');

    await d.remove(ICH, profil.id);
    expect(await d.listOwn(ICH, { gameType: 'cs2' })).toEqual([]);
  });
});
