import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { AUDIT_RETENTION_MONTHS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AuditArchiveWriter,
  archiveAuditEntries,
  archiveCutoff,
  archiveFileName,
  createGzipArchiveWriter,
} from './audit-archive.js';
import { createAuditService } from './audit.js';
import { AdminError } from './errors.js';
import {
  USER_ID,
  actorWith,
  auditEntry,
  createFakeAuditRepository,
  ctxWith,
} from './test-support.js';

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

/**
 * Schreiber, der im Schreibvorgang stehen bleibt, bis der Test ihn freigibt.
 *
 * Damit lässt sich ein zweiter Lauf genau dann anstoßen, wenn der erste
 * mitten in der Archivdatei steckt – der Fall aus backend-admin-resources-11.
 */
function createBlockingWriter(): AuditArchiveWriter & {
  calls: string[];
  /** Aufgelöst, sobald der Lauf tatsächlich beim Schreiben angekommen ist. */
  gestartet: Promise<void>;
  freigeben(): void;
} {
  const calls: string[] = [];
  let angekommen: () => void = () => undefined;
  let loesen: () => void = () => undefined;
  const gestartet = new Promise<void>((resolve) => {
    angekommen = resolve;
  });
  const blockade = new Promise<void>((resolve) => {
    loesen = resolve;
  });

  return {
    calls,
    gestartet,
    freigeben: () => {
      loesen();
    },
    async write(fileName) {
      calls.push(fileName);
      angekommen();
      await blockade;

      return { filePath: `/opt/palantir/data/audit-archive/${fileName}`, sizeBytes: 1234 };
    },
  };
}

const alt = auditEntry({ id: 'alt', timestamp: new Date('2023-01-01T00:00:00.000Z') });
const grenzwertig = auditEntry({
  id: 'grenzwertig',
  timestamp: new Date('2024-09-01T00:00:00.000Z'),
});
const neu = auditEntry({ id: 'neu', timestamp: new Date('2026-08-01T00:00:00.000Z') });

describe('Stichtag und Dateiname eines Archivlaufs', () => {
  it('nimmt den Stichtag 24 Monate vor dem Lauf – als UTC-Datum', () => {
    expect(AUDIT_RETENTION_MONTHS).toBe(24);
    expect(archiveCutoff(NOW).toISOString()).toBe('2024-08-26T00:00:00.000Z');
  });

  it('benennt die Archivdatei nach Stichtag und Zeitpunkt des Laufs', () => {
    expect(archiveFileName(archiveCutoff(NOW), NOW)).toMatch(
      /^audit-log-bis-2024-08-26-20260826T100000Z-[0-9a-f]{8}\.jsonl\.gz$/,
    );
  });

  it('vergibt für zwei Läufe in derselben Sekunde verschiedene Dateinamen', () => {
    // Vorher trug der Name nur den Stichtag: Zwei Läufe am selben Tag – etwa
    // Cronjob und Klick in der Oberfläche – schrieben in dieselbe Datei
    // (backend-admin-resources-11).
    const cutoff = archiveCutoff(NOW);
    const namen = new Set([archiveFileName(cutoff, NOW), archiveFileName(cutoff, NOW)]);

    expect(namen.size).toBe(2);
  });
});

/**
 * Stichtag der Anwendung gegen den des Datenbank-Triggers (backend-db-08).
 *
 * Der Trigger in `0005_admin_ports_audit_storage.sql` rechnet
 * `now() - interval '24 months'` und lehnt jeden Löschversuch ab, der jünger
 * ist. Die erwarteten Werte stammen aus PostgreSQL selbst, z. B.
 * `SELECT timestamptz '2026-03-31 12:34:56.789+00' - interval '24 months';`
 * bei einer Sitzung in UTC.
 */
