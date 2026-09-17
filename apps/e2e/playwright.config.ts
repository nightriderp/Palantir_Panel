/**
 * Ende-zu-Ende-Tests im Browser (Review 2026-09-16, Befund 7.2).
 *
 * Playwright startet Backend und Frontend selbst (`webServer`), beide gegen eine
 * eigene Datenbank: `E2E_DATABASE_URL`, sonst `DATABASE_URL`. Die Datenbank muss
 * migriert und geseedet sein (`db:migrate`, `db:seed`) – das erledigen die CI
 * (`.github/workflows/ci.yml`, Job `e2e`) und lokal der Aufruf in der
 * Wurzel-`package.json` (`pnpm e2e`) **nicht**; wer lokal fährt, legt sich eine
 * Datenbank `palantir_e2e` an und lässt die beiden Skripte einmal dagegen laufen.
 *
 * Zwei Projekte, derselbe Test: Desktop-Chrome und ein Smartphone (Pixel 7).
 * Die Oberfläche ist Mobile-First (Lastenheft §4); ein Ablauf, der nur am
 * Desktop klappt, ist nicht fertig.
 *
 * Der Agent ist die Dev-Attrappe (`DEV_FAKE_AGENT=true`): Sie beantwortet
 * Befehle, ohne Docker. Ein Start endet deshalb nach der Startfrist im
 * Zustand `error` – der Test prüft, dass der Start **angenommen** wird, nicht
 * dass ein Spiel läuft.
 */

import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = process.env.CI === 'true';

export const FRONTEND_URL = 'http://127.0.0.1:3000';
export const BACKEND_URL = 'http://127.0.0.1:4000';
export const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (DATABASE_URL.length === 0) {
  throw new Error(
    'E2E_DATABASE_URL (oder DATABASE_URL) fehlt – die Ende-zu-Ende-Tests brauchen eine migrierte, geseedete Datenbank.',
  );
}

/**
 * Umgebung des Backends – vollständig ausgeschrieben, damit eine lokale `.env`
 * (die `env.ts` per dotenv nachlädt) nichts hineinmischt: Gesetzte Variablen
 * überschreibt dotenv nicht.
 */
export const backendEnv: Record<string, string> = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn',
  BACKEND_HOST: '127.0.0.1',
  BACKEND_PORT: '4000',
  DATABASE_URL,
  PALANTIR_DOMAIN: 'example.test',
  PUBLIC_WEB_URL: FRONTEND_URL,
  PUBLIC_API_URL: BACKEND_URL,
  // http statt https im Test – laut Pflichtenheft §7 nur außerhalb der Produktion.
  COOKIE_SECURE: 'false',
  DEV_FAKE_AGENT: 'true',
  // Alle Spiele freischalten – der Test legt einen Terraria-Server an: kein
  // Pflichtfeld in den Optionen, kleines Kontingent.
  INSTALLATION_PHASE: '3',
  // Klein genug, dass das Widget die Aufgabe im Browser in Millisekunden löst.
  ALTCHA_COMPLEXITY: '2000',
  AGENT_TOKEN: 'e2e-agent-token-nur-fuer-den-testlauf-0123456789',
  // Geheimnisse des Auth-Moduls: nur für diesen Lauf, nie im Betrieb – dort
  // erzeugt sie scripts/setup.sh mit 64 Zeichen.
  JWT_SECRET: 'e2e-jwt-secret-nur-fuer-den-testlauf-0123456789abcdef',
  CSRF_SECRET: 'e2e-csrf-secret-nur-fuer-den-testlauf-0123456789abcdef',
  ALTCHA_HMAC_KEY: 'e2e-altcha-hmac-nur-fuer-den-testlauf-0123456789abcdef',
};

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Ein Lauf schreibt in eine gemeinsame Datenbank; nacheinander ist die
  // verlässliche Wahl.
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobil', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @palantir/backend exec tsx src/index.ts',
      url: `${BACKEND_URL}/health`,
      cwd: repoRoot,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: backendEnv,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @palantir/frontend exec next dev -p 3000 -H 127.0.0.1',
      url: `${FRONTEND_URL}/login`,
      cwd: repoRoot,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: {
        NODE_ENV: 'development',
        NEXT_PUBLIC_API_URL: BACKEND_URL,
        NEXT_PUBLIC_BASE_DOMAIN: 'example.test',
        PUBLIC_API_URL: BACKEND_URL,
        PALANTIR_DOMAIN: 'example.test',
      },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
