import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sitzungserneuerung nach abgelaufenem Zugriffs-Token (Pflichtenheft §7).
 *
 * Das Zugriffs-Token gilt 15 Minuten, der Refresh-Token 30 Tage. Ohne den
 * Tausch dazwischen endete jede Sitzung nach einer Viertelstunde, obwohl sie
 * eigentlich noch gilt. Geprüft wird hier der Ablauf, nicht das Backend: Wann
 * wird erneuert, wie oft, und was passiert, wenn der Tausch scheitert.
 *
 * Die Module werden je Test frisch geladen (`resetModules`), weil die Bündelung
 * paralleler Versuche im Modulzustand liegt.
 */

const ENVELOPE_OK = { success: true, data: { wert: 1 }, error: null };

function envelopeFehler(code: string) {
  return { success: false, data: null, error: { code, message: 'Fehler' } };
}

/** Antwort mit JSON-Rumpf, wie `fetch` sie liefert. */
function antwort(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

async function ladeClient() {
  vi.resetModules();
  return import('./client');
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // `refreshSession()` tut auf dem Server nichts – für die Tests muss ein
  // Dokument vorhanden sein.
  vi.stubGlobal('document', { cookie: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Pfad der jeweiligen Anfrage, unabhängig von der Basis-Adresse. */
function pfade(): string[] {
  return fetchMock.mock.calls.map((call) => new URL(String(call[0]), 'http://x').pathname);
}

describe('apiRequest: abgelaufenes Zugriffs-Token', () => {
  it('erneuert die Sitzung und wiederholt den Aufruf', async () => {
    const { apiRequest } = await ladeClient();

    fetchMock
      .mockResolvedValueOnce(antwort(envelopeFehler('AUTH_REQUIRED'), 401))
      .mockResolvedValueOnce(antwort({ success: true, data: null, error: null }))
      .mockResolvedValueOnce(antwort(ENVELOPE_OK));

    const ergebnis = await apiRequest<{ wert: number }>('/api/servers');

    expect(ergebnis.success).toBe(true);
    expect(pfade()).toEqual(['/api/servers', '/auth/refresh', '/api/servers']);
  });

  it('gibt den ursprünglichen Fehler zurück, wenn der Tausch scheitert', async () => {
    const { apiRequest } = await ladeClient();

    fetchMock
      .mockResolvedValueOnce(antwort(envelopeFehler('AUTH_REQUIRED'), 401))
      .mockResolvedValueOnce(antwort(envelopeFehler('AUTH_SESSION_EXPIRED'), 401));

    const ergebnis = await apiRequest('/api/servers');

    expect(ergebnis.success).toBe(false);
    if (!ergebnis.success) expect(ergebnis.error.code).toBe('AUTH_REQUIRED');
    // Kein dritter Aufruf: nach einem gescheiterten Tausch wird nicht wiederholt.
    expect(pfade()).toEqual(['/api/servers', '/auth/refresh']);
  });

  it('versucht es nur ein einziges Mal', async () => {
    const { apiRequest } = await ladeClient();

    fetchMock
      .mockResolvedValueOnce(antwort(envelopeFehler('AUTH_REQUIRED'), 401))
      .mockResolvedValueOnce(antwort({ success: true, data: null, error: null }))
      .mockResolvedValueOnce(antwort(envelopeFehler('AUTH_REQUIRED'), 401));

    const ergebnis = await apiRequest('/api/servers');

    expect(ergebnis.success).toBe(false);
    expect(pfade()).toEqual(['/api/servers', '/auth/refresh', '/api/servers']);
  });

  it('erneuert nicht bei fehlender Berechtigung', async () => {
    const { apiRequest } = await ladeClient();

    fetchMock.mockResolvedValueOnce(antwort(envelopeFehler('PERMISSION_DENIED'), 403));

    await apiRequest('/api/servers');

    expect(pfade()).toEqual(['/api/servers']);
  });

  it('erneuert nicht, wenn der Aufruf abgebrochen wurde', async () => {
    const { apiRequest } = await ladeClient();
    const controller = new AbortController();
    controller.abort();

    fetchMock.mockResolvedValueOnce(antwort(envelopeFehler('AUTH_REQUIRED'), 401));

    await apiRequest('/api/servers', { signal: controller.signal });

    expect(pfade()).toEqual(['/api/servers']);
  });

  it('bündelt parallele Erneuerungen zu einem einzigen Tausch', async () => {
    const { apiRequest } = await ladeClient();

    // Der Refresh-Token rotiert bei jedem Tausch: ein zweiter Tausch mit dem
    // bereits verbrauchten Token würde die Sitzung beenden.
    fetchMock.mockImplementation((eingabe: unknown) => {
      const pfad = new URL(String(eingabe), 'http://x').pathname;

      if (pfad === '/auth/refresh') {
        return Promise.resolve(antwort({ success: true, data: null, error: null }));
      }

      const erster = fetchMock.mock.calls.filter(
        (call) => new URL(String(call[0]), 'http://x').pathname === pfad,
      ).length;

      return Promise.resolve(
        erster === 1 ? antwort(envelopeFehler('AUTH_REQUIRED'), 401) : antwort(ENVELOPE_OK),
      );
    });

    await Promise.all([apiRequest('/api/a'), apiRequest('/api/b'), apiRequest('/api/c')]);

    expect(pfade().filter((pfad) => pfad === '/auth/refresh')).toHaveLength(1);
  });
});
