/**
 * Attrappe der Ablage für die Tests der Übersichts-Kacheln – ohne PostgreSQL
 * (Entwicklungsregeln §4).
 */

import { randomUUID } from 'node:crypto';
import { type OverviewTileRecord, type OverviewTileRepository } from './index.js';

export const TILE_ID = '44444444-4444-4444-8444-444444444444';

export function tileRecord(overrides: Partial<OverviewTileRecord> = {}): OverviewTileRecord {
  return {
    id: TILE_ID,
    title: 'AirStrafingAddicts.com Surf',
    subtitle: 'Öffentlicher Movement-Server',
    gameTypeId: 'cs2',
    gameLabel: 'CS2 · Surf',
    address: null,
    linkUrl: 'https://discord.gg/asa',
    linkLabel: 'ASA Discord',
    sortOrder: 0,
    enabled: true,
    createdById: null,
    createdAt: new Date('2026-09-26T10:00:00.000Z'),
    updatedAt: new Date('2026-09-26T10:00:00.000Z'),
    ...overrides,
  };
}

export function createFakeOverviewTileRepository(
  start: OverviewTileRecord[] = [],
): OverviewTileRepository & { rows: OverviewTileRecord[] } {
  const rows = [...start];

  return {
    rows,
    async list() {
      return [...rows].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'de'),
      );
    },
    async find(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async create(input) {
      const record: OverviewTileRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date('2026-09-26T12:00:00.000Z'),
        updatedAt: new Date('2026-09-26T12:00:00.000Z'),
      };
      rows.push(record);

      return record;
    },
    async update(id, fields) {
      const index = rows.findIndex((row) => row.id === id);

      if (index === -1) return null;

      const aktualisiert: OverviewTileRecord = {
        ...rows[index]!,
        ...fields,
        updatedAt: new Date('2026-09-26T13:00:00.000Z'),
      };
      rows[index] = aktualisiert;

      return aktualisiert;
    },
    async remove(id) {
      const index = rows.findIndex((row) => row.id === id);

      if (index === -1) return false;

      rows.splice(index, 1);

      return true;
    },
  };
}
