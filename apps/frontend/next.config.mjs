import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// Die zentrale `.env` liegt im Repo-Root (Pflichtenheft §12.1). Next.js liest von
// sich aus nur `.env`-Dateien im App-Verzeichnis, deshalb hier ausdrücklich.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

// Der Domainname wird ausschließlich über PALANTIR_DOMAIN gepflegt. Alles
// Abgeleitete folgt daraus, bleibt aber einzeln überschreibbar – dieselbe Regel
// wie im Backend (`apps/backend/src/config/env.ts`, `adressenAbleiten`).
const domain = process.env.PALANTIR_DOMAIN ?? 'palantir.local';

// Adresse der Backend-API, wie der Browser sie sieht. Frontend und API liegen
// auf getrennten Subdomains (`<domain>` bzw. `api.<domain>`), deshalb muss der
// Wert absolut sein – ein relativer Aufruf landet beim Frontend selbst und endet
// in einem 404. Die Reihenfolge entspricht der des Backends
// (`apps/backend/src/config/env.ts`, `adressenAbleiten`): ein ausdrücklich
// gesetztes PUBLIC_API_URL gewinnt, sonst wird aus der Domain abgeleitet. Damit
// trifft es die Entwicklungsumgebung (`http://localhost:4000`) genauso wie die
// VPS, wo nur PALANTIR_DOMAIN gepflegt wird.
const apiUrl =
  process.env.NEXT_PUBLIC_API_URL || process.env.PUBLIC_API_URL || `https://api.${domain}`;

// Adresse des Live-Kanals (WebSocket). Steht sie nicht in der .env, ergibt sie
// sich wie im Frontend-Code aus der API-Adresse mit ws:// bzw. wss://.
const liveWsUrl =
  process.env.NEXT_PUBLIC_LIVE_WS_URL || apiUrl.replace(/^http/, 'ws').replace(/\/+$/, '');

/**
 * Content-Security-Policy (Audit W2-6, security-matrix-10).
 *
 * Zwei Header, bewusst getrennt:
 *
 * 1. **Durchgesetzt** wird nur, was nichts brechen kann und trotzdem die
 *    wichtigsten Angriffe abdeckt: kein fremder Rahmen (Clickjacking auf
 *    „Server löschen"), keine untergeschobene `<base>`-Adresse, keine Plugins,
 *    Formularziele nur die eigene Herkunft.
 * 2. **Nur beobachtet** (`Report-Only`) wird die vollständige Regel für das
 *    Laden von Skripten, Stilen, Schriften und Bildern. Next.js liefert seine
 *    Bootstrap-Skripte und Stile inline und ohne Nonce, die Schriften kommen
 *    von Google (`layout.tsx`, bewusste Entscheidung), und Profilbilder liegen
 *    auf den CDNs der Anmelde-Anbieter. Eine durchgesetzte Regel würde bei der
 *    kleinsten Auslassung die Oberfläche zerlegen; im Report-Only-Modus meldet
 *    der Browser Verstöße in seiner Konsole, ohne etwas zu blockieren.
 *
 * Der zweite Header wird durchgesetzt, sobald die Meldungen über eine
 * Betriebsphase hinweg leer bleiben (dann `-Report-Only` aus dem Namen nehmen).
 */
const cspErzwungen = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const cspBeobachtet = [
  "default-src 'self'",
  // `unsafe-inline`/`unsafe-eval`: Next.js hängt seine Hydrations-Skripte ohne
  // Nonce in die Seite; in der Entwicklung kommt der Refresh-Mechanismus dazu.
  process.env.NODE_ENV === 'development'
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  // Google Fonts: Stylesheet von fonts.googleapis.com, Schriftdateien von
  // fonts.gstatic.com (siehe `src/app/layout.tsx`).
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // Profilbilder der Anmelde-Anbieter (Discord/Twitch/Steam-CDN) - deren Hosts
  // stehen nicht fest, deshalb `https:`.
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${apiUrl} ${liveWsUrl}`,
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
          { key: 'Content-Security-Policy-Report-Only', value: cspBeobachtet },
        ],
      },
    ];
  },
  reactStrictMode: true,
  // Workspace-Packages werden als TypeScript-Quelle mitkompiliert.
  transpilePackages: ['@palantir/contracts', '@palantir/validation'],
  eslint: {
    dirs: ['src'],
  },
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
    NEXT_PUBLIC_BASE_DOMAIN: process.env.NEXT_PUBLIC_BASE_DOMAIN || domain,
    NEXT_PUBLIC_API_URL: apiUrl,
    // Die angezeigte Version steht bewusst NICHT hier: Sie ist das Versions-Tag
    // des Deployments und existiert zur Bauzeit noch gar nicht (die Images
    // entstehen beim Merge nach `main`, das Tag erst beim Freigeben). Sie kommt
    // zur Laufzeit über `PALANTIR_RELEASE` – siehe `src/lib/version.ts`.
  },
};

export default nextConfig;
