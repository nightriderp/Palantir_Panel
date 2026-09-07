import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardShell } from './DashboardShell';
import DashboardLayout from './layout';
import AdminUsersPage from './admin/users/page';
import ServersPage from './servers/page';

/**
 * Der gemeinsame Rahmen überlebt den Wechsel Dashboard ↔ Administration
 * (Fundpunkt frontend-app-03).
 *
 * Der Test bildet nach, was Next beim Navigieren tut: Das Layout-Element bleibt
 * dasselbe, nur die Seite darunter wird ausgetauscht. Genau daran hing der
 * Fundpunkt – solange `admin/` neben `(dashboard)` lag statt darunter, war es
 * eben **nicht** dasselbe Layout, und React montierte den kompletten
 * Provider-Stapel neu (zwei WebSockets, `/auth/session`, `GET /servers`,
 * `GET /admin/nodes`, Konversationsliste).
 *
 * `DashboardShell` steht hier als Attrappe, die sich zwei Dinge merkt: wie oft
 * sie montiert wurde und welche Instanz sie beim Montieren angelegt hat. Der
 * `useRef` vertritt alles, was der echte Rahmen genau einmal je Montage anlegt –
 * die beiden Verbindungen, die geladene Sitzung, die laufenden Toasts, den
 * Ungelesen-Zähler der Glocke.
 */

const rahmen = vi.hoisted(() => ({
  /** Wie oft der Rahmen montiert wurde. */
  montagen: 0,
  /** Wie oft er wieder abgebaut wurde. */
  abbaue: 0,
  /** Instanz der laufenden Montage – wechselt genau dann, wenn neu montiert wird. */
  instanz: null as object | null,
}));

vi.mock('./DashboardShell', async () => {
  const react = await import('react');

  return {
    DashboardShell: ({ children, versionLabel }: { children: ReactNode; versionLabel: string }) => {
      // Erst der Aufruf beim Montieren legt das Objekt an; alle weiteren
      // Durchläufe bekommen dasselbe zurück.
      const instanz = react.useRef<object>({ versionLabel });

      react.useEffect(() => {
        rahmen.montagen += 1;
        return () => {
          rahmen.abbaue += 1;
        };
      }, []);

      rahmen.instanz = instanz.current;

      return <div data-testid="rahmen">{children}</div>;
    },
  };
});

// Die beiden Seiten sind reine Wrapper um ihre Ansicht; die Ansichten selbst
// laden Daten und gehören nicht in diesen Test.
vi.mock('@/components/servers/ServerOverview', () => ({
  ServerOverview: () => <p>Serverübersicht</p>,
}));

vi.mock('@/components/admin/users/UsersView', () => ({
  UsersView: () => <p>Nutzerverwaltung</p>,
}));

beforeEach(() => {
  rahmen.montagen = 0;
  rahmen.abbaue = 0;
  rahmen.instanz = null;
});

describe('Layout des eingeloggten Bereichs', () => {
  it('behält den Provider-Stapel beim Wechsel von der Übersicht in die Administration', () => {
    const { rerender } = render(
      <DashboardLayout>
        <ServersPage />
      </DashboardLayout>,
    );

    expect(screen.getByText('Serverübersicht')).toBeTruthy();
    const vorher = rahmen.instanz;
    expect(vorher).not.toBeNull();

    // Navigation: dasselbe Layout, andere Seite – so reicht Next die neue Seite
    // durch, solange sich das Layout-Segment nicht ändert.
    rerender(
      <DashboardLayout>
        <AdminUsersPage />
      </DashboardLayout>,
    );

    expect(screen.getByText('Nutzerverwaltung')).toBeTruthy();
    expect(screen.queryByText('Serverübersicht')).toBeNull();

    expect(rahmen.instanz).toBe(vorher);
    expect(rahmen.montagen).toBe(1);
    expect(rahmen.abbaue).toBe(0);
  });

  it('behält ihn auch auf dem Rückweg in den Nutzerbereich', () => {
    const { rerender } = render(
      <DashboardLayout>
        <AdminUsersPage />
      </DashboardLayout>,
    );

    const vorher = rahmen.instanz;

    rerender(
      <DashboardLayout>
        <ServersPage />
      </DashboardLayout>,
    );

    expect(screen.getByText('Serverübersicht')).toBeTruthy();
    expect(rahmen.instanz).toBe(vorher);
    expect(rahmen.montagen).toBe(1);
  });

  it('verlöre ihn bei einem eigenen Admin-Layout – der Zustand vor dem Zusammenlegen', () => {
    /**
     * Stellvertreter für das entfernte `admin/(core)/layout.tsx`: derselbe
     * Rumpf, aber eine andere Komponente. React sieht am Wurzelknoten einen
     * anderen Typ, baut den alten Baum ab und den neuen auf.
     *
     * Der Test hält damit fest, dass die beiden Tests darüber wirklich etwas
     * prüfen – und nicht nur bestätigen, dass React einen unveränderten Baum
     * stehen lässt.
     */
    function GetrenntesAdminLayout({ children }: { children: ReactNode }) {
      return <DashboardShell versionLabel="Entwicklung">{children}</DashboardShell>;
    }

    const { rerender } = render(
      <DashboardLayout>
        <ServersPage />
      </DashboardLayout>,
    );

    const vorher = rahmen.instanz;

    rerender(
      <GetrenntesAdminLayout>
        <AdminUsersPage />
      </GetrenntesAdminLayout>,
    );

    expect(screen.getByText('Nutzerverwaltung')).toBeTruthy();
    expect(rahmen.instanz).not.toBe(vorher);
    expect(rahmen.montagen).toBe(2);
    expect(rahmen.abbaue).toBe(1);
  });
});
