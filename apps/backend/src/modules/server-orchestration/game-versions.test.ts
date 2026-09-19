import { describe, expect, it } from 'vitest';
import {
  MAX_VERSIONS,
  VERSION_CACHE_TTL_MS,
  createMojangVersionCatalogue,
} from './game-versions.js';

/**
 * Wählbare Spielfassungen (Betreiber-Wunsch vom 19.09.2026).
 *
 * Geprüft wird gegen eine Attrappe des Verzeichnisses – kein Abruf nach
 * draußen im Test (Entwicklungsregeln §4): Was hier zählt, ist die Auswertung,
 * nicht Mojangs Erreichbarkeit.
 */

const MANIFEST_URL = 'https://verzeichnis.invalid/manifest.json';

function manifest(ids: readonly string[], neueste = ids[0]) {
  return {
    latest: { release: neueste },
    versions: ids.map((id, index) => ({
      id,
      type: 'release',
      url: `https://verzeichnis.invalid/${id}.json`,
      releaseTime: `2026-0${(index % 9) + 1}-01T10:00:00+00:00`,
    })),
  };
}

function detail(id: string) {
  return {
    downloads: {
      server: { url: `https://daten.invalid/${id}/server.jar`, sha1: `${id}-sha1` },
    },
  };
}

/** Antwortgeber, der Verzeichnis und Datensätze bedient und Abrufe zählt. */
function attrappe(ids: readonly string[], options: { ohneServerJar?: readonly string[] } = {}) {
  const abrufe: string[] = [];
  const ohne = new Set(options.ohneServerJar ?? []);

  const fetchImpl = (async (eingabe: string | URL | Request) => {
    const url = String(eingabe);
    abrufe.push(url);

    if (url === MANIFEST_URL) {
      return new Response(JSON.stringify(manifest(ids)), { status: 200 });
    }

    const id = url.split('/').pop()?.replace('.json', '') ?? '';

    if (ohne.has(id)) {
      return new Response(JSON.stringify({ downloads: {} }), { status: 200 });
    }

    return new Response(JSON.stringify(detail(id)), { status: 200 });
  }) as typeof fetch;

  return { abrufe, fetchImpl };
}

describe('createMojangVersionCatalogue', () => {
  it('liefert die Fassungen mit Adresse und SHA-1, neueste zuerst', async () => {
    const { fetchImpl } = attrappe(['26.3', '26.2', '26.1']);
    const katalog = createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, fetchImpl });

    const liste = await katalog.list('minecraft-vanilla');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['26.3', '26.2', '26.1']);
    expect(liste[0]).toMatchObject({
      latest: true,
      url: 'https://daten.invalid/26.3/server.jar',
      hash: '26.3-sha1',
      hashAlgorithm: 'sha1',
    });
    expect(liste[1]?.latest).toBe(false);
  });

  it('bietet höchstens zwanzig an – eine Liste mit hundert ist keine Auswahl', async () => {
    const ids = Array.from({ length: 40 }, (_, index) => `26.${String(index)}`);
    const { fetchImpl } = attrappe(ids);
    const katalog = createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, fetchImpl });

    expect(await katalog.list('minecraft-vanilla')).toHaveLength(MAX_VERSIONS);
  });

  it('überspringt Fassungen ohne Serverdatei, statt die Liste zu verlieren', async () => {
    const { fetchImpl } = attrappe(['26.3', '26.2'], { ohneServerJar: ['26.2'] });
    const katalog = createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, fetchImpl });

    expect((await katalog.list('minecraft-vanilla')).map((e) => e.id)).toEqual(['26.3']);
  });

  it('holt das Verzeichnis nur einmal je Stunde', async () => {
    const { abrufe, fetchImpl } = attrappe(['26.3']);
    let jetzt = 1_000;
    const katalog = createMojangVersionCatalogue({
      manifestUrl: MANIFEST_URL,
      fetchImpl,
      now: () => jetzt,
    });

    await katalog.list('minecraft-vanilla');
    await katalog.list('minecraft-vanilla');
    const nachZwei = abrufe.length;

    jetzt += VERSION_CACHE_TTL_MS + 1;
    await katalog.list('minecraft-vanilla');

    expect(nachZwei).toBe(2); // Verzeichnis + ein Datensatz
    expect(abrufe.length).toBeGreaterThan(nachZwei);
  });

  it('behält die alte Liste, wenn der Hersteller nicht antwortet', async () => {
    let antwortet = true;
    let jetzt = 1_000;
    const fetchImpl = (async (eingabe: string | URL | Request) => {
      if (!antwortet) {
        throw new Error('Netz weg');
      }

      const url = String(eingabe);

      return url === MANIFEST_URL
        ? new Response(JSON.stringify(manifest(['26.3'])), { status: 200 })
        : new Response(JSON.stringify(detail('26.3')), { status: 200 });
    }) as typeof fetch;

    const katalog = createMojangVersionCatalogue({
      manifestUrl: MANIFEST_URL,
      fetchImpl,
      now: () => jetzt,
    });

    expect(await katalog.list('minecraft-vanilla')).toHaveLength(1);

    antwortet = false;
    jetzt += VERSION_CACHE_TTL_MS + 1;

    // Minuten alt ist besser als leer: Die Auswahl bleibt bedienbar.
    expect(await katalog.list('minecraft-vanilla')).toHaveLength(1);
  });

  it('kennt keine Fassungen für Spiele, die ihre Dateien im Image tragen', async () => {
    const { abrufe, fetchImpl } = attrappe(['26.3']);
    const katalog = createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, fetchImpl });

    expect(await katalog.list('valheim')).toEqual([]);
    expect(await katalog.resolve('valheim', '26.3')).toBeNull();
    expect(abrufe).toEqual([]);
  });

  it('löst eine Fassung auf und meldet eine unbekannte als null', async () => {
    const { fetchImpl } = attrappe(['26.3', '26.2']);
    const katalog = createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, fetchImpl });

    expect(await katalog.resolve('minecraft-vanilla', '26.2')).toMatchObject({
      url: 'https://daten.invalid/26.2/server.jar',
    });
    expect(await katalog.resolve('minecraft-vanilla', '1.0')).toBeNull();
  });
});
