import { describe, expect, it } from 'vitest';
import { getStorageBreakdownResultSchema } from './storage.js';

const ergebnis = {
  scannedAt: '2026-08-26T10:00:00.000Z',
  totalBytes: 2_000_000_000_000,
  usedBytes: 900_000_000_000,
  freeBytes: 1_100_000_000_000,
  entries: [
    {
      kind: 'serverData',
      path: '/srv/palantir/data/0f2f3f4f-0000-4000-8000-000000000001',
      sizeBytes: 5_000_000,
      serverId: '0f2f3f4f-0000-4000-8000-000000000001',
      backupFileName: null,
      imageId: null,
      imageTag: null,
      inUse: true,
      lastModifiedAt: '2026-08-26T09:00:00.000Z',
    },
  ],
};

describe('Ergebnis von GET_STORAGE_BREAKDOWN (Pflichtenheft §16)', () => {
  it('nimmt eine vollständige Meldung des Agents an', () => {
    expect(getStorageBreakdownResultSchema.parse(ergebnis).entries).toHaveLength(1);
  });

  it('lehnt negative Größen ab', () => {
    const result = getStorageBreakdownResultSchema.safeParse({ ...ergebnis, usedBytes: -1 });

    expect(result.success).toBe(false);
  });

  it('lehnt die Kategorie „other" ab – die vergibt erst das Backend', () => {
    const result = getStorageBreakdownResultSchema.safeParse({
      ...ergebnis,
      entries: [{ ...ergebnis.entries[0], kind: 'other' }],
    });

    expect(result.success).toBe(false);
  });

  it('lehnt eine serverId ab, die keine UUID ist', () => {
    const result = getStorageBreakdownResultSchema.safeParse({
      ...ergebnis,
      entries: [{ ...ergebnis.entries[0], serverId: 'server-1' }],
    });

    expect(result.success).toBe(false);
  });
});