describe('Stichtag der Archivierung (backend-db-08)', () => {
  it.each([
    // Monatsende: früher rechnete `setMonth()` in lokaler Zeit, hier zählt UTC.
    {
      fall: '31.03.',
      now: '2026-03-31T12:34:56.789Z',
      datenbank: '2024-03-31T12:34:56.789Z',
      erwartet: '2024-03-31T00:00:00.000Z',
    },
    // Schaltjahr: PostgreSQL klemmt auf den 28.02., `setMonth()` ließ den Tag
    // in den 01.03. überlaufen – der App-Stichtag lag einen Tag zu spät.
    {
      fall: '29.02. im Schaltjahr',
      now: '2028-02-29T06:00:00.000Z',
      datenbank: '2026-02-28T06:00:00.000Z',
      erwartet: '2026-02-28T00:00:00.000Z',
    },
    // Über die Jahresgrenze hinweg, kurz vor Mitternacht UTC.
    {
      fall: 'Jahreswechsel',
      now: '2026-01-01T23:59:59.999Z',
      datenbank: '2024-01-01T23:59:59.999Z',
      erwartet: '2024-01-01T00:00:00.000Z',
    },
    // Zielmonat ist ein Februar mit 29 Tagen: Hier klemmt nichts, der Tag
    // bleibt stehen – die Gegenprobe zum Fall darüber.
    {
      fall: 'Schaltjahr als Ziel',
      now: '2026-02-28T08:15:00.000Z',
      datenbank: '2024-02-28T08:15:00.000Z',
      erwartet: '2024-02-28T00:00:00.000Z',
    },
  ])('$fall: Stichtag bleibt hinter dem der Datenbank', ({ now, datenbank, erwartet }) => {
    const cutoff = archiveCutoff(new Date(now));

    expect(cutoff.toISOString()).toBe(erwartet);
    // Kein Monatsüberlauf: derselbe Kalendertag wie in der Datenbank.
    expect(cutoff.toISOString().slice(0, 10)).toBe(datenbank.slice(0, 10));
    // Nie später als die Datenbank – sonst lehnt der Trigger genau die
    // Einträge ab, die bereits in der Archivdatei stehen.
    expect(cutoff.getTime()).toBeLessThanOrEqual(new Date(datenbank).getTime());
  });

  it('liefert immer Mitternacht UTC', () => {
    for (const now of ['2026-08-26T10:00:00.000Z', '2026-12-31T23:59:59.999Z']) {
      const cutoff = archiveCutoff(new Date(now));

      expect([
        cutoff.getUTCHours(),
        cutoff.getUTCMinutes(),
        cutoff.getUTCSeconds(),
        cutoff.getUTCMilliseconds(),
      ]).toEqual([0, 0, 0, 0]);
    }
  });
});

describe('Archivierung des Audit-Logs (Pflichtenheft §6)', () => {
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

  it('hält den Auslöser des Laufs fest', async () => {
    // Bisher stand der Eintrag mit `actorId: null` da – ein HTTP-Lauf war vom
    // Kommandozeilen-Lauf nicht zu unterscheiden (Pflichtenheft §6).
    const repository = createFakeAuditRepository([alt]);
    const audit = createAuditService(repository);

    await archiveAuditEntries(
      { repository, writer: createRecordingWriter(), audit, now: () => NOW },
      ctxWith(actorWith('audit.manage')),
    );

    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      action: 'audit.archived',
      actorId: USER_ID,
      actorDisplayName: 'Test-Admin',
      ipHint: '10.0.0.x',
      targetType: 'auditLog',
      metadata: { archivedCount: 1 },
    });
  });

  it('bleibt beim Kommandozeilen-Lauf ohne Handelnden', async () => {
    const repository = createFakeAuditRepository([alt]);
    const audit = createAuditService(repository);

    await archiveAuditEntries(
      { repository, writer: createRecordingWriter(), audit, now: () => NOW },
      null,
    );

    expect(repository.rows[0]).toMatchObject({ action: 'audit.archived', actorId: null });
  });

  it('lehnt den Lauf ohne audit.manage ab – auch mit audit.view', async () => {
    const repository = createFakeAuditRepository([alt]);

    // Gefundener Punkt 46: Lesen berechtigt nicht zum Verkuerzen.
    await expect(
      archiveAuditEntries(
        { repository, writer: createRecordingWriter(), now: () => NOW },
        ctxWith(actorWith('audit.view')),
      ),
    ).rejects.toThrow(AdminError);

    expect(repository.rows).toHaveLength(1);
  });

  it('laesst den Lauf mit audit.manage zu', async () => {
    const repository = createFakeAuditRepository([alt]);

    const result = await archiveAuditEntries(
      { repository, writer: createRecordingWriter(), now: () => NOW },
      ctxWith(actorWith('audit.manage')),
    );

    expect(result.archivedCount).toBe(1);
  });
});

/**
 * Nur ein Lauf zur Zeit (Audit W2-16, backend-admin-resources-11).
 *
 * Der Lock liegt in der Datenbank, weil sich der Lauf aus zwei Prozessen
 * anstoßen lässt (Oberfläche und `audit:archive` auf der VPS). Die Attrappe
 * bildet `pg_try_advisory_lock` nach: belegt oder nicht.
 */
