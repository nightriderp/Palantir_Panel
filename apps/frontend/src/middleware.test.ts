import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ENDPOINTS, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/lib/auth/api';
import { config, middleware } from './middleware';

/**
 * Umleitungen der Zugriffssperre (Fundpunkt frontend-app-02).
 *
 * Die Entscheidung „wohin" liegt in `gateRedirect()` und ist dort getestet;
 * hier geht es um das, was die Middleware daraus baut – vor allem darum, dass
 * die Query den Sprung überlebt. Sie wurde bisher geleert, womit die einzige
 * Rückmeldung einer gescheiterten Provider-Verknüpfung (`?error=<CODE>` vom
 * Backend) verloren ging.
 *
 * `fetch` steht als Double da: Der Roundtrip zu `/auth/session` gehört zum
 * Backend, geprüft wird die Verdrahtung davor und danach.
 */

const SITZUNGS_COOKIE = `palantir_session=egal; ${CSRF_COOKIE_NAME}=csrf-token`;

const fetchDouble = vi.fn();

/** Antwort von `/auth/session` für ein angemeldetes, freigeschaltetes Konto. */
function angemeldet(awaitingApproval = false): Response {
  return new Response(
    JSON.stringify({ success: true, data: { account: { awaitingApproval } }, error: null }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Antwort von `/auth/session` ohne gültige Sitzung. */
function abgemeldet(): Response {
  return new Response(JSON.stringify({ success: false, data: null }), { status: 401 });
}

function anfrage(url: string, cookie?: string): NextRequest {
  return new NextRequest(url, cookie === undefined ? undefined : { headers: { cookie } });
}

/** Ziel einer Umleitung als Pfad samt Query. */
function ziel(response: Response): string | null {
  const location = response.headers.get('location');
  if (location === null) return null;
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  fetchDouble.mockReset();
  vi.stubGlobal('fetch', fetchDouble);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Middleware – Umleitung behält die Query (Fundpunkt frontend-app-02)', () => {
  it('reicht den Fehlercode einer gescheiterten Verknüpfung an das neue Ziel weiter', async () => {
    // Angemeldet auf `/login`: Das Backend leitet auch eine misslungene
    // Verknüpfung dorthin, die Sperre schickt weiter auf die Übersicht.
    fetchDouble.mockResolvedValue(angemeldet());

    const response = await middleware(
      anfrage('https://panel.example/login?error=AUTH_METHOD_ALREADY_LINKED', SITZUNGS_COOKIE),
    );

    expect(response.status).toBe(307);
    expect(ziel(response)).toBe('/servers?error=AUTH_METHOD_ALREADY_LINKED');
  });

  it('behält die Query auch auf dem Weg zur Anmeldung', async () => {
    const response = await middleware(anfrage('https://panel.example/servers?error=EGAL'));

    expect(ziel(response)).toBe('/login?error=EGAL');
  });

  it('hält ein noch nicht freigeschaltetes Konto mit Query auf dem Wartebildschirm', async () => {
    fetchDouble.mockResolvedValue(angemeldet(true));

    const response = await middleware(
      anfrage('https://panel.example/profil?linked=discord', SITZUNGS_COOKIE),
    );

    expect(ziel(response)).toBe('/pending?linked=discord');
  });

  it('leitet ohne Query weiterhin ohne Query um', async () => {
    const response = await middleware(anfrage('https://panel.example/servers'));

    expect(ziel(response)).toBe('/login');
  });

  it('lässt eine erlaubte Seite samt Query stehen', async () => {
    fetchDouble.mockResolvedValue(angemeldet());

    const response = await middleware(
      anfrage('https://panel.example/profil?linked=discord', SITZUNGS_COOKIE),
    );

    expect(response.headers.get('location')).toBeNull();
  });

  it('behandelt eine unerreichbare API als „nicht angemeldet"', async () => {
    fetchDouble.mockRejectedValue(new Error('Netz weg'));

    const response = await middleware(
      anfrage('https://panel.example/servers?a=1', SITZUNGS_COOKIE),
    );

    expect(ziel(response)).toBe('/login?a=1');
  });

  it('versucht ohne CSRF-Cookie gar keinen Tausch', async () => {
    // `/auth/refresh` verlangt das Token (Pflichtenheft §7); ohne Cookie-Rest
    // wäre der Aufruf ein garantierter 403.
    fetchDouble.mockResolvedValue(abgemeldet());

    await middleware(anfrage('https://panel.example/servers', 'palantir_session=egal'));

    expect(fetchDouble).toHaveBeenCalledTimes(1);
  });

  it('tauscht bei abgelaufenem Zugriffs-Token und hängt die neuen Cookies an', async () => {
    fetchDouble.mockResolvedValueOnce(abgemeldet()).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { account: {} }, error: null }), {
        status: 200,
        headers: { 'set-cookie': 'palantir_session=neu; Path=/; HttpOnly' },
      }),
    );

    const response = await middleware(
      anfrage('https://panel.example/servers?a=1', SITZUNGS_COOKIE),
    );

    // Sitzung gilt wieder: keine Umleitung, aber frische Cookies an der Antwort.
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toContain('palantir_session=neu');
  });
});

