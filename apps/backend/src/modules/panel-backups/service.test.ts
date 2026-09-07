/**
 * Tests der Panel-Sicherungen (Mockup-Abgleich 12.5.1 und 12.5.2).
 *
 * Geprüft wird der Ablauf, nicht `pg_dump`: Der Abzug ist eingespeist
 * ({@link DatabaseDumper}), damit die Fälle „Abzug scheitert",
 * „Aufbewahrungsfrist" und „Takt" ohne Datenbank und ohne Dateisystem prüfbar
 * bleiben (CLAUDE.md §4).
 */

import { describe, expect, it } from 'vitest';
import { type PermissionActor } from '../rbac/index.js';
import {
  type DatabaseDumper,
  type PanelBackupRecord,
  type PanelBackupRepository,
  backupFileName,
  createPanelBackupService,
  isPanelBackupError,
} from './index.js';
import { pgEnvFromUrl } from './pg-dump.js';

const ADMIN: PermissionActor = {
  isOwner: false,
  permissions: new Set(['backup.manage.any']),
  approved: true,
};
const NUTZER: PermissionActor = {
  isOwner: false,
  permissions: new Set(['backup.manage.own']),
  approved: true,
};

/** Ablage im Speicher – dieselbe Reihenfolge wie die Drizzle-Umsetzung. */
function speicherRepository(vorhanden: PanelBackupRecord[] = []): PanelBackupRepository & {
  readonly rows: PanelBackupRecord[];
} {
  const rows = [...vorhanden];
  let naechste = rows.length + 1;

  function ersetze(id: string, aenderung: Partial<PanelBackupRecord>): PanelBackupRecord {
    const index = rows.findIndex((row) => row.id === id);

    if (index === -1) {
      throw new Error(`Unbekannte Sicherung ${id}.`);
    }

    const neu = { ...rows[index], ...aenderung } as PanelBackupRecord;
    rows[index] = neu;

    return neu;
  }

  return {
    rows,
    async create(trigger, storagePath) {
      if (rows.some((row) => row.status === 'running')) {
        /*
         * Bildet den partiellen Unique-Index `panel_backups_one_running_idx`
         * nach (Audit bb-11): Höchstens ein laufender Abzug, zugesichert von
         * der Datenbank. `pg` legt den SQLSTATE als `code` auf den Fehler.
         */
        const fehler = new Error(
          'duplicate key value violates unique constraint "panel_backups_one_running_idx"',
        ) as Error & { code?: string };
        fehler.code = '23505';

        throw fehler;
      }

      const record: PanelBackupRecord = {
        id: `backup-${String(naechste++)}`,
        status: 'running',
        trigger,
        storagePath,
        sizeBytes: 0,
        failureMessage: null,
        startedAt: new Date('2026-09-01T03:00:00.000Z'),
        completedAt: null,
      };

      rows.push(record);

      return record;
    },
    async finish(id, sizeBytes) {
      return ersetze(id, {
        status: 'completed',
        sizeBytes,
        failureMessage: null,
        completedAt: new Date('2026-09-01T03:00:10.000Z'),
      });
    },
    async fail(id, message) {
      return ersetze(id, {
        status: 'failed',
        failureMessage: message,
        completedAt: new Date('2026-09-01T03:00:10.000Z'),
      });
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async list(limit) {
      return [...rows]
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, limit);
    },
    async findLatest() {
      return [...rows].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null;
    },
    async findRunning() {
      return rows.find((row) => row.status === 'running') ?? null;
    },
    async remove(id) {
      const index = rows.findIndex((row) => row.id === id);

      if (index !== -1) {
        rows.splice(index, 1);
      }
    },
    async listFinishedBefore(before) {
      return rows.filter((row) => row.status !== 'running' && row.startedAt < before);
    },
  };
}

function dumper(groesse = 4_096): DatabaseDumper & { readonly pfade: string[] } {
  const pfade: string[] = [];

  return {
    pfade,
    async dump(targetPath) {
      pfade.push(targetPath);

      return groesse;
    },
  };
}

function entferner(): { remove(path: string): Promise<void>; readonly entfernt: string[] } {
  const entfernt: string[] = [];

  return {
    entfernt,
    async remove(path) {
      entfernt.push(path);
    },
  };
}

function fertig(id: string, startedAt: string, storagePath: string | null): PanelBackupRecord {
  return {
    id,
    status: 'completed',
    trigger: 'scheduled',
    storagePath,
    sizeBytes: 1_024,
    failureMessage: null,
    startedAt: new Date(startedAt),
    completedAt: new Date(startedAt),
  };
}

