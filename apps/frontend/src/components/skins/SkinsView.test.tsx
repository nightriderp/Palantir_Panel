import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkinsView } from './SkinsView';

/**
 * F9 – Skins: In Phase 1 nur der einheitliche „Kommt später"-Zustand aus F2.
 * Der Test sichert, dass die Ansicht den Platzhalter zeigt und keine bedienbare
 * Skin-Funktion vortäuscht – also kein Upload- oder Verwaltungs-Knopf.
 */
describe('SkinsView', () => {
  it('zeigt den Seitenkopf und den Phase-2-Platzhalter', () => {
    render(<SkinsView />);

    expect(screen.getByRole('heading', { level: 1, name: 'Skins' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Skins' })).toBeTruthy();
    expect(screen.getByText(/Kommt später/)).toBeTruthy();
    expect(screen.getByText(/Phase 2 – erstes vollständig unterstütztes Spiel/)).toBeTruthy();
  });

  it('bietet keine Aktionen an (kein Upload, keine Verwaltung)', () => {
    render(<SkinsView />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
