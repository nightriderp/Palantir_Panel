import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Der Routenbaum unter `src/app` – Fundpunkt frontend-app-03.
 *
 * Der Umbau zog `admin/` als gewöhnliches Segment unter die Route-Gruppe
 * `(dashboard)`, damit Dashboard und Administration sich **ein** Layout teilen
 * und der Provider-Stapel (Sitzung, Live-Kanal, Benachrichtigungen, Toasts) den
 * Wechsel zwischen beiden überlebt, statt jedes Mal neu zu entstehen.
 *
 * Diese Datei sichert die drei Eigenschaften, die dabei nicht kaputtgehen
 * dürfen und die man einer einzelnen Datei nicht ansieht:
 *
 * 1. **Keine Adresse ändert sich.** Route-Gruppen in Klammern erscheinen nicht
 *    in der URL – genau darauf beruht der Umbau. Die erwartete Liste steht
 *    unten ausgeschrieben; verschiebt jemand einen Ordner, fällt der Test auf.
 * 2. **Dashboard und Administration hängen unter derselben Layout-Kette.**
 *    Nur dann tauscht Next beim Wechsel kein Layout-Segment aus.
 * 3. **Genau ein Layout baut den Rahmen auf.** Vorher gab es drei
 *    deckungsgleiche Wrapper (`(dashboard)`, `admin/(core)`, `admin/(games)`);
 *    ein vierter würde das Problem stillschweigend wiederholen.
 *
 * Bewusst über das Dateisystem statt über eine gepflegte Liste: Der Router von
 * Next liest denselben Baum, und eine zweite Quelle würde auseinanderlaufen.
 */

const APP_VERZEICHNIS = fileURLToPath(new URL('.', import.meta.url));

interface Route {
  /** Adresse, unter der die Seite erreichbar ist. */
  readonly url: string;
  /** Layout-Dateien von außen nach innen, relativ zu `src/app`. */
  readonly layouts: readonly string[];
}

/**
 * Läuft den Ordnerbaum ab und leitet daraus dieselben Routen ab wie Next.
 *
 * Zwei Regeln des App Routers bilden wir nach: Ein Ordner in Klammern ist eine
 * Route-Gruppe und taucht in der URL **nicht** auf; ein Ordner mit führendem
 * Unterstrich (`_components`) ist privat und ergibt gar keine Route.
 */
function sammleRouten(
  verzeichnis: string = APP_VERZEICHNIS,
  urlSegmente: readonly string[] = [],
  layouts: readonly string[] = [],
  relativerPfad = '',
): Route[] {
  const eintraege = readdirSync(verzeichnis, { withFileTypes: true });
  const dateien = new Set(eintraege.filter((e) => e.isFile()).map((e) => e.name));

  const layoutPfad = relativerPfad === '' ? 'layout.tsx' : `${relativerPfad}/layout.tsx`;
  const kette = dateien.has('layout.tsx') ? [...layouts, layoutPfad] : layouts;

  const routen: Route[] = [];

  if (dateien.has('page.tsx')) {
    routen.push({
      url: urlSegmente.length === 0 ? '/' : `/${urlSegmente.join('/')}`,
      layouts: kette,
    });
  }

  for (const eintrag of eintraege) {
    if (!eintrag.isDirectory() || eintrag.name.startsWith('_')) continue;

    const istGruppe = eintrag.name.startsWith('(') && eintrag.name.endsWith(')');

    routen.push(
      ...sammleRouten(
        join(verzeichnis, eintrag.name),
        istGruppe ? urlSegmente : [...urlSegmente, eintrag.name],
        kette,
        relativerPfad === '' ? eintrag.name : `${relativerPfad}/${eintrag.name}`,
      ),
    );
  }

  return routen;
}

const ROUTEN = sammleRouten();

/** Layout-Ketten sind je Route gleich lang; für den Vergleich genügt der Text. */
function kette(url: string): string {
  const route = ROUTEN.find((eintrag) => eintrag.url === url);
  expect(route, `Route ${url} fehlt`).toBeDefined();
  return (route?.layouts ?? []).join(' > ');
}

/**
 * Alle Adressen der Anwendung, wie sie vor und nach dem Umbau erreichbar sind.
 *
 * Der Umbau hat an dieser Liste nichts geändert – das ist sein Kern: Aus
 * `admin/(core)/users/page.tsx` wurde `(dashboard)/admin/users/page.tsx`, die
 * Adresse blieb `/admin/users`.
 */
const ERWARTETE_ROUTEN = [
  '/',
  '/admin',
  '/admin/addresses',
  '/admin/announcements',
  '/admin/arcade-musik',
  '/admin/audit',
  '/admin/backups',
  '/admin/bilder',
  '/admin/moderation',
  '/admin/nodes',
  '/admin/notifications',
  '/admin/requests',
  '/admin/roles',
  '/admin/sticker',
  '/admin/storage',
  '/admin/templates',
  '/admin/users',
  '/arcade',
  '/einstellungen',
  '/login',
  '/messages',
  '/my-backups',
  '/nodes',
  '/notifications',
  '/pending',
  '/profil',
  '/register',
  '/servers',
  '/servers/[serverId]',
  '/servers/neu',
  '/skins',
];

describe('Routenbaum unter src/app', () => {
  it('bietet genau die bekannten Adressen an – der Umbau verschiebt keine URL', () => {
    expect(ROUTEN.map((route) => route.url).sort()).toEqual(ERWARTETE_ROUTEN);
  });

  it('führt jede Adresse nur einmal – keine zwei Seiten auf demselben Pfad', () => {
    const urls = ROUTEN.map((route) => route.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('hängt Administration und Dashboard unter dieselbe Layout-Kette', () => {
    const dashboard = kette('/servers');

    // Ohne diese Zusicherung tauscht Next beim Wechsel /servers <-> /admin/...
    // das Layout-Segment aus und baut den Provider-Stapel neu auf.
    expect(dashboard).toBe('layout.tsx > (dashboard)/layout.tsx');

    for (const route of ROUTEN.filter((eintrag) => eintrag.url.startsWith('/admin'))) {
      expect(route.layouts.join(' > '), `Layout-Kette von ${route.url}`).toBe(dashboard);
    }
  });

  it('baut den Rahmen an genau einer Stelle auf', () => {
    const layoutDateien = [...new Set(ROUTEN.flatMap((route) => route.layouts))];

    const mitRahmen = layoutDateien.filter((datei) =>
      readFileSync(join(APP_VERZEICHNIS, ...datei.split('/')), 'utf8').includes('DashboardShell'),
    );

    expect(mitRahmen).toEqual(['(dashboard)/layout.tsx']);
  });
});
