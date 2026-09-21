/**
 * Die Bildbibliothek für das Motion-Video.
 *
 * Das Motion-Video zeigt keine Bildschirmaufnahme, sondern **Ausschnitte** des
 * Panels als schwebende Kacheln auf einem Farbverlauf. Dieses Skript legt den
 * Vorrat an: Vollbilder für den Hintergrund und einzelne Bauteile – eine
 * Serverkarte, die Messwert-Kacheln, die Konsole –, die im Film für sich
 * stehen können.
 *
 * Aufgenommen wird als **normaler Nutzer**, nicht als Owner: Die Bilder sollen
 * dieselbe Oberfläche zeigen wie das andere Video.
 *
 *     node motion/bilder.mjs            # alles
 *     node motion/bilder.mjs konsole    # nur dieses Bild
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ZIEL = path.join(HIER, 'bilder');
const BASIS = process.env.DEMO_WEB ?? 'http://127.0.0.1:3000';
const KONTO = { name: 'mika', passwort: 'Palantir-Demo-2026!' };

/**
 * Den Rundgang für neue Konten abhaken.
 *
 * Das Panel begrüßt jedes frische Konto mit einer Führung, die sich über die
 * Seite legt – gut für echte Nutzer, tödlich für eine Aufnahme: Im ersten Lauf
 * lag das Fenster „Kurz stehen bleiben" über jedem einzelnen Bild. Der Stand
 * liegt im Browserspeicher, also wird er vor dem ersten Laden gesetzt.
 */
function rundgangUeberspringen() {
  try {
    window.localStorage.setItem('palantir.rundgang', 'erledigt');
  } catch {
    /* Ohne Speicher zeigt die Führung sich eben – dann hilft nur Wegklicken. */
  }
}

/**
 * Was aufgenommen wird.
 *
 * `teil` ist ein Playwright-Ausdruck für ein einzelnes Element; ohne ihn
 * entsteht ein Vollbild. `warteAuf` hält die Aufnahme an, bis die Seite
 * wirklich etwas zeigt – sonst landen leere Kacheln in der Bibliothek.
 */
const BILDER = [
  {
    name: 'anmeldung',
    pfad: '/login',
    abgemeldet: true,
    warteAuf: 'text=Willkommen',
    beruhigen: 1_200,
  },
  { name: 'uebersicht', pfad: '/servers', warteAuf: 'text=Freundeskreis SMP', beruhigen: 6_000 },
  {
    name: 'serverkarte',
    pfad: '/servers',
    warteAuf: 'text=Freundeskreis SMP',
    beruhigen: 6_000,
    // Bewusst innerhalb von `main`: Denselben Namen trägt der Eintrag in der
    // Seitenleiste, und der ist im Markup der erste Treffer.
    teil: (seite) =>
      kachelUm(seite.locator('main').getByText('Freundeskreis SMP', { exact: true }).first(), {
        breite: 350,
        hoehe: 260,
      }),
  },
  { name: 'assistent', pfad: '/servers/neu', warteAuf: 'text=Wähle dein Spiel', beruhigen: 2_000 },
  {
    name: 'erfolge',
    pfad: '/erfolge',
    warteAuf: 'body',
    beruhigen: 2_500,
  },
  {
    name: 'profil',
    pfad: '/profil',
    warteAuf: 'body',
    beruhigen: 2_500,
  },
  {
    name: 'nachrichten',
    pfad: '/messages',
    warteAuf: 'body',
    beruhigen: 2_000,
  },
  {
    name: 'arcade',
    pfad: '/arcade',
    warteAuf: 'body',
    beruhigen: 2_500,
  },
  {
    name: 'sicherungen',
    pfad: '/my-backups',
    warteAuf: 'body',
    beruhigen: 2_000,
  },
  // --- Bauteile der Serverseite (Pfad wird zur Laufzeit gesetzt) ------------
  {
    name: 'serverkopf',
    server: true,
    warteAuf: 'text=Freundeskreis SMP',
    beruhigen: 6_000,
    teil: (seite) =>
      kachelUm(seite.getByText('Minecraft (Paper)').first(), { breite: 700, hoehe: 130 }),
  },
  {
    name: 'messwerte',
    server: true,
    warteAuf: 'text=CPU-Last',
    beruhigen: 6_000,
    teil: (seite) =>
      kachelUm(seite.getByText('CPU-Last', { exact: true }).first(), { breite: 900, hoehe: 80 }),
  },
  {
    name: 'spielerkarte',
    server: true,
    warteAuf: 'text=Verbundene Spieler',
    beruhigen: 6_000,
    teil: (seite) =>
      kachelUm(seite.getByText('Verbundene Spieler', { exact: true }).first(), {
        breite: 900,
        hoehe: 70,
      }),
  },
  {
    name: 'konsole',
    server: true,
    warteAuf: 'text=console —',
    beruhigen: 6_000,
    teil: (seite) => kachelUm(seite.getByText('console —').first(), { breite: 600, hoehe: 400 }),
  },
  { name: 'serverseite', server: true, warteAuf: 'text=CPU-Last', beruhigen: 6_000 },
  // --- Hochformat -----------------------------------------------------------
  {
    name: 'handy-uebersicht',
    pfad: '/servers',
    warteAuf: 'text=Freundeskreis SMP',
    beruhigen: 6_000,
    fenster: { width: 412, height: 915 },
  },
  {
    name: 'handy-server',
    server: true,
    warteAuf: 'text=CPU-Last',
    beruhigen: 6_000,
    fenster: { width: 412, height: 915 },
  },
];

