/**
 * Der Motion-Renderer.
 *
 * Nimmt keine Bildschirmaufnahme auf, sondern **inszeniert** die Ausschnitte
 * aus `motion/bilder/` auf einer eigenen Bühne (`buehne.html`): schwebende
 * Kacheln, getippte Schrift, Scan-Ecken, Logo-Abbinder.
 *
 * **Warum das einfacher ist als die Bildschirmaufnahme:** Auf dieser Bühne
 * bewegt sich nichts von selbst. Es gibt keine Übergänge, keine Animationen,
 * keine Live-Daten - jedes Einzelbild setzt dieser Renderer den vollständigen
 * Zustand. Die virtuelle Uhr aus der Regie braucht es deshalb gar nicht:
 * Zustand setzen, fotografieren, weiter.
 *
 * Die Bewegung selbst entsteht hier in Node: Tweens, die je Bild einen Schritt
 * weiterrücken - dieselbe Mechanik wie die Hintergrund-Fahrten der Regie.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { BILDRATE, auslaufend, linear, neuerLauf, weich } from '../aufnahme/regie.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const BILDDAUER = 1000 / BILDRATE;

export { auslaufend, linear, weich };

/** Sanftes Hin und Her – für das dauernde Driften der Kacheln. */
export const mische = (von, nach, t) => von + (nach - von) * t;

export class Kino {
  static async oeffnen(optionen = {}) {
    const kino = new Kino(optionen);
    await kino.#start();
    return kino;
  }

