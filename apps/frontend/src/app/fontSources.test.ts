import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';
import { baueCsp } from '@/lib/csp';

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
 * Geprüft werden beide Regelsätze: der statische Grundschutz aus
 * `next.config.mjs` und die vollständige Regel, die `src/proxy.ts` je Anfrage
 * setzt (`lib/csp.ts`, seit dem Review 2026-09-16 durchgesetzt statt nur
 * beobachtet). Nur die zweite nennt Schriftquellen; die erste steht mit drin,
 * damit ein späterer Eintrag dort nicht ungeprüft bleibt.
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

  /** Die je Anfrage durchgesetzte Regel, mit einer Beispiel-Herkunft der API. */
  const HERKUNFT = 'https://api.example.test';
  const durchgesetzt = baueCsp({
    nonce: 'probe',
    apiUrl: HERKUNFT,
    liveWsUrl: 'wss://api.example.test',
    entwicklung: false,
  });

  it('erlaubt in keiner der beiden CSP-Regeln einen Google-Host', async () => {
    const gesetzt = await header();
    const regelsaetze = [gesetzt['Content-Security-Policy'], durchgesetzt];

    for (const regeln of regelsaetze) {
      expect(regeln).toBeDefined();

      for (const host of VERBOTENE_HOSTS) {
        expect(regeln, `CSP erlaubt ${host}`).not.toContain(host);
      }
    }
  });

  it('erlaubt Stile und Schriften von der API-Herkunft', () => {
    // Dieselbe Herkunft, die auch `connect-src` nennt – Panel und API liegen
    // auf getrennten Subdomains, `'self'` genügt also nicht.
    expect(durchgesetzt).toContain(`connect-src 'self' ${HERKUNFT}`);
    expect(durchgesetzt).toContain(`style-src 'self' 'unsafe-inline' ${HERKUNFT}`);
    expect(durchgesetzt).toContain(`font-src 'self' ${HERKUNFT} data:`);
  });

  it('setzt keinen Beobachtungs-Kopf mehr – die Regel wird durchgesetzt', async () => {
    const gesetzt = await header();

    expect(gesetzt['Content-Security-Policy-Report-Only']).toBeUndefined();
    // Der statische Grundschutz darf kein `default-src` tragen: Zwei CSP-Köpfe
    // gelten beide, und er würde die nonce-tragenden Skripte blockieren.
    expect(gesetzt['Content-Security-Policy']).not.toContain('default-src');
  });
});
