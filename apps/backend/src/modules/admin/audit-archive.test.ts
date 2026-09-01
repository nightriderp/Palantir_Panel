import { AUDIT_RETENTION_MONTHS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AuditArchiveWriter,
  archiveAuditEntries,
  archiveCutoff,
  archiveFileName,
} from './audit-archive.js';
import { createAuditService } from './audit.js';
import { AdminError } from './errors.js';
import { actorWith, auditEntry, createFakeAuditRepository } from './test-support.js';

const NOW = new Date('2026-08-26T10:00:00.000Z');

/** Schreibt nichts, merkt sich aber, was und wann geschrieben wurde. */
function createRecordingWriter(): AuditArchiveWriter & {
  calls: { fileName: string; ids: string[] }[];
} {
  const calls: { fileName: string; ids: string[] }[] = [];

  return {
    calls,
    async write(fileName, entries) {
      calls.push({ fileName, ids: entries.map((entry) => entry.id) });

      return { filePath: `/opt/palantir/data/audit-archive/${fileName}`, sizeBytes: 1234 };
    },
  };
}

function failingWriter(): AuditArchiveWriter {
  return {
    async write() {
      throw new Error('Kein Platz auf dem Datenträger');
    },
  };
}

const alt = auditEntry({ id: 'alt', timestamp: new Date('2023-01-01T00:00:00.000Z') });
const grenzwertig = auditEntry({
  id: 'grenzwertig',
  timestamp: new Date('2024-09-01T00:00:00.000Z'),
});
const neu = auditEntry({ id: 'neu', timestamp: new Date('2026-08-01T00:00:00.000Z') });

describe('Archivierung des Audit-Logs (Pflichtenheft §6)', () => {
  it('nimmt den Stichtag 24 Monate vor dem Lauf', () => {
    expect(AUDIT_RETENTION_MONTHS).toBe(24);
    expect(archiveCutoff(NOW).toISOString()).toBe('2024-08-26T10:00:00.000Z');
  });

  it('benennt die Archivdatei nach dem Stichtag', () => {
    expect(archiveFileName(archiveCutoff(NOW))).toBe('audit-log-bis-2024-08-26.jsonl.gz');
  });

  it('exportiert nur Einträge älter als der Stichtag und entfernt genau diese', async () => {
    const repository = createFakeAuditRepository([alt, grenzwertig, neu]);
    const writer = createRecordingWriter();

    const result = await archiveAuditEntries({ repository, writer, now: () => NOW }, null);

    expect(writer.calls[0]?.ids).toEqual(['alt']);
    expect(result.archivedCount).toBe(1);
    expect(repository.rows.map((row) => row.id)).toEqual(['grenzwertig', 'neu']);
  });

  it('schreibt das Archiv, bevor es etwas entfernt', async () => {
    const repository = createFakeAuditRepository([alt]);
    const order: string[] = [];

    const writer: AuditArchiveWriter = {
      async write(fileName) {
        order.push('write');

        return { filePath: fileName, sizeBytes: 10 };
      },
    };

    const originalDelete = repository.deleteOlderThan.bind(repository);
    repository.deleteOlderThan = async (cutoff) => {
      order.push('delete');

      return originalDelete(cutoff);
    };

    await archiveAuditEntries({ repository, writer, now: () => NOW }, null);

    expect(order).toEqual(['write', 'delete']);
  });

  it('lässt die aktive Tabelle unverändert, wenn der Export scheitert', async () => {
    const repository = createFakeAuditRepository([alt, neu]);

    await expect(
      archiveAuditEntries({ repository, writer: failingWriter(), now: () => NOW }, null),
    ).rejects.toMatchObject({ code: 'AUDIT_ARCHIVE_FAILED' });

    expect(repository.rows.map((row) => row.id)).toEqual(['alt', 'neu']);
  });

  it('schreibt keine Datei, wenn nichts zu archivieren ist', async () => {
    const repository = createFakeAuditRepository([neu]);
    const writer = createRecordingWriter();

    const result = await archiveAuditEntries({ repository, writer, now: () => NOW }, null);

    expect(writer.calls).toHaveLength(0);
    expect(result.archivedCount).toBe(0);
    expect(result.archiveFilePath).toBeNull();
    expect(repository.rows).toHaveLength(1);
  });

  it('protokolliert den Lauf selbst – und zwar erst nach dem Entfernen', async () => {
    const repository = createFakeAuditRepository([alt]);
    const audit = createAuditService(repository);

    const result = await archiveAuditEntries(
      { repository, writer: createRecordingWriter(), audit, now: () => NOW },
      null,
    );

    // Der neue Eintrag ist jünger als der Stichtag und kann deshalb nicht
    // selbst Teil des Archivs geworden sein.
    expect(repository.rows.map((row) => row.action)).toEqual(['audit.archived']);
    expect(result.archivedCount).toBe(1);
  });

  it('lehnt den Lauf ohne audit.manage ab – auch mit audit.view', async () => {
    const repository = createFakeAuditRepository([alt]);

    // Gefundener Punkt 46: Lesen berechtigt nicht zum Verkuerzen.
    await expect(
      archiveAuditEntries(
        { repository, writer: createRecordingWriter(), now: () => NOW },
        actorWith('audit.view'),
      ),
    ).rejects.toThrow(AdminError);

    expect(repository.rows).toHaveLength(1);
  });

  it('laesst den Lauf mit audit.manage zu', async () => {
    const repository = createFakeAuditRepository([alt]);

    const result = await archiveAuditEntries(
      { repository, writer: createRecordingWriter(), now: () => NOW },
      actorWith('audit.manage'),
    );

    expect(result.archivedCount).toBe(1);
  });
});
