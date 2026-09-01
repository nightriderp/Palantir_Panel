import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_GROUPS } from './notificationView';
import { mutableGroups, useMutedEvents } from './useMutedEvents';

const laden = vi.fn();
const speichern = vi.fn();

vi.mock('@/lib/api/notifications', () => ({
  fetchNotificationPreferences: (...args: unknown[]) => laden(...args) as unknown,
  saveNotificationPreferences: (...args: unknown[]) => speichern(...args) as unknown,
}));

/** Ein Schalter je Gruppe – wie im Einstellungs-Reiter. */
function Schalter() {
  const muted = useMutedEvents();

  return (
    <ul>
      {mutableGroups(NOTIFICATION_GROUPS).map((group) => (
        <li key={group.key}>
          <button
            type="button"
            data-testid={group.key}
            disabled={muted.loading || muted.saving}
            onClick={() => muted.setGroup(group, !muted.receives(group))}
          >
            {muted.receives(group) ? 'an' : 'aus'}
          </button>
        </li>
      ))}
      <li data-testid="fehler">{muted.error ?? ''}</li>
    </ul>
  );
}

beforeEach(() => {
  laden.mockReset();
  speichern.mockReset();
});

describe('useMutedEvents (Gefundener Punkt 93)', () => {
  it('bietet die Ankündigungs-Gruppe gar nicht erst an', () => {
    // Sie enthält nur `announcement.published`, und das lässt sich nicht abbestellen.
    expect(mutableGroups(NOTIFICATION_GROUPS).map((group) => group.key)).not.toContain(
      'announcement',
    );
  });

  it('zeigt eine abbestellte Gruppe als ausgeschaltet', async () => {
    laden.mockResolvedValue({ success: true, data: { mutedEvents: ['backup.failed'] } });

    render(<Schalter />);

    await waitFor(() => {
      expect(screen.getByTestId('backup').textContent).toBe('aus');
    });
    expect(screen.getByTestId('server').textContent).toBe('an');
  });

  it('bestellt beim Umlegen die ganze Gruppe ab', async () => {
    laden.mockResolvedValue({ success: true, data: { mutedEvents: [] } });
    speichern.mockResolvedValue({ success: true, data: { mutedEvents: ['backup.failed'] } });

    render(<Schalter />);
    await waitFor(() => {
      expect((screen.getByTestId('backup') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('backup'));

    await waitFor(() => {
      expect(speichern).toHaveBeenCalledWith({ mutedEvents: ['backup.failed'] });
    });
  });

  it('nimmt den Schalter zurück, wenn das Speichern scheitert', async () => {
    laden.mockResolvedValue({ success: true, data: { mutedEvents: [] } });
    speichern.mockResolvedValue({ success: false, error: { code: 'INTERNAL_ERROR', message: '' } });

    render(<Schalter />);
    await waitFor(() => {
      expect((screen.getByTestId('backup') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('backup'));

    await waitFor(() => {
      expect(screen.getByTestId('backup').textContent).toBe('an');
    });
    expect(screen.getByTestId('fehler').textContent).not.toBe('');
  });
});
