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
 * (`game_version_url`, `game_version_hash`), und ein Start braucht Mojang
 * nicht mehr. Das ist Absicht: Ein Start, der an einem fremden Dienst hängt,
 * wäre genau dann kaputt, wenn man ihn braucht – und der Fingerabdruck des
 * Containers bliebe nicht stabil.
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
  /** Verfahren der Prüfsumme – Mojang nennt SHA-1. */
  readonly hashAlgorithm: 'sha1' | 'sha256';
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

export interface MojangCatalogueOptions {
  /** Adresse des Verzeichnisses; in Tests eine Attrappe. */
  readonly manifestUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  /** Frist je Abruf; ein hängender Hersteller darf das Panel nicht blockieren. */
  readonly timeoutMs?: number;
}

const MOJANG_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

/** Spieltypen, die ihre Version von Mojang beziehen. */
const MOJANG_GAME_TYPES = new Set(['minecraft-vanilla']);

export function createMojangVersionCatalogue(
  options: MojangCatalogueOptions = {},
): GameVersionCatalogue {
  const manifestUrl = options.manifestUrl ?? MOJANG_MANIFEST_URL;
  const holen = options.fetchImpl ?? fetch;
  const jetzt = options.now ?? ((): number => Date.now());
  const timeoutMs = options.timeoutMs ?? 10_000;

  let zwischenspeicher: { readonly bis: number; readonly eintraege: GameVersionQuelle[] } | null =
    null;

  async function lese<T>(url: string): Promise<T | null> {
    try {
      const antwort = await holen(url, { signal: AbortSignal.timeout(timeoutMs) });

      if (!antwort.ok) {
        return null;
      }

      return (await antwort.json()) as T;
    } catch {
      // Netz weg, Frist abgelaufen, Unsinn im Körper: Die Liste bleibt leer,
      // und die Oberfläche zeigt „keine Auswahl" statt einer Fehlerseite.
      return null;
    }
  }

  async function ladeListe(): Promise<GameVersionQuelle[]> {
    const gespeichert = zwischenspeicher;

    if (gespeichert !== null && gespeichert.bis > jetzt()) {
      return gespeichert.eintraege;
    }

    const manifest = await lese<MojangManifest>(manifestUrl);

    if (manifest === null) {
      // Lieber die alte Liste als gar keine: Sie ist Minuten alt, nicht falsch.
      return gespeichert?.eintraege ?? [];
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
          eintrag.url === undefined ? null : await lese<MojangVersionDetail>(eintrag.url);
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

    const eintraege = aufgeloest.filter(
      (eintrag): eintrag is GameVersionQuelle => eintrag !== null,
    );

    if (eintraege.length > 0) {
      zwischenspeicher = { bis: jetzt() + VERSION_CACHE_TTL_MS, eintraege };
    }

    return eintraege;
  }

  return {
    async list(gameTypeId) {
      return MOJANG_GAME_TYPES.has(gameTypeId) ? ladeListe() : [];
    },

    async resolve(gameTypeId, versionId) {
      if (!MOJANG_GAME_TYPES.has(gameTypeId)) {
        return null;
      }

      const liste = await ladeListe();

      return liste.find((eintrag) => eintrag.id === versionId) ?? null;
    },
  };
}