/**
 * Vom Treffer nach oben wachsen, bis der Ausschnitt Kartengröße hat.
 *
 * Feste XPath-Tiefen („der dritte Vorfahre") treffen bei jeder Umstellung des
 * Markups etwas anderes: Hier kam einmal die ganze Seitenleiste heraus und
 * einmal eine einzelne Messwert-Kachel statt der Reihe. Die Regel „geh hoch,
 * bis es groß genug ist" beschreibt dagegen, was gemeint ist.
 */
function kachelUm(locator, { breite = 350, hoehe = 200, hoechstens = 6 } = {}) {
  return {
    async loesen() {
      let lauf = locator;
      for (let stufe = 0; stufe <= hoechstens; stufe += 1) {
        const kasten = await lauf.boundingBox().catch(() => null);
        if (kasten !== null && kasten.width >= breite && kasten.height >= hoehe) return lauf;
        lauf = lauf.locator('xpath=..');
      }
      throw new Error(`Kein Vorfahre erreicht ${breite}x${hoehe}.`);
    },
  };
}

async function anmelden(seite) {
  await seite.goto(`${BASIS}/login`, { waitUntil: 'domcontentloaded' });
  await seite.waitForTimeout(600);
  if (/\/servers/.test(seite.url())) return;
  await seite.getByLabel('Benutzername').fill(KONTO.name);
  await seite.getByLabel('Passwort', { exact: true }).fill(KONTO.passwort);
  await seite.getByText('Sicherheitsprüfung bestanden.').waitFor({ timeout: 40_000 });
  await seite.getByLabel('Passwort', { exact: true }).press('Enter');
  await seite.waitForURL(/\/servers/, { timeout: 40_000 });
  await seite.waitForTimeout(1_500);
}

async function serverAdresse(seite) {
  const antwort = await seite.evaluate(async (basis) => {
    const r = await fetch(`${basis}/api/servers`, { credentials: 'include' });
    const h = await r.json();
    const liste = h.data?.items ?? h.data ?? [];
    const smp = liste.find((s) => s.name === 'Freundeskreis SMP') ?? liste[0];
    return smp ? `/servers/${smp.id}` : null;
  }, process.env.DEMO_API ?? 'http://127.0.0.1:4000');
  if (antwort === null) throw new Error('Kein Server für die Bauteil-Aufnahmen gefunden.');
  return antwort;
}

