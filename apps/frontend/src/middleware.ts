import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_ENDPOINTS, apiUrl } from '@/lib/auth/api';
import { gateRedirect } from '@/lib/auth/routes';

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
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const cookie = request.headers.get('cookie') ?? '';

  let authed = false;
  let awaiting = false;

  // Ohne Cookie gibt es nichts zu prüfen – spart den Roundtrip für jeden
  // anonymen Zugriff und für Bots.
  if (cookie.length > 0) {
    try {
      const response = await fetch(apiUrl(AUTH_ENDPOINTS.session), {
        headers: { cookie },
        cache: 'no-store',
      });

      if (response.ok) {
        authed = true;
        const body: unknown = await response.json().catch(() => null);
        awaiting = Boolean(
          (body as { data?: { awaitingApproval?: boolean } } | null)?.data?.awaitingApproval,
        );
      }
    } catch {
      // API nicht erreichbar: als „nicht angemeldet" behandeln. Das leitet auf
      // die Anmeldung, statt geschützte Seiten im Blindflug zu zeigen.
    }
  }

  const ziel = gateRedirect(request.nextUrl.pathname, { authed, awaiting });

  if (ziel !== null && ziel !== request.nextUrl.pathname) {
    const url = request.nextUrl.clone();
    url.pathname = ziel;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Alles außer Next-Interna und Dateien mit Endung (statische Assets). Damit
  // greift die Sperre auf jede echte Seite, ohne den Asset-Auslieferung zu
  // bremsen.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
