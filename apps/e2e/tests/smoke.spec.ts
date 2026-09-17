/**
 * Der erste Ende-zu-Ende-Smoke-Test (Review 2026-09-16, Befund 7.2):
 * anmelden (beim ersten Lauf: registrieren und Owner werden) → Server anlegen
 * → starten.
 *
 * Läuft in beiden Projekten (Desktop und Pixel 7) mit demselben Ablauf; der
 * Test navigiert über Adressen, nicht über das Menü, damit die Zeilen für beide
 * Formfaktoren gelten.
 *
 * **Ein Owner je Datenbank.** Genau ein Konto trägt den Owner-Status
 * (Lastenheft §2), und die Datenbank überlebt den Lauf. Deshalb hat der Test
 * ein festes Owner-Konto: Beim ersten Lauf registriert er es und hebt es über
 * das Backend-CLI zum Owner (wie in der Einrichtung, `deploy/README.md` §6);
 * jeder weitere Lauf meldet sich damit an. Server bekommen einen Zeitstempel im
 * Namen, aufgeräumt wird nicht – die Datenbank des Laufs ist eine
 * Wegwerf-Datenbank.
 */

import { type Page, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DATABASE_URL } from '../playwright.config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const OWNER = { username: 'e2eowner', password: 'E2e-Owner-Passwort-2026!' };

/**
 * Das Konto zum Owner heben – idempotent, solange es dasselbe Konto ist.
 *
 * Direkt über `tsx` aus dem Backend-Paket statt über `pnpm run`: Unter
 * Windows verlangt Node 24 für `.cmd`-Dateien eine Shell, und mit Shell wären
 * die Argumente nicht mehr geschützt.
 */
function zumOwnerMachen(username: string): void {
  const backend = path.join(repoRoot, 'apps', 'backend');
  const tsx = path.join(backend, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  execFileSync(process.execPath, [tsx, 'src/db/owner.ts', username], {
    cwd: backend,
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  });
}

/** Wartet, bis das ALTCHA-Widget die Aufgabe gelöst hat – erst dann nimmt das Backend das Formular an. */
async function warteAufAltcha(page: Page): Promise<void> {
  await expect(page.getByText('Sicherheitsprüfung bestanden.')).toBeVisible();
}

/**
 * Als Owner anmelden. Gibt es das Konto noch nicht (erster Lauf gegen diese
 * Datenbank), wird es registriert und zum Owner gemacht.
 */
async function alsOwnerAnmelden(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(OWNER.username);
  await page.getByLabel('Passwort', { exact: true }).fill(OWNER.password);
  await warteAufAltcha(page);
  await page.getByRole('button', { name: 'Anmelden' }).click();

  // Drei Ausgänge: Serverliste (Owner ist da), Warteseite (Konto da, aber noch
  // nicht Owner – ein abgebrochener früherer Lauf) oder Fehlermeldung (Konto
  // gibt es noch nicht). `commit` statt `load`: Die Warteseite trägt selbst
  // eine Meldung mit `role="alert"`, die sonst vor dem Ladeereignis gewinnt.
  await Promise.race([
    page.waitForURL(/\/(servers|pending)/, { waitUntil: 'commit' }),
    // Nur eine Meldung mit Text zählt: Die Seite hält eine leere `alert`-Region vor.
    page.getByRole('alert').filter({ hasText: /\S/ }).waitFor(),
  ]);
  const ergebnis = /\/servers/.test(page.url())
    ? 'angemeldet'
    : /\/pending/.test(page.url())
      ? 'wartet'
      : 'abgewiesen';

  if (ergebnis === 'angemeldet') {
    return;
  }

  if (ergebnis === 'abgewiesen') {
    await page.goto('/register');
    await page.getByLabel('Benutzername').fill(OWNER.username);
    await page.getByLabel('Passwort', { exact: true }).fill(OWNER.password);
    await warteAufAltcha(page);
    await page.getByRole('button', { name: 'Registrieren' }).click();

    // Ohne Rolle wartet ein frisches Konto auf die Freischaltung (Lastenheft §3.1).
    await expect(page).toHaveURL(/\/pending/);
  }

  zumOwnerMachen(OWNER.username);
  await page.getByRole('button', { name: 'Freischaltung prüfen' }).click();
  await expect(page).toHaveURL(/\/servers/);
}

test('Anmelden, Server anlegen und starten', async ({ page }, testInfo) => {
  const kennung = `${Date.now().toString(36)}${testInfo.project.name === 'mobil' ? 'm' : 'd'}`;
  const servername = `E2E Welt ${kennung}`;

  await alsOwnerAnmelden(page);

  // --- Server anlegen ------------------------------------------------------
  await page.goto('/servers/neu');
  await expect(page.getByRole('heading', { name: 'Wähle dein Spiel' })).toBeVisible();
  // Terraria: verfügbar ab Ausbaustufe 3, ohne Pflichtfelder (anders als
  // Minecraft mit EULA).
  await page.getByRole('button', { name: /^Terraria/ }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();

  await page.getByLabel('Servername').fill(servername);
  await page.getByLabel('Adresse').fill(`e2e-${kennung}`);
  // Genau eine Node aus dem Seed; ausgewählt wird die erste echte Option.
  await page.getByLabel('Node').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Weiter' }).click();

  // Optionen: Vorgaben reichen.
  await page.getByRole('button', { name: 'Weiter' }).click();

  await page.getByRole('button', { name: 'Server erstellen' }).click();
  await expect(page).toHaveURL(/\/servers\/[0-9a-f-]{36}$/);
  // Seitenkopf und Detailkopf tragen beide den Namen – einer reicht.
  await expect(page.getByRole('heading', { name: servername }).first()).toBeVisible();

  // --- Starten -------------------------------------------------------------
  // Die Attrappe legt den Container an; bis dahin steht der Server auf
  // „Wird erstellt …", dann „Offline".
  await expect(page.getByRole('button', { name: 'Starten' })).toBeEnabled();
  await page.getByRole('button', { name: 'Starten' }).click();

  // Angenommen heißt: Der Zustand wechselt nach `starting` – die Oberfläche
  // zeigt „Startet …". Ob das Spiel dann antwortet, kann die Attrappe nicht.
  await expect(page.getByText(/Startet …|Online/).first()).toBeVisible();
});
