import { createHash } from 'node:crypto';

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

/**
 * Was die Auswahlliste braucht – und nur das.
 *
 * Getrennt von {@link GameVersionQuelle}, seit Fabric dazugekommen ist: Dort
 * gibt es die Prüfsumme erst, wenn jemand die Datei geholt und gerechnet hat
 * (siehe {@link createFabricVersionCatalogue}). Eine Liste von zwanzig
 * Einträgen hätte zwanzig Downloads gekostet, nur damit jemand ein Aufklappmenü
 * ansieht. Die Anzeige braucht die Summe nicht; das Anlegen braucht sie.
 */
/** SHA-256 als Hex – dasselbe, was `sha256sum` auf der Kommandozeile liefert. */
function sha256Hex(daten: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(daten)).digest('hex');
}

export interface GameVersionEintrag {
  /** Kennung beim Hersteller, z. B. `26.3`. */
  readonly id: string;
  readonly releasedAt: string | null;
  readonly latest: boolean;
}

export interface GameVersionQuelle extends GameVersionEintrag {
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

/**
 * Ein Katalog, dessen Liste die Adressen schon mitbringt.
 *
 * Das trifft auf alle zu ausser Fabric: Mojang, Paper und NeoForge nennen die
 * Pruefsumme in derselben Antwort, aus der die Liste entsteht. Wer einen
 * solchen Katalog direkt in der Hand hat, kommt an Adresse und Summe auch
 * ueber `list()` - die Schnittstelle darunter verspricht das nicht, weil
 * Fabric es nicht halten kann.
 */
export interface GameVersionKatalogMitQuellen extends GameVersionCatalogue {
  list(gameTypeId: string): Promise<readonly GameVersionQuelle[]>;
}

export interface GameVersionCatalogue {
  /** Alle wählbaren Versionen, neueste zuerst. */
  list(gameTypeId: string): Promise<readonly GameVersionEintrag[]>;
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

