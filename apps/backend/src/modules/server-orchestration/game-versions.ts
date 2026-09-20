/**
 * Wählbare Spielversionen (Betreiber-Wunsch vom 19.09.2026).
 *
 * **Warum überhaupt.** Bis hierher legte das Image fest, welche Serverdatei
 * ein Spiel holt. Wer eine ältere Welt weiterspielen wollte – Mods, Plugins,
 * eine Version, die die Mitspieler haben –, hatte keine Wahl.
 *
 * **Woher die Liste kommt.** Vom Hersteller, nicht aus einer Aufzählung im
 * Code: Mojang führt sein Verzeichnis unter `piston-meta.mojang.com`, und was
 * dort morgen dazukommt, steht damit auch im Panel. Eine eingebaute Liste
 * wäre am Tag der nächsten Veröffentlichung veraltet.
 *
 * **Wann das Netz gebraucht wird.** Nur beim Anzeigen der Liste und beim
 * Auswählen einer Version. Danach stehen Adresse und Prüfsumme **am Server**
 * (`game_version_url`, `game_version_hash`), und ein Start braucht den
 * Hersteller nicht mehr. Das ist Absicht: Ein Start, der an einem fremden
 * Dienst hängt, wäre genau dann kaputt, wenn man ihn braucht – und der
 * Fingerabdruck des Containers bliebe nicht stabil.
 *
 * **Ein Katalog je Hersteller.** Mojang war der erste, Paper und NeoForge
 * kamen dazu (Betreiber-Wunsch 20.09.2026: eine Minecraft-Vorlage, die alle
 * Versionen und Ausgaben abdeckt). Sie teilen sich Abruf, Frist und
 * Zwischenspeicher; verschieden ist allein, wie der Hersteller seine Liste
 * führt. `createVersionCatalogueGroup()` legt sie nebeneinander und fragt den,
 * der den Spieltyp kennt.
 */

export interface GameVersionQuelle {
  /** Kennung beim Hersteller, z. B. `26.3`. */
  readonly id: string;
  readonly releasedAt: string | null;
  readonly latest: boolean;
  /** Adresse der Serverdatei. */
  readonly url: string;
  /** Prüfsumme der Serverdatei. */
  readonly hash: string;
  /** Verfahren der Prüfsumme – Mojang nennt SHA-1, Paper SHA-256. */
  readonly hashAlgorithm: 'sha1' | 'sha256';
  /**
   * Version des Mod-Loaders, wo die Spielversion allein nicht reicht.
   *
   * Bei NeoForge wählt der Betreiber eine **Minecraft**-Version; welcher
   * Loader dazu gehört, ist keine zweite Entscheidung, sondern folgt daraus
   * (`21.4.96` gehört zu `1.21.4`). Die Adresse oben zeigt auf das
   * Installationsprogramm dieses Loaders; diese Angabe sagt, welche Version
   * darin steckt – für die Anzeige und für das Startskript.
   *
   * Ohne Angabe ist die Serverdatei für sich vollständig (Mojang, Paper).
   */
  readonly loaderVersion?: string;
}

export interface GameVersionCatalogue {
  /** Alle wählbaren Versionen, neueste zuerst. */
  list(gameTypeId: string): Promise<readonly GameVersionQuelle[]>;
  /** Eine Version auflösen; `null`, wenn der Hersteller sie nicht kennt. */
  resolve(gameTypeId: string, versionId: string): Promise<GameVersionQuelle | null>;
}

/** Wie lange eine geholte Liste gilt, bevor sie neu geholt wird. */
export const VERSION_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Wie viele Versionen das Panel anbietet.
 *
 * Mojang führt über hundert Ausgaben bis zurück zu 2011. Eine Auswahlliste mit
 * hundert Einträgen ist keine Auswahl mehr; die letzten zwanzig decken die
 * Versionen ab, für die es Plugins, Mods und Mitspieler gibt.
 */
export const MAX_VERSIONS = 20;