describe('Serialisierung des Archivlaufs', () => {
  it('weist einen zweiten Lauf ab und lässt die Datei des ersten unangetastet', async () => {
    const repository = createFakeAuditRepository([alt]);
    const erster = createBlockingWriter();
    const zweiter = createRecordingWriter();

    // Erster Lauf: steht mitten im Schreiben der Archivdatei.
    const laufend = archiveAuditEntries({ repository, writer: erster, now: () => NOW }, null);
    await erster.gestartet;

    const fehler = await archiveAuditEntries(
      { repository, writer: zweiter, now: () => NOW },
      null,
    ).catch((error: unknown) => error);

    expect(fehler).toBeInstanceOf(AdminError);
    expect(fehler).toMatchObject({ code: 'AUDIT_ARCHIVE_FAILED' });
    expect((fehler as AdminError).message).toMatch(/bereits ein Archivierungslauf/);

    // Der zweite Lauf hat nichts geschrieben und nichts gelöscht.
    expect(zweiter.calls).toHaveLength(0);
    expect(erster.calls).toHaveLength(1);
    expect(repository.rows.map((row) => row.id)).toEqual(['alt']);

    erster.freigeben();
    await laufend;

    expect(repository.lockHeld).toBe(false);
  });

  it('gibt die Sperre nach dem Lauf wieder frei', async () => {
    const repository = createFakeAuditRepository([alt]);

    await archiveAuditEntries(
      { repository, writer: createRecordingWriter(), now: () => NOW },
      null,
    );

    expect(repository.lockHeld).toBe(false);

    // Ein zweiter Lauf kommt danach wieder durch – es ist nur nichts mehr da.
    const spaeter = await archiveAuditEntries(
      { repository, writer: createRecordingWriter(), now: () => NOW },
      null,
    );

    expect(spaeter.archivedCount).toBe(0);
  });

  it('gibt die Sperre auch nach einem gescheiterten Lauf frei', async () => {
    const repository = createFakeAuditRepository([alt]);

    await expect(
      archiveAuditEntries({ repository, writer: failingWriter(), now: () => NOW }, null),
    ).rejects.toMatchObject({ code: 'AUDIT_ARCHIVE_FAILED' });

    expect(repository.lockHeld).toBe(false);

    // Sonst wäre nach einem vollen Datenträger nie wieder ein Lauf möglich.
    const zweiter = await archiveAuditEntries(
      { repository, writer: createRecordingWriter(), now: () => NOW },
      null,
    );

    expect(zweiter.archivedCount).toBe(1);
  });

  it('prüft die Berechtigung, bevor es die Sperre nimmt', async () => {
    const repository = createFakeAuditRepository([alt]);

    await expect(
      archiveAuditEntries(
        { repository, writer: createRecordingWriter(), now: () => NOW },
        ctxWith(actorWith('audit.view')),
      ),
    ).rejects.toThrow(AdminError);

    expect(repository.lockHeld).toBe(false);
  });
});

/**
 * Die Archivdatei selbst – der einzige Test, der wirklich auf die Platte
 * schreibt. Er sichert die letzte Schranke gegen Datenverlust ab: Ein
 * vorhandenes Archiv wird nie überschrieben (backend-admin-resources-11).
 */
describe('Archivdatei schreiben', () => {
  it('überschreibt eine vorhandene Archivdatei nicht', async () => {
    const verzeichnis = await mkdtemp(path.join(tmpdir(), 'palantir-audit-archiv-'));

    try {
      const writer = createGzipArchiveWriter(verzeichnis);
      const dateiname = archiveFileName(archiveCutoff(NOW), NOW);

      const datei = await writer.write(dateiname, [alt]);
      const inhalt = await readFile(datei.filePath);

      // Der gzip-Inhalt ist vollständiges JSON Lines.
      const zeilen = gunzipSync(inhalt).toString('utf8').trimEnd().split('\n');
      expect(zeilen).toHaveLength(1);
      expect(JSON.parse(zeilen[0] ?? '{}')).toMatchObject({ id: 'alt' });

      // Zweiter Schreibversuch unter demselben Namen: abgewiesen, statt den
      // ersten Export mit einem zweiten gzip-Strom zu zerschreiben.
      await expect(writer.write(dateiname, [neu])).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(datei.filePath)).toEqual(inhalt);
    } finally {
      await rm(verzeichnis, { recursive: true, force: true });
    }
  });
});
