import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployBanner } from './DeployBanner';

/**
 * Der Balken darf nur erscheinen, wenn der Server wirklich eine **andere**
 * Fassung meldet. Ein Netzfehler oder eine unbrauchbare Antwort ist keine
 * Nachricht – sonst stünde nach jedem Aussetzer „neue Fassung verfügbar".
 */
function antwortMit(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeployBanner', () => {
  it('meldet eine neuere Fassung mit beiden Nummern', async () => {
    vi.stubGlobal('fetch', antwortMit({ release: 'v1.27.0' }));

    render(<DeployBanner current="v1.26.0" />);

    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
    expect(screen.getByRole('status').textContent).toContain('v1.27.0');
    expect(screen.getByRole('status').textContent).toContain('v1.26.0');
  });

  it('bleibt still, wenn dieselbe Fassung läuft', async () => {
    vi.stubGlobal('fetch', antwortMit({ release: 'v1.26.0' }));

    render(<DeployBanner current="v1.26.0" />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bleibt still, wenn der Abruf scheitert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    );

    render(<DeployBanner current="v1.26.0" />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bleibt still, wenn die Antwort keine Fassung trägt', async () => {
    vi.stubGlobal('fetch', antwortMit({}));

    render(<DeployBanner current="v1.26.0" />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
