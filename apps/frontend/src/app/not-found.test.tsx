import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { THEME_COOKIE } from '@/lib/theme/cookie';

/**
 * Die 404-Seite ist die einzige Stelle, die ihren Spruch **selbst** aus dem
 * Cookie holt statt aus dem Kontext – sie ist eine Server-Komponente und hat
 * keine Hooks (`lib/theme/SpruchProvider.tsx`).
 *
 * Genau deshalb steht sie hier: Über HTTP ist sie nicht zu erreichen, weil der
 * Proxy jeden unbekannten Pfad ohne Sitzung auf `/login` umleitet
 * (`src/proxy.ts`) – ein Aufruf von Hand beweist also gar nichts. Der einzige
 * Weg, diesen zweiten Pfad zur Theme-Wahl zu prüfen, ist, die Komponente
 * aufzurufen.
 */

let cookieWert: string | undefined;

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === THEME_COOKIE && cookieWert !== undefined ? { name, value: cookieWert } : undefined,
    }),
}));

const { default: NotFound } = await import('./not-found');

async function zeige(theme: string | undefined) {
  cookieWert = theme;
  render(await NotFound());
}

describe('404-Seite', () => {
  it('zeigt ohne Cookie den neutralen Text', async () => {
    await zeige(undefined);

    expect(screen.getByRole('heading', { name: 'Diese Seite gibt es nicht' })).toBeTruthy();
  });

  it('zeigt den Spruch des gewählten Themes', async () => {
    await zeige('hyperraum');

    expect(screen.getByRole('heading', { name: 'Der Kurs führt ins Leere' })).toBeTruthy();
    expect(screen.getByText(/Die Übersicht führt zurück zu deinen Servern/)).toBeTruthy();
  });

  it('fällt bei unbekanntem Cookie auf den neutralen Text zurück', async () => {
    await zeige('boesewicht');

    expect(screen.getByRole('heading', { name: 'Diese Seite gibt es nicht' })).toBeTruthy();
  });

  /*
   * „Fehler 404" ist eine technische Angabe, kein Spruch: Wer sie weitergibt
   * oder in eine Suchmaschine eingibt, soll in jedem Theme dasselbe vorfinden.
   * Dasselbe gilt für die beiden Wege hinaus – sie sind die Auskunft der
   * Seite, nicht ihr Ton.
   */
  it('lässt Fehlercode und Auswege in jedem Theme unangetastet', async () => {
    for (const theme of [undefined, 'schmiedefeuer', 'neonnacht', 'kanzlei', 'hyperraum']) {
      cookieWert = theme;
      const { unmount } = render(await NotFound());

      expect(screen.getByText('Fehler 404'), theme ?? 'ohne Theme').toBeTruthy();
      expect(screen.getByRole('link', { name: 'Zur Übersicht' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Zur Anmeldung' })).toBeTruthy();
      unmount();
    }
  });
});