/**
 * Die Marke aus dem Repo neben die Bilder legen.
 *
 * Der Abbinder des Films zeigt `apps/frontend/public/logo.png` – dieselbe
 * Datei, die auch das Panel ausliefert, nicht eine nachgezeichnete Kopie. Die
 * Bühne lädt ihre Bilder über einen `file:`-Pfad aus diesem Ordner; die Datei
 * muss also hier liegen. Kopiert statt verknüpft, damit der Ordner für sich
 * vollständig ist.
 */
function marke() {
  const quelle = path.resolve(HIER, '..', '..', 'apps', 'frontend', 'public', 'logo.png');
  if (!fs.existsSync(quelle)) {
    console.warn(`Marke nicht gefunden: ${quelle} – der Abbinder bleibt leer.`);
    return;
  }
  fs.copyFileSync(quelle, path.join(ZIEL, 'logo.png'));
}

async function main() {
  const gewuenscht = process.argv.slice(2);
  const liste =
    gewuenscht.length === 0 ? BILDER : BILDER.filter((b) => gewuenscht.includes(b.name));
  if (liste.length === 0) {
    console.error(`Unbekannt. Bekannt sind:\n  ${BILDER.map((b) => b.name).join('\n  ')}`);
    process.exit(2);
  }

  fs.mkdirSync(ZIEL, { recursive: true });
  marke();

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
  });

  const fertig = [];
  const fehlend = [];

  for (const bild of liste) {
    const fenster = bild.fenster ?? { width: 1600, height: 1000 };
    const ctx = await browser.newContext({
      viewport: fenster,
      deviceScaleFactor: 2,
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      colorScheme: 'dark',
    });
    await ctx.addInitScript(rundgangUeberspringen);
    const seite = await ctx.newPage();

    try {
      if (bild.abgemeldet !== true) await anmelden(seite);
      const pfad = bild.server === true ? await serverAdresse(seite) : bild.pfad;
      await seite.goto(`${BASIS}${pfad}`, { waitUntil: 'domcontentloaded' });
      if (bild.warteAuf) {
        await seite.locator(bild.warteAuf).first().waitFor({ state: 'visible', timeout: 30_000 });
      }
      await seite.waitForTimeout(bild.beruhigen ?? 1_500);

      // Das Abzeichen des Entwicklungsbetriebs gehört in kein Bild.
      await seite.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});

      const datei = path.join(ZIEL, `${bild.name}.png`);
      if (bild.teil) {
        const gewaehlt = bild.teil(seite);
        const element = typeof gewaehlt.loesen === 'function' ? await gewaehlt.loesen() : gewaehlt;
        await element.waitFor({ state: 'visible', timeout: 15_000 });
        await element.screenshot({ path: datei });
      } else {
        await seite.screenshot({ path: datei });
      }

      const groesse = fs.statSync(datei).size;
      fertig.push(`${bild.name} (${(groesse / 1024).toFixed(0)} KB)`);
      process.stdout.write(`  ✓ ${bild.name}\n`);
    } catch (fehler) {
      // Eine fehlende Kachel bricht die Bibliothek nicht ab – am Ende steht,
      // was fehlt, und der Film kann ohne sie geschnitten werden.
      fehlend.push(`${bild.name}: ${String(fehler.message).split('\n')[0]}`);
      process.stdout.write(`  ✗ ${bild.name}\n`);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();

  console.log(`\n${fertig.length} Bilder in ${path.relative(process.cwd(), ZIEL)}/`);
  if (fehlend.length > 0) {
    console.log('\nNicht aufgenommen:');
    for (const zeile of fehlend) console.log(`  ${zeile}`);
  }
}

main().catch((fehler) => {
  console.error('\nBildbibliothek abgebrochen:', fehler.message);
  process.exit(1);
});
