import { type BackupDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  consistencyMeta,
  filterByType,
  retentionState,
  serversWithoutBackup,
  sortByNewest,
  summarizeOwnBackups,
} from './backupsView';

/** Minimaler, vollständiger `BackupDto` mit überschreibbaren Feldern für den Test. */
function makeBackup(overrides: Partial<BackupDto> = {}): BackupDto {
  return {
    id: 'b1',
    serverId: 's1',
    serverName: 'Server 1',
    ownerId: 'u1',
    ownerDisplayName: 'Ich',
    type: 'manual',
    status: 'completed',
    isExport: false,
    sizeBytes: 1000,
    storagePath: null,
    checksumSha256: null,
    containerStopped: false,
    createdByUserId: 'u1',
    createdByDisplayName: 'Ich',
    createdAt: '2026-08-20T10:00:00.000Z',
    startedAt: '2026-08-20T10:00:00.000Z',
    completedAt: '2026-08-20T10:01:00.000Z',
    failureCode: null,
    failureMessage: null,
    retentionProtected: true,
    expiresAt: null,
    permissions: { canView: true, canRestore: true, canDelete: true, canDownload: true },
    ...overrides,
  };
}

describe('summarizeOwnBackups', () => {
  it('zählt Typen und Zustände und summiert den Speicher über alle Server', () => {
    const summary = summarizeOwnBackups([
      makeBackup({ id: 'a', type: 'manual', sizeBytes: 1000 }),
      makeBackup({ id: 'b', type: 'automatic', sizeBytes: 2000 }),
      makeBackup({ id: 'c', type: 'automatic', status: 'running', sizeBytes: 0 }),
      makeBackup({ id: 'd', type: 'manual', status: 'failed', sizeBytes: 0 }),
    ]);

    expect(summary.total).toBe(4);
    expect(summary.totalSizeBytes).toBe(3000);
    expect(summary.manualCount).toBe(2);
    expect(summary.automaticCount).toBe(2);
    expect(summary.pendingCount).toBe(1);
    expect(summary.failedCount).toBe(1);
  });

  it('liefert für einen leeren Bestand lauter Nullen', () => {
    expect(summarizeOwnBackups([])).toEqual({
      total: 0,
      totalSizeBytes: 0,
      manualCount: 0,
      automaticCount: 0,
      pendingCount: 0,
      failedCount: 0,
    });
  });
});

describe('retentionState', () => {
  it('erkennt geschützte Backups (manuell oder neuestes automatisches)', () => {
    expect(retentionState(makeBackup({ retentionProtected: true, expiresAt: null }))).toBe(
      'protected',
    );
  });

  it('meldet den Ablauf, wenn ein Löschzeitpunkt gesetzt ist', () => {
    expect(
      retentionState(
        makeBackup({
          type: 'automatic',
          retentionProtected: false,
          expiresAt: '2026-08-27T10:00:00.000Z',
        }),
      ),
    ).toBe('expiring');
  });

  it('geht Zustand vor Aufbewahrung: laufend und fehlgeschlagen zuerst', () => {
    expect(retentionState(makeBackup({ status: 'running' }))).toBe('pending');
    expect(retentionState(makeBackup({ status: 'pending' }))).toBe('pending');
    expect(
      retentionState(makeBackup({ status: 'failed', retentionProtected: false, expiresAt: null })),
    ).toBe('failed');
  });
});

describe('filterByType', () => {
  const backups = [
    makeBackup({ id: 'm', type: 'manual' }),
    makeBackup({ id: 'a', type: 'automatic' }),
  ];

  it('lässt bei „all" alles durch', () => {
    expect(filterByType(backups, 'all')).toHaveLength(2);
  });

  it('filtert auf den gewählten Typ', () => {
    expect(filterByType(backups, 'manual').map((b) => b.id)).toEqual(['m']);
    expect(filterByType(backups, 'automatic').map((b) => b.id)).toEqual(['a']);
  });

  it('mutiert die Eingabe nicht', () => {
    const input = [...backups];
    filterByType(input, 'manual');
    expect(input).toHaveLength(2);
  });
});

describe('sortByNewest', () => {
  it('sortiert neueste zuerst, ohne die Eingabe zu verändern', () => {
    const input = [
      makeBackup({ id: 'alt', createdAt: '2026-08-01T00:00:00.000Z' }),
      makeBackup({ id: 'neu', createdAt: '2026-08-28T00:00:00.000Z' }),
      makeBackup({ id: 'mitte', createdAt: '2026-08-15T00:00:00.000Z' }),
    ];

    expect(sortByNewest(input).map((b) => b.id)).toEqual(['neu', 'mitte', 'alt']);
    expect(input.map((b) => b.id)).toEqual(['alt', 'neu', 'mitte']);
  });
});

describe('serversWithoutBackup', () => {
  const server = (id: string, name: string, ownerId = 'u1') => ({ id, name, ownerId });

  it('nennt nur eigene Server ohne jede Sicherung', () => {
    const ergebnis = serversWithoutBackup(
      [server('s1', 'Eins'), server('s2', 'Zwei'), server('s3', 'Fremd', 'u2')],
      [makeBackup({ serverId: 's1' })],
      'u1',
    );

    expect(ergebnis).toEqual([{ id: 's2', name: 'Zwei' }]);
  });

  it('zaehlt auch eine fehlgeschlagene Sicherung als Versuch', () => {
    const ergebnis = serversWithoutBackup(
      [server('s1', 'Eins')],
      [makeBackup({ serverId: 's1', status: 'failed' })],
      'u1',
    );

    expect(ergebnis).toEqual([]);
  });

  it('bleibt ohne Sitzung leer', () => {
    expect(serversWithoutBackup([server('s1', 'Eins')], [], null)).toEqual([]);
  });
});

describe('Vollstaendig / Unklar (Gefundener Punkt 38)', () => {
  it('nennt ein bei gestopptem Server gezogenes Archiv vollstaendig', () => {
    const meta = consistencyMeta(makeBackup({ status: 'completed', containerStopped: true }));

    expect(meta?.label).toBe('Vollständig');
    expect(meta?.tone).toBe('success');
  });

  it('nennt ein im Betrieb gezogenes Archiv unklar - aber nicht fehlerhaft', () => {
    const meta = consistencyMeta(makeBackup({ status: 'completed', containerStopped: false }));

    expect(meta?.label).toBe('Unklar');
    // Kein Fehler, nur eine Einschraenkung.
    expect(meta?.tone).toBe('neutral');
  });

  it('sagt zu einem unfertigen Backup nichts', () => {
    expect(consistencyMeta(makeBackup({ status: 'running' }))).toBeNull();
    expect(consistencyMeta(makeBackup({ status: 'failed' }))).toBeNull();
  });
});
