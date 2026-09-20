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

/**
 * Die Kanten des Rahmens (Betreiberwunsch 20.09.2026).
 *
 * Sie tragen den Marken-Verlauf statt der weißen Haarlinie. Der Punkt, der
 * dabei leicht kaputtgeht: Die waagerechte Kante läuft über **zwei** Elemente
 * – den Kopf der Seitenleiste (unter dem Logo) und den der Inhaltsspalte –
 * und muss trotzdem als eine Linie lesen. Das hängt allein daran, dass das
 * rechte Stück seinen Verlauf um die Breite der Seitenleiste verschiebt.
 */
describe('AppShell – Kanten des Rahmens', () => {
  function rahmen(): { seitenleiste: HTMLElement; kopfLinks: Element; kopfRechts: HTMLElement } {
    render(
      <AppShell sidebar={<SideNavSection items={EINTRAEGE} />} topbar={<span>Kopf</span>}>
        <p>Inhalt</p>
      </AppShell>,
    );

    const seitenleiste = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    const kopfLinks = seitenleiste.firstElementChild;
    const kopfRechts = screen.getByRole('banner');

    if (kopfLinks === null) throw new Error('Kopf der Seitenleiste fehlt');

    return { seitenleiste, kopfLinks, kopfRechts };
  }

  it('zeichnet beide Kanten als Verlaufsfläche, nicht als Rahmenfarbe', () => {
    const { seitenleiste, kopfLinks, kopfRechts } = rahmen();

    // Ein Verlauf kann keine `border-color` sein – deshalb eigene Klassen.
    expect(seitenleiste.className).toContain('rahmenkante-laengs');
    expect(kopfLinks.className).toContain('rahmenkante-quer');
    expect(kopfRechts.className).toContain('rahmenkante-quer');

    // Die alte weiße Haarlinie darf nicht danebenstehen, sonst lägen zwei
    // Linien übereinander.
    expect(seitenleiste.className).not.toContain('border-r');
    expect(kopfLinks.className).not.toContain('border-b');
    expect(kopfRechts.className).not.toContain('border-b');
  });

  it('verschiebt nur das rechte Stück der waagerechten Kante', () => {
    const { kopfLinks, kopfRechts } = rahmen();

    // ⚠️ Ohne den Versatz fängt der Verlauf rechts von vorn an: An der Kante
    // der Seitenleiste stünde dann wieder Violett, wo schon Türkis kommt –
    // ein sichtbarer Farbsprung mitten im Kopf.
    expect(kopfLinks.className).not.toContain('rahmenkante-quer-versetzt');
    expect(kopfRechts.className).toContain('rahmenkante-quer-versetzt');
  });

  it('hält die Seitenleiste auch ab `md` positioniert', () => {
    const { seitenleiste } = rahmen();

    /*
     * Die Kante hängt als `::after` an der Seitenleiste. Ein `static` Element
     * ist kein Bezugspunkt: Die Linie würde sich den nächsten positionierten
     * Vorfahren suchen und quer über die Seite laufen. Deshalb `md:relative`
     * statt des früheren `md:static` – im Fluss ändert das nichts.
     */
    expect(seitenleiste.className).toContain('md:relative');
    expect(seitenleiste.className).not.toContain('md:static');
  });
});
