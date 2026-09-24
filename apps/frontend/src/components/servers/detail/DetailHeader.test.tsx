import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ownerPermissions, permissions, server as serverFixture } from '../testFixtures';
import { DetailHeader } from './DetailHeader';

/**
 * Besitzerwechsel (Pflichtenheft §7): Der Knopf hängt an zwei Dingen – dem
 * Flag `canTransferOwnership` aus dem DTO und daran, dass die Detailseite
 * einen Handler mitgibt (nur mit `canManageUsers`, weil die Auswahl die
 * Nutzerliste braucht). Fehlt eines davon, gibt es den Weg nicht.
 */
function zeichne(flags: Partial<Parameters<typeof permissions>[0]>, onTransferOwner?: () => void) {
  const server = serverFixture({ id: 'srv-1', permissions: { ...ownerPermissions(), ...flags } });

  return render(
    <DetailHeader
      server={server}
      busy={false}
      onLifecycle={() => undefined}
      onUpdate={() => undefined}
      onOpenSettings={() => undefined}
      onDelete={() => undefined}
      onCopyAddress={() => undefined}
      {...(onTransferOwner ? { onTransferOwner } : {})}
    />,
  );
}

describe('DetailHeader – Besitzer wechseln', () => {
  it('zeigt den Knopf nur mit Flag und Handler', () => {
    const handler = vi.fn();
    zeichne({ canTransferOwnership: true }, handler);

    fireEvent.click(screen.getByRole('button', { name: 'Besitzer wechseln' }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lässt den Knopf ohne Flag weg – der Besitzer gibt seinen Server nicht weiter', () => {
    zeichne({ canTransferOwnership: false }, vi.fn());

    expect(screen.queryByRole('button', { name: 'Besitzer wechseln' })).toBeNull();
  });

  it('lässt den Knopf ohne Handler weg – ohne Nutzerliste gäbe es keine Auswahl', () => {
    zeichne({ canTransferOwnership: true });

    expect(screen.queryByRole('button', { name: 'Besitzer wechseln' })).toBeNull();
  });
});

describe('DetailHeader – Adresse kopieren', () => {
  function mitAdresse(copyPrefix?: string) {
    const onCopyAddress = vi.fn();
    const server = {
      ...serverFixture({ id: 'srv-1', permissions: ownerPermissions() }),
      address: {
        hostname: 'cs.example.tld',
        port: 25003,
        ...(copyPrefix === undefined ? {} : { copyPrefix }),
      },
    };

    render(
      <DetailHeader
        server={server}
        busy={false}
        onLifecycle={() => undefined}
        onUpdate={() => undefined}
        onOpenSettings={() => undefined}
        onDelete={() => undefined}
        onCopyAddress={onCopyAddress}
      />,
    );

    fireEvent.click(screen.getByTitle('Adresse kopieren'));

    return onCopyAddress;
  }

  it('setzt den Vorsatz des Spiels davor (CS2: connect), zeigt ihn aber nicht', () => {
    expect(mitAdresse('connect ')).toHaveBeenCalledWith('connect cs.example.tld:25003');
    expect(screen.queryByText(/connect cs/u)).toBeNull();
  });

  it('kopiert ohne Vorsatz die Adresse allein', () => {
    expect(mitAdresse()).toHaveBeenCalledWith('cs.example.tld:25003');
  });
});

describe('DetailHeader – Spielbilder', () => {
  function zeichneMit(bilder: { gameIconUrl?: string | null; gameCoverUrl?: string | null }) {
    const server = serverFixture({ id: 'srv-1', name: 'Die OGs', permissions: ownerPermissions() });

    return render(
      <DetailHeader
        server={server}
        busy={false}
        onLifecycle={() => undefined}
        onUpdate={() => undefined}
        onOpenSettings={() => undefined}
        onDelete={() => undefined}
        onCopyAddress={() => undefined}
        {...bilder}
      />,
    );
  }

  it('zeigt Symbol und Kachelbild des Spiels, wenn beide bekannt sind', () => {
    const { container } = zeichneMit({
      gameIconUrl: 'https://api.example.tld/api/game-types/minecraft/images/icon',
      gameCoverUrl: 'https://api.example.tld/api/game-types/minecraft/images/cover',
    });

    const symbol = container.querySelector('img');
    expect(symbol?.getAttribute('src')).toBe(
      'https://api.example.tld/api/game-types/minecraft/images/icon',
    );
    expect(screen.queryByText('DI')).toBeNull();

    const hintergrund = container.querySelector<HTMLElement>('[style*="background-image"]');
    expect(hintergrund?.style.backgroundImage).toContain('/images/cover');
  });

  it('fällt ohne Bilder auf das Namenskürzel zurück', () => {
    const { container } = zeichneMit({});

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[style*="background-image"]')).toBeNull();
    expect(screen.getByText('DI')).toBeTruthy();
  });
});
