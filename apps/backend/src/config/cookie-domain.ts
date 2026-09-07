/**
 * Geltungsbereich der Sitzungs-Cookies (Audit W2-6, security-matrix-03).
 *
 * Ein `Domain`-Attribut gilt im Browser **immer** samt aller Subdomains. Steht
 * dort die Basis-Domain der Instanz, gehen `palantir_access`,
 * `palantir_refresh` und `palantir_csrf` auch an die Spielserver-Hosts
 * (`<sub>.<PALANTIR_DOMAIN>`, siehe `@palantir/contracts` `buildServerHostname`)
 * – also an Container, in denen ab Phase 2 fremder Code der Server-Besitzer
 * läuft. Ohne `Domain` bleibt ein Cookie beim setzenden Host (host-only).
 *
 * Deshalb wird die Cookie-Domain nicht mehr aus `PALANTIR_DOMAIN` genommen,
 * sondern aus den **tatsächlichen Panel-Hosts**: Nur so eng, dass Weboberfläche
 * und API sie beide sehen. Liegen beide auf demselben Host (Entwicklung:
 * `localhost:3000` / `localhost:4000`), entfällt das Attribut ganz.
 *
 * Reine Funktionen ohne Fastify/Zod, damit die Ableitung für sich prüfbar ist
 * (CLAUDE.md §4).
 */

/** Hostname einer Adresse ohne Port; `undefined`, wenn sie nicht lesbar ist. */
function hostVon(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Gemeinsames Suffix zweier Hostnamen auf Label-Grenzen.
 *
 * `api.panel.example` und `panel.example` ergeben `panel.example`.
 * Ein Suffix aus nur einem Label (`example`, `localhost`) ergibt `undefined`:
 * Eine Cookie-Domain auf dieser Ebene wäre entweder eine öffentliche Endung
 * (vom Browser ohnehin verworfen) oder unnötig weit.
 */
function gemeinsamesSuffix(a: string, b: string): string | undefined {
  const links = a.split('.').reverse();
  const rechts = b.split('.').reverse();
  const gemeinsam: string[] = [];

  for (let i = 0; i < Math.min(links.length, rechts.length); i += 1) {
    if (links[i] !== rechts[i]) {
      break;
    }

    gemeinsam.push(links[i] as string);
  }

  return gemeinsam.length >= 2 ? gemeinsam.reverse().join('.') : undefined;
}

/**
 * Cookie-Domain aus Web- und API-Adresse ableiten.
 *
 * - gleicher Host (Entwicklung, oder Panel und API unter einem Namen):
 *   `undefined` → host-only, der engste mögliche Bereich.
 * - verschiedene Hosts: das gemeinsame Suffix, z. B. `panel.example.tld` für
 *   `panel.example.tld` (Web) und `api.panel.example.tld` (API).
 * - kein gemeinsames Suffix mit mindestens zwei Labeln: `undefined`.
 *
 * **Umstellungshinweis:** Wo die Vorgabe bisher `PALANTIR_DOMAIN` war und jetzt
 * ein anderer Wert herauskommt (Entwicklung mit `localhost`), gelten die im
 * Browser liegenden Cookies der alten Domain nicht mehr als dieselben – die
 * betroffenen Sitzungen müssen sich einmalig neu anmelden.
 */
export function cookieDomainAbleiten(webUrl: string, apiUrl: string): string | undefined {
  const web = hostVon(webUrl);
  const api = hostVon(apiUrl);

  if (web === undefined || api === undefined) {
    return undefined;
  }

  if (web === api) {
    return undefined;
  }

  return gemeinsamesSuffix(web, api);
}

/**
 * Deckt die Cookie-Domain auch die Spielserver-Hosts ab?
 *
 * Spielserver liegen unter `<sub>.<PALANTIR_DOMAIN>`. Ist die Cookie-Domain
 * gleich `PALANTIR_DOMAIN` oder ein Suffix davon, schickt der Browser die
 * Sitzungs-Cookies an jeden dieser Hosts. Das Backend kann das nicht selbst
 * auflösen – die Abhilfe ist eine Betriebsentscheidung (Panel und API eine
 * Ebene tiefer, z. B. `panel.<domain>` und `api.panel.<domain>`). Deshalb nur
 * eine Warnung beim Start, kein Startabbruch.
 */
export function cookieDomainUmfasstSpielhosts(
  cookieDomain: string | undefined,
  palantirDomain: string,
): boolean {
  if (cookieDomain === undefined || cookieDomain.length === 0) {
    return false;
  }

  const domain = palantirDomain.toLowerCase();
  const cookie = cookieDomain.toLowerCase().replace(/^\./, '');

  return domain === cookie || domain.endsWith(`.${cookie}`);
}
