import {
  type BackupDto,
  type BackupProgress,
  type BackupRestoreJobDto,
  type GameServerDto,
} from '@palantir/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { permissions, server as serverFixture } from '../testFixtures';
import { BackupsTab } from './BackupsTab';

/**
 * Fundpunkt event-flow-05 – der Reiter „Backups" las `backup.progressed` nicht.
 *
 * Eine eben angestoßene Sicherung blieb dort auf „Läuft …" stehen, obwohl der
 * Abschluss längst im Browser angekommen war; „Herunterladen" und
 * „Wiederherstellen" erschienen erst nach einem Reiterwechsel oder Reload.
 */

const api = vi.hoisted(() => ({ fetchBackups: vi.fn() }));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBackups: api.fetchBackups,
}));

const SERVER: GameServerDto = serverFixture({
  id: 'srv-1',
  name: 'Welt',
  permissions: permissions({ canView: true, canManageBackups: true }),
});

function backup(overrides: Partial<BackupDto> = {}): BackupDto {
  return {
    id: 'backup-1',
    serverId: 'srv-1',
    serverName: 'Welt',
    type: 'manual',
    status: 'running',
    isExport: false,
    sizeBytes: 0,
    checksum: null,
    storagePath: null,
    consistency: 'unknown',
    createdAt: '2026-09-06T10:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    retentionProtected: true,
    failureMessage: null,
    createdByUserId: 'user-1',
    createdByDisplayName: 'Alex',
    permissions: { canDownload: true, canRestore: true, canDelete: true },
    ...overrides,
  } as BackupDto;
}

function fortschritt(overrides: Partial<BackupProgress> = {}): BackupProgress {
  return {
    backupId: 'backup-1',
    status: 'completed',
    isExport: false,
    sizeBytes: 1024,
    completedAt: '2026-09-06T10:05:00.000Z',
    failureMessage: null,
    ...overrides,
  };
}

function zeichne(anfangsFortschritt: BackupProgress | null) {
  const baum = (progress: BackupProgress | null) => (
    <ToastProvider>
      <BackupsTab server={SERVER} backupProgress={progress} restoreJob={null} />
    </ToastProvider>
  );

  const ergebnis = render(baum(anfangsFortschritt));

  return {
    melde: (progress: BackupProgress | null) => {
      act(() => {
        ergebnis.rerender(baum(progress));
      });
    },
  };
}

beforeEach(() => {
  api.fetchBackups.mockReset();
  api.fetchBackups.mockResolvedValue({ success: true, data: [backup()], error: null });
});

describe('BackupsTab – Live-Fortschritt (event-flow-05)', () => {
  it('schreibt den Listeneintrag fort und lädt die Liste nach', async () => {
    const { melde } = zeichne(null);

    expect(await screen.findByText('Läuft …')).toBeTruthy();
    expect(api.fetchBackups).toHaveBeenCalledTimes(1);

    // Ab hier liefert das Backend die abgeschlossene Sicherung.
    api.fetchBackups.mockResolvedValue({
      success: true,
      data: [backup({ status: 'completed', sizeBytes: 1024, completedAt: '2026-09-06T10:05Z' })],
      error: null,
    });

    melde(fortschritt());

    expect(await screen.findByText('Fertig')).toBeTruthy();
    expect(screen.queryByText('Läuft …')).toBeNull();

    // Das Ereignis trägt weder Prüfsumme noch `permissions` – deshalb einmal
    // den vollständigen Datensatz nachholen.
    await waitFor(() => {
      expect(api.fetchBackups).toHaveBeenCalledTimes(2);
    });
  });

  it('zeigt einen Fehlschlag samt Meldung und lädt ebenfalls nach', async () => {
    const { melde } = zeichne(null);
    await screen.findByText('Läuft …');

    api.fetchBackups.mockResolvedValue({
      success: true,
      data: [backup({ status: 'failed', failureMessage: 'Kein Platz auf der Platte.' })],
      error: null,
    });

    melde(fortschritt({ status: 'failed', failureMessage: 'Kein Platz auf der Platte.' }));

    expect(await screen.findByText('Fehlgeschlagen')).toBeTruthy();
    expect(screen.getByText(/Kein Platz auf der Platte\./)).toBeTruthy();
    await waitFor(() => {
      expect(api.fetchBackups).toHaveBeenCalledTimes(2);
    });
  });

  it('lädt bei einem laufenden Zwischenstand nicht nach', async () => {
    const { melde } = zeichne(null);
    await screen.findByText('Läuft …');

    melde(fortschritt({ status: 'running' }));

    await waitFor(() => {
      expect(screen.getByText('Läuft …')).toBeTruthy();
    });
    expect(api.fetchBackups).toHaveBeenCalledTimes(1);
  });

  it('übergeht den Fortschritt eines Exports – der gehört in die Einstellungen', async () => {
    const { melde } = zeichne(null);
    await screen.findByText('Läuft …');

    melde(fortschritt({ isExport: true, backupId: 'export-1' }));

    await waitFor(() => {
      expect(screen.getByText('Läuft …')).toBeTruthy();
    });
    expect(api.fetchBackups).toHaveBeenCalledTimes(1);
  });
});

