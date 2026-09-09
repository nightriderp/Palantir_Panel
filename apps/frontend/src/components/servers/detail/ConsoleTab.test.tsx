import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { server } from '../testFixtures';
import { ConsoleTab } from './ConsoleTab';

/**
 * Schnellbefehle der Live-Konsole (P2-8): Die Knöpfe unter dem Eingabefeld
 * kommen aus der Spiele-Definition (`consoleQuickCommands`), nicht mehr fest
 * von hier – was bei Minecraft `list` heißt, heißt beim Prüfstand `help`.
 */

function zeichne(options: Parameters<typeof server>[0], onSend = vi.fn(() => true)) {
  render(
    <ToastProvider>
      <ConsoleTab
        server={server(options)}
        lines={[]}
        connection="open"
        onSend={onSend}
        onClear={() => undefined}
      />
    </ToastProvider>,
  );

  return onSend;
}

describe('ConsoleTab – Schnellbefehle', () => {
  it('zeigt die Schnellbefehle des Spiels und schickt beim Klick die Befehlszeile', () => {
    const onSend = zeichne({
      id: 'srv-1',
      status: 'running',
      consoleQuickCommands: [
        { label: 'Spieler', command: 'list' },
        { label: 'Stopp', command: 'stop' },
      ],
    });

    const spieler = screen.getByRole('button', { name: 'Spieler' });
    // Die Beschriftung sagt, was passiert; der Befehl selbst steht im Titel.
    expect(spieler.getAttribute('title')).toBe('list');

    fireEvent.click(spieler);
    expect(onSend).toHaveBeenCalledWith('list');
  });

  it('zeigt ohne Schnellbefehle nur das Eingabefeld', () => {
    zeichne({ id: 'srv-1', status: 'running' });

    expect(screen.queryByRole('button', { name: 'Spieler' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Konsolenbefehl' })).toBeTruthy();
  });

  it('sperrt die Schnellbefehle, solange der Server nicht läuft', () => {
    zeichne({
      id: 'srv-1',
      status: 'stopped',
      consoleQuickCommands: [{ label: 'Spieler', command: 'list' }],
    });

    const knopf = screen.getByRole('button', { name: 'Spieler' }) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
  });
});
