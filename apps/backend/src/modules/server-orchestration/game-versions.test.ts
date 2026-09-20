import { describe, expect, it } from 'vitest';
import {
  MAX_VERSIONS,
  VERSION_CACHE_TTL_MS,
  createMojangVersionCatalogue,
  createNeoforgeVersionCatalogue,
  createPaperVersionCatalogue,
  createVersionCatalogueGroup,
  minecraftVersionAusNeoforge,
} from './game-versions.js';

/**
 * Wählbare Spielversionen (Betreiber-Wunsch vom 19.09.2026).
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
  it('liefert die Versionen mit Adresse und SHA-1, neueste zuerst', async () => {
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

  it('überspringt Versionen ohne Serverdatei, statt die Liste zu verlieren', async () => {
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

  it('kennt keine Versionen für Spiele, die ihre Dateien im Image tragen', async () => {
    const { abrufe, fetchImpl } = attrappe(['26.3']);
    const katalog = createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, fetchImpl });

    expect(await katalog.list('valheim')).toEqual([]);
    expect(await katalog.resolve('valheim', '26.3')).toBeNull();
    expect(abrufe).toEqual([]);
  });

  it('löst eine Version auf und meldet eine unbekannte als null', async () => {
    const { fetchImpl } = attrappe(['26.3', '26.2']);
    const katalog = createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, fetchImpl });

    expect(await katalog.resolve('minecraft-vanilla', '26.2')).toMatchObject({
      url: 'https://daten.invalid/26.2/server.jar',
    });
    expect(await katalog.resolve('minecraft-vanilla', '1.0')).toBeNull();
  });
});

/**
 * PaperMC (Betreiber-Wunsch 20.09.2026: eine Minecraft-Vorlage für alle
 * Versionen und Ausgaben).
 *
 * Wie bei Mojang gegen eine Attrappe – geprüft wird die Auswertung, nicht die
 * Erreichbarkeit von PaperMC.
 */

const PAPER_URL = 'https://paper.invalid/v2/projects/paper';

interface PaperBauVorgabe {
  readonly build: number;
  readonly channel: string;
}

