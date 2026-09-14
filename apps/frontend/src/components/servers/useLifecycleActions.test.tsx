import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { LifecycleConfirmDialog } from './LifecycleConfirmDialog';
import { server as serverFixture } from './testFixtures';
import { useLifecycleActions } from './useLifecycleActions';

/**
 * Die weiche Kapazitätsprüfung im Frontend (Pflichtenheft §10).
 *
 * Das Backend lehnt einen Start nicht mehr ab, nur weil die Node eng ist – es
 * fragt (`RESOURCE_CONFIRMATION_REQUIRED`). Wer daraus eine Fehlermeldung
 * macht, lässt den Betreiber vor einer Aktion stehen, die möglich ist. Hier
 * steht, dass aus der Frage ein Dialog wird und aus dem „Ja" derselbe Befehl
 * mit `force`.
 */

const laufen = vi.fn();

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runLifecycleAction: (...args: unknown[]) => laufen(...args) as unknown,
}));

const SERVER = serverFixture({ id: 'srv-1', name: 'Welt', status: 'stopped' });

function fehler(code: string) {
  return { success: false, data: null, error: { code, message: 'technischer Freitext' } };
}

function Steuerung() {
  const lifecycle = useLifecycleActions();

  return (
    <div>
      <button type="button" onClick={() => void lifecycle.run(SERVER, 'start')}>
        Starten
      </button>
      <LifecycleConfirmDialog confirmation={lifecycle.confirmation} />
    </div>
  );
}

function zeichne() {
  render(
    <ToastProvider>
      <Steuerung />
    </ToastProvider>,
  );
}

beforeEach(() => {
  laufen.mockReset();
});

describe('useLifecycleActions – Rückfrage bei enger Node', () => {
  it('macht aus RESOURCE_CONFIRMATION_REQUIRED einen Dialog statt einer Fehlermeldung', async () => {
    laufen.mockResolvedValue(fehler('RESOURCE_CONFIRMATION_REQUIRED'));

    zeichne();
    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));

    expect(await screen.findByText('Trotzdem starten?')).toBeTruthy();
    // Der Anzeigetext kommt aus dem Fehlercode-Katalog, nicht aus dem Freitext
    // der Antwort (Pflichtenheft §5.1).
    expect(screen.queryByText('technischer Freitext')).toBeNull();
  });

  it('schickt nach der Bestätigung denselben Befehl mit force', async () => {
    laufen.mockResolvedValueOnce(fehler('RESOURCE_CONFIRMATION_REQUIRED'));
    laufen.mockResolvedValueOnce({ success: true, data: SERVER, error: null });

    zeichne();
    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem starten' }));

    await waitFor(() => {
      expect(laufen).toHaveBeenCalledTimes(2);
    });
    expect(laufen.mock.calls[0]).toEqual(['srv-1', 'start', {}]);
    expect(laufen.mock.calls[1]).toEqual(['srv-1', 'start', { erzwingen: true }]);
  });

  it('startet nach dem Abbrechen gar nichts', async () => {
    laufen.mockResolvedValue(fehler('RESOURCE_CONFIRMATION_REQUIRED'));

    zeichne();
    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => {
      expect(screen.queryByText('Trotzdem starten?')).toBeNull();
    });
    expect(laufen).toHaveBeenCalledTimes(1);
  });

  it('fragt bei einem erschöpften Kontingent nicht nach – da gibt es nichts zu entscheiden', async () => {
    laufen.mockResolvedValue(fehler('RESOURCE_LIMIT_EXCEEDED'));

    zeichne();
    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));

    await waitFor(() => {
      expect(laufen).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Trotzdem starten?')).toBeNull();
  });

  it('fragt nicht zweimal, wenn schon erzwungen wurde', async () => {
    // Sonst liefe eine Antwort, die das Backend gar nicht mehr schicken
    // dürfte, in eine endlose Schleife aus Dialog und Bestätigung.
    laufen.mockResolvedValue(fehler('RESOURCE_CONFIRMATION_REQUIRED'));

    zeichne();
    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem starten' }));

    await waitFor(() => {
      expect(laufen).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText('Trotzdem starten?')).toBeNull();
  });
});
