import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { istSuchbegriff, useUrlFilter } from './useUrlFilter';

/**
 * Filter und Suche in der Adresszeile (Fundpunkt 213).
 *
 * Am laufenden System gemessen: Wer in der Übersicht auf „Offline" klickte und
 * „welt" in die Suche tippte, sah danach dieselbe Adresse wie vorher – der
 * Zustand ließ sich niemandem schicken, ein Neuladen warf ihn weg.
 */

type Auswahl = 'all' | 'online';

function istAuswahl(wert: string): wert is Auswahl {
  return wert === 'all' || wert === 'online';
}

function Probe() {
  const [wert, setWert] = useUrlFilter<Auswahl>('filter', 'all', istAuswahl);

  return (
    <div>
      <span data-testid="wert">{wert}</span>
      <button type="button" onClick={() => setWert('online')}>
        online
      </button>
      <button type="button" onClick={() => setWert('all')}>
        alle
      </button>
    </div>
  );
}

function ProbeSuche() {
  const [wert, setWert] = useUrlFilter<string>('q', '', istSuchbegriff);

  return (
    <div>
      <span data-testid="wert">{wert}</span>
      <button type="button" onClick={() => setWert('welt')}>
        suchen
      </button>
    </div>
  );
}

function adresse(): string {
  return `${window.location.pathname}${window.location.search}`;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/servers');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useUrlFilter (Fundpunkt 213)', () => {
  it('schreibt die Auswahl in die Adresse', () => {
    render(<Probe />);

    act(() => {
      screen.getByRole('button', { name: 'online' }).click();
    });

    expect(adresse()).toBe('/servers?filter=online');
    expect(screen.getByTestId('wert').textContent).toBe('online');
  });

  it('nimmt den Vorgabewert wieder aus der Adresse heraus', () => {
    render(<Probe />);

    act(() => {
      screen.getByRole('button', { name: 'online' }).click();
    });
    act(() => {
      screen.getByRole('button', { name: 'alle' }).click();
    });

    // Der Normalfall gehört nicht in die Adresse – sonst trägt jeder Link
    // einen Parameter, der nichts aussagt.
    expect(adresse()).toBe('/servers');
  });

  it('liest die Auswahl beim Öffnen aus der Adresse', () => {
    window.history.replaceState(null, '', '/servers?filter=online');

    render(<Probe />);

    expect(screen.getByTestId('wert').textContent).toBe('online');
  });

  it('ignoriert einen Wert, den es nicht gibt', () => {
    window.history.replaceState(null, '', '/servers?filter=<script>');

    render(<Probe />);

    expect(screen.getByTestId('wert').textContent).toBe('all');
  });

  it('hält den Suchbegriff genauso fest', () => {
    render(<ProbeSuche />);

    act(() => {
      screen.getByRole('button', { name: 'suchen' }).click();
    });

    expect(adresse()).toBe('/servers?q=welt');
  });

  it('lässt andere Parameter der Adresse stehen', () => {
    window.history.replaceState(null, '', '/servers?highlight=abc');

    render(<Probe />);

    act(() => {
      screen.getByRole('button', { name: 'online' }).click();
    });

    expect(adresse()).toContain('highlight=abc');
    expect(adresse()).toContain('filter=online');
  });
});
