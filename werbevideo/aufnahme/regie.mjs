/**
 * Regie: führt das Panel vor und nimmt es in Einzelbildern auf.
 *
 * **Warum Einzelbilder und nicht die Bildschirmaufnahme von Playwright?**
 * Weil eine Aufnahme nach der Wanduhr auf einem beliebig ausgelasteten Rechner
 * ruckelt. Hier läuft stattdessen Chromiums virtuelle Uhr: Vor jedem Bild wird
 * die Seitenzeit um genau ein Bild weitergestellt, dann wird fotografiert.
 * Ob ein Bild 20 ms oder 500 ms braucht, ändert am Ergebnis nichts – jede
 * Bewegung im Video ist exakt gleichmäßig, auch die der Oberfläche selbst.
 *
 * **Warum die Kamera im Browser und nicht im Schnitt?** Ein Zoom im Schnitt
 * rechnet Bildpunkte hoch. Ein `transform` auf der Seite lässt Chromium den
 * Text in der Zielgröße neu rastern – der Zoom ist so scharf wie das
 * Standbild.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { schichtSkript } from './schicht.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, '..', '..');

export const BILDRATE = 30;
const BILDDAUER = 1000 / BILDRATE;

/** Weiche Beschleunigung – Start und Ende ohne Ruck. */
export const weich = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Schnell los, sanft aus – für Kamerafahrten die natürlichere Kurve. */
export const auslaufend = (t) => 1 - (1 - t) ** 3;
export const linear = (t) => t;

const mische = (von, nach, t) => von + (nach - von) * t;

export class Regie {
  static async oeffnen(optionen = {}) {
    const regie = new Regie(optionen);
    await regie.#start();
    return regie;
  }

  constructor(optionen) {
    this.breite = optionen.breite ?? 1920;
    this.hoehe = optionen.hoehe ?? 1080;
    this.ziel = optionen.ziel ?? path.join(WURZEL, 'werbevideo', 'aufnahmen');
    this.basis = optionen.basis ?? 'http://127.0.0.1:3000';
    this.steuer = optionen.steuer ?? 'http://127.0.0.1:4500';
    this.gueteBild = optionen.gueteBild ?? 94;
    this.ffmpeg = optionen.ffmpeg ?? process.env.FFMPEG ?? 'ffmpeg';

    this.szenenName = null;
    this.bildNummer = 0;
    this.bilderOrdner = null;
    this.geschrieben = [];

    this.zustand = {
      kamera: { zoom: 1, x: this.breite / 2, y: this.hoehe / 2 },
      blende: 1,
      titel: null,
      untertitel: null,
      zeiger: null,
      ring: null,
      markierung: null,
    };
  }

  async #start() {
    this.browser = await chromium.launch({
      executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
    });
    this.ctx = await this.browser.newContext({
      viewport: { width: this.breite, height: this.hoehe },
      deviceScaleFactor: 1,
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      colorScheme: 'dark',
      bypassCSP: true,
      reducedMotion: 'no-preference',
    });
    await this.ctx.addInitScript(schichtSkript());
    this.seite = await this.ctx.newPage();
    this.cdp = await this.ctx.newCDPSession(this.seite);
    fs.mkdirSync(this.ziel, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // Uhr
  // -------------------------------------------------------------------------

  /** Die Seitenzeit anhalten – ab hier bewegt sich nur noch, was wir schalten. */
  async #uhrAnhalten() {
    await this.cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  }

