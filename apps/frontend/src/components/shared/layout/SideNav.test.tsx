import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SideNavSection, type SideNavItem } from './SideNav';

/**
 * Navigationsbaustein – jeder Eintrag hat ein Ziel (Fundpunkt 159).
 *
 * `SideNavItem.href` war optional, und Einträge ohne Ziel wurden als `<button>`
 * gezeichnet. Die Hauptnavigation verlangt seit Fundpunkt 155 ein Ziel und ist
 * der einzige Verwender – damit war der Zweig hier ebenfalls unerreichbar.
 * Geprüft wird beides: am Typ und an dem, was im DOM landet.
 */

const EINTRAEGE: SideNavItem[] = [
  { key: 'servers', label: 'Übersicht', icon: 'grid', href: '/servers', active: true },
  { key: 'messages', label: 'Nachrichten', icon: 'chat', href: '/messages', badgeCount: 3 },
];

describe('SideNavSection – Ziel ist Pflicht (Fundpunkt 159)', () => {
  it('lässt einen Eintrag ohne Ziel nicht mehr zu', () => {
    // @ts-expect-error – `href` ist Pflicht; ein Eintrag ohne Ziel ist kein Eintrag.
    const ohneZiel: SideNavItem = { key: 'irgendwas', label: 'Irgendwas', icon: 'grid' };

    expect(ohneZiel.key).toBe('irgendwas');
  });

  it('zeichnet jeden Eintrag als Link, keinen als Schaltfläche', () => {
    render(<SideNavSection title="Administration" items={EINTRAEGE} />);

    const links = screen.getAllByRole('link');

    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/servers', '/messages']);
    // Der Zweig für Einträge ohne Ziel zeichnete ein `<button>`; ohne ihn gibt
    // es keins mehr.
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('hebt den aktiven Eintrag hervor und zeigt den Zähler', () => {
    render(<SideNavSection items={EINTRAEGE} />);

    expect(screen.getByRole('link', { name: /Übersicht/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: /Nachrichten/ }).textContent).toContain('3');
  });
});

/**
 * Der Rahmen des aktiven Eintrags darf keinen Platz kosten, den der ruhende
 * nicht auch belegt.
 *
 * Vorher trug nur der aktive Eintrag `border-l-2`. Weil ein Rahmen Breite hat,
 * rutschte bei jedem Seitenwechsel die Beschriftung der neuen Zeile zwei Pixel
 * nach rechts und die der alten wieder zurück – auf der meistbenutzten Fläche
 * der Oberfläche ein sichtbares Zucken. Der Test hält fest, was die Lösung
 * ausmacht: Die Kante steht an **jedem** Eintrag, ruhend nur durchsichtig.
 */
describe('SideNavSection – kein Versatz beim Wechsel des aktiven Eintrags', () => {
  it('gibt aktivem und ruhendem Eintrag dieselbe Rahmenbreite', () => {
    render(<SideNavSection items={EINTRAEGE} />);

    const aktiv = screen.getByRole('link', { name: /Übersicht/ });
    const ruhend = screen.getByRole('link', { name: /Nachrichten/ });

    for (const eintrag of [aktiv, ruhend]) {
      expect(eintrag.className).toContain('border-l-2');
    }

    expect(aktiv.className).toContain('border-brand');
    expect(ruhend.className).toContain('border-transparent');
  });

  it('blendet den Farbwechsel über, statt ihn zu schalten', () => {
    render(<SideNavSection items={EINTRAEGE} />);

    expect(screen.getByRole('link', { name: /Nachrichten/ }).className).toContain(
      'transition-colors',
    );
  });
});
