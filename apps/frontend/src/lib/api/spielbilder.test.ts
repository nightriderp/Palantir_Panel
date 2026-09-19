import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Adressen der Spielbilder gehören an die API, nicht an das Panel
 * (Betreiber-Meldung 20.09.2026).
 *
 * Das Backend liefert sie als Pfad, weil es seine öffentliche Adresse nicht
 * kennt. Läuft die API unter einer eigenen Subdomain – so wie im Betrieb –,
 * sucht der Browser ein `/api/…` beim Panel und findet nichts. Symbol und
 * Kachelbild blieben deshalb unsichtbar, obwohl beide hochgeladen waren.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function antwortMit(spiele: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data: spiele, error: null }),
  } as unknown as Response;
}

const SPIEL = {
  id: 'minecraft-vanilla',
  name: 'Minecraft',
  iconUrl: '/api/game-types/minecraft-vanilla/images/icon?v=1',
  coverImageUrl: '/api/game-types/minecraft-vanilla/images/cover?v=2',
};

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn().mockResolvedValue(antwortMit([SPIEL]));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', { cookie: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchGameTypes – Bildadressen', () => {
  it('hängt die API-Adresse davor, wenn eine gesetzt ist', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.org');

    const { fetchGameTypes } = await import('./servers');
    const ergebnis = await fetchGameTypes();

    expect(ergebnis.success).toBe(true);

    if (!ergebnis.success) {
      return;
    }

    expect(ergebnis.data[0]?.iconUrl).toBe(
      'https://api.example.org/api/game-types/minecraft-vanilla/images/icon?v=1',
    );
    expect(ergebnis.data[0]?.coverImageUrl).toBe(
      'https://api.example.org/api/game-types/minecraft-vanilla/images/cover?v=2',
    );
  });

  it('lässt den Pfad in Ruhe, wenn API und Panel dieselbe Adresse haben', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');

    const { fetchGameTypes } = await import('./servers');
    const ergebnis = await fetchGameTypes();

    if (!ergebnis.success) {
      throw new Error('Abruf ist fehlgeschlagen');
    }

    expect(ergebnis.data[0]?.iconUrl).toBe('/api/game-types/minecraft-vanilla/images/icon?v=1');
  });

  it('macht aus „kein Bild" nichts anderes', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.org');
    fetchMock.mockResolvedValue(antwortMit([{ ...SPIEL, iconUrl: null, coverImageUrl: null }]));

    const { fetchGameTypes } = await import('./servers');
    const ergebnis = await fetchGameTypes();

    if (!ergebnis.success) {
      throw new Error('Abruf ist fehlgeschlagen');
    }

    expect(ergebnis.data[0]?.iconUrl).toBeNull();
    expect(ergebnis.data[0]?.coverImageUrl).toBeNull();
  });

  it('rührt eine bereits vollständige Adresse nicht an', async () => {
    // Für den Fall, dass das Backend später selbst absolute Adressen liefert.
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.org');
    fetchMock.mockResolvedValue(
      antwortMit([{ ...SPIEL, iconUrl: 'https://cdn.example.org/icon.webp' }]),
    );

    const { fetchGameTypes } = await import('./servers');
    const ergebnis = await fetchGameTypes();

    if (!ergebnis.success) {
      throw new Error('Abruf ist fehlgeschlagen');
    }

    expect(ergebnis.data[0]?.iconUrl).toBe('https://cdn.example.org/icon.webp');
  });
});
