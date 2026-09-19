import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkinsView } from './SkinsView';

/**
 * F9 – Skins: nur der einheitliche „Kommt später"-Zustand aus F2. Der Test
 * sichert, dass die Ansicht den Platzhalter zeigt und keine bedienbare
 * Skin-Funktion vortäuscht – also kein Upload- oder Verwaltungs-Knopf.
 *
 * Seit Fundpunkt 307 **ohne Phasenangabe**: Die Seite verwies auf Phase 2, die
 * abgeschlossen ist. Der Test hält das fest, damit niemand versehentlich wieder
 * eine verstrichene Phase verspricht.
 */
describe('SkinsView', () => {
  it('zeigt den Seitenkopf und den Platzhalter ohne Phasenzusage', () => {
    const { container } = render(<SkinsView />);

    expect(screen.getByRole('heading', { level: 1, name: 'Skins' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Skins' })).toBeTruthy();
    expect(screen.getByText(/Kommt später/)).toBeTruthy();
    expect(screen.getByText(/Termin offen/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Phase 2/);
  });

  it('bietet keine Aktionen an (kein Upload, keine Verwaltung)', () => {
    render(<SkinsView />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
