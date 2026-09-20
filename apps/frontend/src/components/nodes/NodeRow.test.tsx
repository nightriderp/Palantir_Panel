import { type HostNodeDto } from '@palantir/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeRow } from './NodeRow';

function node(overrides: Partial<HostNodeDto> = {}): HostNodeDto {
  const total = { ramMb: 16384, cpuCores: 8, diskMb: 512_000 };
  const allocated = { ramMb: 8192, diskMb: 128_000 };
  return {
    id: 'n1',
    name: 'Wohnzimmer-PC',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: {
      total,
      allocated,
      available: { ramMb: total.ramMb - allocated.ramMb },
    },
    usage: null,
    serverCount: 3,
    lastSeenAt: '2026-08-27T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: { canView: true, canManage: false, canManageStorage: false },
    ...overrides,
  };
}

describe('NodeRow', () => {
  it('zeigt Name und Zustand', () => {
    render(<NodeRow node={node()} />);
    expect(screen.getByText('Wohnzimmer-PC')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('zeigt niemals die interne Tunnel-Adresse (Vorgabe F7)', () => {
    const { container } = render(<NodeRow node={node()} />);
    expect(container.textContent).not.toContain('10.10.0.2');
  });

  it('erklärt einen nicht-online Zustand im Klartext', () => {
    render(<NodeRow node={node({ status: 'maintenance' })} />);
    expect(screen.getByText(/Wartung/)).toBeTruthy();
    expect(screen.getByText(/stillgelegt/)).toBeTruthy();
  });

  it('zeigt die Statusmeldung, wenn eine vorliegt', () => {
    render(<NodeRow node={node({ statusMessage: 'Update auf Version 2 läuft.' })} />);
    expect(screen.getByText('Update auf Version 2 läuft.')).toBeTruthy();
  });
});

describe('NodeRow – Agent-Version (Befund 11.3)', () => {
  const kompatibel = {
    version: '1.4.2',
    protocolVersion: 1,
    expectedProtocolVersion: 1,
    compatible: true,
    reportedAt: '2026-09-16T10:00:00.000Z',
  };

  it('nennt die Version des Agents in der Unterzeile', () => {
    render(<NodeRow node={node({ agent: kompatibel })} />);
    expect(screen.getByText(/Agent 1\.4\.2/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warnt im Klartext, wenn der Agent nicht zur Version des Panels passt', () => {
    render(
      <NodeRow
        node={node({
          status: 'offline',
          agent: { ...kompatibel, protocolVersion: 2, compatible: false },
        })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('passt nicht');
    expect(screen.getByRole('alert').textContent).toContain('aktualisieren');
  });

  it('zeigt ohne Meldung des Agents nichts dazu', () => {
    const { container } = render(<NodeRow node={node()} />);
    expect(container.textContent).not.toContain('Agent');
  });
});
