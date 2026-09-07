import { describe, expect, it } from 'vitest';
import {
  createBackupCommandResultSchema,
  downloadBackupCommandResultSchema,
} from './agent-commands.js';
import {
  backupScheduleDtoSchema,
  createBackupInputSchema,
  cronExpressionSchema,
  updateBackupScheduleInputSchema,
} from './backups.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('Cron-Ausdruck (Pflichtenheft §6)', () => {
  it.each(['0 4 * * *', '*/15 * * * *', '0 3,15 * * 1-5'])('nimmt %s an', (ausdruck) => {
    expect(cronExpressionSchema.safeParse(ausdruck).success).toBe(true);
  });

  it.each(['0 4 * *', '', 'täglich', '0 4 * * * *', 'rm -rf /'])('lehnt %s ab', (ausdruck) => {
    expect(cronExpressionSchema.safeParse(ausdruck).success).toBe(false);
  });
});

describe('Eingaben der Backup-Verwaltung', () => {
  it('hält den Server standardmäßig nicht an', () => {
    // Ein unerwarteter Serverstopp mitten im Spiel wäre die unangenehmere
    // Überraschung als eine Sicherung im laufenden Betrieb.
    expect(createBackupInputSchema.parse({})).toEqual({ stopServer: false });
  });

  it('verlangt beim Zeitplan immer einen Cron-Ausdruck', () => {
    expect(updateBackupScheduleInputSchema.safeParse({ enabled: false }).success).toBe(false);
    expect(
      updateBackupScheduleInputSchema.parse({ enabled: true, cronExpression: '0 4 * * *' }),
    ).toEqual({ enabled: true, cronExpression: '0 4 * * *', stopServer: false });
  });
});

describe('Backup-Zeitplan als Antwort (Audit contracts-validation-03)', () => {
  const zeitplan = {
    serverId: UUID,
    enabled: true,
    cronExpression: '0 4 * * *',
    stopServer: true,
    lastRunAt: '2026-08-26T04:00:00.000Z',
    nextRunAt: '2026-08-27T04:00:00.000Z',
    lastBackupId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-26T04:00:00.000Z',
    permissions: { canView: true, canEdit: true },
  };

  it('liefert stopServer mit aus – sonst kann es kein Formular anzeigen', () => {
    expect(backupScheduleDtoSchema.parse(zeitplan)).toEqual(zeitplan);
  });

  it('nimmt eine Antwort ohne das additive Feld weiter an', () => {
    const { stopServer: _stopServer, ...ohneFeld } = zeitplan;

    expect(backupScheduleDtoSchema.parse(ohneFeld)).toEqual(ohneFeld);
  });
});

describe('Ergebnisse der Backup-Befehle', () => {
  it('besteht auf einer echten SHA-256-Prüfsumme', () => {
    const basis = {
      backupId: UUID,
      storagePath: '/srv/palantir/backups/a.tar.zst',
      sizeBytes: 10,
      containerStopped: true,
      startedAt: '2026-08-26T04:00:00.000Z',
      completedAt: '2026-08-26T04:01:00.000Z',
    };

    expect(
      createBackupCommandResultSchema.safeParse({ ...basis, checksumSha256: 'a'.repeat(64) })
        .success,
    ).toBe(true);
    expect(
      createBackupCommandResultSchema.safeParse({ ...basis, checksumSha256: 'nicht-hex' }).success,
    ).toBe(false);
  });

  it('erlaubt einen leeren letzten Block am Dateiende', () => {
    const ergebnis = downloadBackupCommandResultSchema.parse({
      backupId: UUID,
      offset: 1024,
      contentBase64: '',
      bytesRead: 0,
      totalBytes: 1024,
      eof: true,
    });

    expect(ergebnis.eof).toBe(true);
  });
});
