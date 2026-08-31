import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_ENDPOINTS, CSRF_HEADER_NAME, apiUrl, readCsrfToken } from '@/lib/auth/api';
import { type GateState, gateRedirect, sessionStateFromEnvelope } from '@/lib/auth/routes';

/**
 * Zugriffssperre für den eingeloggten Bereich.
 *
 * Ohne diese Sperre rendert das Frontend Dashboard und Admin auch für nicht
 * angemeldete Besucher – die Daten bleiben zwar serverseitig geschützt (die API
 * verlangt eine Sitzung), aber die eingeloggte Oberfläche gehört Fremden nicht
 * gezeigt. Bisher leitete nur die Wurzel `/` clientseitig um; Deep-Links auf
 * `/servers`, `/admin` usw. waren ungeschützt.
 *
 * Die Middleware prüft die Sitzung an genau einer Stelle – serverseitig gegen
 * `/auth/session`, mit den weitergereichten Cookies – und leitet nach den Regeln
 * aus `gateRedirect()` um. Die eigentliche Rechteprüfung bleibt beim Backend;
 * hier geht es allein um „angemeldet ja/nein" und „freigeschaltet ja/nein".
 *
 * **Abgelaufenes Zugriffs-Token:** Es gilt 15 Minuten, der Refresh-Token 30 Tage
 * (Pflichtenheft §7). Ohne den Tausch an dieser Stelle landete jeder Aufruf einer
 * Seite nach einer Viertelstunde auf der Anmeldung, obwohl die Sitzung noch gilt –
 * die Erneuerung im Browser (`lib/api/client.ts`) greift erst, wenn die Seite
 * schon läuft. Gelingt der Tausch, werden die neuen Sitzungs-Cookies an die
 * Antwort gehängt; sonst bleibt es beim Weg zur Anmeldung.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const cookie = request.headers.get('cookie') ?? '';

  let state: GateState = { authed: false, awaiting: false };
  let frischeCookies: string[] = [];

  // Ohne Cookie gibt es nichts zu prüfen – spart den Roundtrip für jeden
  // anonymen Zugriff und für Bots.
  if (cookie.length > 0) {
    try {
      const response = await fetch(apiUrl(AUTH_ENDPOINTS.session), {
        headers: { cookie },
        cache: 'no-store',
      });

      // Auswertung liegt in einer reinen, getesteten Funktion; die Middleware
      // besorgt nur den Roundtrip. So ist der Envelope-Vertrag ohne Mock der
      // Next-Laufzeit prüfbar.
      let body: unknown = response.ok ? await response.json().catch(() => null) : null;

      /*
       * Nur versuchen, wenn ein CSRF-Token mitkommt: `/auth/refresh` verlangt
       * es (Pflichtenheft §7). Ohne das Token endete der Tausch garantiert mit
       * 403 - ein Aufruf, den sich jeder abgemeldete Besucher mit
       * Cookie-Resten sonst einfängt.
       */
      if (!response.ok && response.status === 401 && readCsrfToken(cookie) !== null) {
        const erneuert = await tauscheToken(cookie);
        if (erneuert !== null) {
          frischeCookies = erneuert.cookies;
          body = erneuert.body;
        }
      }

      state = sessionStateFromEnvelope(body);
    } catch {
      // API nicht erreichbar: als „nicht angemeldet" behandeln. Das leitet auf
      // die Anmeldung, statt geschützte Seiten im Blindflug zu zeigen.
    }
  }

  const ziel = gateRedirect(request.nextUrl.pathname, state);

  if (ziel !== null && ziel !== request.nextUrl.pathname) {
    const url = request.nextUrl.clone();
    url.pathname = ziel;
    url.search = '';
    return mitCookies(NextResponse.redirect(url), frischeCookies);
  }

  return mitCookies(NextResponse.next(), frischeCookies);
}

/**
 * Refresh-Token gegen ein frisches Zugriffs-Token tauschen.
 *
 * `null`, wenn der Tausch nicht durchging – dann ist die Sitzung wirklich zu
 * Ende, und das Backend hat die Cookies bereits selbst gelöscht. Die Antwort des
 * Endpunkts enthält dasselbe `{ account }` wie `/auth/session`, ein zweiter
 * Roundtrip ist deshalb unnötig.
 */
async function tauscheToken(cookie: string): Promise<{ cookies: string[]; body: unknown } | null> {
  // `/auth/refresh` ist bewusst **nicht** von der CSRF-Prüfung ausgenommen
  // (Pflichtenheft §7); das Token steht im mitgereichten Cookie.
  const csrfToken = readCsrfToken(cookie);

  const response = await fetch(apiUrl(AUTH_ENDPOINTS.refresh), {
    method: 'POST',
    headers: {
      cookie,
      Accept: 'application/json',
      ...(csrfToken === null ? {} : { [CSRF_HEADER_NAME]: csrfToken }),
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;

  return {
    cookies: response.headers.getSetCookie(),
    body: await response.json().catch(() => null),
  };
}

/** Die erneuerten Sitzungs-Cookies an die Antwort hängen. */
function mitCookies(response: NextResponse, cookies: readonly string[]): NextResponse {
  for (const wert of cookies) {
    response.headers.append('set-cookie', wert);
  }
  return response;
}

export const config = {
  // Alles außer Next-Interna und Dateien mit Endung (statische Assets). Damit
  // greift die Sperre auf jede echte Seite, ohne den Asset-Auslieferung zu
  // bremsen.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
