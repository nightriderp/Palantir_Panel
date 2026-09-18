/**
 * Bausteine der Admin-Tabellen (Review 2026-09-16, Befund 12.2).
 *
 * jsdom rendert keine Layouts, deshalb prüfen die Tests die Verabredung, an
 * der die Kartendarstellung hängt: Jede Zelle mit `label` trägt ihre
 * Spaltenbeschriftung selbst, eine ohne nicht; die Kopfzeile bleibt eine
 * Tabellenkopfzeile, und Sortierköpfe sind die einzigen, die auf schmalen
 * Bildschirmen stehen bleiben.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminTable, SortTh, Td, Th } from './common';

function klassen(element: HTMLElement): string[] {
  return Array.from(element.classList);
}

describe('AdminTable', () => {
  it('bleibt für Vorlesehilfen und Tests eine Tabelle mit Kopf- und Datenzellen', () => {
    render(
      <AdminTable>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th className="text-right">Größe</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td label="Name">Welt A</Td>
            <Td label="Größe" className="text-right">
              12 MB
            </Td>
          </tr>
        </tbody>
      </AdminTable>,
    );

    const tabelle = screen.getByRole('table');
    expect(
      within(tabelle)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Name', 'Größe']);
    expect(within(tabelle).getAllByRole('cell')).toHaveLength(2);
  });
});

describe('Td', () => {
  it('trägt die Spaltenbeschriftung für schmale Bildschirme an der Zelle', () => {
    render(
      <table>
        <tbody>
          <tr>
            <Td label="Protokoll">UDP</Td>
          </tr>
        </tbody>
      </table>,
    );

    const zelle = screen.getByRole('cell');
    expect(zelle.textContent).toContain('Protokoll');
    expect(zelle.textContent).toContain('UDP');
    // Die Beschriftung verschwindet ab `md` samt Zugänglichkeitsbaum – dort
    // übernimmt die Kopfzeile.
    expect(klassen(screen.getByText('Protokoll'))).toContain('md:hidden');
    expect(klassen(zelle)).toContain('flex');
  });

  it('nimmt ohne Beschriftung die ganze Breite (Auswahlkästchen, Aktionen)', () => {
    render(
      <table>
        <tbody>
          <tr>
            <Td className="text-right">
              <button type="button">Löschen</button>
            </Td>
          </tr>
        </tbody>
      </table>,
    );

    const zelle = screen.getByRole('cell');
    expect(zelle.textContent).toBe('Löschen');
    expect(klassen(zelle)).toEqual(expect.arrayContaining(['block', 'text-right']));
    expect(klassen(zelle)).not.toContain('flex');
  });
});

describe('Th und SortTh', () => {
  it('versteckt reine Beschriftungen auf schmalen Bildschirmen, Sortierköpfe nicht', () => {
    render(
      <table>
        <thead>
          <tr>
            <Th>Zeitpunkt</Th>
            <SortTh aktiv richtung="asc" onSort={() => undefined}>
              Name
            </SortTh>
          </tr>
        </thead>
      </table>,
    );

    const koepfe = screen.getAllByRole('columnheader');
    const beschriftung = koepfe[0]!;
    const sortierbar = koepfe[1]!;
    expect(klassen(beschriftung)).toEqual(expect.arrayContaining(['hidden', 'md:table-cell']));
    expect(klassen(sortierbar)).toEqual(expect.arrayContaining(['block', 'md:table-cell']));
    expect(klassen(sortierbar)).not.toContain('hidden');
    expect(sortierbar.getAttribute('aria-sort')).toBe('ascending');
    expect(within(sortierbar).getByRole('button', { name: /Name/ })).toBeDefined();
  });
});
