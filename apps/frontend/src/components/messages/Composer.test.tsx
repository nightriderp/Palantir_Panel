import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';

/**
 * Der Entwurf überlebt eine abgelehnte Nachricht.
 *
 * Vorher leerte `submit()` das Feld, sobald der Knopf gedrückt war – noch bevor
 * das Backend geantwortet hatte. Ging das Senden schief, blieb dem Nutzer ein
 * roter Hinweis und ein leeres Feld; das Getippte war weg. Getroffen hat das
 * nicht nur den Netzausfall: Der Chat ist auf 30 Nachrichten je Minute
 * gedrosselt (`abuse-limits.ts`), und wer in einem lebhaften Gruppenchat
 * dagegenläuft, verliert eine lange Nachricht.
 *
 * Die Server-Konsole macht es seit jeher richtig (`ConsoleTab.onSend`): Das Feld
 * wird erst geleert, wenn der Befehl angenommen ist.
 */
describe('Composer – Entwurf bei fehlgeschlagenem Senden', () => {
  function tippen(text: string) {
    fireEvent.change(screen.getByLabelText('Nachricht schreiben'), { target: { value: text } });
  }

  function feld(): HTMLTextAreaElement {
    return screen.getByLabelText('Nachricht schreiben') as HTMLTextAreaElement;
  }

  it('behält den Text, wenn das Senden fehlschlägt', async () => {
    const senden = vi.fn(async () => false);
    render(<Composer canSend sending={false} onSend={senden} />);

    tippen('Wer ist heute Abend dabei?');
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));

    await waitFor(() => expect(senden).toHaveBeenCalledWith('Wer ist heute Abend dabei?'));
    expect(feld().value).toBe('Wer ist heute Abend dabei?');
  });

  it('leert das Feld, sobald die Nachricht angekommen ist', async () => {
    const senden = vi.fn(async () => true);
    render(<Composer canSend sending={false} onSend={senden} />);

    tippen('Angekommen');
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));

    await waitFor(() => expect(feld().value).toBe(''));
  });

  it('behält den Text auch bei Enter, nicht nur beim Knopf', async () => {
    const senden = vi.fn(async () => false);
    render(<Composer canSend sending={false} onSend={senden} />);

    tippen('Per Enter geschickt');
    fireEvent.keyDown(feld(), { key: 'Enter' });

    await waitFor(() => expect(senden).toHaveBeenCalledTimes(1));
    expect(feld().value).toBe('Per Enter geschickt');
  });

  it('sendet nur den beschnittenen Text, behält aber die Eingabe wie getippt', async () => {
    const senden = vi.fn(async () => false);
    render(<Composer canSend sending={false} onSend={senden} />);

    tippen('  mit Rand  ');
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));

    await waitFor(() => expect(senden).toHaveBeenCalledWith('mit Rand'));
    expect(feld().value).toBe('  mit Rand  ');
  });
});
