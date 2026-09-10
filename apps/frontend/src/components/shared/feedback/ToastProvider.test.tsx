import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastProvider';

/**
 * Anzeigedauer der Einblendungen (Fundpunkt 220).
 *
 * Am laufenden System gemessen: Ein Klick auf „Starten" bei nicht verbundener
 * Node beantwortete das Backend mit `503 AGENT_NOT_CONNECTED`; der Satz „Der
 * Homeserver ist derzeit nicht verbunden." war nach 2,8 Sekunden wieder weg –
 * Messreihe im 400-ms-Takt. Wer während des Klicks kurz wegsah, sah nur, dass
 * nichts passiert ist.
 *
 * Geprüft wird deshalb die Grenze zwischen den Arten: Erfolg verschwindet von
 * selbst, ein Fehler bleibt stehen, bis jemand ihn wegklickt.
 */

function Ausloeser() {
  const toast = useToast();

  return (
    <div>
      <button type="button" onClick={() => toast.success('Gespeichert.')}>
        Erfolg melden
      </button>
      <button type="button" onClick={() => toast.error('Der Homeserver ist nicht verbunden.')}>
        Fehler melden
      </button>
      <button type="button" onClick={() => toast.warning('Fast voll.')}>
        Warnen
      </button>
    </div>
  );
}

function zeichne() {
  return render(
    <ToastProvider>
      <Ausloeser />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider – Anzeigedauer (Fundpunkt 220)', () => {
  it('blendet eine Erfolgsmeldung nach wenigen Sekunden wieder aus', () => {
    zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Erfolg melden' }));
    expect(screen.getByText('Gespeichert.')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText('Gespeichert.')).toBeNull();
  });

  it('lässt eine Fehlermeldung stehen', () => {
    zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Fehler melden' }));

    act(() => {
      // Weit über jede bisherige Frist hinaus.
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText('Der Homeserver ist nicht verbunden.')).toBeTruthy();
  });

  it('lässt sich die stehengebliebene Fehlermeldung wegklicken', () => {
    zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Fehler melden' }));
    fireEvent.click(screen.getByRole('button', { name: 'Meldung ausblenden' }));

    expect(screen.queryByText('Der Homeserver ist nicht verbunden.')).toBeNull();
  });

  it('gibt einer Warnung mehr Zeit als einer Erfolgsmeldung', () => {
    zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Warnen' }));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('Fast voll.')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText('Fast voll.')).toBeNull();
  });
});