  /** Die Seitenzeit um `ms` weiterstellen und warten, bis die Seite fertig ist. */
  async #uhrWeiter(ms) {
    const abgelaufen = new Promise((loesen) => {
      this.cdp.once('Emulation.virtualTimeBudgetExpired', loesen);
    });
    await this.cdp.send('Emulation.setVirtualTimePolicy', {
      policy: 'pauseIfNetworkFetchesPending',
      budget: ms,
      maxVirtualTimeTaskStarvationCount: 8000,
    });
    // Notbremse: Hängt eine Anfrage, darf die Aufnahme nicht mit ihr stehen
    // bleiben – ein Bild zu viel ist besser als ein Abbruch nach zehn Minuten.
    await Promise.race([abgelaufen, new Promise((r) => setTimeout(r, 8000))]);
  }

  /**
   * Etwas tun, das echte Zeit braucht (anmelden, laden, auf die API warten),
   * ohne dabei aufzunehmen.
   *
   * Die Seitenzeit läuft hier **in kleinen Schritten** weiter, nicht mit der
   * Richtlinie `advance`. Die lässt Chromium die virtuelle Uhr so schnell
   * laufen, wie die Aufgabenschlange es zulässt – in einem einzigen Anmeldevorgang
   * vergingen so Tage. Im Bild stand danach „Laufzeit 3 d 14 h" an einem Server,
   * der vor Minuten angelegt worden war. Jeder Schritt hier entspricht ungefähr
   * der Zeit, die er wirklich braucht; die Uhr der Seite bleibt damit plausibel.
   */
  async imVorlauf(auftrag) {
    let fertig = false;
    let ergebnis;
    let fehler = null;
    const lauf = Promise.resolve()
      .then(auftrag)
      .then(
        (wert) => {
          ergebnis = wert;
        },
        (problem) => {
          fehler = problem;
        },
      )
      .finally(() => {
        fertig = true;
      });

    while (!fertig) {
      await this.#uhrWeiter(50);
    }
    await lauf;
    if (fehler !== null) throw fehler;
    return ergebnis;
  }

  // -------------------------------------------------------------------------
  // Aufnahme
  // -------------------------------------------------------------------------

  async szene(name) {
    this.szenenName = name;
    this.bildNummer = 0;
    this.bilderOrdner = path.join(this.ziel, '.bilder', name);
    fs.rmSync(this.bilderOrdner, { recursive: true, force: true });
    fs.mkdirSync(this.bilderOrdner, { recursive: true });
    await this.#uhrAnhalten();
    process.stdout.write(`\nSzene „${name}" `);
  }

  /** Ein Einzelbild: Zustand setzen, Uhr ein Bild weiter, fotografieren. */
  async #bild() {
    await this.seite.evaluate((z) => window.__regie?.setze(z), this.zustand);
    await this.#uhrWeiter(BILDDAUER);
    const datei = path.join(this.bilderOrdner, String(this.bildNummer).padStart(6, '0') + '.jpeg');
    await this.seite.screenshot({ path: datei, type: 'jpeg', quality: this.gueteBild });
    this.bildNummer += 1;
    if (this.bildNummer % 30 === 0) process.stdout.write('.');
  }

  /** Über eine Dauer hinweg aufnehmen und dabei je Bild `auftrag(t)` aufrufen. */
  async #ueber(dauer, auftrag, kurve = weich) {
    const bilder = Math.max(1, Math.round(dauer / BILDDAUER));
    for (let i = 1; i <= bilder; i += 1) {
      await auftrag(kurve(i / bilder), i / bilder);
      await this.#bild();
    }
  }

  /** Stillstand – die Seite läuft weiter, die Kamera nicht. */
  async halten(dauer) {
    await this.#ueber(dauer, () => {}, linear);
  }

  // -------------------------------------------------------------------------
  // Kamera
  // -------------------------------------------------------------------------

  /**
   * Kamerafahrt. Ziel ist entweder ein Element (`auf`) oder ein Punkt
   * (`x`/`y`) in Seitenkoordinaten, dazu ein Zoomfaktor.
   */
  async kamera({ auf = null, zoom = 1, dauer = 1200, kurve = auslaufend, rand = 40 } = {}) {
    const ziel = await this.#kameraZiel({ auf, zoom, rand });
    const von = { ...this.zustand.kamera };
    await this.#ueber(
      dauer,
      (t) => {
        this.zustand.kamera = {
          zoom: mische(von.zoom, ziel.zoom, t),
          x: mische(von.x, ziel.x, t),
          y: mische(von.y, ziel.y, t),
        };
      },
      kurve,
    );
  }

  /** Kamera ohne Fahrt setzen (für den ersten Bildausschnitt einer Szene). */
  async kameraSetzen({ auf = null, zoom = 1, rand = 40 } = {}) {
    this.zustand.kamera = await this.#kameraZiel({ auf, zoom, rand });
  }

  /**
   * Bildschirmrechteck eines Ziels. `ziel` ist ein Playwright-Selektor (auch
   * `text=`/`:has-text()`) oder ein fertiger Locator – bewusst nicht
   * `querySelector`: Die Oberfläche wird über sichtbaren Text angesprochen,
   * nicht über Klassennamen, die sich beim nächsten Umbau ändern.
   */
  async rechteck(ziel, { sichtbar = true } = {}) {
    const locator = typeof ziel === 'string' ? this.seite.locator(ziel).first() : ziel;
    if (sichtbar) await locator.waitFor({ state: 'visible', timeout: 15_000 });
    const kasten = await locator.boundingBox();
    if (kasten === null) throw new Error(`Ziel ohne Ausdehnung: ${String(ziel)}`);
    return { x: kasten.x, y: kasten.y, breite: kasten.width, hoehe: kasten.height };
  }

  /** Dasselbe Rechteck in Seitenkoordinaten – also ohne die Kamera. */
  async seitenRechteck(ziel) {
    const r = await this.rechteck(ziel);
    const { zoom, x, y } = this.zustand.kamera;
    const tx = this.breite / 2 - x * zoom;
    const ty = this.hoehe / 2 - y * zoom;
    return {
      x: (r.x - tx) / zoom,
      y: (r.y - ty) / zoom,
      breite: r.breite / zoom,
      hoehe: r.hoehe / zoom,
    };
  }

  /**
   * Hält den Bildausschnitt innerhalb der Seite.
   *
   * Ohne das schiebt eine Fahrt auf ein Element am Rand schwarze Flächen ins
   * Bild – die Seite hört dort auf, die Kamera nicht.
   */
  #einfangen({ zoom, x, y }) {
    const halbeBreite = this.breite / (2 * zoom);
    const halbeHoehe = this.hoehe / (2 * zoom);
    const klemme = (wert, min, max) =>
      min > max ? (min + max) / 2 : Math.min(max, Math.max(min, wert));
    return {
      zoom,
      x: klemme(x, halbeBreite, this.breite - halbeBreite),
      y: klemme(y, halbeHoehe, this.hoehe - halbeHoehe),
    };
  }

  async #kameraZiel({ auf, zoom, rand }) {
    if (auf === null) {
      return this.#einfangen({ zoom, x: this.breite / 2, y: this.hoehe / 2 });
    }
    const rechteck = await this.seitenRechteck(auf);

    // Ohne ausdrücklichen Zoom so nah heran, wie das Element es zulässt.
    const passend = Math.min(
      this.breite / (rechteck.breite + rand * 2),
      this.hoehe / (rechteck.hoehe + rand * 2),
    );
    const z = zoom === 'passend' ? Math.min(2.2, Math.max(1, passend)) : zoom;
    return this.#einfangen({
      zoom: z,
      x: rechteck.x + rechteck.breite / 2,
      y: rechteck.y + rechteck.hoehe / 2,
    });
  }

  // -------------------------------------------------------------------------
  // Blenden, Titel, Untertitel
  // -------------------------------------------------------------------------

  async aufblenden(dauer = 700) {
    await this.#ueber(dauer, (t) => {
      this.zustand.blende = 1 - t;
    });
    this.zustand.blende = 0;
  }

  async abblenden(dauer = 700) {
    await this.#ueber(dauer, (t) => {
      this.zustand.blende = t;
    });
    this.zustand.blende = 1;
  }

  /** Titelkarte: kommt, steht, geht. */
  async titelkarte(zeile, unterzeile = '', { ein = 600, stand = 1600, aus = 500 } = {}) {
    this.zustand.titel = { zeile, unterzeile, deckkraft: 0 };
    await this.#ueber(ein, (t) => {
      this.zustand.titel = { zeile, unterzeile, deckkraft: t };
    });
    await this.halten(stand);
    await this.#ueber(aus, (t) => {
      this.zustand.titel = { zeile, unterzeile, deckkraft: 1 - t };
    });
    this.zustand.titel = null;
  }

  /** Erklärzeile am unteren Bildrand. */
  async untertitel(text, { ein = 380, stand = 1800, aus = 320 } = {}) {
    await this.untertitelEin(text, ein);
    await this.halten(stand);
    await this.untertitelAus(aus);
  }

  async untertitelEin(text, dauer = 380) {
    await this.#ueber(dauer, (t) => {
      this.zustand.untertitel = { text, deckkraft: t };
    });
    this.zustand.untertitel = { text, deckkraft: 1 };
  }

  async untertitelAus(dauer = 320) {
    const text = this.zustand.untertitel?.text ?? '';
    await this.#ueber(dauer, (t) => {
      this.zustand.untertitel = { text, deckkraft: 1 - t };
    });
    this.zustand.untertitel = null;
  }

  /** Eine Stelle hervorheben und den Rest abdunkeln. */
  async markiere(wahl, { ein = 400 } = {}) {
    const rechteck = await this.rechteck(wahl);
    await this.#ueber(ein, (t) => {
      this.zustand.markierung = { rechteck, deckkraft: t };
    });
  }

  async markierungAus(dauer = 300) {
    const markierung = this.zustand.markierung;
    if (!markierung) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.markierung = { ...markierung, deckkraft: 1 - t };
    });
    this.zustand.markierung = null;
  }

  // -------------------------------------------------------------------------
  // Zeiger und Eingaben
  // -------------------------------------------------------------------------

  /** Den Zeiger zu einem Punkt im Bild führen. */
  async zeigerZu(x, y, dauer = 620) {
    const von = this.zustand.zeiger ?? {
      x: this.breite * 0.62,
      y: this.hoehe * 0.86,
      deckkraft: 0,
    };
    await this.#ueber(dauer, (t) => {
      this.zustand.zeiger = {
        x: mische(von.x, x, t),
        y: mische(von.y, y, t),
        deckkraft: Math.min(1, (von.deckkraft ?? 0) + t * 2),
      };
    });
    this.zustand.zeiger = { x, y, deckkraft: 1 };
    await this.seite.mouse.move(x, y);
  }

  async zeigerAus(dauer = 300) {
    const von = this.zustand.zeiger;
    if (!von) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.zeiger = { ...von, deckkraft: 1 - t };
    });
    this.zustand.zeiger = null;
  }

  /**
   * Auf ein Element klicken: hinfahren, kurz innehalten, Klickring, klicken.
   * Der Ring ist das, was im Video den Klick sichtbar macht – ein echter
   * Mauszeiger steht auf einem Bildschirmfoto nicht mit drauf.
   */
  async klicke(wahl, { hin = 620, nach = 260 } = {}) {
    const r = await this.rechteck(wahl);
    const x = r.x + r.breite / 2;
    const y = r.y + r.hoehe / 2;

    await this.zeigerZu(x, y, hin);
    await this.halten(120);

    // Ring aufziehen, gleichzeitig klicken.
    await this.seite.mouse.click(x, y);
    await this.#ueber(
      420,
      (t) => {
        this.zustand.ring = { x, y, radius: 12 + t * 44, deckkraft: 1 - t };
      },
      linear,
    );
    this.zustand.ring = null;
    if (nach > 0) await this.halten(nach);
  }

  /** In ein Feld tippen – Zeichen für Zeichen, mit ungleichmäßigem Takt. */
  async tippe(wahl, text, { proZeichen = 62 } = {}) {
    const r = await this.rechteck(wahl).catch(() => null);
    if (r !== null) {
      await this.zeigerZu(r.x + Math.min(r.breite - 30, 40), r.y + r.hoehe / 2, 450);
      await this.seite.mouse.click(r.x + Math.min(r.breite - 30, 40), r.y + r.hoehe / 2);
    }
    for (const zeichen of text) {
      await this.seite.keyboard.type(zeichen);
      // Menschen tippen nicht im Metronom.
      const takt = proZeichen * (0.62 + Math.random() * 0.85);
      await this.#ueber(takt, () => {}, linear);
    }
  }

  // -------------------------------------------------------------------------
  // Navigation und Bühnensteuerung
  // -------------------------------------------------------------------------

  /**
   * Seite aufrufen und zur Ruhe kommen lassen.
   *
   * Bewusst `domcontentloaded` statt `networkidle`: Das Panel hält einen
   * Live-Kanal und den Benachrichtigungskanal offen, im Entwicklungsbetrieb
   * kommt die Aktualisierungsverbindung von Next.js dazu. „Kein Netzverkehr
   * mehr" tritt damit nie ein – `networkidle` läuft in den Zeitüberlauf,
   * obwohl die Seite längst steht.
   */
  async gehe(pfad, { beruhigen = 1800, warteAuf = null } = {}) {
    await this.imVorlauf(async () => {
      await this.seite.goto(`${this.basis}${pfad}`, { waitUntil: 'domcontentloaded' });
      if (warteAuf !== null) {
        await this.seite.locator(warteAuf).first().waitFor({ state: 'visible', timeout: 30_000 });
      }
      await this.seite.waitForTimeout(beruhigen);
    });
  }

  /** Anmelden – gehört zum Aufbau, nicht ins Video. */
  async anmelden(benutzer, passwort) {
    await this.imVorlauf(async () => {
      await this.seite.goto(`${this.basis}/login`, { waitUntil: 'domcontentloaded' });
      await this.seite.getByLabel('Benutzername').fill(benutzer);
      await this.seite.getByLabel('Passwort', { exact: true }).fill(passwort);
      await this.seite.getByText('Sicherheitsprüfung bestanden.').waitFor({ timeout: 40_000 });
      await this.seite.getByRole('button', { name: 'Anmelden' }).click();
      await this.seite.waitForURL(/\/servers/, { timeout: 40_000 });
      await this.seite.waitForTimeout(2500);
    });
  }

  /** Die Demo-Node steuern (Konsolenzeilen, Spielerzahlen). */
  async buehne(pfad) {
    return this.imVorlauf(async () => {
      const antwort = await fetch(`${this.steuer}${pfad}`);
      return antwort.json();
    });
  }

  // -------------------------------------------------------------------------
  // Schnitt der Szene
  // -------------------------------------------------------------------------

  /** Die aufgenommenen Bilder zu einem Clip zusammenfassen. */
  async schnitt() {
    const name = this.szenenName;
    const datei = path.join(this.ziel, `${name}.mp4`);
    process.stdout.write(` ${this.bildNummer} Bilder → kodiere `);

    await neuerLauf(this.ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(BILDRATE),
      '-i',
      path.join(this.bilderOrdner, '%06d.jpeg'),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      datei,
    ]);

    fs.rmSync(this.bilderOrdner, { recursive: true, force: true });
    this.geschrieben.push({ name, datei, bilder: this.bildNummer });
    process.stdout.write(`fertig (${(this.bildNummer / BILDRATE).toFixed(1)} s)`);
    this.szenenName = null;
    return datei;
  }

  async schliessen() {
    await this.browser?.close();
  }
}

export function neuerLauf(befehl, argumente) {
  return new Promise((loesen, ablehnen) => {
    const lauf = spawn(befehl, argumente, { stdio: ['ignore', 'inherit', 'inherit'] });
    lauf.on('error', ablehnen);
    lauf.on('close', (code) =>
      code === 0 ? loesen() : ablehnen(new Error(`${befehl} endete mit ${code}`)),
    );
  });
}