/**
 * Wiederherstellung als Auftrag (Fundpunkt 225).
 *
 * Vorher wartete die Anfrage bis zu zwei Stunden auf den Agent; der Nutzer sah
 * einen Fehlschlag, sobald ein Vermittler davor aufgab. Jetzt kommt der
 * Auftrag sofort zurueck, und der Fortschritt laeuft ueber den Live-Kanal.
 */
describe('BackupsTab - Wiederherstellung (Fundpunkt 225)', () => {
  const AUFTRAG: BackupRestoreJobDto = {
    id: '99999999-9999-4999-8999-999999999999',
    serverId: SERVER.id,
    backupId: 'backup-1',
    status: 'running',
    progressPercent: 0,
    step: 'Archiv wird geprüft und entpackt',
    statusMessage: null,
    startedAt: '2026-09-10T12:00:00.000Z',
    finishedAt: null,
  };

  function zeichneMitAuftrag(job: BackupRestoreJobDto | null) {
    return render(
      <ToastProvider>
        <BackupsTab server={SERVER} backupProgress={null} restoreJob={job} />
      </ToastProvider>,
    );
  }

  it('zeigt den laufenden Auftrag mit seinem Schritt', () => {
    zeichneMitAuftrag(AUFTRAG);

    expect(screen.getByText('Wiederherstellung')).toBeTruthy();
    expect(screen.getByText('Archiv wird geprüft und entpackt')).toBeTruthy();
    expect(screen.getByText('Läuft')).toBeTruthy();
  });

  it('sagt es, wenn der Auftrag fertig ist', () => {
    zeichneMitAuftrag({
      ...AUFTRAG,
      status: 'completed',
      progressPercent: 100,
      step: 'Fertig',
      finishedAt: '2026-09-10T12:05:00.000Z',
    });

    expect(screen.getByText('Wiederherstellung abgeschlossen')).toBeTruthy();
    // „Fertig" steht sowohl als Zustand als auch als Schritt da.
    expect(screen.getAllByText('Fertig').length).toBeGreaterThan(0);
  });

  it('nennt den Grund eines Fehlschlags', () => {
    zeichneMitAuftrag({
      ...AUFTRAG,
      status: 'failed',
      statusMessage: 'Das Archiv liess sich nicht entpacken.',
      finishedAt: '2026-09-10T12:05:00.000Z',
    });

    expect(screen.getByText('Das Archiv liess sich nicht entpacken.')).toBeTruthy();
  });

  it('zeigt ohne Auftrag keinen Balken', () => {
    zeichneMitAuftrag(null);

    expect(screen.queryByText('Wiederherstellung')).toBeNull();
  });
});
