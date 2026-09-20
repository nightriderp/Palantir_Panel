import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployBanner } from './DeployBanner';

/**
 * Der Balken darf nur erscheinen, wenn der Server wirklich eine **andere**
 * Version meldet. Ein Netzfehler oder eine unbrauchbare Antwort ist keine
 * Nachricht – sonst stünde nach jedem Aussetzer „neue Version verfügbar".
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
  it('meldet eine neuere Version mit beiden Nummern', async () => {
    vi.stubGlobal('fetch', antwortMit({ release: 'v1.27.0' }));

    render(<DeployBanner current="v1.26.0" />);

    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
    expect(screen.getByRole('status').textContent).toContain('v1.27.0');
    expect(screen.getByRole('status').textContent).toContain('v1.26.0');
  });

  it('laesst sich wegklicken und bleibt fuer diese Version weg', async () => {
    /*
     * Ein "nie wieder" gibt es nicht: Eine veraltete Seite bleibt ein Problem,
     * auch wenn man den Hinweis wegwischt. Weggeklickt gilt deshalb genau fuer
     * die eine Version - erscheint spaeter eine noch neuere, meldet er sich.
     */
    vi.stubGlobal('fetch', antwortMit({ release: 'v1.27.0' }));

    render(<DeployBanner current="v1.26.0" />);

    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Später' }));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bleibt still, wenn dieselbe Version läuft', async () => {
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

  it('bleibt still, wenn die Antwort keine Version trägt', async () => {
    vi.stubGlobal('fetch', antwortMit({}));

    render(<DeployBanner current="v1.26.0" />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
