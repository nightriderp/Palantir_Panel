import { type HostNodeDto } from '@palantir/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeCard } from './NodeCard';

function node(overrides: Partial<HostNodeDto> = {}): HostNodeDto {
  const total = { ramMb: 16384, cpuCores: 8, diskMb: 512_000 };
  const allocated = { ramMb: 8192, cpuCores: 4, diskMb: 128_000 };
  return {
    id: 'n1',
    name: 'Wohnzimmer-PC',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: {
      total,
      allocated,
      available: {
        ramMb: total.ramMb - allocated.ramMb,
        cpuCores: total.cpuCores - allocated.cpuCores,
        diskMb: total.diskMb - allocated.diskMb,
      },
    },
    usage: null,
    serverCount: 3,
    lastSeenAt: '2026-08-27T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: { canView: true, canManage: false, canManageStorage: false },
    ...overrides,
  };
}

describe('NodeCard', () => {
  it('zeigt Name und Zustand', () => {
    render(<NodeCard node={node()} />);
    expect(screen.getByText('Wohnzimmer-PC')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('zeigt niemals die interne Tunnel-Adresse (Vorgabe F7)', () => {
    const { container } = render(<NodeCard node={node()} />);
    expect(container.textContent).not.toContain('10.10.0.2');
  });

  it('erklärt einen nicht-online Zustand im Klartext', () => {
    render(<NodeCard node={node({ status: 'maintenance' })} />);
    expect(screen.getByText(/Wartung/)).toBeTruthy();
    expect(screen.getByText(/stillgelegt/)).toBeTruthy();
  });

  it('zeigt die Statusmeldung, wenn eine vorliegt', () => {
    render(<NodeCard node={node({ statusMessage: 'Update auf Version 2 läuft.' })} />);
    expect(screen.getByText('Update auf Version 2 läuft.')).toBeTruthy();
  });
});
