import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNodes as fetchNodesAusAdmin } from './admin';
import { fetchNodes as fetchNodesAusNodes } from './nodes';

/**
 * Eine Definition der Node-Liste für alle Ansichten (Audit frontend-app-09).
 *
 * `fetchNodes` stand zweimal für denselben Endpunkt: in `admin.ts` für
 * Node-Verwaltung und Storage-Explorer, in `nodes.ts` für Dashboard und
 * Node-Ansicht. Beide konnten auseinanderlaufen, ohne dass ein Test es gemerkt
 * hätte. Diese Datei hält fest, dass beide Einstiegspunkte dieselbe Funktion
 * sind und dieselbe Anfrage stellen.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function antwort(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data: [], error: null }),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(antwort());
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', { cookie: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Pfad der Anfrage, unabhängig von der Basis-Adresse. */
function pfade(): string[] {
  return fetchMock.mock.calls.map((call) => new URL(String(call[0]), 'http://x').pathname);
}

describe('fetchNodes', () => {
  it('ist über beide Module dieselbe Funktion', () => {
    expect(fetchNodesAusAdmin).toBe(fetchNodesAusNodes);
  });

  it('stellt für beide bisherigen Aufrufer dieselbe Anfrage', async () => {
    await fetchNodesAusNodes();
    await fetchNodesAusAdmin();

    expect(pfade()).toEqual(['/admin/nodes', '/admin/nodes']);
  });

  it('reicht das Abbruch-Signal durch', async () => {
    const controller = new AbortController();

    await fetchNodesAusAdmin(controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });
});