    /** Rohe Bytes – für Dateien, deren Prüfsumme niemand nennt (Fabric). */
    async bytes(url: string): Promise<ArrayBuffer | null> {
      const antwort = await leseRoh(url);

      if (antwort === null) {
        return null;
      }

      try {
        return await antwort.arrayBuffer();
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
}): GameVersionKatalogMitQuellen {
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
): GameVersionKatalogMitQuellen {
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
  /** Nach Reihe geordnet: `{ "26.3": ["26.3", "26.3-rc-3"], ... }`. */
  readonly versions?: Readonly<Record<string, readonly string[]>>;
}

interface PaperDownload {
  readonly name?: string;
  readonly url?: string;
  readonly checksums?: { readonly sha256?: string };
}

interface PaperBuild {
  readonly id?: number;
  readonly time?: string;
  readonly channel?: string;
  readonly downloads?: Readonly<Record<string, PaperDownload>>;
}

export interface PaperCatalogueOptions extends KatalogGrundOptionen {
  /** Wurzel des Projekts; in Tests eine Attrappe. */
  readonly projectUrl?: string;
}

const PAPER_PROJECT_URL = 'https://fill.papermc.io/v3/projects/paper';

const PAPER_GAME_TYPES = new Set(['minecraft-paper']);

/** Der Eintrag, den Paper als Serverdatei führt. */
const PAPER_DOWNLOAD_SCHLUESSEL = 'server:default';

/**
 * Eine Vorabversion – Paper hängt `-rc-3`, `-pre-1` und Ähnliches an.
 *
 * Gilt genauso für NeoForge (`-beta`). Wer eine Welt auf eine Vorabversion
 * setzt, tut das mit Absicht; über die Auswahl des Panels soll es nicht aus
 * Versehen passieren.
 */
function istVorab(version: string): boolean {
  return version.includes('-');
}

/**
 * Paper führt seine Versionen nach Reihen und je Version eine Folge von Bauten.
 *
 * **Die v3-Schnittstelle, nicht v2.** Das Image holt seine Jar schon von
 * `fill.papermc.io/v3` (siehe `images/game/minecraft/Dockerfile`); zwei
 * verschiedene Schnittstellen für dieselbe Sache wären zwei Stellen, die
 * auseinanderlaufen.
 *
 * **Der Bau zählt, nicht nur die Version.** Eine Paper-Version wie `26.2` ist
 * kein fertiges Ding, sondern eine Folge: Bau 121, 126 … Gewählt wird der
 * höchste im Kanal `STABLE`. Gibt es für eine Version nur Vorabbauten, fällt
 * sie aus der Liste: Ein Server, der ohne Vorwarnung auf einem Vorabbau läuft,
 * ist eine Überraschung, die niemand bestellt hat.
 *
 * Adresse und Prüfsumme stehen fertig im Datensatz des Baus – die Adresse wird
 * nicht zusammengesetzt, sondern übernommen.
 */
export function createPaperVersionCatalogue(
  options: PaperCatalogueOptions = {},
): GameVersionKatalogMitQuellen {
  const projektUrl = options.projectUrl ?? PAPER_PROJECT_URL;
  const leser = erstelleLeser(options);

  return erstelleKatalog({
    gameTypeIds: PAPER_GAME_TYPES,
    now: options.now ?? ((): number => Date.now()),
    async laden() {
      const projekt = await leser.json<PaperProjekt>(projektUrl);
      const reihen = projekt?.versions ?? {};

      /*
       * Die Reihen stehen neueste zuerst, und innerhalb einer Reihe ebenso.
       * Beides übernimmt die flache Liste, statt selbst zu sortieren: Eine
       * eigene Ordnung über Versionsnummern müsste raten, wie der Hersteller
       * zählt, und läge bei der nächsten Umstellung falsch.
       */
      const versionen = Object.values(reihen)
        .flat()
        .filter((version) => !istVorab(version))
        .slice(0, MAX_VERSIONS);

      if (versionen.length === 0) {
        return [];
      }

      const aufgeloest = await Promise.all(
        versionen.map(async (version, index): Promise<GameVersionQuelle | null> => {
          const bauten = await leser.json<readonly PaperBuild[]>(
            `${projektUrl}/versions/${encodeURIComponent(version)}/builds`,
          );

          if (!Array.isArray(bauten)) {
            return null;
          }

          // Höchste Nummer statt „letzter im Feld": Die Reihenfolge der Antwort
          // ist nirgends zugesagt, die Nummer dagegen zählt aufwärts.
          const fertige = bauten
            .filter((bau) => bau.channel === 'STABLE' && typeof bau.id === 'number')
            .sort((links, rechts) => (links.id as number) - (rechts.id as number));

          const neuester = fertige[fertige.length - 1];
          const datei = neuester?.downloads?.[PAPER_DOWNLOAD_SCHLUESSEL];

          if (datei?.url === undefined || datei.checksums?.sha256 === undefined) {
            return null;
          }

          return {
            id: version,
            // Paper nennt kein Datum für die Version, nur für den Bau – und der
            // ist die Datei, die hier tatsächlich geholt wird.
            releasedAt: neuester?.time ?? null,
            latest: index === 0,
            url: datei.url,
            hash: datei.checksums.sha256,
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
 * Die Minecraft-Version steckt in der NeoForge-Version – in zwei Schreibweisen.
 *
 * Im Maven-Ordner liegen beide nebeneinander, weil NeoForge die Zählung mit
 * Minecraft umgestellt hat:
 *
 * | NeoForge    | Stellen | Minecraft |
 * | ----------- | ------- | --------- |
 * | `26.2.0.86` | vier    | `26.2`    |
 * | `21.1.251`  | drei    | `1.21.1`  |
 *
 * Die Stellenzahl unterscheidet sie: Seit Minecraft selbst zweistellig zählt
 * (`26.2`), hängt NeoForge Fehlerstand und Bau an und kommt auf vier. Vorher
 * trug es die beiden hinteren Stellen von `1.21.1` und kam auf drei.
 *
 * `null`, wenn eine Kennung in keines der beiden Schemata passt; dann bleibt
 * sie aussen vor, statt eine Minecraft-Version zu behaupten.
 */
export function minecraftVersionAusNeoforge(neoforge: string): string | null {
  const stellen = neoforge.split('.');

  if (stellen.length === 4 && stellen.every((stelle) => /^\d+$/.test(stelle))) {
    return `${stellen[0] as string}.${stellen[1] as string}`;
  }

  if (stellen.length === 3 && stellen.every((stelle) => /^\d+$/.test(stelle))) {
    return `1.${stellen[0] as string}.${stellen[1] as string}`;
  }

  return null;
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
 * **Die Prüfsumme liegt neben der Datei.** Maven legt sie als eigene kleine
 * Datei ab; `.sha256` bevorzugt, `.sha1` als Rückfall, weil ältere Ordner nur
 * die kennen.
 */
export function createNeoforgeVersionCatalogue(
  options: NeoforgeCatalogueOptions = {},
): GameVersionKatalogMitQuellen {
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
        .filter((version) => version !== '' && !istVorab(version));

      /*
       * Je Minecraft-Version der höchste NeoForge-Bau. Der Ordner ist nicht
       * verlässlich geordnet – im echten Verzeichnis steht `26.1.2.109` vor
       * `26.2.0.86` und `21.1.251` ganz am Ende –, deshalb wird verglichen und
       * nicht auf die Reihenfolge vertraut.
       */
      const jeSpielversion = new Map<string, NeoforgeBau>();

      for (const version of alle) {
        const minecraft = minecraftVersionAusNeoforge(version);

        if (minecraft === null) {
          continue;
        }

        const bisher = jeSpielversion.get(minecraft);

        if (bisher === undefined || vergleicheVersionen(version, bisher.neoforge) > 0) {
          jeSpielversion.set(minecraft, { neoforge: version, minecraft });
        }
      }

      const bauten = [...jeSpielversion.values()]
        .sort((links, rechts) => vergleicheVersionen(rechts.minecraft, links.minecraft))
        .slice(0, MAX_VERSIONS);

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

/**
 * Zwei Versionsnummern der Stelle nach vergleichen.
 *
 * `26.2.0.86` ist grösser als `26.1.2.109`, obwohl `109` grösser als `86` ist –
 * ein Vergleich als Zeichenkette läge hier falsch, und der Maven-Ordner ist
 * nicht nach Grösse geordnet. Fehlende Stellen zählen als `0`, damit `26.2`
 * und `26.2.0` gleich sind.
 */
function vergleicheVersionen(links: string, rechts: string): number {
  const a = links.split('.').map((stelle) => Number.parseInt(stelle, 10) || 0);
  const b = rechts.split('.').map((stelle) => Number.parseInt(stelle, 10) || 0);

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const unterschied = (a[i] ?? 0) - (b[i] ?? 0);

    if (unterschied !== 0) {
      return unterschied;
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// FabricMC – Minecraft (Fabric)
// ---------------------------------------------------------------------------

interface FabricSpielversion {
  readonly version?: string;
  readonly stable?: boolean;
}

interface FabricLoader {
  readonly version?: string;
  readonly stable?: boolean;
}

interface FabricInstaller {
  readonly version?: string;
  readonly stable?: boolean;
}

export interface FabricCatalogueOptions extends KatalogGrundOptionen {
  /** Wurzel der Meta-Schnittstelle; in Tests eine Attrappe. */
  readonly metaUrl?: string;
  /** Rechnet die Prüfsumme einer geholten Datei; in Tests eine Attrappe. */
  readonly digest?: (daten: ArrayBuffer) => string;
}

const FABRIC_META_URL = 'https://meta.fabricmc.net/v2';

const FABRIC_GAME_TYPES = new Set(['minecraft-fabric']);

/**
 * Fabric nennt keine Prüfsumme – also rechnen wir sie.
 *
 * **Warum das überhaupt geht.** Die Starter-Jar entsteht auf Anfrage aus drei
 * Fassungen – Spiel, Loader, Installationsprogramm – und ist für dasselbe
 * Tripel byteweise dieselbe Datei. Nachgemessen am 2026-09-20: zweimal geholt,
 * zweimal `f1d2bafd…`, und genau diese Summe pinnt das Dockerfile des
 * Minecraft-Images seit Fassung 6 von Hand. Was dort ein Mensch einmal tut,
 * tut hier der Katalog.
 *
 * **Was das nicht leistet, und das ist der ehrliche Unterschied zu den anderen
 * drei Katalogen:** Bei Mojang, Paper und NeoForge kommt die Summe vom
 * Hersteller; sie bestätigt, dass die geholte Datei die gemeinte ist. Hier
 * kommt sie von uns und bestätigt nur, dass spätere Starts dieselbe Datei
 * bekommen wie die Wahl. Wäre Fabric im Moment der Wahl unterwandert, fiele
 * das nicht auf. Der Schutz gilt ab der Wahl, nicht davor – und das ist immer
 * noch mehr als gar keine Summe, mit der das Image gar nichts verwerfen könnte.
 *
 * **Gerechnet wird erst bei der Wahl.** Die Liste kostet einen Abruf; die
 * Summe kostet 178 KiB. Zwanzig Einträge zu hashen, nur damit jemand ein
 * Aufklappmenü ansieht, wäre der falsche Tausch – deshalb liefert `list()` nur
 * {@link GameVersionEintrag}.
 */
export function createFabricVersionCatalogue(
  options: FabricCatalogueOptions = {},
): GameVersionCatalogue {
  const metaUrl = options.metaUrl ?? FABRIC_META_URL;
  const leser = erstelleLeser(options);
  const jetzt = options.now ?? ((): number => Date.now());
  const digest = options.digest ?? sha256Hex;

  const liste = erstelleKatalog({
    gameTypeIds: FABRIC_GAME_TYPES,
    now: jetzt,
    async laden() {
      const spiele = await leser.json<readonly FabricSpielversion[]>(`${metaUrl}/versions/game`);

      if (!Array.isArray(spiele)) {
        return [];
      }

      /*
       * `stable` sagt Fabric selbst – anders als bei Paper und NeoForge muss
       * das nicht am Namen abgelesen werden. Die Liste steht neueste zuerst.
       */
      return spiele
        .filter(
          (eintrag): eintrag is { version: string; stable: true } =>
            eintrag.stable === true && typeof eintrag.version === 'string',
        )
        .slice(0, MAX_VERSIONS)
        .map((eintrag, index) => ({
          id: eintrag.version,
          // Die Schnittstelle nennt kein Datum; das Panel zeigt dann keins.
          releasedAt: null,
          latest: index === 0,
          // Ohne Adresse und Summe: Beides entsteht erst in `resolve`.
          url: '',
          hash: '',
          hashAlgorithm: 'sha256' as const,
        }));
    },
  });

  /** Neueste stabile Fassung aus einer Fabric-Liste. */
  async function neuesteStabile(pfad: string): Promise<string | null> {
    const eintraege = await leser.json<readonly (FabricLoader | FabricInstaller)[]>(
      `${metaUrl}/versions/${pfad}`,
    );

    if (!Array.isArray(eintraege)) {
      return null;
    }

    const treffer = eintraege.find(
      (eintrag) => eintrag.stable === true && typeof eintrag.version === 'string',
    );

    return treffer?.version ?? null;
  }

  return {
    list: liste.list,

    async resolve(gameTypeId, versionId) {
      const bekannt = await liste.resolve(gameTypeId, versionId);

      if (bekannt === null) {
        return null;
      }

      const loader = await neuesteStabile('loader');
      const installer = await neuesteStabile('installer');

      if (loader === null || installer === null) {
        return null;
      }

      const url =
        `${metaUrl}/versions/loader/${encodeURIComponent(versionId)}` +
        `/${encodeURIComponent(loader)}/${encodeURIComponent(installer)}/server/jar`;

      const daten = await leser.bytes(url);

      if (daten === null) {
        return null;
      }

      return {
        id: bekannt.id,
        releasedAt: bekannt.releasedAt,
        latest: bekannt.latest,
        url,
        hash: digest(daten),
        hashAlgorithm: 'sha256',
        loaderVersion: loader,
      };
    },
  };
}
