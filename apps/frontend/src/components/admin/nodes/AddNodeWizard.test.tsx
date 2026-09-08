import { type HostNodeDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { AddNodeWizard } from './AddNodeWizard';

/**
 * Warnung beim Anlegen einer weiteren Node (Fundpunkt 160).
 *
 * Ab zwei eingetragenen Nodes lehnt das Backend das gemeinsame `AGENT_TOKEN`
 * ab; eine bestehende Node ohne eigenes Token fällt dann beim nächsten
 * Verbindungsaufbau heraus. Der Wizard warnt davor und lässt bestätigen – er
 * blockiert das Anlegen aber nicht: Die umgekehrte Reihenfolge kann gewollt
 * sein.
 */

const api = vi.hoisted(() => ({ createNode: vi.fn() }));

vi.mock('@/lib/api/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createNode: api.createNode,
}));

function node(overrides: Partial<HostNodeDto> = {}): HostNodeDto {
  const total = { ramMb: 16_384, cpuCores: 8, diskMb: 512_000 };

  return {
    id: 'node-1',
    name: 'Wohnzimmer-PC',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: { total, allocated: { ramMb: 0, cpuCores: 0, diskMb: 0 }, available: total },
    usage: null,
    serverCount: 0,
    lastSeenAt: null,
    hasAgentToken: false,
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: { canView: true, canManage: true, canManageStorage: true },
    ...overrides,
  };
}

function zeige(existingNodes: HostNodeDto[]) {
  render(
    <ToastProvider>
      <AddNodeWizard
        open
        onClose={() => undefined}
        onCreated={() => undefined}
        existingNodes={existingNodes}
      />
    </ToastProvider>,
  );
}

function anlegenSchaltflaeche(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Node anlegen' }) as HTMLButtonElement;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AddNodeWizard – zweite Node bei gemeinsamem Agent-Token', () => {
  it('warnt, wenn eine bestehende Node kein eigenes Agent-Token hat', () => {
    zeige([node({ hasAgentToken: false })]);

    expect(screen.getByText(/hängt noch am gemeinsamen AGENT_TOKEN/)).toBeTruthy();
    expect(screen.getByText(/\/opt\/palantir\/\.env/)).toBeTruthy();
  });

  it('warnt nicht, wenn noch gar keine Node besteht', () => {
    zeige([]);

    expect(screen.queryByText(/gemeinsamen AGENT_TOKEN/)).toBeNull();
    expect(anlegenSchaltflaeche().disabled).toBe(false);
  });

  it('warnt nicht, wenn alle bestehenden Nodes ein eigenes Token haben', () => {
    zeige([node({ hasAgentToken: true })]);

    expect(screen.queryByText(/gemeinsamen AGENT_TOKEN/)).toBeNull();
    expect(anlegenSchaltflaeche().disabled).toBe(false);
  });

  it('sperrt „Node anlegen“, bis die Warnung bestätigt ist – und blockiert danach nicht', async () => {
    api.createNode.mockResolvedValue({
      success: true,
      data: node({ id: 'node-2', name: 'Keller' }),
    });
    zeige([node({ hasAgentToken: false })]);

    expect(anlegenSchaltflaeche().disabled).toBe(true);

    fireEvent.click(screen.getByRole('switch', { name: 'Verstanden – trotzdem anlegen' }));

    expect(anlegenSchaltflaeche().disabled).toBe(false);

    fireEvent.click(anlegenSchaltflaeche());

    await waitFor(() => expect(api.createNode).toHaveBeenCalledTimes(1));
  });

  it('nennt in der Anleitung danach keinen Rückfall auf das geteilte Token mehr', async () => {
    api.createNode.mockResolvedValue({
      success: true,
      data: node({ id: 'node-2', name: 'Keller' }),
    });
    zeige([node({ hasAgentToken: false })]);

    fireEvent.click(screen.getByRole('switch', { name: 'Verstanden – trotzdem anlegen' }));
    fireEvent.click(anlegenSchaltflaeche());

    expect(await screen.findByText(/Ein Rückfall auf das geteilte AGENT_TOKEN/)).toBeTruthy();
  });
});
