import { type GameServerDto, type ServerMemberDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { permissions, server as serverFixture } from '../testFixtures';
import { MembersPanel } from './MembersPanel';

/**
 * Rechtegesteuerte Ansicht: die Mitgliederverwaltung (Audit W2-29,
 * `test-gaps-10`; Fundpunkt contract-drift-01).
 *
 * Zwei Zusagen hängen hier an Flags aus dem DTO und waren ungeprüft:
 *
 * 1. `permissions.canManageMembers` entscheidet, ob es den Weg zum Freigeben
 *    überhaupt gibt; `canEdit` je Eintrag, ob Stufe und Entfernen bedienbar
 *    sind. Ein vertauschtes Flag zeigte niemandem etwas an.
 * 2. `PUT /members` liefert **ein** Mitglied, nicht die Liste. Genau daran ist
 *    die Mitgliederverwaltung schon einmal funktionslos geworden – die Ansicht
 *    muss den einen Eintrag einsortieren statt eine Liste zu erwarten.
 *
 * Die API steht als Attrappe da: geprüft wird die Ansicht, nicht der Transport.
 */

const api = vi.hoisted(() => ({
  fetchMembers: vi.fn(),
  addOrUpdateMember: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMembers: api.fetchMembers,
  addOrUpdateMember: api.addOrUpdateMember,
  removeMember: api.removeMember,
}));

const NEU_ID = '00000000-0000-4000-8000-000000000001';

function mitglied(overrides: Partial<ServerMemberDto> = {}): ServerMemberDto {
  return {
    userId: '00000000-0000-4000-8000-000000000002',
    displayName: 'Mitverwalter',
    level: 'operator',
    addedAt: '2026-08-31T08:00:00.000Z',
    canEdit: true,
    ...overrides,
  };
}

function testServer(canManageMembers: boolean): GameServerDto {
  return serverFixture({
    id: 'srv-1',
    name: 'Welt',
    permissions: permissions({ canView: true, canManageMembers }),
  });
}

function zeichne(server: GameServerDto) {
  return render(
    <ToastProvider>
      <MembersPanel server={server} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  api.fetchMembers.mockReset();
  api.addOrUpdateMember.mockReset();
  api.removeMember.mockReset();

  api.fetchMembers.mockResolvedValue({ success: true, data: [mitglied()], error: null });
});

describe('MembersPanel – Sichtbarkeit nach Rechten', () => {
  it('zeigt dem Berechtigten den Weg zum Freigeben', async () => {
    zeichne(testServer(true));

    expect(await screen.findByRole('button', { name: 'Mitverwalter hinzufügen' })).toBeTruthy();
  });

  it('zeigt ihn einem Konto ohne canManageMembers nicht', async () => {
    zeichne(testServer(false));

    // Erst warten, bis die Liste da ist – sonst prüfte der Test nur, dass die
    // Ansicht noch lädt.
    expect(await screen.findByText('Mitverwalter')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mitverwalter hinzufügen' })).toBeNull();
  });

  it('macht einen Eintrag mit canEdit bedienbar', async () => {
    zeichne(testServer(true));

    expect(await screen.findByLabelText('Stufe von Mitverwalter')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeTruthy();
  });

  it('zeigt einen Eintrag ohne canEdit nur als Plakette', async () => {
    api.fetchMembers.mockResolvedValue({
      success: true,
      data: [mitglied({ canEdit: false })],
      error: null,
    });

    zeichne(testServer(false));

    expect(await screen.findByText('Bedienen')).toBeTruthy();
    expect(screen.queryByLabelText('Stufe von Mitverwalter')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull();
  });

  it('sagt es, wenn außer dem Besitzer niemand Zugriff hat', async () => {
    api.fetchMembers.mockResolvedValue({ success: true, data: [], error: null });

    zeichne(testServer(true));

    expect(
      await screen.findByText('Außer dem Besitzer hat niemand Zugriff auf diesen Server.'),
    ).toBeTruthy();
  });
});

describe('MembersPanel – Freigeben (contract-drift-01)', () => {
  async function oeffneDialog() {
    zeichne(testServer(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Mitverwalter hinzufügen' }));
    fireEvent.change(screen.getByLabelText('Nutzer-Id'), { target: { value: NEU_ID } });
  }

  it('nimmt das eine gelieferte Mitglied in die Liste auf', async () => {
    api.addOrUpdateMember.mockResolvedValue({
      success: true,
      // Die Route antwortet mit genau einer Zuordnung – nicht mit der Liste.
      data: mitglied({ userId: NEU_ID, displayName: 'Neues Mitglied', level: 'operator' }),
      error: null,
    });

    await oeffneDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Zugriff geben' }));

    expect(await screen.findByText('Neues Mitglied')).toBeTruthy();
    expect(api.addOrUpdateMember).toHaveBeenCalledWith('srv-1', {
      userId: NEU_ID,
      level: 'operator',
    });
    // Der bestehende Eintrag bleibt stehen.
    expect(screen.getByText('Mitverwalter')).toBeTruthy();
  });

  it('behält einen abgelehnten Versuch im Dialog und ändert die Liste nicht', async () => {
    api.addOrUpdateMember.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'USER_NOT_FOUND', message: 'Das Konto ist unbekannt.' },
    });

    await oeffneDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Zugriff geben' }));

    // Angezeigt wird der Text des Fehlercodes aus dem Katalog, nicht der
    // Freitext der Antwort (`errorText()` in `lib/api/client.ts`).
    expect(await screen.findByText('Dieses Konto existiert nicht.')).toBeTruthy();
    expect(screen.queryByText('Das Konto ist unbekannt.')).toBeNull();
    expect(screen.queryByText('Neues Mitglied')).toBeNull();
  });

  it('prüft die Eingabe, bevor sie das Backend erreicht', async () => {
    zeichne(testServer(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Mitverwalter hinzufügen' }));
    fireEvent.change(screen.getByLabelText('Nutzer-Id'), { target: { value: 'keine-uuid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zugriff geben' }));

    await waitFor(() => {
      expect(api.addOrUpdateMember).not.toHaveBeenCalled();
    });
  });
});

describe('MembersPanel – Stufe ändern und entziehen', () => {
  it('schickt die neue Stufe und übernimmt die Antwort', async () => {
    api.addOrUpdateMember.mockResolvedValue({
      success: true,
      data: mitglied({ level: 'manager' }),
      error: null,
    });

    zeichne(testServer(true));

    fireEvent.change(await screen.findByLabelText('Stufe von Mitverwalter'), {
      target: { value: 'manager' },
    });

    await waitFor(() => {
      expect(api.addOrUpdateMember).toHaveBeenCalledWith('srv-1', {
        userId: mitglied().userId,
        level: 'manager',
      });
    });

    expect(await screen.findByText(/Darf zusätzlich Einstellungen, Dateien, Backups/)).toBeTruthy();
  });

  it('entzieht den Zugriff erst nach der Rückfrage', async () => {
    api.removeMember.mockResolvedValue({ success: true, data: null, error: null });

    zeichne(testServer(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));

    // Vor der Bestätigung ist nichts passiert.
    expect(api.removeMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Entziehen' }));

    await waitFor(() => {
      expect(api.removeMember).toHaveBeenCalledWith('srv-1', mitglied().userId);
    });

    expect(
      await screen.findByText('Außer dem Besitzer hat niemand Zugriff auf diesen Server.'),
    ).toBeTruthy();
  });
});
