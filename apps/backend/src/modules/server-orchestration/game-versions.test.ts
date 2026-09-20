import { describe, expect, it } from 'vitest';
import {
  MAX_VERSIONS,
  VERSION_CACHE_TTL_MS,
  createFabricVersionCatalogue,
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
 * Die Attrappe bildet die **v3-Schnittstelle** nach, weil das Image seine Jar
 * schon von dort holt (`images/game/minecraft/Dockerfile`): Versionen nach
 * Reihen geordnet, Bauten mit `id`/`channel: 'STABLE'` und einer fertigen
 * Adresse unter `downloads['server:default']`.
 */

const PAPER_URL = 'https://paper.invalid/v3/projects/paper';

interface PaperBauVorgabe {
  readonly id: number;
  readonly channel: string;
}

/** Antwortgeber für Projekt und Bauten je Version. */
function paperAttrappe(
  reihen: Readonly<Record<string, readonly string[]>>,
  bauten: Readonly<Record<string, readonly PaperBauVorgabe[]>> = {},
) {
  const abrufe: string[] = [];

  const fetchImpl = (async (eingabe: string | URL | Request) => {
    const url = String(eingabe);
    abrufe.push(url);

    if (url === PAPER_URL) {
      return new Response(JSON.stringify({ project: { id: 'paper' }, versions: reihen }), {
        status: 200,
      });
    }

    const roh = /\/versions\/([^/]+)\/builds$/.exec(url)?.[1];

    if (roh === undefined) {
      return new Response('nein', { status: 404 });
    }

    const version = decodeURIComponent(roh);
    const vorgabe = bauten[version] ?? [{ id: 7, channel: 'STABLE' }];

    return new Response(
      JSON.stringify(
        vorgabe.map((bau) => ({
          id: bau.id,
          time: '2026-09-01T10:00:00Z',
          channel: bau.channel,
          downloads: {
            'server:default': {
              name: `paper-${version}-${String(bau.id)}.jar`,
              size: 64_521_721,
              checksums: { sha256: `${version}-${String(bau.id)}-sha256` },
              url: `https://fill-data.invalid/v1/objects/${version}-${String(bau.id)}/paper.jar`,
            },
          },
        })),
      ),
      { status: 200 },
    );
  }) as typeof fetch;

  return { abrufe, fetchImpl };
}

describe('createPaperVersionCatalogue', () => {
  it('nimmt die Reihenfolge des Herstellers, quer über die Reihen', async () => {
    const { fetchImpl } = paperAttrappe({
      '26.3': ['26.3'],
      '26.2': ['26.2'],
      '1.21': ['1.21.11', '1.21.10'],
    });
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    const liste = await katalog.list('minecraft-paper');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['26.3', '26.2', '1.21.11', '1.21.10']);
    expect(liste[0]?.latest).toBe(true);
    expect(liste[1]?.latest).toBe(false);
  });

  it('lässt Vorabversionen draußen', async () => {
    // `26.3-rc-3` steht im echten Verzeichnis neben `26.3`.
    const { fetchImpl } = paperAttrappe({ '26.3': ['26.3', '26.3-rc-3'] });
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    expect((await katalog.list('minecraft-paper')).map((eintrag) => eintrag.id)).toEqual(['26.3']);
  });

  it('nimmt Adresse und Prüfsumme aus dem höchsten fertigen Bau', async () => {
    const { fetchImpl } = paperAttrappe(
      { '26.2': ['26.2'] },
      {
        '26.2': [
          { id: 126, channel: 'STABLE' },
          { id: 121, channel: 'STABLE' },
        ],
      },
    );
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    const [eintrag] = await katalog.list('minecraft-paper');

    // Höchste Nummer, nicht letzter Eintrag im Feld.
    expect(eintrag?.url).toBe('https://fill-data.invalid/v1/objects/26.2-126/paper.jar');
    expect(eintrag?.hash).toBe('26.2-126-sha256');
    expect(eintrag?.hashAlgorithm).toBe('sha256');
    expect(eintrag?.releasedAt).toBe('2026-09-01T10:00:00Z');
  });

  it('lässt eine Version aus, die nur Vorabbauten hat', async () => {
    // Ein Server, der ohne Vorwarnung auf einem Vorabbau läuft, ist eine
    // Überraschung, die niemand bestellt hat.
    const { fetchImpl } = paperAttrappe(
      { '26.3': ['26.3'], '26.2': ['26.2'] },
      { '26.3': [{ id: 1, channel: 'ALPHA' }] },
    );
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    expect((await katalog.list('minecraft-paper')).map((eintrag) => eintrag.id)).toEqual(['26.2']);
  });

  it('bietet höchstens MAX_VERSIONS an und nimmt dafuer die vordersten', async () => {
    const alle = Array.from({ length: MAX_VERSIONS + 5 }, (_, index) => `26.${String(index)}`);
    const { fetchImpl } = paperAttrappe({ '26': alle });
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    const liste = await katalog.list('minecraft-paper');

    expect(liste).toHaveLength(MAX_VERSIONS);
    expect(liste[0]?.id).toBe('26.0');
  });

  it('antwortet auf fremde Spieltypen leer, ohne einen Abruf', async () => {
    const { abrufe, fetchImpl } = paperAttrappe({ '26.2': ['26.2'] });
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    expect(await katalog.list('minecraft-vanilla')).toEqual([]);
    expect(await katalog.resolve('valheim', '26.2')).toBeNull();
    expect(abrufe).toEqual([]);
  });

  it('löst eine Version auf und kennt eine unbekannte nicht', async () => {
    const { fetchImpl } = paperAttrappe({ '26.2': ['26.2'] });
    const katalog = createPaperVersionCatalogue({ projectUrl: PAPER_URL, fetchImpl });

    expect((await katalog.resolve('minecraft-paper', '26.2'))?.id).toBe('26.2');
    expect(await katalog.resolve('minecraft-paper', '1.7.10')).toBeNull();
  });

  it('holt die Liste nur einmal je Frist', async () => {
    let uhr = 1_000;
    const { abrufe, fetchImpl } = paperAttrappe({ '26.2': ['26.2'] });
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
    const echt = paperAttrappe({ '26.2': ['26.2'] });
    const fetchImpl = (async (eingabe: string | URL | Request) =>
      erreichbar
        ? echt.fetchImpl(eingabe as string)
        : new Response('weg', { status: 503 })) as typeof fetch;

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
 *
 * Die Versionen im Test sind die echten aus dem Verzeichnis – samt der
 * Unordnung dort: `26.1.2.109` steht vor `26.2.0.86`, und `21.1.251` aus der
 * alten Zählung liegt ganz am Ende.
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

    const version = treffer[1] as string;
    const verfahren = treffer[2] as string;

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
  it('liest die neue, vierstellige Zählung', () => {
    // `26.2.0.86` gehört zu Minecraft `26.2` – so steht es im Dockerfile des
    // Minecraft-Images.
    expect(minecraftVersionAusNeoforge('26.2.0.86')).toBe('26.2');
    expect(minecraftVersionAusNeoforge('26.1.2.109')).toBe('26.1');
  });

  it('liest die alte, dreistellige Zählung', () => {
    // Vor der Umstellung trug NeoForge die beiden hinteren Stellen von `1.21.1`.
    expect(minecraftVersionAusNeoforge('21.1.251')).toBe('1.21.1');
  });

  it('gibt null, wo keines der beiden Schemata passt', () => {
    // Lieber nichts anbieten als eine Spielversion behaupten.
    expect(minecraftVersionAusNeoforge('irgendwas')).toBeNull();
    expect(minecraftVersionAusNeoforge('26')).toBeNull();
    expect(minecraftVersionAusNeoforge('26.2.x.86')).toBeNull();
  });
});

describe('createNeoforgeVersionCatalogue', () => {
  it('bietet Minecraft-Versionen an, nicht NeoForge-Versionen', async () => {
    const { fetchImpl } = neoforgeAttrappe(['26.1.2.109', '26.2.0.86', '21.1.251']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const liste = await katalog.list('minecraft-neoforge');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['26.2', '26.1', '1.21.1']);
    expect(liste[0]?.loaderVersion).toBe('26.2.0.86');
  });

  it('nimmt je Spielversion den höchsten Bau, nicht den letzten im Ordner', async () => {
    // Der Ordner ist nicht nach Grösse geordnet.
    const { fetchImpl } = neoforgeAttrappe(['26.2.0.88', '26.2.0.86', '26.2.0.87']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const liste = await katalog.list('minecraft-neoforge');

    expect(liste).toHaveLength(1);
    expect(liste[0]?.loaderVersion).toBe('26.2.0.88');
    expect(liste[0]?.url).toBe(`${NEOFORGE_URL}/26.2.0.88/neoforge-26.2.0.88-installer.jar`);
  });

  it('ordnet die Spielversionen der Größe nach, nicht als Zeichenkette', async () => {
    const { fetchImpl } = neoforgeAttrappe(['26.10.0.1', '26.2.0.86']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    expect((await katalog.list('minecraft-neoforge')).map((eintrag) => eintrag.id)).toEqual([
      '26.10',
      '26.2',
    ]);
  });

  it('lässt Vorabversionen draußen', async () => {
    const { fetchImpl } = neoforgeAttrappe(['26.2.0.86', '26.3.0.7-beta']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    expect((await katalog.list('minecraft-neoforge')).map((eintrag) => eintrag.id)).toEqual([
      '26.2',
    ]);
  });

  it('nimmt sha256, wenn es das gibt', async () => {
    const { fetchImpl } = neoforgeAttrappe(['26.2.0.86']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const [eintrag] = await katalog.list('minecraft-neoforge');

    expect(eintrag?.hashAlgorithm).toBe('sha256');
    expect(eintrag?.hash).toHaveLength(64);
  });

  it('fällt auf sha1 zurück, wo der Ordner kein sha256 führt', async () => {
    const { fetchImpl } = neoforgeAttrappe(['26.2.0.86'], { ohneSha256: true });
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    const [eintrag] = await katalog.list('minecraft-neoforge');

    expect(eintrag?.hashAlgorithm).toBe('sha1');
    expect(eintrag?.hash).toHaveLength(40);
  });

  it('lässt eine Version ohne Prüfsumme aus', async () => {
    // Ohne Prüfsumme könnte das Image nicht verwerfen, was nicht dazu passt.
    const { fetchImpl } = neoforgeAttrappe(['26.1.2.109', '26.2.0.86'], {
      ohneSumme: ['26.2.0.86'],
    });
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    expect((await katalog.list('minecraft-neoforge')).map((eintrag) => eintrag.id)).toEqual([
      '26.1',
    ]);
  });

  it('antwortet auf fremde Spieltypen leer, ohne einen Abruf', async () => {
    const { abrufe, fetchImpl } = neoforgeAttrappe(['26.2.0.86']);
    const katalog = createNeoforgeVersionCatalogue({ mavenUrl: NEOFORGE_URL, fetchImpl });

    expect(await katalog.list('minecraft-paper')).toEqual([]);
    expect(abrufe).toEqual([]);
  });
});

describe('createVersionCatalogueGroup', () => {
  it('fragt den Katalog, der den Spieltyp kennt', async () => {
    const gruppe = createVersionCatalogueGroup([
      createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, ...attrappe(['26.2']) }),
      createPaperVersionCatalogue({
        projectUrl: PAPER_URL,
        ...paperAttrappe({ '26.3': ['26.3'] }),
      }),
      createNeoforgeVersionCatalogue({
        mavenUrl: NEOFORGE_URL,
        ...neoforgeAttrappe(['26.2.0.86']),
      }),
    ]);

    expect((await gruppe.list('minecraft-vanilla'))[0]?.id).toBe('26.2');
    expect((await gruppe.list('minecraft-paper'))[0]?.id).toBe('26.3');
    expect((await gruppe.list('minecraft-neoforge'))[0]?.id).toBe('26.2');
  });

  it('bleibt leer, wo kein Katalog zuständig ist', async () => {
    const gruppe = createVersionCatalogueGroup([
      createPaperVersionCatalogue({
        projectUrl: PAPER_URL,
        ...paperAttrappe({ '26.2': ['26.2'] }),
      }),
    ]);

    expect(await gruppe.list('valheim')).toEqual([]);
    expect(await gruppe.resolve('valheim', '1.0')).toBeNull();
  });

  it('löst über den zuständigen Katalog auf', async () => {
    const gruppe = createVersionCatalogueGroup([
      createMojangVersionCatalogue({ manifestUrl: MANIFEST_URL, ...attrappe(['26.2']) }),
      createPaperVersionCatalogue({
        projectUrl: PAPER_URL,
        ...paperAttrappe({ '26.3': ['26.3'] }),
      }),
    ]);

    expect((await gruppe.resolve('minecraft-paper', '26.3'))?.hashAlgorithm).toBe('sha256');
    expect((await gruppe.resolve('minecraft-vanilla', '26.2'))?.hashAlgorithm).toBe('sha1');
  });
});

/**
 * FabricMC nennt keine Prüfsumme – der Katalog rechnet sie.
 *
 * Die Attrappe bildet die drei Listen nach (`game`, `loader`, `installer`) und
 * liefert unter der zusammengesetzten Adresse eine Datei. Geprüft wird, dass
 * die Liste **keinen** Abruf der Datei auslöst und die Wahl genau einen.
 */

const FABRIC_URL = 'https://fabric.invalid/v2';

function fabricAttrappe(
  spiele: readonly { version: string; stable: boolean }[],
  options: { readonly ohneDatei?: boolean; readonly inhalt?: string } = {},
) {
  const abrufe: string[] = [];

  const fetchImpl = (async (eingabe: string | URL | Request) => {
    const url = String(eingabe);
    abrufe.push(url);

    if (url === `${FABRIC_URL}/versions/game`) {
      return new Response(JSON.stringify(spiele), { status: 200 });
    }

    if (url === `${FABRIC_URL}/versions/loader`) {
      return new Response(
        JSON.stringify([
          { version: '0.19.6', stable: false },
          { version: '0.19.5', stable: true },
        ]),
        { status: 200 },
      );
    }

    if (url === `${FABRIC_URL}/versions/installer`) {
      return new Response(
        JSON.stringify([
          { version: '1.1.3', stable: false },
          { version: '1.1.2', stable: true },
        ]),
        { status: 200 },
      );
    }

    if (url.endsWith('/server/jar')) {
      return options.ohneDatei === true
        ? new Response('weg', { status: 503 })
        : new Response(options.inhalt ?? 'eine Starter-Jar', { status: 200 });
    }

    return new Response('nein', { status: 404 });
  }) as typeof fetch;

  return { abrufe, fetchImpl };
}

const STABIL = [
  { version: '26.3', stable: true },
  { version: '26.3-rc-3', stable: false },
  { version: '26.2', stable: true },
];

describe('createFabricVersionCatalogue', () => {
  it('nimmt nur, was Fabric selbst stabil nennt', async () => {
    // Anders als bei Paper und NeoForge muss das nicht am Namen abgelesen
    // werden - die Schnittstelle sagt es.
    const { fetchImpl } = fabricAttrappe(STABIL);
    const katalog = createFabricVersionCatalogue({ metaUrl: FABRIC_URL, fetchImpl });

    const liste = await katalog.list('minecraft-fabric');

    expect(liste.map((eintrag) => eintrag.id)).toEqual(['26.3', '26.2']);
    expect(liste[0]?.latest).toBe(true);
  });

  it('holt für die Liste keine einzige Datei', async () => {
    // Der Grund, warum `list()` nur GameVersionEintrag liefert: Zwanzig
    // Einträge zu hashen, nur damit jemand ein Aufklappmenü ansieht, wäre der
    // falsche Tausch.
    const { abrufe, fetchImpl } = fabricAttrappe(STABIL);
    const katalog = createFabricVersionCatalogue({ metaUrl: FABRIC_URL, fetchImpl });

    await katalog.list('minecraft-fabric');

    expect(abrufe).toEqual([`${FABRIC_URL}/versions/game`]);
  });

  it('setzt bei der Wahl die Adresse aus drei Fassungen zusammen', async () => {
    const { fetchImpl } = fabricAttrappe(STABIL);
    const katalog = createFabricVersionCatalogue({ metaUrl: FABRIC_URL, fetchImpl });

    const quelle = await katalog.resolve('minecraft-fabric', '26.2');

    expect(quelle?.url).toBe(`${FABRIC_URL}/versions/loader/26.2/0.19.5/1.1.2/server/jar`);
    expect(quelle?.loaderVersion).toBe('0.19.5');
  });

  it('nimmt den neuesten stabilen Loader, nicht den neuesten überhaupt', async () => {
    // `0.19.6` steht in der Attrappe davor, ist aber nicht stabil.
    const { fetchImpl } = fabricAttrappe(STABIL);
    const katalog = createFabricVersionCatalogue({ metaUrl: FABRIC_URL, fetchImpl });

    expect((await katalog.resolve('minecraft-fabric', '26.2'))?.loaderVersion).toBe('0.19.5');
  });

  it('rechnet die Prüfsumme über die geholte Datei', async () => {
    const { fetchImpl } = fabricAttrappe(STABIL, { inhalt: 'genau diese Bytes' });
    const katalog = createFabricVersionCatalogue({
      metaUrl: FABRIC_URL,
      fetchImpl,
      digest: (daten) => `gerechnet:${String(new Uint8Array(daten).byteLength)}`,
    });

    const quelle = await katalog.resolve('minecraft-fabric', '26.2');

    expect(quelle?.hash).toBe(`gerechnet:${String('genau diese Bytes'.length)}`);
    expect(quelle?.hashAlgorithm).toBe('sha256');
  });

  it('gibt null, wenn die Datei nicht zu holen ist', async () => {
    // Ohne Datei keine Summe, ohne Summe keine Quelle: Das Anlegen soll
    // scheitern, statt einen Server mit ungeprüfter Adresse zu erzeugen.
    const { fetchImpl } = fabricAttrappe(STABIL, { ohneDatei: true });
    const katalog = createFabricVersionCatalogue({ metaUrl: FABRIC_URL, fetchImpl });

    expect(await katalog.resolve('minecraft-fabric', '26.2')).toBeNull();
  });

  it('kennt eine Version nicht, die nicht in der Liste steht', async () => {
    const { fetchImpl } = fabricAttrappe(STABIL);
    const katalog = createFabricVersionCatalogue({ metaUrl: FABRIC_URL, fetchImpl });

    expect(await katalog.resolve('minecraft-fabric', '1.7.10')).toBeNull();
  });

  it('antwortet auf fremde Spieltypen leer, ohne einen Abruf', async () => {
    const { abrufe, fetchImpl } = fabricAttrappe(STABIL);
    const katalog = createFabricVersionCatalogue({ metaUrl: FABRIC_URL, fetchImpl });

    expect(await katalog.list('minecraft-paper')).toEqual([]);
    expect(await katalog.resolve('minecraft-paper', '26.2')).toBeNull();
    expect(abrufe).toEqual([]);
  });

  it('holt die Liste nur einmal je Frist', async () => {
    let uhr = 1_000;
    const { abrufe, fetchImpl } = fabricAttrappe(STABIL);
    const katalog = createFabricVersionCatalogue({
      metaUrl: FABRIC_URL,
      fetchImpl,
      now: () => uhr,
    });

    await katalog.list('minecraft-fabric');
    await katalog.list('minecraft-fabric');

    expect(abrufe).toHaveLength(1);

    uhr += VERSION_CACHE_TTL_MS + 1;
    await katalog.list('minecraft-fabric');

    expect(abrufe).toHaveLength(2);
  });
});
