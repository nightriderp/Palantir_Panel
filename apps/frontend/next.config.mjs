import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// Die zentrale `.env` liegt im Repo-Root (Pflichtenheft §12.1). Next.js liest von
// sich aus nur `.env`-Dateien im App-Verzeichnis, deshalb hier ausdrücklich.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

/** Trägt der Wert ausschließlich ASCII-Zeichen? Dann ist nichts umzurechnen. */
const nurAscii = (wert) => {
  for (const zeichen of wert) {
    if ((zeichen.codePointAt(0) ?? 0) > 0x7f) return false;
  }
  return true;
};

/**
 * Hostname in die ASCII-Form bringen – dieselbe Regel wie im Backend
 * (`apps/backend/src/config/domain-ascii.ts`, dort steht die ausführliche
 * Begründung). Kurz: `müf-it.de` und `xn--mf-it-kva.de` sind derselbe Name,
 * aber der Browser schickt immer die zweite Form, und CORS vergleicht die
 * Zeichenkette. Stünde im Bundle die Umlaut-Form, käme auf keinen API-Aufruf
 * eine Antwort.
 *
 * Hier bewusst noch einmal ausgeschrieben statt importiert: Diese Datei ist
 * einfaches ESM, das Node beim Bau lädt – ein Workspace-Package mit
 * TypeScript-Quelle steht zu diesem Zeitpunkt nicht zur Verfügung. Dieselbe
 * Doppelung gilt schon für die Ableitung der API-Adresse darunter.
 *
 * Ein reiner ASCII-Wert wird unverändert durchgereicht.
 */
const alsAscii = (name) => {
  if (nurAscii(name)) return name;
  try {
    return new URL(`https://${name}`).hostname;
  } catch {
    throw new Error(`PALANTIR_DOMAIN ist kein gültiger Hostname: „${name}".`);
  }
};

// Der Domainname wird ausschließlich über PALANTIR_DOMAIN gepflegt. Alles
// Abgeleitete folgt daraus, bleibt aber einzeln überschreibbar – dieselbe Regel
// wie im Backend (`apps/backend/src/config/env.ts`, `adressenAbleiten`).
const domain = alsAscii(process.env.PALANTIR_DOMAIN ?? 'palantir.local');

// Adresse der Backend-API, wie der Browser sie sieht. Der Wert ist absolut –
// ein relativer Aufruf landet sonst beim Frontend selbst und endet in einem 404.
// Die Reihenfolge entspricht der des Backends
// (`apps/backend/src/config/env.ts`, `adressenAbleiten`): ein ausdrücklich
// gesetztes PUBLIC_API_URL gewinnt, sonst wird aus der Domain abgeleitet. Damit
// trifft es die Entwicklungsumgebung (`http://localhost:4000`) genauso wie die
// VPS, wo nur PALANTIR_DOMAIN gepflegt wird.
//
// ⚠️ **Die Vorgabe ist `https://<domain>/api`, nicht `https://api.<domain>`.**
// Hier stand das Zweite, und damit wichen Backend und Frontend seit dem
// 20.09.2026 voneinander ab: Das Backend leitet `https://${domain}/api` ab
// (`env.ts`, `adressenAbleiten`), und mit demselben Datum ist der eigene
// API-Router aus `deploy/vps/docker-compose.yml` entfernt worden – API und
// Panel teilen sich seither einen Host, damit die Sitzungs-Cookies host-only
// bleiben (`deploy/README.md`, Abschnitt 7.2). Eine Instanz, die
// `PUBLIC_API_URL` leer lässt – genau das empfiehlt die Anleitung dort –, bekam
// hier trotzdem `https://api.<domain>` in ihr Browser-Bundle geschrieben: eine
// Adresse, die niemand mehr bedient. Das Panel hätte auf keinen einzigen
// API-Aufruf eine Antwort bekommen. Dass es im Betrieb nicht auffiel, liegt
// allein daran, dass diese Instanz `PUBLIC_API_URL` ausdrücklich setzt.
//
// Nebenwirkung, die das Ganze überhaupt ans Licht brachte: Über die Vorgabe
// liegt die API auf **derselben Herkunft** wie die Seite. Das render-blockende
// Schrift-Stylesheet (`src/app/layout.tsx`) braucht damit keine zweite
// Verbindung mehr, bevor der erste Text steht.
const adresseAlsAscii = (wert) => {
  if (nurAscii(wert)) return wert;
  const href = new URL(wert).href;
  return href.endsWith('/') && !wert.endsWith('/') ? href.slice(0, -1) : href;
};