/** Antwortgeber für Projekt und Bauten je Version. */
function paperAttrappe(
  versionen: readonly string[],
  bauten: Readonly<Record<string, readonly PaperBauVorgabe[]>> = {},
) {
  const abrufe: string[] = [];

  const fetchImpl = (async (eingabe: string | URL | Request) => {
    const url = String(eingabe);
    abrufe.push(url);

    if (url === PAPER_URL) {
      return new Response(JSON.stringify({ versions: versionen }), { status: 200 });
    }

    const version = /\/versions\/([^/]+)\/builds$/.exec(url)?.[1];

    if (version === undefined) {
      return new Response('nein', { status: 404 });
    }

    const vorgabe = bauten[decodeURIComponent(version)] ?? [{ build: 7, channel: 'default' }];

    return new Response(
      JSON.stringify({
        builds: vorgabe.map((bau) => ({
          build: bau.build,
          time: '2026-09-01T10:00:00.000Z',
          channel: bau.channel,
          downloads: {
            application: {
              name: `paper-${decodeURIComponent(version)}-${String(bau.build)}.jar`,
              sha256: `${decodeURIComponent(version)}-${String(bau.build)}-sha256`,
            },
          },
        })),
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  return { abrufe, fetchImpl };
}

describe('createPaperVersionCatalogue', () => {
  it('führt die neueste Version zuerst – Paper listet aufsteigend', async () => {
    const { fetchImpl } = paperAttrappe(['1.21.1', '1.21.3', '1.21.4']);
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    const liste = await katalog.list('minecraft-paper');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['1.21.4', '1.21.3', '1.21.1']);
    expect(liste[0]?.latest).toBe(true);
    expect(liste[1]?.latest).toBe(false);
  });

  it('setzt Adresse und Prüfsumme aus dem neuesten fertigen Bau zusammen', async () => {
    const { fetchImpl } = paperAttrappe(['1.21.4'], {
      '1.21.4': [
        { build: 10, channel: 'default' },
        { build: 11, channel: 'default' },
      ],
    });
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    const [eintrag] = await katalog.list('minecraft-paper');

    expect(eintrag?.url).toBe(
      `${PAPER_URL}/versions/1.21.4/builds/11/downloads/paper-1.21.4-11.jar`,
    );
    expect(eintrag?.hash).toBe('1.21.4-11-sha256');
    expect(eintrag?.hashAlgorithm).toBe('sha256');
  });

  it('lässt eine Version aus, die nur Vorabbauten hat', async () => {
    // Ein Server, der ohne Vorwarnung auf `experimental` läuft, ist eine
    // Überraschung, die niemand bestellt hat.
    const { fetchImpl } = paperAttrappe(['1.21.3', '1.21.4'], {
      '1.21.4': [{ build: 1, channel: 'experimental' }],
    });
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    const liste = await katalog.list('minecraft-paper');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['1.21.3']);
  });

  it('bietet höchstens MAX_VERSIONS an und nimmt dafür die neuesten', async () => {
    const alle = Array.from({ length: MAX_VERSIONS + 5 }, (_, index) => `1.20.${String(index)}`);
    const { fetchImpl } = paperAttrappe(alle);
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    const liste = await katalog.list('minecraft-paper');

    expect(liste).toHaveLength(MAX_VERSIONS);
    expect(liste[0]?.id).toBe(`1.20.${String(MAX_VERSIONS + 4)}`);
  });

  it('antwortet auf fremde Spieltypen leer', async () => {
    const { abrufe, fetchImpl } = paperAttrappe(['1.21.4']);
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    expect(await katalog.list('minecraft-vanilla')).toEqual([]);
    expect(await katalog.resolve('valheim', '1.21.4')).toBeNull();
    expect(abrufe).toEqual([]);
  });

  it('löst eine Version auf und kennt eine unbekannte nicht', async () => {
    const { fetchImpl } = paperAttrappe(['1.21.4']);
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    expect((await katalog.resolve('minecraft-paper', '1.21.4'))?.id).toBe('1.21.4');
    expect(await katalog.resolve('minecraft-paper', '1.7.10')).toBeNull();
  });

  it('holt die Liste nur einmal je Frist', async () => {
    let uhr = 1_000;
    const { abrufe, fetchImpl } = paperAttrappe(['1.21.4']);
    const katalog = createPaperVersionCatalogue({
      projectUrl: PAPER_URL,
      fetchImpl,
      now: () => uhr,
    });

    await katalog.list('minecraft-paper');
    const nachErstem = abrufe.length;
    await katalog.list('minecraft-paper');

    expect(abrufe).toHaveLength(nachErstem);

    uhr += VERSION_CACHE_TTL_MS + 1;
    await katalog.list('minecraft-paper');

    expect(abrufe.length).toBeGreaterThan(nachErstem);
  });

  it('behält die alte Liste, wenn PaperMC gerade nicht antwortet', async () => {
    let uhr = 1_000;
    let erreichbar = true;
    const fetchImpl = (async (eingabe: string | URL | Request) => {
      if (!erreichbar) {
        return new Response('weg', { status: 503 });
      }

      const url = String(eingabe);

      if (url === PAPER_URL) {
        return new Response(JSON.stringify({ versions: ['1.21.4'] }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          builds: [
            {
              build: 3,
              channel: 'default',
              downloads: { application: { name: 'paper.jar', sha256: 'summe' } },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const katalog = createPaperVersionCatalogue({
      projectUrl: PAPER_URL,
      fetchImpl,
      now: () => uhr,
    });

    expect(await katalog.list('minecraft-paper')).toHaveLength(1);

    erreichbar = false;
    uhr += VERSION_CACHE_TTL_MS + 1;

    expect(await katalog.list('minecraft-paper')).toHaveLength(1);
  });
});

/**
 * NeoForge liegt als Maven-Ordner, nicht als JSON-Schnittstelle.
 */

const NEOFORGE_URL = 'https://neoforge.invalid/releases/net/neoforged/neoforge';

function neoforgeAttrappe(
  versionen: readonly string[],
  options: { readonly ohneSha256?: boolean; readonly ohneSumme?: readonly string[] } = {},
) {
  const abrufe: string[] = [];
  const ohne = new Set(options.ohneSumme ?? []);

  const fetchImpl = (async (eingabe: string | URL | Request) => {
    const url = String(eingabe);
    abrufe.push(url);

    if (url.endsWith('/maven-metadata.xml')) {
      return new Response(
        `<metadata><versioning><versions>${versionen
          .map((version) => `<version>${version}</version>`)
          .join('')}</versions></versioning></metadata>`,
        { status: 200 },
      );
    }

    const treffer = /\/([^/]+)\/neoforge-[^/]+-installer\.jar\.(sha256|sha1)$/.exec(url);

    if (treffer === null) {
      return new Response('nein', { status: 404 });
    }

    const [, version, verfahren] = treffer as unknown as [string, string, string];

    if (ohne.has(version)) {
      return new Response('nein', { status: 404 });
    }

    if (verfahren === 'sha256' && options.ohneSha256 === true) {
      return new Response('nein', { status: 404 });
    }

    const laenge = verfahren === 'sha256' ? 64 : 40;

    return new Response(`${'a'.repeat(laenge)}  neoforge-${version}-installer.jar\n`, {
      status: 200,
    });
  }) as typeof fetch;

  return { abrufe, fetchImpl };
}

describe('minecraftVersionAusNeoforge', () => {
  it('liest die Spielversion aus der NeoForge-Kennung', () => {
    expect(minecraftVersionAusNeoforge('21.4.96')).toBe('1.21.4');
    expect(minecraftVersionAusNeoforge('20.6.119')).toBe('1.20.6');
  });

  it('gibt null, wo das Schema nicht passt', () => {
    // Lieber nichts anbieten als eine Spielversion behaupten.
    expect(minecraftVersionAusNeoforge('irgendwas')).toBeNull();
    expect(minecraftVersionAusNeoforge('21')).toBeNull();
  });
});

describe('createNeoforgeVersionCatalogue', () => {
  it('bietet Minecraft-Versionen an, nicht NeoForge-Versionen', async () => {
    const { fetchImpl } = neoforgeAttrappe(['20.6.119', '21.4.96']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const liste = await katalog.list('minecraft-neoforge');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['1.21.4', '1.20.6']);
    expect(liste[0]?.loaderVersion).toBe('21.4.96');
  });

  it('nimmt je Spielversion den neuesten Bau', async () => {
    const { fetchImpl } = neoforgeAttrappe(['21.4.10', '21.4.96']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const liste = await katalog.list('minecraft-neoforge');

    expect(liste).toHaveLength(1);
    expect(liste[0]?.loaderVersion).toBe('21.4.96');
    expect(liste[0]?.url).toBe(`${NEOFORGE_URL}/21.4.96/neoforge-21.4.96-installer.jar`);
  });

  it('lässt Vorabversionen draußen', async () => {
    const { fetchImpl } = neoforgeAttrappe(['21.4.96', '21.5.1-beta']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const liste = await katalog.list('minecraft-neoforge');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['1.21.4']);
  });

  it('nimmt sha256, wenn es das gibt', async () => {
    const { fetchImpl } = neoforgeAttrappe(['21.4.96']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const [eintrag] = await katalog.list('minecraft-neoforge');

    expect(eintrag?.hashAlgorithm).toBe('sha256');
    expect(eintrag?.hash).toHaveLength(64);
  });

  it('fällt auf sha1 zurück, wo der Ordner kein sha256 führt', async () => {
    const { fetchImpl } = neoforgeAttrappe(['21.4.96'], { ohneSha256: true });
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const [eintrag] = await katalog.list('minecraft-neoforge');

    expect(eintrag?.hashAlgorithm).toBe('sha1');
    expect(eintrag?.hash).toHaveLength(40);
  });

  it('lässt eine Version ohne Prüfsumme aus', async () => {
    // Ohne Prüfsumme könnte das Image nicht verwerfen, was nicht dazu passt.
    const { fetchImpl } = neoforgeAttrappe(['20.6.119', '21.4.96'], { ohneSumme: ['21.4.96'] });
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const liste = await katalog.list('minecraft-neoforge');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['1.20.6']);
  });

  it('antwortet auf fremde Spieltypen leer', async () => {
    const { abrufe, fetchImpl } = neoforgeAttrappe(['21.4.96']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    expect(await katalog.list('minecraft-paper')).toEqual([]);
    expect(abrufe).toEqual([]);
  });
});

describe('createVersionCatalogueGroup', () => {
  it('fragt den Katalog, der den Spieltyp kennt', async () => {
    const gruppe = createVersionCatalogueGroup([
      createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, ...attrappe(['1.21.4']) }),
      createPaperVersionCatalogue({ projectUrl: PAPER_URL, ...paperAttrappe(['1.21.3']) }),
      createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, ...neoforgeAttrappe(['21.4.96']) }),
    ]);

    expect((await gruppe.list('minecraft-vanilla'))[0]?.id).toBe('1.21.4');
    expect((await gruppe.list('minecraft-paper'))[0]?.id).toBe('1.21.3');
    expect((await gruppe.list('minecraft-neoforge'))[0]?.id).toBe('1.21.4');
  });

  it('bleibt leer, wo kein Katalog zuständig ist', async () => {
    const gruppe = createVersionCatalogueGroup([
      createPaperVersionCatalogue({ projectUrl: PAPER_URL, ...paperAttrappe(['1.21.3']) }),
    ]);

    expect(await gruppe.list('valheim')).toEqual([]);
    expect(await gruppe.resolve('valheim', '1.0')).toBeNull();
  });

  it('löst über den zuständigen Katalog auf', async () => {
    const gruppe = createVersionCatalogueGroup([
      createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, ...attrappe(['1.21.4']) }),
      createPaperVersionCatalogue({ projectUrl: PAPER_URL, ...paperAttrappe(['1.21.3']) }),
    ]);

    expect((await gruppe.resolve('minecraft-paper', '1.21.3'))?.hashAlgorithm).toBe('sha256');
    expect((await gruppe.resolve('minecraft-vanilla', '1.21.4'))?.hashAlgorithm).toBe('sha1');
  });
});