/** Was jeder Katalog gleich macht: abrufen, warten, Uhr lesen. */
export interface KatalogGrundOptionen {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  /** Frist je Abruf; ein hängender Hersteller darf das Panel nicht blockieren. */
  readonly timeoutMs?: number;
}

/**
 * Abrufer mit Frist, der bei jedem Fehler `null` liefert.
 *
 * Netz weg, Frist abgelaufen, Unsinn im Körper: Die Liste bleibt leer, und die
 * Oberfläche zeigt „keine Auswahl" statt einer Fehlerseite. Ein Hersteller, der
 * gerade nicht erreichbar ist, darf das Anlegen eines Servers nicht verhindern
 * – nur die Wahl einer anderen Version.
 */
function erstelleLeser(options: KatalogGrundOptionen) {
  const holen = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function leseRoh(url: string): Promise<Response | null> {
    try {
      const antwort = await holen(url, { signal: AbortSignal.timeout(timeoutMs) });

      return antwort.ok ? antwort : null;
    } catch {
      return null;
    }
  }

  return {
    async json<T>(url: string): Promise<T | null> {
      const antwort = await leseRoh(url);

      if (antwort === null) {
        return null;
      }

      try {
        return (await antwort.json()) as T;
      } catch {
        return null;
      }
    },

    async text(url: string): Promise<string | null> {
      const antwort = await leseRoh(url);

      if (antwort === null) {
        return null;
      }

      try {
        return await antwort.text();
      } catch {
        return null;
      }
    },
  };
}

/**
 * Zwischenspeicher, Frist und die beiden Methoden – für jeden Katalog gleich.
 *
 * `laden` holt die Liste beim Hersteller. Der Rest steht hier: eine Stunde
 * Frist, und wenn ein Abruf scheitert, lieber die alte Liste als gar keine.
 * Sie ist Minuten alt, nicht falsch.
 */
function erstelleKatalog(spec: {
  readonly gameTypeIds: ReadonlySet<string>;
  readonly laden: () => Promise<GameVersionQuelle[]>;
  readonly now: () => number;
}): GameVersionCatalogue {
  let zwischenspeicher: { readonly bis: number; readonly eintraege: GameVersionQuelle[] } | null =
    null;

  async function liste(): Promise<GameVersionQuelle[]> {
    const gespeichert = zwischenspeicher;

    if (gespeichert !== null && gespeichert.bis > spec.now()) {
      return gespeichert.eintraege;
    }

    const eintraege = await spec.laden();

    if (eintraege.length === 0) {
      return gespeichert?.eintraege ?? [];
    }

    zwischenspeicher = { bis: spec.now() + VERSION_CACHE_TTL_MS, eintraege };

    return eintraege;
  }

  return {
    async list(gameTypeId) {
      return spec.gameTypeIds.has(gameTypeId) ? liste() : [];
    },

    async resolve(gameTypeId, versionId) {
      if (!spec.gameTypeIds.has(gameTypeId)) {
        return null;
      }

      return (await liste()).find((eintrag) => eintrag.id === versionId) ?? null;
    },
  };
}

/**
 * Mehrere Kataloge nebeneinander.
 *
 * Jeder kennt seine Spieltypen und antwortet auf alle anderen leer; gefragt
 * wird der Reihe nach, bis einer etwas liefert. Bewusst kein Verzeichnis
 * „Spieltyp → Katalog" daneben: Welche Typen ein Katalog bedient, weiß er
 * selbst am besten, und zwei Orte für dieselbe Zuordnung driften auseinander.
 */