/**
 * Der Tausch-Zweig im Einzelnen (Audit W2-29, `test-gaps-10`).
 *
 * Das Zugriffs-Token gilt 15 Minuten, der Refresh-Token 30 Tage
 * (Pflichtenheft §7). Ohne diesen Zweig landete jeder Seitenaufruf nach einer
 * Viertelstunde auf der Anmeldung, obwohl die Sitzung noch gilt. Geprüft wird
 * deshalb nicht nur der glückliche Fall, sondern auch, **womit** getauscht wird
 * und was bei einem gescheiterten Tausch passiert.
 */
describe('Middleware – Erneuerung des Zugriffs-Tokens', () => {
  /** Antwort von `/auth/refresh` mit beliebig vielen Sitzungs-Cookies. */
  function erneuert(cookies: readonly string[], awaitingApproval = false): Response {
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const wert of cookies) headers.append('set-cookie', wert);

    return new Response(
      JSON.stringify({ success: true, data: { account: { awaitingApproval } }, error: null }),
      { status: 200, headers },
    );
  }

  it('ruft /auth/refresh als POST mit dem CSRF-Kopf auf', async () => {
    fetchDouble
      .mockResolvedValueOnce(abgemeldet())
      .mockResolvedValueOnce(erneuert(['palantir_session=neu']));

    await middleware(anfrage('https://panel.example/servers', SITZUNGS_COOKIE));

    expect(fetchDouble).toHaveBeenCalledTimes(2);

    const [url, init] = fetchDouble.mock.calls[1] as [string, RequestInit];

    expect(url).toContain(AUTH_ENDPOINTS.refresh);
    expect(init.method).toBe('POST');
    // Ohne den Kopf endete der Tausch am CSRF-Schutz (Pflichtenheft §7).
    expect((init.headers as Record<string, string>)[CSRF_HEADER_NAME]).toBe('csrf-token');
    expect((init.headers as Record<string, string>).cookie).toBe(SITZUNGS_COOKIE);
  });

  it('hängt jeden gelieferten Cookie an – nicht nur den ersten', async () => {
    fetchDouble
      .mockResolvedValueOnce(abgemeldet())
      .mockResolvedValueOnce(
        erneuert(['palantir_session=neu; Path=/', 'palantir_refresh=neu; Path=/']),
      );

    const response = await middleware(anfrage('https://panel.example/servers', SITZUNGS_COOKIE));
    const gesetzt = response.headers.getSetCookie();

    expect(gesetzt).toHaveLength(2);
    expect(gesetzt.join(' ')).toContain('palantir_refresh=neu');
  });

  it('führt ein noch nicht freigeschaltetes Konto trotz Tausch auf den Wartebildschirm', async () => {
    fetchDouble
      .mockResolvedValueOnce(abgemeldet())
      .mockResolvedValueOnce(erneuert(['palantir_session=neu'], true));

    const response = await middleware(anfrage('https://panel.example/servers', SITZUNGS_COOKIE));

    expect(ziel(response)).toBe('/pending');
    // Die frischen Cookies gehen trotzdem mit: sonst liefe der nächste Aufruf
    // erneut in den Tausch.
    expect(response.headers.get('set-cookie')).toContain('palantir_session=neu');
  });

  it('leitet ohne Cookies zur Anmeldung, wenn der Tausch abgelehnt wird', async () => {
    fetchDouble.mockResolvedValueOnce(abgemeldet()).mockResolvedValueOnce(
      // Der Refresh-Token ist wirklich zu Ende; das Backend hat die Cookies
      // bereits selbst gelöscht.
      new Response(JSON.stringify({ success: false, data: null }), { status: 401 }),
    );

    const response = await middleware(
      anfrage('https://panel.example/servers?a=1', SITZUNGS_COOKIE),
    );

    expect(ziel(response)).toBe('/login?a=1');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('versucht den Tausch nur bei 401, nicht bei einem Serverfehler', async () => {
    fetchDouble.mockResolvedValue(new Response('kaputt', { status: 500 }));

    const response = await middleware(anfrage('https://panel.example/servers', SITZUNGS_COOKIE));

    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(ziel(response)).toBe('/login');
  });

  it('behandelt eine Tausch-Antwort ohne verwertbaren Rumpf als nicht angemeldet', async () => {
    fetchDouble
      .mockResolvedValueOnce(abgemeldet())
      .mockResolvedValueOnce(new Response('kein json', { status: 200 }));

    const response = await middleware(anfrage('https://panel.example/servers', SITZUNGS_COOKIE));

    expect(ziel(response)).toBe('/login');
  });

  it('fällt auf die Anmeldung zurück, wenn der Tausch selbst am Netz scheitert', async () => {
    fetchDouble.mockResolvedValueOnce(abgemeldet()).mockRejectedValueOnce(new Error('Netz weg'));

    const response = await middleware(anfrage('https://panel.example/servers', SITZUNGS_COOKIE));

    expect(ziel(response)).toBe('/login');
  });

  it('spart den Roundtrip für einen Besucher ganz ohne Cookie', async () => {
    const response = await middleware(anfrage('https://panel.example/servers'));

    expect(fetchDouble).not.toHaveBeenCalled();
    expect(ziel(response)).toBe('/login');
  });

  it('lässt eine gültige Sitzung unangetastet – kein Tausch, keine Cookies', async () => {
    fetchDouble.mockResolvedValue(angemeldet());

    const response = await middleware(anfrage('https://panel.example/servers', SITZUNGS_COOKIE));

    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

/**
 * Die Wurzel `/` – Fundpunkt frontend-app-07.
 *
 * Unter `src/app` liegt keine `page.tsx` mehr: Sie wurde nie gerendert, weil
 * die Sperre jede Anfrage auf `/` weiterleitet, und hielt daneben eine zweite,
 * clientseitige Fassung derselben Entscheidung vor. Damit die Löschung nicht
 * eines Tages einen 404 hinterlässt, hängen zwei Bedingungen daran: Der Matcher
 * muss `/` erfassen, und `gateRedirect()` muss für `/` in jedem Zustand ein Ziel
 * liefern (dort geprüft). Beides steht hier bzw. in `lib/auth/routes.test.ts`.
 */
describe('Middleware – Wurzel ohne eigene Seite (Fundpunkt frontend-app-07)', () => {
  it('erfasst `/` mit dem Matcher', () => {
    const muster = config.matcher.map((eintrag) => new RegExp(`^${eintrag}$`));

    expect(muster.some((regex) => regex.test('/'))).toBe(true);
    // Gegenprobe: Dateien mit Endung bleiben bewusst außen vor.
    expect(muster.some((regex) => regex.test('/logo.svg'))).toBe(false);
  });

  it('leitet einen anonymen Besucher der Wurzel zur Anmeldung', async () => {
    const response = await middleware(anfrage('https://panel.example/'));

    expect(ziel(response)).toBe('/login');
  });

  it('leitet ein wartendes Konto von der Wurzel auf den Wartebildschirm', async () => {
    fetchDouble.mockResolvedValue(angemeldet(true));

    const response = await middleware(anfrage('https://panel.example/', SITZUNGS_COOKIE));

    expect(ziel(response)).toBe('/pending');
  });

  it('leitet ein freigeschaltetes Konto von der Wurzel auf die Übersicht', async () => {
    fetchDouble.mockResolvedValue(angemeldet());

    const response = await middleware(anfrage('https://panel.example/', SITZUNGS_COOKIE));

    expect(ziel(response)).toBe('/servers');
  });
});
