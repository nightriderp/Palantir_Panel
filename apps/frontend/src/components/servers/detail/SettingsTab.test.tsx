import { type GameServerDto, type ServerCloneJobDto } from '@palantir/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { forgetCloneJob, rememberCloneJob } from '@/lib/live/cloneJobHandle';
import { permissions, server as serverFixture } from '../testFixtures';
import { SettingsTab } from './SettingsTab';

/**
 * Fundpunkte frontend-lib-04 (Eingaben überleben einen Statuswechsel) und
 * event-flow-06 (Klon-Stand wird nachgeholt).
 */

const api = vi.hoisted(() => ({
  fetchGameTypes: vi.fn(),
  fetchCloneJob: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/servers/srv-1',
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchGameTypes: api.fetchGameTypes,
  fetchCloneJob: api.fetchCloneJob,
}));

/** Ohne Mitgliederverwaltung – der Test braucht nur Formular und Klon-Karte. */
function testServer(overrides: Partial<GameServerDto> = {}): GameServerDto {
  return {
    ...serverFixture({
      id: 'srv-1',
      name: 'Welt',
      status: 'starting',
      permissions: permissions({ canManageSettings: true, canClone: true }),
    }),
    ...overrides,
  };
}

function cloneJob(overrides: Partial<ServerCloneJobDto> = {}): ServerCloneJobDto {
  return {
    id: 'job-1',
    serverId: 'srv-1',
    status: 'running',
    progressPercent: 30,
    step: 'Weltdaten werden kopiert',
    statusMessage: null,
    startedAt: '2026-09-06T10:00:00.000Z',
    finishedAt: null,
    targetServerId: null,
    targetName: 'Welt (Kopie)',
    targetSubdomain: 'welt-kopie',
    includeWorldData: true,
    copiedBytes: 300,
    totalBytes: 1000,
    ...overrides,
  };
}

function zeichne(props: {
  server: GameServerDto;
  connection?: 'connecting' | 'open' | 'closed';
  cloneJob?: ServerCloneJobDto | null;
}) {
  const baum = (aktuell: typeof props) => (
    <ToastProvider>
      <SettingsTab
        server={aktuell.server}
        onServerUpdated={() => undefined}
        cloneJob={aktuell.cloneJob ?? null}
        connection={aktuell.connection ?? 'open'}
        backupProgress={null}
      />
    </ToastProvider>
  );

  const ergebnis = render(baum(props));

  return {
    ...ergebnis,
    neu: (naechste: typeof props) => {
      act(() => {
        ergebnis.rerender(baum(naechste));
      });
    },
  };
}

beforeEach(() => {
  api.fetchGameTypes.mockReset();
  api.fetchCloneJob.mockReset();
  api.fetchGameTypes.mockResolvedValue({ success: true, data: [], error: null });
  api.fetchCloneJob.mockResolvedValue({ success: true, data: cloneJob(), error: null });

  forgetCloneJob('srv-1');
  forgetCloneJob('srv-2');
});

afterEach(() => {
  forgetCloneJob('srv-1');
  forgetCloneJob('srv-2');
});

describe('SettingsTab – Formular und Live-Statuswechsel (frontend-lib-04)', () => {
  it('behält getippte Startparameter, wenn nur der Status wechselt', () => {
    const start = testServer();
    const { neu } = zeichne({ server: start });

    const feld = screen.getByLabelText('Startparameter');
    fireEvent.change(feld, { target: { value: '-Xmx8G' } });

    // Genau das, was `ServerDetail` bei `server.statusChanged` erzeugt:
    // ein neues DTO-Objekt mit gleichem Inhalt, aber anderem Status.
    neu({ server: { ...start, status: 'running' } });

    expect((screen.getByLabelText('Startparameter') as HTMLInputElement).value).toBe('-Xmx8G');
  });

  it('behält auch den getippten Namen über einen Statuswechsel hinweg', () => {
    const start = testServer();
    const { neu } = zeichne({ server: start });

    fireEvent.change(screen.getByLabelText('Servername'), { target: { value: 'Neue Welt' } });
    neu({ server: { ...start, status: 'running', statusMessage: 'Läuft an …' } });

    expect((screen.getByLabelText('Servername') as HTMLInputElement).value).toBe('Neue Welt');
  });

  it('setzt das Formular beim Wechsel auf einen anderen Server zurück', () => {
    const start = testServer();
    const { neu } = zeichne({ server: start });

    fireEvent.change(screen.getByLabelText('Servername'), { target: { value: 'Getippt' } });
    neu({
      server: testServer({ id: 'srv-2', name: 'Zweite Welt', startupParameters: '-Xmx2G' }),
    });

    expect((screen.getByLabelText('Servername') as HTMLInputElement).value).toBe('Zweite Welt');
    expect((screen.getByLabelText('Startparameter') as HTMLInputElement).value).toBe('-Xmx2G');
  });
});

describe('SettingsTab – Klon-Auftrag nachholen (event-flow-06)', () => {
  it('fragt den gemerkten Auftrag beim Öffnen des Reiters ab und zeigt ihn an', async () => {
    rememberCloneJob(cloneJob({ progressPercent: 5, step: 'Wartet' }));

    zeichne({ server: testServer() });

    await waitFor(() => {
      expect(api.fetchCloneJob).toHaveBeenCalledWith('srv-1', 'job-1');
    });

    // Der Stand aus der Antwort, nicht der gemerkte – 30 statt 5 Prozent.
    expect(await screen.findByText('30 %')).toBeTruthy();
    expect(screen.getByText(/Weltdaten werden kopiert/)).toBeTruthy();
  });

  it('fragt nach einem Wiederanlauf des Live-Kanals erneut nach', async () => {
    rememberCloneJob(cloneJob());

    const { neu } = zeichne({ server: testServer(), connection: 'open' });

    await waitFor(() => {
      expect(api.fetchCloneJob).toHaveBeenCalledTimes(1);
    });

    neu({ server: testServer(), connection: 'closed' });
    neu({ server: testServer(), connection: 'open' });

    await waitFor(() => {
      expect(api.fetchCloneJob.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('fragt nichts ab, solange kein Auftrag gemerkt ist', async () => {
    zeichne({ server: testServer() });

    await waitFor(() => {
      expect(api.fetchGameTypes).toHaveBeenCalled();
    });
    expect(api.fetchCloneJob).not.toHaveBeenCalled();
  });

  it('meldet einen dem Backend unbekannten Auftrag als abgebrochen', async () => {
    rememberCloneJob(cloneJob());
    api.fetchCloneJob.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'SERVER_NOT_FOUND', message: 'Der Klon-Auftrag ist unbekannt.' },
    });

    zeichne({ server: testServer() });

    expect(await screen.findByText('Abgebrochen')).toBeTruthy();
    expect(screen.getByText(/nicht mehr bekannt/)).toBeTruthy();
  });
});
