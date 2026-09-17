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