const apiUrl = adresseAlsAscii(
  process.env.NEXT_PUBLIC_API_URL || process.env.PUBLIC_API_URL || `https://${domain}/api`,
);

/**
 * Content-Security-Policy (Audit W2-6, security-matrix-10).
 *
 * Hier steht nur der **statische Grundschutz**, der für jede Antwort gilt –
 * auch für die, die nicht durch `src/proxy.ts` laufen (statische Dateien,
 * `/fassung`): kein fremder Rahmen (Clickjacking auf „Server löschen"), keine
 * untergeschobene `<base>`-Adresse, keine Plugins, Formularziele nur die eigene
 * Herkunft. Bewusst ohne `default-src`: Zwei CSP-Köpfe gelten beide, und ein
 * `default-src 'self'` hier würde die nonce-tragenden Inline-Skripte der Seiten
 * blockieren.
 *
 * Die **vollständige Regel** – Skripte nur mit Nonce, Stile, Schriften, Bilder,
 * Live-Kanal – setzt `src/proxy.ts` je Anfrage (`lib/csp.ts`). Sie lief bis
 * zum Review 2026-09-16 (Befunde 3.4/12.3) nur als `Report-Only`, weil Next.js
 * seine Skripte ohne Nonce in die Seite hängte; seit der Nonce ist sie
 * durchgesetzt und der Beobachtungs-Kopf entfallen. Eine Regel, die man nur
 * beobachtet, hält keinen Angriff auf.
 */
const cspErzwungen = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Sicherheits-Header der Weboberfläche (Audit W2-6, security-matrix-10).
   *
   * Dieselben Werte setzt zusätzlich die Traefik-Middleware
   * (`deploy/vps/docker-compose.yml`) - hier stehen sie, damit sie auch bei
   * einem Start ohne Reverse-Proxy und in der Entwicklung gelten. HSTS bleibt
   * bewusst bei Traefik: Nur dort ist bekannt, ob TLS tatsächlich anliegt.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: cspErzwungen },
        ],
      },
    ];
  },
  reactStrictMode: true,
  // Workspace-Packages werden als TypeScript-Quelle mitkompiliert.
  transpilePackages: ['@palantir/contracts', '@palantir/validation'],
  // Erzeugt unter `.next/standalone` einen eigenständigen Server samt der
  // tatsächlich benötigten Abhängigkeiten. Ohne das müsste das Laufzeit-Image
  // den kompletten node_modules-Baum mitschleppen.
  output: 'standalone',
  // Im Monorepo muss die Wurzel ausdrücklich benannt werden, sonst verfolgt
  // Next.js die Dateien nur ab `apps/frontend` und lässt die Workspace-Packages
  // aus `packages/` weg.
  outputFileTracingRoot: repoRoot,
  env: {
    // NEXT_PUBLIC_-Variablen werden zur Bauzeit eingesetzt und müssen daher
    // hier aufgelöst werden – zur Laufzeit ist die zentrale `.env` im Browser
    // nicht verfügbar.
    // Ebenfalls in der ASCII-Form: Der Wert dient nicht nur der Anzeige im
    // Wizard, sondern in `lib/auth/api.ts` auch dem Vergleich mit der
    // tatsächlichen Herkunft der Seite. Auch angezeigt wird sie so: Spieler
    // tippen die Serveradresse in ihr Spiel, und Spiel-Clients können keine
    // Umlaut-Domains (Fundpunkt 340).
    NEXT_PUBLIC_BASE_DOMAIN: alsAscii(process.env.NEXT_PUBLIC_BASE_DOMAIN || domain),
    NEXT_PUBLIC_API_URL: apiUrl,
    // Die angezeigte Version steht bewusst NICHT hier: Sie ist das Versions-Tag
    // des Deployments und existiert zur Bauzeit noch gar nicht (die Images
    // entstehen beim Merge nach `main`, das Tag erst beim Freigeben). Sie kommt
    // zur Laufzeit über `PALANTIR_RELEASE` – siehe `src/lib/version.ts`.
  },
};

export default nextConfig;
