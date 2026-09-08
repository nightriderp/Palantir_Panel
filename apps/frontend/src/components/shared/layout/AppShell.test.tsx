import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import { SideNavSection, type SideNavItem } from './SideNav';

/**
 * Der Seitenrahmen schließt die mobile Schublade (Fundpunkt 166).
 *
 * Der Navigationsbaustein trug dafür bis hierher ein `onSelect` je Eintrag –
 * gesetzt hat es nie jemand. Es war auch nicht nötig: `AppShell` legt den
 * Klick-Fänger um den ganzen Behälter der Seitenleiste, und jeder Klick auf
 * einen Eintrag blubbert dorthin. Diese Datei hält das fest, damit das
 * Entfernen von `onSelect` die Schublade nicht offen stehen lässt.
 *
 * Geprüft wird über `aria-expanded` der Menü-Schaltfläche – die Angabe, die
 * auch ein Screenreader auswertet, und damit aussagekräftiger als eine
 * CSS-Klasse.
 */

const EINTRAEGE: SideNavItem[] = [
  { key: 'servers', label: 'Übersicht', icon: 'grid', href: '/servers', active: true },
  { key: 'messages', label: 'Nachrichten', icon: 'chat', href: '/messages' },
];

/** Rendert den Rahmen und liefert die Menü-Schaltfläche dazu. */
function rahmen() {
  render(
    <AppShell sidebar={<SideNavSection items={EINTRAEGE} />}>
      <p>Inhalt</p>
    </AppShell>,
  );

  return screen.getByRole('button', { name: 'Navigation öffnen' });
}

function istOffen(menue: HTMLElement): boolean {
  return menue.getAttribute('aria-expanded') === 'true';
}

describe('AppShell – mobile Schublade', () => {
  it('ist zu Beginn geschlossen', () => {
    expect(istOffen(rahmen())).toBe(false);
  });

  it('schließt sich, wenn ein Eintrag der Navigation angeklickt wird', () => {
    const menue = rahmen();

    fireEvent.click(menue);
    expect(istOffen(menue)).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: /Nachrichten/ }));

    // Kein `onSelect` am Eintrag nötig – der Fänger um den Behälter genügt.
    expect(istOffen(menue)).toBe(false);
  });

  it('schließt sich über die eigene Schaltfläche', () => {
    const menue = rahmen();

    fireEvent.click(menue);
    fireEvent.click(screen.getByRole('button', { name: 'Navigation schließen' }));

    expect(istOffen(menue)).toBe(false);
  });

  it('schließt sich mit Escape', () => {
    const menue = rahmen();

    fireEvent.click(menue);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(istOffen(menue)).toBe(false);
  });
});
