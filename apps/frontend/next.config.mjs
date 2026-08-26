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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace-Packages werden als TypeScript-Quelle mitkompiliert.
  transpilePackages: ['@palantir/contracts', '@palantir/validation'],
  eslint: {
    dirs: ['src'],
  },
  env: {
    // NEXT_PUBLIC_-Variablen werden zur Bauzeit eingesetzt und müssen daher
    // hier aufgelöst werden – zur Laufzeit ist die zentrale `.env` im Browser
    // nicht verfügbar.
    NEXT_PUBLIC_BASE_DOMAIN: process.env.NEXT_PUBLIC_BASE_DOMAIN || domain,
  },
};

export default nextConfig;
