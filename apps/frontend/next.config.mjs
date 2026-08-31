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

/** @type {import('next').NextConfig} */
const nextConfig = {
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
