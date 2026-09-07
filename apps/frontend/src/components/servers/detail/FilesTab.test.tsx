import {
  type GameServerDto,
  type ServerFileEntryDto,
  type ServerFileListDto,
} from '@palantir/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { ownerPermissions, server as serverFixture } from '../testFixtures';
import { FilesTab } from './FilesTab';

/**
 * Audit contract-drift-03 – die Vertragsoptionen `recursive` und `overwrite`
 * waren aus der Oberfläche nicht steuerbar.
 *
 * Beide sind im Agent-Protokoll ausdrücklich als Schranke gedacht: Ein
 * nicht-leeres Verzeichnis und eine bereits vorhandene Datei bleiben
 * unangetastet, solange niemand das Gegenteil verlangt. Faktisch löschte die
 * Oberfläche jedes Verzeichnis samt Baum – der Vorgabewert des Backends hob die
 * Schranke wieder auf –, während Ersetzen gar nicht erreichbar war.
 *
 * Geprüft wird, was an die API-Schicht geht: Sie reicht beides unverändert an
 * das Backend und von dort an den Agenten weiter.
 */

const api = vi.hoisted(() => ({
  fetchFileList: vi.fn(),
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchFileList: api.fetchFileList,
  deleteFile: api.deleteFile,
  uploadFile: api.uploadFile,
}));

const SERVER: GameServerDto = serverFixture({
  id: 'srv-1',
  name: 'Welt',
  permissions: ownerPermissions(),
});

function eintrag(overrides: Partial<ServerFileEntryDto> = {}): ServerFileEntryDto {
  return {
    name: 'server.properties',
    path: 'server.properties',
    type: 'file',
    sizeBytes: 512,
    modifiedAt: '2026-09-06T10:00:00.000Z',
    editable: true,
    downloadable: true,
    ...overrides,
  };
}

function liste(entries: ServerFileEntryDto[]): ServerFileListDto {
  return {
    serverId: 'srv-1',
    path: '',
    parentPath: null,
    entries,
    writable: true,
    maxUploadBytes: 1024 * 1024,
    maxEditableBytes: 1024 * 1024,
  };
}

function zeichne(entries: ServerFileEntryDto[]) {
  api.fetchFileList.mockResolvedValue({ success: true, data: liste(entries), error: null });

  return render(
    <ToastProvider>
      <FilesTab server={SERVER} />
    </ToastProvider>,
  );
}

/** Öffnet den Löschdialog für den genannten Eintrag. */
async function oeffneLoeschdialog(name: string): Promise<void> {
  const zeile = (await screen.findByText(name)).closest('li');

  fireEvent.click(within(zeile as HTMLElement).getByRole('button', { name: 'Löschen' }));
}

const VERZEICHNIS = eintrag({
  name: 'world',
  path: 'world',
  type: 'directory',
  editable: false,
  downloadable: false,
});

beforeEach(() => {
  api.fetchFileList.mockReset();
  api.deleteFile.mockReset();
  api.uploadFile.mockReset();
  api.deleteFile.mockResolvedValue({ success: true, data: null, error: null });
});

describe('FilesTab – Löschen (Audit contract-drift-03)', () => {
  it('nimmt den Inhalt eines Verzeichnisses nur nach ausdrücklicher Bestätigung mit', async () => {
    zeichne([VERZEICHNIS]);

    await oeffneLoeschdialog('world');

    // Der Dialog benennt, was der Vertrag unterscheidet.
    expect(await screen.findByText('Verzeichnis löschen?')).toBeTruthy();
    expect(
      screen.getByText(/wird mit seinem gesamten Inhalt endgültig aus dem Datenordner entfernt/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => {
      expect(api.deleteFile).toHaveBeenCalledWith('srv-1', 'world', true);
    });
  });

  it('schickt für eine einzelne Datei kein recursive', async () => {
    zeichne([eintrag()]);

    await oeffneLoeschdialog('server.properties');

    expect(await screen.findByText('Datei löschen?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => {
      expect(api.deleteFile).toHaveBeenCalledWith('srv-1', 'server.properties', false);
    });
  });
});

describe('FilesTab – Hochladen auf einen belegten Pfad (Audit contract-drift-03)', () => {
  it('fragt nach und wiederholt den Upload mit overwrite', async () => {
    api.uploadFile
      .mockResolvedValueOnce({
        success: false,
        data: null,
        error: { code: 'AGENT_FILE_EXISTS', message: 'Am Zielpfad existiert bereits eine Datei.' },
      })
      .mockResolvedValueOnce({ success: true, data: liste([eintrag()]), error: null });

    const { container } = zeichne([eintrag()]);

    await screen.findByText('server.properties');

    const eingabe = container.querySelector('input[type="file"]');

    fireEvent.change(eingabe as HTMLInputElement, {
      target: { files: [new File(['neu'], 'server.properties', { type: 'text/plain' })] },
    });

    // Der erste Versuch geht ohne `overwrite` hinaus – nichts wird unbemerkt
    // ersetzt.
    await waitFor(() => {
      expect(api.uploadFile).toHaveBeenCalledTimes(1);
    });
    expect(api.uploadFile.mock.calls[0]?.[3]).toBe(false);

    fireEvent.click(await screen.findByRole('button', { name: 'Ersetzen' }));

    await waitFor(() => {
      expect(api.uploadFile).toHaveBeenCalledTimes(2);
    });
    expect(api.uploadFile.mock.calls[1]?.[3]).toBe(true);
    expect(api.uploadFile.mock.calls[1]?.[0]).toBe('srv-1');
  });
});
