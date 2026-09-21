import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';
import { UserLabel } from './UserLabel';

/**
 * Profilbild und Namenszeile (Betreiber-Wunsch 21.09.2026).
 *
 * Geprüft wird das, was der Baustein selbst entscheidet: was ohne Bild
 * dasteht, und dass die Namenszeile den Titel zeigt, ohne ihn mit dem Namen zu
 * verwechseln.
 */

describe('Avatar', () => {
  it('zeigt das Bild, wenn es eins gibt', () => {
    const { container } = render(<Avatar src="/api/users/u1/avatar?v=1" displayName="Femi" />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/users/u1/avatar?v=1');
  });

  it('fällt ohne Bild auf den Anfangsbuchstaben zurück', () => {
    /*
     * Nicht auf das Sinnbild: In einer Liste mit zehn Zeilen sind zehn
     * identische graue Köpfe keine Unterscheidung, ein Buchstabe ist einer.
     */
    const { container } = render(<Avatar src={null} displayName="femi" />);

    expect(container.textContent).toBe('F');
    expect(container.querySelector('img')).toBeNull();
  });

  it('nimmt auch ein Emoji als ersten Buchstaben, nicht dessen halbes Zeichen', () => {
    const { container } = render(<Avatar src={null} displayName="🐍 Schlange" />);

    expect(container.textContent).toBe('🐍');
  });

  it('zeigt ohne Namen das Sinnbild statt eines leeren Kreises', () => {
    // Der Fall des gelöschten Kontos: Es gibt keinen Buchstaben.
    const { container } = render(<Avatar src={null} displayName={null} />);

    expect(container.textContent).toBe('');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('übergeht einen Namen aus reinem Leerraum', () => {
    const { container } = render(<Avatar src={null} displayName="   " />);

    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('UserLabel', () => {
  it('stellt den Titel hinter den Namen, ohne ihn zu ersetzen', () => {
    render(<UserLabel avatarSrc={null} displayName="Femi" title="Nachtschicht" />);

    expect(screen.getByText('Femi')).toBeTruthy();
    expect(screen.getByText('Nachtschicht')).toBeTruthy();
  });

  it('kommt ohne Titel aus', () => {
    const { container } = render(<UserLabel avatarSrc={null} displayName="Femi" />);

    expect(container.textContent).toBe('FFemi');
  });

  it('hängt einen Zusatz hinter den Titel', () => {
    render(<UserLabel avatarSrc={null} displayName="Femi" title="Nachtschicht" suffix="· du" />);

    expect(screen.getByText('· du')).toBeTruthy();
  });

  it('lässt das Bild weg, wenn die Zeile ihr eigenes zeichnet', () => {
    const { container } = render(<UserLabel avatarSrc={null} displayName="Femi" hideAvatar />);

    expect(container.textContent).toBe('Femi');
  });
});
