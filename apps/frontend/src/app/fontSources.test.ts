import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

/**
 * Die Oberfläche lädt keine Schriften mehr bei Google (Fundpunkt 151).
 *
 * Bis zum Arbeitspaket S-3 holte das Root-Layout Space Grotesk und JetBrains
 * Mono zur Laufzeit von `fonts.googleapis.com` bzw. `fonts.gstatic.com`. Jeder
 * Seitenaufruf – auch der auf die Anmeldeseite, also **vor** jeder Anmeldung –
 * teilte damit die IP-Adresse des Betrachters einem Dritten mit.
 *
 * Dieser Test ist die Versicherung dagegen, dass die beiden Hosts beim nächsten
 * Umbau zurückkommen. Er prüft deshalb **beides**:
 *
 * 1. Das Layout, in dem die `<link>`-Zeilen standen.
 * 2. Die Content-Security-Policy, in der die Hosts erlaubt waren. Erst mit ihr
 *    ist der Anbieter wirklich ausgeschlossen: Solange die Hosts in `style-src`
 *    und `font-src` stehen, lädt jede versehentlich stehengebliebene Regel
 *    weiter von dort – und niemand bemerkt es, weil nichts kaputtgeht.
 *
 * Geprüft werden beide Regelsätze, der durchgesetzte und der beobachtende.
 * Aktuell nennt nur der zweite Schriftquellen; genau deshalb steht der erste
 * hier mit drin, damit ein späterer Eintrag dort nicht ungeprüft bleibt.
 */

const VERBOTENE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'googleapis', 'gstatic'];

const LAYOUT = readFileSync(fileURLToPath(new URL('./layout.tsx', import.meta.url)), 'utf8');

/** Die gesetzten Sicherheits-Header, so wie Next.js sie ausliefert. */
async function header(): Promise<Record<string, string>> {
  // Ohne `headers()` gäbe es überhaupt keine Sicherheits-Header mehr – das wäre
  // kein leeres Ergebnis, sondern ein Fehler.
  expect(nextConfig.headers, 'next.config.mjs setzt keine Header mehr').toBeDefined();

  const regeln = (await nextConfig.headers?.()) ?? [];
  const eintraege = regeln.flatMap((regel) => regel.headers);

  return Object.fromEntries(eintraege.map((eintrag) => [eintrag.key, eintrag.value]));
}

describe('Schriftquellen der Oberfläche', () => {
  it('nennt in keinem Fall einen Google-Host im Root-Layout', () => {
    for (const host of VERBOTENE_HOSTS) {
      expect(LAYOUT, `Root-Layout nennt ${host}`).not.toContain(host);
    }
  });

  it('bindet stattdessen genau ein Stylesheet aus der eigenen API ein', () => {
    expect(LAYOUT).toContain('fontStylesheetUrl()');
    expect(LAYOUT).toContain('rel="stylesheet"');
  });

  it('erlaubt in keiner der beiden CSP-Regeln einen Google-Host', async () => {
    const gesetzt = await header();
    const regelsaetze = [
      gesetzt['Content-Security-Policy'],
      gesetzt['Content-Security-Policy-Report-Only'],
    ];

    for (const regeln of regelsaetze) {
      expect(regeln).toBeDefined();

      for (const host of VERBOTENE_HOSTS) {
        expect(regeln, `CSP erlaubt ${host}`).not.toContain(host);
      }
    }
  });

  it('erlaubt Stile und Schriften von der API-Herkunft', async () => {
    const gesetzt = await header();
    const beobachtet = gesetzt['Content-Security-Policy-Report-Only'] ?? '';

    // Dieselbe Herkunft, die auch `connect-src` nennt – Panel und API liegen
    // auf getrennten Subdomains, `'self'` genügt also nicht.
    const herkunft = /connect-src 'self' (\S+)/.exec(beobachtet)?.[1];

    expect(herkunft).toBeDefined();
    expect(beobachtet).toContain(`style-src 'self' 'unsafe-inline' ${herkunft}`);
    expect(beobachtet).toContain(`font-src 'self' ${herkunft} data:`);
  });
});
