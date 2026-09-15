import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlobalStatus } from './GlobalStatus';
import { type StatusMetric } from './shellSummary';

/**
 * Der Verlauf beim Überfahren (übernommen aus hafenmeister).
 *
 * Für die Zahlen der Kopfzeile gibt es keinen gespeicherten Verlauf – sie
 * entstehen bei jedem Abruf neu. Gesammelt wird deshalb im Browser, und das
 * Fenster sagt es auch: Wer mehr erwartet, als da ist, liest eine falsche
 * Kurve.
 */

const cpu = (value: string, numeric: number | null): StatusMetric => ({
  key: 'cpu',
  label: 'CPU',
  value,
  tone: 'warning',
  note: 'Durchschnitt über die Nodes.',
  numeric,
  format: (wert) => `${String(Math.round(wert))} %`,
});

describe('GlobalStatus', () => {
  it('zeigt Wert und Beschriftung jeder Kennzahl', () => {
    render(<GlobalStatus metrics={[cpu('40 %', 40)]} />);

    expect(screen.getByText('40 %')).toBeTruthy();
    expect(screen.getByText('CPU')).toBeTruthy();
  });

  it('sagt beim ersten Ueberfahren, dass noch gesammelt wird', () => {
    const { container } = render(<GlobalStatus metrics={[cpu('40 %', 40)]} />);
    const kennzahl = container.querySelector('span.relative');

    expect(kennzahl).not.toBeNull();
    fireEvent.mouseEnter(kennzahl as Element);

    // Eine einzige Messung ist noch keine Linie - und das steht auch da.
    expect(screen.getByText('sammelt noch …')).toBeTruthy();
    expect(screen.getByText(/nicht gespeichert/)).toBeTruthy();
  });

  it('oeffnet kein Fenster fuer eine Kennzahl ohne Zahlenwert', () => {
    /*
     * „—" heisst unbekannt. Eine Kennzahl, die dauerhaft nichts meldet (keine
     * Node verbunden), bekaeme sonst ein Feld, das „sammelt noch" behauptet -
     * dabei wird da nie eine Linie entstehen.
     */
    const { container } = render(<GlobalStatus metrics={[cpu('—', null)]} />);
    const kennzahl = container.querySelector('span.relative');

    fireEvent.mouseEnter(kennzahl as Element);

    expect(screen.queryByText('sammelt noch …')).toBeNull();
  });

  it('bleibt leer, solange nichts geladen ist', () => {
    const { container } = render(<GlobalStatus metrics={[]} />);

    expect(container.textContent).toBe('');
  });
});
