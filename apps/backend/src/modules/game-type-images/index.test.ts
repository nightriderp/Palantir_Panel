import { describe, expect, it } from 'vitest';
import {
  GAME_IMAGE_MAX_BYTES,
  type GameTypeImageKind,
  type GameTypeImageRecord,
  type GameTypeImageRepository,
  createGameTypeImageService,
  gameImageUrl,
  isGameTypeImageError,
  pruefeGameImage,
} from './index.js';

/**
 * Symbol und Kachelbild eines Spieltyps (Betreiber-Wunsch vom 19.09.2026).
 *
 * Geprüft wird, was das Backend ohne Bildbibliothek beantworten kann: Typ,
 * Größe, die ersten Bytes – und dass ein Bild nur zu einem Spiel gehört, das
 * es gibt.
 */

/** Kleinste Dateien, die die jeweilige Signatur tragen. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP', 'ascii'),
]);

function repository(): GameTypeImageRepository & { rows: GameTypeImageRecord[] } {
  const rows: GameTypeImageRecord[] = [];

  return {
    rows,
    async find(gameTypeId, kind) {
      return rows.find((row) => row.gameTypeId === gameTypeId && row.kind === kind) ?? null;
    },
    async listUpdatedAt() {
      const stand = new Map<string, Partial<Record<GameTypeImageKind, Date>>>();

      for (const row of rows) {
        stand.set(row.gameTypeId, { ...stand.get(row.gameTypeId), [row.kind]: row.updatedAt });
      }

      return stand;
    },
    async save(input) {
      const eintrag: GameTypeImageRecord = {
        gameTypeId: input.gameTypeId,
        kind: input.kind,
        data: input.data,
        mimeType: input.mimeType,
        updatedAt: new Date('2026-09-19T18:00:00.000Z'),
      };
      const index = rows.findIndex(
        (row) => row.gameTypeId === input.gameTypeId && row.kind === input.kind,
      );

      if (index === -1) {
        rows.push(eintrag);
      } else {
        rows[index] = eintrag;
      }

      return eintrag;
    },
    async remove(gameTypeId, kind) {
      const index = rows.findIndex((row) => row.gameTypeId === gameTypeId && row.kind === kind);

      if (index === -1) {
        return false;
      }

      rows.splice(index, 1);

      return true;
    },
  };
}

function service(bekannt: readonly string[] = ['minecraft-vanilla']) {
  const repo = repository();

  return {
    repo,
    service: createGameTypeImageService({
      repository: repo,
      kennt: (gameTypeId) => bekannt.includes(gameTypeId),
    }),
  };
}

describe('pruefeGameImage', () => {
  it('nimmt PNG, JPEG und WebP an', () => {
    for (const [mimeType, data] of [
      ['image/png', PNG],
      ['image/jpeg', JPEG],
      ['image/webp', WEBP],
    ] as const) {
      expect(pruefeGameImage({ kind: 'icon', mimeType, data }).mimeType).toBe(mimeType);
    }
  });

  it('lehnt ein fremdes Format ab', () => {
    const fehler = (() => {
      try {
        pruefeGameImage({ kind: 'icon', mimeType: 'image/gif', data: PNG });

        return null;
      } catch (ursache: unknown) {
        return ursache;
      }
    })();

    expect(isGameTypeImageError(fehler) ? fehler.code : null).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('glaubt dem gemeldeten Typ nicht, sondern den ersten Bytes', () => {
    // Ein Programm, das sich als Bild ausgibt: gleiche Endung, andere Bytes.
    const fehler = (() => {
      try {
        pruefeGameImage({
          kind: 'icon',
          mimeType: 'image/png',
          data: Buffer.from('MZ irgendein Programm'),
        });

        return null;
      } catch (ursache: unknown) {
        return ursache;
      }
    })();

    expect(isGameTypeImageError(fehler) ? fehler.code : null).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('gibt dem Kachelbild mehr Platz als dem Symbol', () => {
    expect(GAME_IMAGE_MAX_BYTES.cover).toBeGreaterThan(GAME_IMAGE_MAX_BYTES.icon);

    const zuGross = Buffer.concat([PNG, Buffer.alloc(GAME_IMAGE_MAX_BYTES.icon)]);
    const fehler = (() => {
      try {
        pruefeGameImage({ kind: 'icon', mimeType: 'image/png', data: zuGross });

        return null;
      } catch (ursache: unknown) {
        return ursache;
      }
    })();

    expect(isGameTypeImageError(fehler) ? fehler.code : null).toBe('FILE_TOO_LARGE');
    // Als Kachelbild passt dieselbe Datei noch.
    expect(pruefeGameImage({ kind: 'cover', mimeType: 'image/png', data: zuGross }).data).toBe(
      zuGross,
    );
  });
});

describe('createGameTypeImageService', () => {
  it('legt ein Bild an und liefert seine Adresse mit Zeitstempel', async () => {
    const { service: dienst } = service();

    await dienst.save({
      gameTypeId: 'minecraft-vanilla',
      kind: 'icon',
      mimeType: 'image/png',
      data: PNG,
      uploadedById: null,
    });

    const adressen = await dienst.urls();

    expect(adressen.get('minecraft-vanilla')).toEqual({
      iconUrl: `/api/game-types/minecraft-vanilla/images/icon?v=${String(
        new Date('2026-09-19T18:00:00.000Z').getTime(),
      )}`,
      coverImageUrl: null,
    });
  });

  it('ersetzt ein vorhandenes Bild, statt ein zweites daneben zu legen', async () => {
    const { service: dienst, repo } = service();

    await dienst.save({
      gameTypeId: 'minecraft-vanilla',
      kind: 'icon',
      mimeType: 'image/png',
      data: PNG,
      uploadedById: null,
    });
    await dienst.save({
      gameTypeId: 'minecraft-vanilla',
      kind: 'icon',
      mimeType: 'image/jpeg',
      data: JPEG,
      uploadedById: null,
    });

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]?.mimeType).toBe('image/jpeg');
  });

  it('lehnt ein Bild für ein Spiel ab, das es nicht gibt', async () => {
    const { service: dienst } = service();

    const fehler = await dienst
      .save({
        gameTypeId: 'gibtsnicht',
        kind: 'icon',
        mimeType: 'image/png',
        data: PNG,
        uploadedById: null,
      })
      .catch((ursache: unknown) => ursache);

    expect(isGameTypeImageError(fehler) ? fehler.code : null).toBe('NOT_FOUND');
  });

  it('nimmt das Entfernen eines fehlenden Bildes hin', async () => {
    const { service: dienst } = service();

    await expect(dienst.remove('minecraft-vanilla', 'cover')).resolves.toBeUndefined();
  });

  it('baut die Adresse mit dem Zeitstempel als Fassung', () => {
    expect(gameImageUrl('a b', 'cover', new Date(1_000))).toBe(
      '/api/game-types/a%20b/images/cover?v=1000',
    );
  });
});
