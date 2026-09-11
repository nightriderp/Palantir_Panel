import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEITENGROESSE, useSeitenteilung, useTabellenSortierung } from './tableSort';

/**
 * Sortierung und Seitenteilung der Admin-Tabellen (Fundpunkt 212).
 *
 * Am laufenden System gemessen: Keine der Tabellen ließ sich sortieren, und
 * keine teilte sich in Seiten – bei zweihundert Konten war „wer ist zuletzt
 * dazugekommen" eine Frage ohne Antwort.
 */

const SPALTEN = ['name', 'anzahl'] as const;

type Spalte = (typeof SPALTEN)[number];

interface Zeile {
  readonly name: string;
  readonly anzahl: number | null;
}

const ZEILEN: Zeile[] = [
  { name: 'Bravo', anzahl: 2 },
  { name: 'alpha', anzahl: null },
  { name: 'Charlie', anzahl: 10 },
];

function Probe({
  standard = 'name' as Spalte,
  praefix = '',
}: {
  standard?: Spalte;
  praefix?: string;
}) {
  const sortierung = useTabellenSortierung<Spalte>(SPALTEN, standard, 'asc', praefix);
  const sortiert = sortierung.sortiere(ZEILEN, {
    name: (zeile) => zeile.name,
    anzahl: (zeile) => zeile.anzahl,
  });

  return (
    <table>
      <thead>
        <tr>
          <th aria-sort={sortierung.ariaSort('name')}>
            <button type="button" onClick={() => sortierung.umschalten('name')}>
              Name
            </button>
          </th>
          <th aria-sort={sortierung.ariaSort('anzahl')}>
            <button type="button" onClick={() => sortierung.umschalten('anzahl')}>
              Anzahl
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td data-testid="reihenfolge">{sortiert.map((zeile) => zeile.name).join(',')}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Blaettern({ anzahl, praefix = '' }: { anzahl: number; praefix?: string }) {
  const zeilen = Array.from({ length: anzahl }, (_, index) => `Z${index + 1}`);
  const seite = useSeitenteilung(zeilen, praefix);

  return (
    <div>
      <span data-testid="sichtbar">{seite.zeilen.join(',')}</span>
      <span data-testid="stand">{`${seite.seite}/${seite.seiten}/${seite.gesamt}`}</span>
      <button type="button" onClick={() => seite.blaettere(2)}>
        zwei
      </button>
      <button type="button" onClick={() => seite.blaettere(1)}>
        eins
      </button>
    </div>
  );
}

function adresse(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function reihenfolge(): string {
  return screen.getByTestId('reihenfolge').textContent ?? '';
}

beforeEach(() => {
  window.history.replaceState(null, '', '/admin/users');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useTabellenSortierung (Fundpunkt 212)', () => {
  it('sortiert Text ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    render(<Probe />);

    // Ohne `localeCompare` stünde „Bravo" vor „alpha": Großbuchstaben haben
    // den kleineren Codepunkt. Genau das liest sich in einer Liste wie ein
    // Fehler.
    expect(reihenfolge()).toBe('alpha,Bravo,Charlie');
  });

  it('dreht dieselbe Spalte um und setzt eine andere zurück', () => {
    render(<Probe />);

    act(() => {
      screen.getByRole('button', { name: 'Name' }).click();
    });
    expect(reihenfolge()).toBe('Charlie,Bravo,alpha');
    expect(adresse()).toBe('/admin/users?dir=desc');

    act(() => {
      screen.getByRole('button', { name: 'Anzahl' }).click();
    });
    // Neue Spalte, neue Vorgaberichtung – nicht die zufällig zuletzt gewählte.
    expect(adresse()).toBe('/admin/users?sort=anzahl');
  });

  it('stellt Zeilen ohne Wert immer ans Ende', () => {
    render(<Probe standard="anzahl" />);

    expect(reihenfolge()).toBe('Bravo,Charlie,alpha');

    act(() => {
      screen.getByRole('button', { name: 'Anzahl' }).click();
    });

    // Auch absteigend: Eine Zeile ohne Angabe ist kein kleinster Wert.
    expect(reihenfolge()).toBe('Charlie,Bravo,alpha');
  });

  it('meldet den Zustand über aria-sort', () => {
    render(<Probe />);

    const koepfe = screen.getAllByRole('columnheader');
    expect(koepfe[0]?.getAttribute('aria-sort')).toBe('ascending');
    expect(koepfe[1]?.getAttribute('aria-sort')).toBe('none');
  });

  it('liest die Auswahl beim Öffnen aus der Adresse', () => {
    window.history.replaceState(null, '', '/admin/users?sort=anzahl&dir=desc');

    render(<Probe />);

    expect(reihenfolge()).toBe('Charlie,Bravo,alpha');
  });

  it('verwirft eine Spalte, die es nicht gibt', () => {
    window.history.replaceState(null, '', '/admin/users?sort=gehalt');

    render(<Probe />);

    expect(reihenfolge()).toBe('alpha,Bravo,Charlie');
  });

  it('hält zwei Tabellen auf einer Seite auseinander', () => {
    render(
      <>
        <Probe praefix="links" />
        <Probe praefix="rechts" />
      </>,
    );

    act(() => {
      screen.getAllByRole('button', { name: 'Anzahl' })[0]?.click();
    });

    expect(adresse()).toBe('/admin/users?linkssort=anzahl');
    // Die zweite Tabelle steht unverändert auf ihrer Vorgabe.
    expect(screen.getAllByTestId('reihenfolge')[1]?.textContent).toBe('alpha,Bravo,Charlie');
  });
});

describe('useSeitenteilung (Fundpunkt 212)', () => {
  it('zeigt bei kurzen Listen alles auf einer Seite', () => {
    render(<Blaettern anzahl={3} />);

    expect(screen.getByTestId('stand').textContent).toBe('1/1/3');
  });

  it('schneidet lange Listen in Seiten', () => {
    render(<Blaettern anzahl={SEITENGROESSE + 2} />);

    expect(screen.getByTestId('stand').textContent).toBe(`1/2/${SEITENGROESSE + 2}`);

    act(() => {
      screen.getByRole('button', { name: 'zwei' }).click();
    });

    expect(screen.getByTestId('sichtbar').textContent).toBe(
      `Z${SEITENGROESSE + 1},Z${SEITENGROESSE + 2}`,
    );
    expect(adresse()).toBe('/admin/users?seite=2');
  });

  it('nimmt die erste Seite wieder aus der Adresse heraus', () => {
    render(<Blaettern anzahl={SEITENGROESSE + 2} />);

    act(() => {
      screen.getByRole('button', { name: 'zwei' }).click();
    });
    act(() => {
      screen.getByRole('button', { name: 'eins' }).click();
    });

    expect(adresse()).toBe('/admin/users');
  });

  it('fällt auf die letzte vorhandene Seite zurück', () => {
    window.history.replaceState(null, '', '/admin/users?seite=9');

    // Zwischen zwei Abrufen kann die Liste kürzer werden – eine leere Tabelle
    // wäre die schlechtere Antwort als die letzte Seite, die es noch gibt.
    render(<Blaettern anzahl={SEITENGROESSE + 2} />);

    expect(screen.getByTestId('stand').textContent).toBe(`2/2/${SEITENGROESSE + 2}`);
  });
});
