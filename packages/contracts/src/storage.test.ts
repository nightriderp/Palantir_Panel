import { describe, expect, it } from 'vitest';
import { STORAGE_ENTRY_KINDS, type StorageEntryDto, isStorageEntryKind } from './storage.js';

function entry(overrides: Partial<StorageEntryDto> = {}): StorageEntryDto {
  return {
    id: '/srv/palantir/data/beispiel',
    kind: 'serverData',
    label: 'Beispielserver',
    path: '/srv/palantir/data/beispiel',
    sizeBytes: 1024,
    serverId: '0f2f3f4f-0000-4000-8000-000000000001',
    backupId: null,
    imageTag: null,
    inUse: true,
    lastModifiedAt: null,
    deleteBlockedReason: 'activeServerData',
    permissions: { canView: true, canDelete: false },
    ...overrides,
  };
}

describe('Storage-Explorer-Contract (Lastenheft §3.8, Pflichtenheft §16)', () => {
  it('kennt genau die Kategorien aus dem Lastenheft', () => {
    expect([...STORAGE_ENTRY_KINDS]).toEqual([
      'serverData',
      'backup',
      'dockerImage',
      'orphaned',
      'other',
    ]);
    expect(isStorageEntryKind('backup')).toBe(true);
    expect(isStorageEntryKind('sonstiges')).toBe(false);
  });

  it('nennt zu einem gesperrten Eintrag immer einen benannten Grund statt Freitext', () => {
    const gesperrt = entry();

    expect(gesperrt.permissions.canDelete).toBe(false);
    expect(gesperrt.deleteBlockedReason).toBe('activeServerData');
  });

  it('lässt den Grund bei löschbaren Einträgen leer', () => {
    const backup = entry({
      kind: 'backup',
      backupId: '0f2f3f4f-0000-4000-8000-000000000002',
      deleteBlockedReason: null,
      permissions: { canView: true, canDelete: true },
    });

    expect(backup.deleteBlockedReason).toBeNull();
    expect(backup.permissions.canDelete).toBe(true);
  });
});