function baue(
  overrides: Partial<Parameters<typeof createPanelBackupService>[0]> = {},
): ReturnType<typeof createPanelBackupService> {
  return createPanelBackupService({
    repository: speicherRepository(),
    directory: '/opt/palantir/data/panel-backups',
    dumper: dumper(),
    files: entferner(),
    intervalHours: 24,
    retentionDays: 14,
    now: () => new Date('2026-09-01T03:00:00.000Z'),
    ...overrides,
  });
}

describe('Panel-Sicherungen', () => {
  it('legt einen Abzug an und meldet ihn als abgeschlossen', async () => {
    const abzug = dumper(8_192);
    const service = baue({ dumper: abzug });

    const dto = await service.start(ADMIN, 'manual');

    expect(dto.status).toBe('completed');
    expect(dto.trigger).toBe('manual');
    expect(dto.sizeBytes).toBe(8_192);
    expect(dto.storagePath).toBe(
      `/opt/palantir/data/panel-backups/${backupFileName(new Date('2026-09-01T03:00:00.000Z'))}`,
    );
    expect(abzug.pfade).toEqual([dto.storagePath]);
  });

  it('haelt einen gescheiterten Abzug mit Grund fest, statt zu werfen', async () => {
    const service = baue({
      dumper: {
        async dump() {
          throw new Error('pg_dump endete mit Code 1.');
        },
      },
    });

    const dto = await service.start(ADMIN, 'manual');

    expect(dto.status).toBe('failed');
    expect(dto.failureMessage).toBe('pg_dump endete mit Code 1.');
  });

  it('lehnt ohne Ablageort benannt ab, statt still nichts zu tun', async () => {
    const service = baue({ directory: null });

    await expect(service.start(ADMIN, 'manual')).rejects.toSatisfy(
      (error: unknown) => isPanelBackupError(error) && error.code === 'PANEL_BACKUP_NOT_CONFIGURED',
    );
  });

  it('laesst keinen zweiten Lauf zu, solange einer laeuft', async () => {
    const repository = speicherRepository([
      {
        id: 'laufend',
        status: 'running',
        trigger: 'scheduled',
        storagePath: '/pfad/laufend.sql.gz',
        sizeBytes: 0,
        failureMessage: null,
        startedAt: new Date('2026-09-01T02:59:00.000Z'),
        completedAt: null,
      },
    ]);

    await expect(baue({ repository }).start(ADMIN, 'manual')).rejects.toSatisfy(
      (error: unknown) =>
        isPanelBackupError(error) && error.code === 'PANEL_BACKUP_ALREADY_RUNNING',
    );
  });

  it('laesst im Rennen die Datenbank entscheiden – kein zweites pg_dump (Audit bb-11)', async () => {
    const repository = speicherRepository([
      {
        id: 'laufend',
        status: 'running',
        trigger: 'scheduled',
        storagePath: '/pfad/laufend.sql.gz',
        sizeBytes: 0,
        failureMessage: null,
        startedAt: new Date('2026-09-01T02:59:00.000Z'),
        completedAt: null,
      },
    ]);
    const abzug = dumper();
    const service = baue({
      // Das Rennfenster zwischen Pruefen und Anlegen: Beide Aufrufer (Takt und
      // Knopfdruck) sehen „nichts laeuft", der Index faengt den zweiten.
      repository: { ...repository, findRunning: async () => null },
      dumper: abzug,
    });

    await expect(service.start(ADMIN, 'manual')).rejects.toSatisfy(
      (error: unknown) =>
        isPanelBackupError(error) && error.code === 'PANEL_BACKUP_ALREADY_RUNNING',
    );

    // Entscheidend: kein zweiter Abzug auf denselben Zielpfad – und kein roher
    // 23505, der als INTERNAL_ERROR (500) beim Aufrufer ankaeme.
    expect(abzug.pfade).toEqual([]);
    expect(repository.rows.filter((row) => row.status === 'running')).toHaveLength(1);
  });

  it('verlangt backup.manage.any – ein eigenes Backup-Recht genuegt nicht', async () => {
    const service = baue();

    await expect(service.list(NUTZER)).rejects.toSatisfy(
      (error: unknown) => isPanelBackupError(error) && error.code === 'PERMISSION_DENIED',
    );
    await expect(service.start(NUTZER, 'manual')).rejects.toSatisfy(
      (error: unknown) => isPanelBackupError(error) && error.code === 'PERMISSION_DENIED',
    );
  });

  it('loescht Datei und Datensatz, aber keinen laufenden Abzug', async () => {
    const repository = speicherRepository([
      fertig('alt', '2026-08-30T03:00:00.000Z', '/pfad/alt.sql.gz'),
      {
        id: 'laufend',
        status: 'running',
        trigger: 'manual',
        storagePath: '/pfad/laufend.sql.gz',
        sizeBytes: 0,
        failureMessage: null,
        startedAt: new Date('2026-09-01T02:59:00.000Z'),
        completedAt: null,
      },
    ]);
    const dateien = entferner();
    const service = baue({ repository, files: dateien });

    await service.remove(ADMIN, 'alt');

    expect(dateien.entfernt).toEqual(['/pfad/alt.sql.gz']);
    expect(repository.rows.map((row) => row.id)).toEqual(['laufend']);

    await expect(service.remove(ADMIN, 'laufend')).rejects.toSatisfy(
      (error: unknown) =>
        isPanelBackupError(error) && error.code === 'PANEL_BACKUP_ALREADY_RUNNING',
    );
    await expect(service.remove(ADMIN, 'gibtesnicht')).rejects.toSatisfy(
      (error: unknown) => isPanelBackupError(error) && error.code === 'PANEL_BACKUP_NOT_FOUND',
    );
  });

  it('zeigt einen laufenden Abzug ohne Loesch-Recht an', async () => {
    const repository = speicherRepository([
      {
        id: 'laufend',
        status: 'running',
        trigger: 'scheduled',
        storagePath: '/pfad/laufend.sql.gz',
        sizeBytes: 0,
        failureMessage: null,
        startedAt: new Date('2026-09-01T02:59:00.000Z'),
        completedAt: null,
      },
    ]);

    const [dto] = await baue({ repository }).list(ADMIN);

    expect(dto?.permissions.canDelete).toBe(false);
  });

  describe('geplanter Lauf', () => {
    it('startet, wenn der Abstand um ist', async () => {
      const repository = speicherRepository([
        fertig('vorheriger', '2026-08-31T02:00:00.000Z', '/pfad/vorheriger.sql.gz'),
      ]);

      const dto = await baue({ repository }).runScheduled();

      expect(dto?.trigger).toBe('scheduled');
      expect(dto?.status).toBe('completed');
    });

    it('meldet dem Zeitgeber „nichts zu tun", wenn er das Rennen verliert (Audit bb-11)', async () => {
      const repository = speicherRepository([
        {
          id: 'laufend',
          status: 'running',
          trigger: 'manual',
          storagePath: '/pfad/laufend.sql.gz',
          sizeBytes: 0,
          failureMessage: null,
          // Weit genug zurueck, damit der Takt faellig ist und ueberhaupt bis
          // zum Anlegen kommt.
          startedAt: new Date('2026-08-30T03:00:00.000Z'),
          completedAt: null,
        },
      ]);
      const abzug = dumper();

      // Der Takt sieht „nichts laeuft", zwischen Pruefung und Anlegen kommt ein
      // Lauf von Hand dazwischen. Fuer den Zeitgeber ist das kein Fehler,
      // sondern der dokumentierte Fall „bereits einer unterwegs".
      const dto = await baue({
        repository: { ...repository, findRunning: async () => null },
        dumper: abzug,
      }).runScheduled();

      expect(dto).toBeNull();
      expect(abzug.pfade).toEqual([]);
    });

    it('wartet, solange der Abstand nicht um ist', async () => {
      const repository = speicherRepository([
        fertig('vorheriger', '2026-09-01T01:00:00.000Z', '/pfad/vorheriger.sql.gz'),
      ]);

      expect(await baue({ repository }).runScheduled()).toBeNull();
    });

    it('laeuft ohne Ablageort und ohne Takt gar nicht – der Zeitgeber soll nicht scheitern', async () => {
      expect(await baue({ directory: null }).runScheduled()).toBeNull();
      expect(await baue({ intervalHours: null }).runScheduled()).toBeNull();
    });

    it('startet den ersten Lauf ohne Vorgeschichte sofort', async () => {
      const dto = await baue().runScheduled();

      expect(dto?.trigger).toBe('scheduled');
    });
  });

  describe('Aufbewahrung', () => {
    it('raeumt Datei und Datensatz jenseits der Frist weg', async () => {
      const repository = speicherRepository([
        fertig('uralt', '2026-08-01T03:00:00.000Z', '/pfad/uralt.sql.gz'),
        fertig('frisch', '2026-08-30T03:00:00.000Z', '/pfad/frisch.sql.gz'),
      ]);
      const dateien = entferner();

      const entfernt = await baue({ repository, files: dateien }).prune();

      expect(entfernt).toBe(1);
      expect(dateien.entfernt).toEqual(['/pfad/uralt.sql.gz']);
      expect(repository.rows.map((row) => row.id)).toEqual(['frisch']);
    });

    it('raeumt ohne Frist nichts weg', async () => {
      const repository = speicherRepository([
        fertig('uralt', '2020-01-01T03:00:00.000Z', '/pfad/uralt.sql.gz'),
      ]);

      expect(await baue({ repository, retentionDays: null }).prune()).toBe(0);
      expect(repository.rows).toHaveLength(1);
    });

    it('macht nach einer unloeschbaren Datei weiter (Audit W1-6, bb-16)', async () => {
      const repository = speicherRepository([
        fertig('gesperrt', '2026-08-01T03:00:00.000Z', '/pfad/gesperrt.sql.gz'),
        fertig('uralt', '2026-08-02T03:00:00.000Z', '/pfad/uralt.sql.gz'),
      ]);
      const entfernt: string[] = [];
      const dateien = {
        remove(path: string): Promise<void> {
          if (path === '/pfad/gesperrt.sql.gz') {
            // `rm force` schluckt nur ENOENT – EPERM/EBUSY kommen durch.
            return Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
          }

          entfernt.push(path);

          return Promise.resolve();
        },
      };

      const anzahl = await baue({ repository, files: dateien }).prune();

      // Der sperrige Datensatz bleibt stehen – der naechste Lauf versucht es
      // erneut. Alles danach ist trotzdem weg, statt jede Minute am selben
      // Eintrag zu scheitern.
      expect(anzahl).toBe(1);
      expect(entfernt).toEqual(['/pfad/uralt.sql.gz']);
      expect(repository.rows.map((row) => row.id)).toEqual(['gesperrt']);
    });
  });

  describe('abgerissener Lauf (Audit W1-6, bb-04)', () => {
    /** Ein `running`, dessen Prozess den Neustart nicht ueberlebt hat. */
    function laufend(startedAt: string): PanelBackupRecord {
      return {
        id: 'abgerissen',
        status: 'running',
        trigger: 'scheduled',
        storagePath: '/pfad/abgerissen.sql.gz',
        sizeBytes: 0,
        failureMessage: null,
        startedAt: new Date(startedAt),
        completedAt: null,
      };
    }

    it('setzt einen seit Stunden laufenden Abzug auf failed', async () => {
      const repository = speicherRepository([laufend('2026-08-31T02:00:00.000Z')]);

      expect(await baue({ repository }).sweepOrphanedRun()).toBe('abgerissen');
      expect(repository.rows[0]?.status).toBe('failed');
      expect(repository.rows[0]?.failureMessage).toContain('Neustart');
    });

    it('laesst die geplante Sicherung danach wieder laufen', async () => {
      const repository = speicherRepository([laufend('2026-08-31T02:00:00.000Z')]);
      const service = baue({ repository });

      // Vorher: `runScheduled()` liefert still `null` – die Instanz sichert
      // sich unbemerkt nie wieder selbst.
      expect(await service.runScheduled()).toBeNull();

      await service.sweepOrphanedRun();

      expect((await service.runScheduled())?.status).toBe('completed');
    });

    it('ruehrt einen frisch gestarteten Abzug nicht an', async () => {
      const repository = speicherRepository([laufend('2026-09-01T02:55:00.000Z')]);

      expect(await baue({ repository }).sweepOrphanedRun()).toBeNull();
      expect(repository.rows[0]?.status).toBe('running');
    });

    it('meldet ohne laufenden Abzug nichts', async () => {
      expect(await baue().sweepOrphanedRun()).toBeNull();
    });
  });
});

describe('pgEnvFromUrl', () => {
  it('zerlegt die Verbindungsangabe, statt sie als Datenbanknamen zu reichen', () => {
    expect(
      pgEnvFromUrl('postgresql://palantir:ge%2Fheim@db.example.org:6543/palantir?sslmode=require'),
    ).toEqual({
      PGHOST: 'db.example.org',
      PGPORT: '6543',
      PGUSER: 'palantir',
      PGPASSWORD: 'ge/heim',
      PGDATABASE: 'palantir',
      PGSSLMODE: 'require',
    });
  });

  it('laesst weg, was nicht angegeben ist', () => {
    expect(pgEnvFromUrl('postgres://localhost/palantir')).toEqual({
      PGHOST: 'localhost',
      PGDATABASE: 'palantir',
    });
  });
});
