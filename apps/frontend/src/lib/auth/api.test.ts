import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ENDPOINTS, CSRF_COOKIE_NAME, readCsrfToken } from './api';

describe('CSRF-Token aus dem Cookie (Pflichtenheft §7)', () => {
  it('liest das Token aus einer Cookie-Zeile mit mehreren Einträgen', () => {
    expect(readCsrfToken(`theme=dark; ${CSRF_COOKIE_NAME}=abc123; other=1`)).toBe('abc123');
  });

  it('kommt mit einem einzelnen Eintrag ohne Leerzeichen zurecht', () => {
    expect(readCsrfToken(`${CSRF_COOKIE_NAME}=abc123`)).toBe('abc123');
  });

  it('dekodiert prozentkodierte Werte', () => {
    expect(readCsrfToken(`${CSRF_COOKIE_NAME}=a%2Fb%3Dc`)).toBe('a/b=c');
  });

  it('behält Gleichheitszeichen im Wert – base64 endet oft darauf', () => {
    expect(readCsrfToken(`${CSRF_COOKIE_NAME}=dG9rZW4=`)).toBe('dG9rZW4=');
  });

  it('liefert null, wenn kein Token gesetzt ist', () => {
    expect(readCsrfToken('theme=dark')).toBeNull();
    expect(readCsrfToken('')).toBeNull();
  });

  it('verwechselt es nicht mit einem ähnlich benannten Cookie', () => {
    expect(readCsrfToken(`x_${CSRF_COOKIE_NAME}=fremd`)).toBeNull();
  });
});

describe('Endpunkte (Pflichtenheft §5.3)', () => {
  it('folgt bei OAuth den Redirect-URIs aus .env.example §5', () => {
    expect(AUTH_ENDPOINTS.oauthStart('discord')).toBe('/auth/discord/start');
    expect(AUTH_ENDPOINTS.oauthStart('steam')).toBe('/auth/steam/start');
  });

  it('führt alle Pfade unter /auth', () => {
    const paths = [
      AUTH_ENDPOINTS.login,
      AUTH_ENDPOINTS.twoFactor,
      AUTH_ENDPOINTS.register,
      AUTH_ENDPOINTS.session,
      AUTH_ENDPOINTS.logout,
      AUTH_ENDPOINTS.altchaChallenge,
    ];
    for (const path of paths) {
      expect(path.startsWith('/auth/')).toBe(true);
    }
  });
});

/**
 * Erneuerung über Tab-Grenzen hinweg (Fundpunkt frontend-lib-01).
 *
 * Die Bündelung im Modul gilt nur je Tab. Zwei offene Tabs tauschten sonst
 * gleichzeitig denselben Refresh-Token ein; das Backend sah eine
 * Wiederverwendung und widerrief alle Sitzungen. Geprüft wird hier die
 * Abstimmung: Wer wartet, wer tauscht, und was passiert, wenn der andere Tab
 * verschwindet.
 *
 * Das Modul wird je Test frisch geladen, weil die Bündelung im Modulzustand
 * liegt.
 */

/** Nachbau von `BroadcastChannel`: zustellen an alle offenen Kanäle. */
class FakeKanal {
  static offen: FakeKanal[] = [];

  onmessage: ((ereignis: { data: unknown }) => void) | null = null;

  private geschlossen = false;

  constructor(readonly name: string) {
    FakeKanal.offen.push(this);
  }

  postMessage(data: unknown): void {
    for (const kanal of FakeKanal.offen) {
      if (kanal !== this && !kanal.geschlossen) kanal.onmessage?.({ data });
    }
  }

  close(): void {
    this.geschlossen = true;
  }
}

/** Nachbau von `localStorage` mit einsehbarem Inhalt. */
function fakeSpeicher(anfang: Record<string, string> = {}) {
  const daten = new Map(Object.entries(anfang));

  return {
    daten,
    getItem: (schluessel: string): string | null => daten.get(schluessel) ?? null,
    setItem: (schluessel: string, wert: string): void => {
      daten.set(schluessel, wert);
    },
    removeItem: (schluessel: string): void => {
      daten.delete(schluessel);
    },
  };
}

const SPERRE = 'palantir.auth.erneuerung';

describe('Erneuerung mit Sperre über mehrere Tabs (Fundpunkt frontend-lib-01)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let speicher: ReturnType<typeof fakeSpeicher>;

  async function ladeApi() {
    vi.resetModules();
    return import('./api');
  }

  beforeEach(() => {
    FakeKanal.offen = [];
    fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    speicher = fakeSpeicher();
    vi.stubGlobal('fetch', fetchMock);
    // `refreshSession()` tut ohne Dokument nichts.
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('localStorage', speicher);
    vi.stubGlobal('BroadcastChannel', FakeKanal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tauscht selbst und räumt die Sperre danach wieder ab', async () => {
    const { refreshSession } = await ladeApi();

    const erfolg = await refreshSession();

    expect(erfolg).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(speicher.daten.has(SPERRE)).toBe(false);
  });

  it('wartet auf das Ergebnis des anderen Tabs, statt selbst zu tauschen', async () => {
    const { refreshSession } = await ladeApi();
    speicher.setItem(SPERRE, String(Date.now()));

    const wartend = refreshSession();
    // Der andere Tab meldet seinen erfolgreichen Tausch.
    new FakeKanal('palantir.auth.erneuerung').postMessage({ erneuert: true });

    await expect(wartend).resolves.toBe(true);
    // Entscheidend: kein zweiter Einlöseversuch mit demselben Token.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('übernimmt den gescheiterten Tausch des anderen Tabs, ohne ihn zu wiederholen', async () => {
    const { refreshSession } = await ladeApi();
    speicher.setItem(SPERRE, String(Date.now()));

    const wartend = refreshSession();
    new FakeKanal('palantir.auth.erneuerung').postMessage({ erneuert: false });

    await expect(wartend).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tauscht selbst, wenn der andere Tab verschwindet, ohne zu melden', async () => {
    const { refreshSession } = await ladeApi();
    speicher.setItem(SPERRE, String(Date.now()));

    const wartend = refreshSession();
    // Tab geschlossen: die Sperre fällt weg, es kommt nie eine Meldung.
    speicher.removeItem(SPERRE);

    await expect(wartend).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignoriert eine verwaiste Sperre eines abgestürzten Tabs', async () => {
    const { refreshSession } = await ladeApi();
    speicher.setItem(SPERRE, String(Date.now() - 60_000));

    await expect(refreshSession()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bündelt mehrere Aufrufe desselben Tabs zu einem Tausch', async () => {
    const { refreshSession } = await ladeApi();

    await Promise.all([refreshSession(), refreshSession(), refreshSession()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('kommt ohne Speicher und ohne Kanal aus', async () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('BroadcastChannel', undefined);
    const { refreshSession } = await ladeApi();

    await expect(refreshSession()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