export function createVersionCatalogueGroup(
  kataloge: readonly GameVersionCatalogue[],
): GameVersionCatalogue {
  return {
    async list(gameTypeId) {
      for (const katalog of kataloge) {
        const eintraege = await katalog.list(gameTypeId);

        if (eintraege.length > 0) {
          return eintraege;
        }
      }

      return [];
    },

    async resolve(gameTypeId, versionId) {
      for (const katalog of kataloge) {
        const quelle = await katalog.resolve(gameTypeId, versionId);

        if (quelle !== null) {
          return quelle;
        }
      }

      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Mojang – Minecraft (Vanilla)
// ---------------------------------------------------------------------------

interface MojangManifest {
  readonly latest?: { readonly release?: string };
  readonly versions?: readonly {
    readonly id?: string;
    readonly type?: string;
    readonly url?: string;
    readonly releaseTime?: string;
  }[];
}

interface MojangVersionDetail {
  readonly downloads?: {
    readonly server?: { readonly url?: string; readonly sha1?: string };
  };
}

export interface MojangCatalogueOptions extends KatalogGrundOptionen {
  /** Adresse des Verzeichnisses; in Tests eine Attrappe. */
  readonly manifestUrl?: string;
}

const MOJANG_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

/** Spieltypen, die ihre Version von Mojang beziehen. */
const MOJANG_GAME_TYPES = new Set(['minecraft-vanilla']);

export function createMojangVersionCatalogue(
  options: MojangCatalogueOptions = {},
): GameVersionCatalogue {
  const manifestUrl = options.manifestUrl ?? MOJANG_MANIFEST_URL;
  const leser = erstelleLeser(options);

  return erstelleKatalog({
    gameTypeIds: MOJANG_GAME_TYPES,
    now: options.now ?? ((): number => Date.now()),
    async laden() {
      const manifest = await leser.json<MojangManifest>(manifestUrl);

      if (manifest === null) {
        return [];
      }

      const neueste = manifest.latest?.release ?? null;
      const releases = (manifest.versions ?? [])
        .filter((eintrag) => eintrag.type === 'release' && typeof eintrag.id === 'string')
        .slice(0, MAX_VERSIONS);

      /*
       * Die Adresse der Serverdatei steht nicht im Verzeichnis, sondern erst im
       * Datensatz je Version – das sind zwanzig weitere Abrufe. Sie laufen
       * nebeneinander und nur einmal je Stunde.
       */
      const aufgeloest = await Promise.all(
        releases.map(async (eintrag): Promise<GameVersionQuelle | null> => {
          const detail =
            eintrag.url === undefined ? null : await leser.json<MojangVersionDetail>(eintrag.url);
          const server = detail?.downloads?.server;

          if (server?.url === undefined || server.sha1 === undefined) {
            return null;
          }

          return {
            id: eintrag.id as string,
            releasedAt: eintrag.releaseTime ?? null,
            latest: eintrag.id === neueste,
            url: server.url,
            hash: server.sha1,
            hashAlgorithm: 'sha1',
          };
        }),
      );

      return aufgeloest.filter((eintrag): eintrag is GameVersionQuelle => eintrag !== null);
    },
  });
}

// ---------------------------------------------------------------------------
// PaperMC – Minecraft (Paper)
// ---------------------------------------------------------------------------

interface PaperProjekt {
  readonly versions?: readonly string[];
}

interface PaperBuild {
  readonly build?: number;
  readonly time?: string;
  readonly channel?: string;
  readonly downloads?: {
    readonly application?: { readonly name?: string; readonly sha256?: string };
  };
}

interface PaperBuilds {
  readonly builds?: readonly PaperBuild[];
}

export interface PaperCatalogueOptions extends KatalogGrundOptionen {
  /** Wurzel des Projekts; in Tests eine Attrappe. */
  readonly projectUrl?: string;
}

const PAPER_PROJECT_URL = 'https://api.papermc.io/v2/projects/paper';

const PAPER_GAME_TYPES = new Set(['minecraft-paper']);

/**
 * Paper führt seine Versionen aufsteigend und je Version eine Reihe von Bauten.
 *
 * **Der Bau zählt, nicht nur die Version.** Eine Paper-Version wie `1.21.4` ist
 * kein fertiges Ding, sondern eine Reihe: Bau 1, 2, 3 … Gewählt wird der
 * neueste im Kanal `default` – das ist der, den Paper selbst als fertig
 * bezeichnet. Gibt es für eine Version nur Vorabbauten (`experimental`), fällt
 * sie aus der Liste: Ein Server, der ohne Vorwarnung auf einem Vorabbau läuft,
 * ist eine Überraschung, die niemand bestellt hat.
 *
 * Die Prüfsumme steht mit im Datensatz des Baus (`sha256`), die Adresse setzt
 * sich aus Version, Bau und Dateiname zusammen.
 */
export function createPaperVersionCatalogue(
  options: PaperCatalogueOptions = {},
): GameVersionCatalogue {
  const projektUrl = options.projectUrl ?? PAPER_PROJECT_URL;
  const leser = erstelleLeser(options);

  return erstelleKatalog({
    gameTypeIds: PAPER_GAME_TYPES,
    now: options.now ?? ((): number => Date.now()),
    async laden() {
      const projekt = await leser.json<PaperProjekt>(projektUrl);
      const alle = projekt?.versions ?? [];

      if (alle.length === 0) {
        return [];
      }

      // Aufsteigend geführt: Die letzten sind die neuesten, und die Liste des
      // Panels beginnt mit der neuesten.
      const versionen = alle.slice(-MAX_VERSIONS).reverse();

      const aufgeloest = await Promise.all(
        versionen.map(async (version, index): Promise<GameVersionQuelle | null> => {
          const bauten = await leser.json<PaperBuilds>(
            `${projektUrl}/versions/${encodeURIComponent(version)}/builds`,
          );

          const fertige = (bauten?.builds ?? []).filter((bau) => bau.channel === 'default');
          const neuester = fertige[fertige.length - 1];
          const anwendung = neuester?.downloads?.application;

          if (
            neuester?.build === undefined ||
            anwendung?.name === undefined ||
            anwendung.sha256 === undefined
          ) {
            return null;
          }

          return {
            id: version,
            // Paper nennt kein Datum für die Version, nur für den Bau – und der
            // ist die Datei, die hier tatsächlich geholt wird.
            releasedAt: neuester.time ?? null,
            latest: index === 0,
            url:
              `${projektUrl}/versions/${encodeURIComponent(version)}` +
              `/builds/${String(neuester.build)}/downloads/${encodeURIComponent(anwendung.name)}`,
            hash: anwendung.sha256,
            hashAlgorithm: 'sha256',
          };
        }),
      );

      return aufgeloest.filter((eintrag): eintrag is GameVersionQuelle => eintrag !== null);
    },
  });
}

// ---------------------------------------------------------------------------
// NeoForge – Minecraft (NeoForge)
// ---------------------------------------------------------------------------

export interface NeoforgeCatalogueOptions extends KatalogGrundOptionen {
  /** Wurzel des Maven-Ordners; in Tests eine Attrappe. */
  readonly mavenUrl?: string;
}

const NEOFORGE_MAVEN_URL = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

const NEOFORGE_GAME_TYPES = new Set(['minecraft-neoforge']);

/**
 * Die Minecraft-Version steckt in der NeoForge-Version.
 *
 * NeoForge zählt `21.4.96` für Minecraft `1.21.4`, `20.6.119` für `1.20.6`:
 * die ersten beiden Stellen sind Haupt- und Nebenversion des Spiels, mit einer
 * führenden `1`. Das ist keine Vermutung, sondern das erklärte Schema des
 * Projekts – und der Grund, warum der Betreiber hier eine Minecraft-Version
 * wählt und keine NeoForge-Version: Die zweite folgt aus der ersten.
 *
 * `null`, wenn eine Kennung nicht in das Schema passt; dann bleibt sie aussen
 * vor, statt eine Minecraft-Version zu behaupten.
 */
export function minecraftVersionAusNeoforge(neoforge: string): string | null {
  const treffer = /^(\d+)\.(\d+)\.\d+/.exec(neoforge);

  if (treffer === null) {
    return null;
  }

  return `1.${treffer[1] as string}.${treffer[2] as string}`;
}

interface NeoforgeBau {
  readonly neoforge: string;
  readonly minecraft: string;
}

/**
 * NeoForge liegt als Maven-Ordner, nicht als JSON-Schnittstelle.
 *
 * **Die Versionsliste wird aus dem `maven-metadata.xml` gelesen**, und zwar mit
 * einem Ausdruck über die `<version>`-Elemente statt mit einem XML-Leser. Für
 * eine Datei mit genau einer Sorte Element eine Abhängigkeit aufzunehmen wäre
 * unverhältnismässig (Entwicklungsregeln §1: keine neue Bibliothek nebenbei);
 * was nicht in das Schema passt, fällt ohnehin heraus.
 *
 * **Vorabversionen bleiben draussen.** NeoForge hängt `-beta` an, solange eine
 * Reihe nicht fertig ist. Wer eine Welt darauf setzt, tut das mit Absicht –
 * über die Auswahl des Panels soll es nicht aus Versehen passieren.
 *
 * **Die Prüfsumme liegt neben der Datei.** Maven legt sie als eigene kleine
 * Datei ab; `.sha256` bevorzugt, `.sha1` als Rückfall, weil ältere Ordner nur
 * die kennen.
 */
export function createNeoforgeVersionCatalogue(
  options: NeoforgeCatalogueOptions = {},
): GameVersionCatalogue {
  const mavenUrl = options.mavenUrl ?? NEOFORGE_MAVEN_URL;
  const leser = erstelleLeser(options);

  async function pruefsumme(
    version: string,
  ): Promise<{ hash: string; hashAlgorithm: 'sha1' | 'sha256' } | null> {
    const basis = `${mavenUrl}/${version}/neoforge-${version}-installer.jar`;

    for (const verfahren of ['sha256', 'sha1'] as const) {
      const roh = await leser.text(`${basis}.${verfahren}`);
      const summe = roh?.trim().split(/\s+/)[0] ?? '';

      if (/^[0-9a-f]{40,64}$/i.test(summe)) {
        return { hash: summe.toLowerCase(), hashAlgorithm: verfahren };
      }
    }

    return null;
  }

  return erstelleKatalog({
    gameTypeIds: NEOFORGE_GAME_TYPES,
    now: options.now ?? ((): number => Date.now()),
    async laden() {
      const xml = await leser.text(`${mavenUrl}/maven-metadata.xml`);

      if (xml === null) {
        return [];
      }

      const alle = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map((treffer) => (treffer[1] ?? '').trim())
        .filter((version) => version !== '' && !version.includes('-'));

      /*
       * Je Minecraft-Version der neueste NeoForge-Bau. Maven führt aufsteigend,
       * also gewinnt der letzte Treffer – und die neueste Spielversion steht
       * am Ende der Datei.
       */
      const jeSpielversion = new Map<string, NeoforgeBau>();

      for (const version of alle) {
        const minecraft = minecraftVersionAusNeoforge(version);

        if (minecraft !== null) {
          jeSpielversion.set(minecraft, { neoforge: version, minecraft });
        }
      }

      const bauten = [...jeSpielversion.values()].reverse().slice(0, MAX_VERSIONS);

      const aufgeloest = await Promise.all(
        bauten.map(async (bau, index): Promise<GameVersionQuelle | null> => {
          const summe = await pruefsumme(bau.neoforge);

          if (summe === null) {
            return null;
          }

          return {
            id: bau.minecraft,
            // Maven nennt kein Datum je Version; das Panel zeigt dann keins.
            releasedAt: null,
            latest: index === 0,
            url: `${mavenUrl}/${bau.neoforge}/neoforge-${bau.neoforge}-installer.jar`,
            hash: summe.hash,
            hashAlgorithm: summe.hashAlgorithm,
            loaderVersion: bau.neoforge,
          };
        }),
      );

      return aufgeloest.filter((eintrag): eintrag is GameVersionQuelle => eintrag !== null);
    },
  });
}