  constructor(optionen = {}) {
    this.breite = optionen.breite ?? 1920;
    this.hoehe = optionen.hoehe ?? 1080;
    this.ziel = optionen.ziel ?? path.join(HIER, '..', 'aufnahmen');
    this.gueteBild = optionen.gueteBild ?? 95;
    this.ffmpeg = optionen.ffmpeg ?? process.env.FFMPEG ?? 'ffmpeg';

    this.szenenName = null;
    this.bildNummer = 0;
    this.bilderOrdner = null;
    this.geschrieben = [];
    this.zeit = 0;

    /** Bewegungen, die im Hintergrund weiterlaufen (siehe Regie). */
    this.hintergrund = [];

    this.zustand = {
      grund: { hell: 0, glut: 0.5, glutHub: 0 },
      kacheln: [],
      scan: null,
      marken: [],
      titel: null,
      zeile: null,
      logo: null,
      vignette: 0.25,
      blitz: null,
      stoss: 1,
      blende: 1,
    };

    /** Driften: je Kachel eine eigene Phase, damit nichts im Gleichschritt liegt. */
    this.drift = [];
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
    });
    this.seite = await this.ctx.newPage();
    await this.seite.goto(pathToFileURL(path.join(HIER, 'buehne.html')).href, {
      waitUntil: 'load',
    });
    fs.mkdirSync(this.ziel, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // Bausteine der Bühne
  // -------------------------------------------------------------------------

  /** Pfad eines Bildes aus der Bibliothek, wie die Bühne ihn laden kann. */
  bild(name) {
    const datei = path.join(HIER, 'bilder', `${name}.png`);
    if (!fs.existsSync(datei)) {
      throw new Error(`Bild „${name}" fehlt. Bibliothek erzeugen: node motion/bilder.mjs ${name}`);
    }
    return `bilder/${name}.png`;
  }

  /**
   * Die Kachel-Streuung setzen.
   *
   * Jede Kachel bekommt eine eigene Driftphase; im Bild bewegt sich dadurch
   * alles leicht gegeneinander, statt wie eine Tapete zu wandern.
   */
  kachelnSetzen(liste) {
    this.zustand.kacheln = liste.map((k) => ({
      ...k,
      bild: k.bild.startsWith('bilder/') ? k.bild : this.bild(k.bild),
    }));
    this.drift = liste.map((k, i) => ({
      phase: k.driftPhase ?? i * 1.7,
      weite: k.driftWeite ?? 9,
      tempo: k.driftTempo ?? 0.12 + (i % 5) * 0.02,
    }));
  }

  /** Eine einzelne Kachel verändern (Position, Größe, Deckkraft …). */
  kachel(index, aenderung) {
    const k = this.zustand.kacheln[index];
    if (!k) throw new Error(`Kachel ${String(index)} gibt es nicht.`);
    Object.assign(k, aenderung);
  }

  // -------------------------------------------------------------------------
  // Aufnahme
  // -------------------------------------------------------------------------

  async szene(name) {
    this.szenenName = name;
    this.bildNummer = 0;
    this.zeit = 0;
    this.bilderOrdner = path.join(this.ziel, '.bilder', name);
    fs.rmSync(this.bilderOrdner, { recursive: true, force: true });
    fs.mkdirSync(this.bilderOrdner, { recursive: true });
    process.stdout.write(`\nMotion „${name}" `);
  }

  #hintergrundWeiter() {
    for (const bewegung of this.hintergrund) {
      bewegung.verstrichen += BILDDAUER;
      const t = Math.min(1, bewegung.verstrichen / bewegung.dauer);
      bewegung.anwenden(bewegung.kurve(t));
    }
    this.hintergrund = this.hintergrund.filter((b) => b.verstrichen < b.dauer);
  }

  /** Ein Einzelbild: Drift rechnen, Zustand setzen, fotografieren. */
  async #bild() {
    this.#hintergrundWeiter();
    this.zeit += BILDDAUER / 1000;

    // Das Driften liegt über den gesetzten Positionen und verändert sie nicht.
    const kacheln = this.zustand.kacheln.map((k, i) => {
      const d = this.drift[i];
      if (!d) return k;
      return {
        ...k,
        x: k.x + Math.sin(this.zeit * d.tempo * 2 * Math.PI + d.phase) * d.weite,
        y: k.y + Math.cos(this.zeit * d.tempo * 1.6 * Math.PI + d.phase) * d.weite * 0.7,
      };
    });

    const glutHub = Math.sin(this.zeit * 0.35) * 2.5;

    await this.seite.evaluate((z) => window.__kino.setze(z), {
      ...this.zustand,
      kacheln,
      grund: { ...this.zustand.grund, glutHub },
    });

    /*
     * Erst fotografieren, wenn die Bilder wirklich da sind.
     *
     * Eine frisch gesetzte Kachel und die Marke sind im Moment des
     * Zustandswechsels noch leere `<img>`-Knoten. Ohne diese Abfrage fiele
     * genau das erste Einzelbild nach jedem Wechsel ohne sie aus – im
     * fertigen Clip ein Zucken von einem Dreißigstel.
     */
    await this.seite.waitForFunction(() => window.__kino.bilderBereit(), null, { timeout: 10_000 });

    const datei = path.join(this.bilderOrdner, String(this.bildNummer).padStart(6, '0') + '.jpeg');
    await this.seite.screenshot({ path: datei, type: 'jpeg', quality: this.gueteBild });
    this.bildNummer += 1;
    if (this.bildNummer % 30 === 0) process.stdout.write('.');
  }

  async #ueber(dauer, auftrag, kurve = weich) {
    const bilder = Math.max(1, Math.round(dauer / BILDDAUER));
    for (let i = 1; i <= bilder; i += 1) {
      await auftrag(kurve(i / bilder), i / bilder);
      await this.#bild();
    }
  }

  async halten(dauer) {
    await this.#ueber(dauer, () => {}, linear);
  }

  /** Eine Bewegung anstoßen, die unter dem Folgenden weiterläuft. */
  fahrtStarten(dauer, anwenden, kurve = auslaufend) {
    this.hintergrund.push({ dauer, verstrichen: 0, kurve, anwenden });
  }

  // -------------------------------------------------------------------------
  // Schrift
  // -------------------------------------------------------------------------

  /**
   * Text tippen – Zeichen für Zeichen, mit Cursor und farbig auslaufendem Ende.
   */
  async tippen(text, { proZeichen = 42, groesse = 128, y = 460, dunkel = false, halten = 0 } = {}) {
    const setzen = (gezeigt, strich = true) => {
      this.zustand.titel = { text, gezeigt, schwanz: 3, strich, groesse, y, dunkel, deckkraft: 1 };
    };
    setzen(0);
    await this.#ueber(text.length * proZeichen, (t) => setzen(t * text.length), linear);
    setzen(text.length);
    if (halten > 0) await this.halten(halten);
  }

  /** Titel einblenden, ohne zu tippen. */
  async titelEin(text, { dauer = 500, groesse = 128, y = 460, dunkel = false } = {}) {
    await this.#ueber(dauer, (t) => {
      this.zustand.titel = {
        text,
        gezeigt: text.length,
        schwanz: 0,
        strich: false,
        groesse,
        y: y + (1 - t) * 26,
        dunkel,
        deckkraft: t,
      };
    });
  }

  async titelAus(dauer = 360) {
    const titel = this.zustand.titel;
    if (!titel) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.titel = { ...titel, deckkraft: 1 - t, y: titel.y - t * 22 };
    });
    this.zustand.titel = null;
  }

  async zeileEin(text, { dauer = 420, y = 640, dunkel = false } = {}) {
    await this.#ueber(dauer, (t) => {
      this.zustand.zeile = { text, deckkraft: t, y: y + (1 - t) * 16, dunkel };
    });
  }

  async zeileAus(dauer = 320) {
    const zeile = this.zustand.zeile;
    if (!zeile) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.zeile = { ...zeile, deckkraft: 1 - t };
    });
    this.zustand.zeile = null;
  }

  // -------------------------------------------------------------------------
  // Blenden, Scan, Logo
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

  /** Von Dunkel nach Hell (oder zurück) überblenden. */
  async grundWechseln(hell, dauer = 900) {
    const von = this.zustand.grund.hell;
    await this.#ueber(dauer, (t) => {
      this.zustand.grund = { ...this.zustand.grund, hell: mische(von, hell, t) };
    });
  }

  /** Die Scan-Ecken um eine Stelle legen. */
  async scanEin(rechteck, { dauer = 420 } = {}) {
    await this.#ueber(dauer, (t) => {
      this.zustand.scan = {
        ...rechteck,
        breite: rechteck.breite * mische(1.12, 1, t),
        hoehe: rechteck.hoehe * mische(1.12, 1, t),
        deckkraft: t,
      };
    });
  }

  async scanAus(dauer = 300) {
    const scan = this.zustand.scan;
    if (!scan) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.scan = { ...scan, deckkraft: 1 - t };
    });
    this.zustand.scan = null;
  }

  /** Ein Feld auf der Kachel hervorheben. */
  async markeEin(rechteck, { dauer = 320 } = {}) {
    const index = this.zustand.marken.length;
    this.zustand.marken.push({ ...rechteck, deckkraft: 0 });
    await this.#ueber(dauer, (t) => {
      this.zustand.marken[index] = { ...rechteck, deckkraft: t };
    });
  }

  async markenAus(dauer = 300) {
    const marken = [...this.zustand.marken];
    if (marken.length === 0) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.marken = marken.map((m) => ({ ...m, deckkraft: (m.deckkraft ?? 1) * (1 - t) }));
    });
    this.zustand.marken = [];
  }

  async logoZeigen({ zeile = '', dauer = 900, dunkel = false, halten = 1_400 } = {}) {
    await this.#ueber(dauer, (t) => {
      this.zustand.logo = { deckkraft: t, skala: mische(0.92, 1, t), zeile, dunkel };
    });
    if (halten > 0) await this.halten(halten);
  }

  // -------------------------------------------------------------------------
  // Schlag: Stoß, Blitz, harter Wechsel
  // -------------------------------------------------------------------------

  /**
   * Zoom-Stoß auf den Takt.
   *
   * Schnell hinein, etwas langsamer zurück – genau so sitzt der Schlag auf der
   * Eins. Andersherum (langsam hinein) wirkt es wie ein Zoom, nicht wie ein
   * Schnitt.
   */
  async stoss({ staerke = 0.05, hin = 100, zurueck = 200 } = {}) {
    await this.#ueber(hin, (t) => {
      this.zustand.stoss = 1 + staerke * t;
    });
    await this.#ueber(zurueck, (t) => {
      this.zustand.stoss = 1 + staerke * (1 - t);
    });
    this.zustand.stoss = 1;
  }

  /**
   * Heller Schlag über das Bild.
   *
   * Sehr kurz hinein, deutlich länger hinaus: Das ist der Verlauf, den ein
   * Blitz im Auge hinterlässt. Gleich lang in beide Richtungen sieht aus wie
   * eine Überblendung nach Weiß.
   */
  async blitz({ farbe = '#ffffff', hoehe = 0.8, ein = 60, aus = 240 } = {}) {
    await this.#ueber(
      ein,
      (t) => {
        this.zustand.blitz = { farbe, deckkraft: hoehe * t };
      },
      linear,
    );
    await this.#ueber(aus, (t) => {
      this.zustand.blitz = { farbe, deckkraft: hoehe * (1 - t) };
    });
    this.zustand.blitz = null;
  }

  /**
   * Harter Wechsel: Blitz und Stoß auf demselben Schlag.
   *
   * Die beiden laufen bewusst übereinander – der Stoß im Hintergrund, während
   * der Blitz die Bilder darunter verdeckt. Nacheinander abgespielt wären es
   * zwei Ereignisse statt eines Schnitts.
   */
  async schlag({ staerke = 0.06, farbe = '#ffffff', hoehe = 0.85 } = {}) {
    this.fahrtStarten(
      300,
      (t) => {
        // Hin und zurück in einer Bewegung: erst auf, dann ab.
        this.zustand.stoss = 1 + staerke * Math.sin(Math.PI * t);
      },
      linear,
    );
    await this.blitz({ farbe, hoehe });
    this.zustand.stoss = 1;
  }

  async logoAus(dauer = 500) {
    const logo = this.zustand.logo;
    if (!logo) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.logo = { ...logo, deckkraft: 1 - t, skala: mische(1, 1.04, t) };
    });
    this.zustand.logo = null;
  }

  // -------------------------------------------------------------------------
  // Schnitt
  // -------------------------------------------------------------------------

  async schnitt() {
    const name = this.szenenName;
    const datei = path.join(this.ziel, `${name}.mp4`);

    const vorhanden = fs.readdirSync(this.bilderOrdner).filter((d) => d.endsWith('.jpeg')).length;
    if (vorhanden !== this.bildNummer) {
      throw new Error(
        `Motion „${name}": ${String(this.bildNummer)} Bilder gezählt, ${String(vorhanden)} auf der Platte.`,
      );
    }

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
