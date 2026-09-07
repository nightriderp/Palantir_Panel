import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CSRF_COOKIE_NAME } from '@/lib/auth/api';
import { middleware } from './middleware';

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
