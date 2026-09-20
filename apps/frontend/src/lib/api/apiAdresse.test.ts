import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Woher das Browser-Bundle seine API-Adresse bekommt.
 *
 * Der Anlass ist kein Schönheitsfehler: Backend und Frontend leiteten die
 * Adresse **unterschiedlich** ab. Das Backend nimmt ohne `PUBLIC_API_URL`
 * `https://<Domain>/api` (`apps/backend/src/config/env.ts`,
 * `adressenAbleiten`), `next.config.mjs` nahm `https://api.<Domain>` – und
 * genau diesen Host bedient seit dem 20.09.2026 niemand mehr, seit API und
 * Panel sich einen Host teilen. Eine Instanz, die `PUBLIC_API_URL` leer lässt
 * (so steht es in `deploy/README.md` und in `.env.example`), hätte ein
 * Frontend bekommen, das auf keinen einzigen Aufruf eine Antwort erhält.
 *
 * Auffallen konnte das niemandem: Die laufende Instanz setzt den Wert
 * ausdrücklich, und in der Entwicklung zeigt er auf `localhost:4000`. Die
 * Vorgabe greift erst bei einer **neuen** Instanz – also dort, wo niemand
 * zusieht.
 */

/** Die Umgebungsvariablen, die in die Ableitung eingehen. */
const SCHLUESSEL = [
  'PALANTIR_DOMAIN',
  'PUBLIC_API_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_BASE_DOMAIN',
] as const;

let vorher: Partial<Record<(typeof SCHLUESSEL)[number], string | undefined>> = {};

beforeEach(() => {
  vorher = Object.fromEntries(SCHLUESSEL.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const schluessel of SCHLUESSEL) {
    const wert = vorher[schluessel];
    if (wert === undefined) delete process.env[schluessel];
    else process.env[schluessel] = wert;
  }
  vi.resetModules();
});

/**
 * `next.config.mjs` mit einer gesetzten Umgebung laden.
 *
 * ⚠️ Jeder Schlüssel wird gesetzt, auch wenn er leer sein soll. `dotenv`
 * überschreibt nichts, was schon in `process.env` steht – ein leerer String
 * hält die zentrale `.env` des Repos also draußen, ein `delete` nicht.
 */
async function ladeConfig(
  umgebung: Partial<Record<(typeof SCHLUESSEL)[number], string>>,
): Promise<{ env: Record<string, string> }> {
  for (const schluessel of SCHLUESSEL) process.env[schluessel] = umgebung[schluessel] ?? '';

  vi.resetModules();
  const modul = (await import('../../../next.config.mjs')) as {
    default: { env: Record<string, string> };
  };
  return modul.default;
}

describe('Vorgabe der API-Adresse im Browser-Bundle', () => {
  it('leitet ohne Angabe denselben Host ab wie das Backend', async () => {
    const config = await ladeConfig({ PALANTIR_DOMAIN: 'beispiel.tld' });

    expect(config.env.NEXT_PUBLIC_API_URL).toBe('https://beispiel.tld/api');
  });

  it('führt nicht mehr auf einen eigenen API-Host', async () => {
    const config = await ladeConfig({ PALANTIR_DOMAIN: 'beispiel.tld' });

    // Der alte Wert. Seit dem Wegfall des `palantir-api`-Routers
    // (deploy/vps/docker-compose.yml, 20.09.2026) bedient ihn niemand.
    expect(config.env.NEXT_PUBLIC_API_URL).not.toBe('https://api.beispiel.tld');
  });

  it('ein gesetztes PUBLIC_API_URL gewinnt gegen die Vorgabe', async () => {
    const config = await ladeConfig({
      PALANTIR_DOMAIN: 'beispiel.tld',
      PUBLIC_API_URL: 'http://localhost:4000',
    });

    expect(config.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:4000');
  });

  it('NEXT_PUBLIC_API_URL sticht PUBLIC_API_URL', async () => {
    const config = await ladeConfig({
      PALANTIR_DOMAIN: 'beispiel.tld',
      PUBLIC_API_URL: 'http://localhost:4000',
      NEXT_PUBLIC_API_URL: 'https://api.anders.tld',
    });

    expect(config.env.NEXT_PUBLIC_API_URL).toBe('https://api.anders.tld');
  });
});

describe('fremdeApiHerkunft – der preconnect im Wurzel-Layout', () => {
  async function herkunft(
    umgebung: Partial<Record<(typeof SCHLUESSEL)[number], string>>,
  ): Promise<string | null> {
    for (const schluessel of SCHLUESSEL) process.env[schluessel] = umgebung[schluessel] ?? '';

    vi.resetModules();
    const { fremdeApiHerkunft } = await import('@/lib/auth/api');
    return fremdeApiHerkunft();
  }

  it('schweigt, wenn die API auf der Herkunft der Seite liegt', async () => {
    // Der Regelfall seit der Zusammenlegung: ein `preconnect` auf die eigene
    // Herkunft wäre eine Zeile ohne Wirkung.
    await expect(
      herkunft({
        NEXT_PUBLIC_API_URL: 'https://beispiel.tld/api',
        NEXT_PUBLIC_BASE_DOMAIN: 'beispiel.tld',
      }),
    ).resolves.toBeNull();
  });

  it('nennt die Herkunft, wenn die API woanders liegt', async () => {
    await expect(
      herkunft({
        NEXT_PUBLIC_API_URL: 'https://api.beispiel.tld',
        NEXT_PUBLIC_BASE_DOMAIN: 'beispiel.tld',
      }),
    ).resolves.toBe('https://api.beispiel.tld');
  });

  it('schweigt bei fehlender oder unlesbarer Angabe', async () => {
    // Ein fehlender Hinweis kostet Zeit, ein falscher öffnet eine Verbindung
    // ins Leere – im Zweifel also nichts setzen.
    await expect(herkunft({ NEXT_PUBLIC_BASE_DOMAIN: 'beispiel.tld' })).resolves.toBeNull();
    await expect(herkunft({ NEXT_PUBLIC_API_URL: 'https://api.beispiel.tld' })).resolves.toBeNull();
    await expect(
      herkunft({ NEXT_PUBLIC_API_URL: 'kein:// url', NEXT_PUBLIC_BASE_DOMAIN: 'beispiel.tld' }),
    ).resolves.toBeNull();
  });
});
